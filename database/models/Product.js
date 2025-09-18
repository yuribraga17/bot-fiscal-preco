const database = require('../database');
const logger = require('../../utils/logger');

/**
 * Modelo para gerenciamento de produtos
 * Contém todos os métodos para CRUD e operações específicas
 */
class Product {
  
  /**
   * Cria um novo produto
   * @param {Object} productData - Dados do produto
   */
  static async create(productData) {
    try {
      const { 
        name, 
        url, 
        currentPrice, 
        targetPrice, 
        channelId, 
        guildId, 
        userId,
        promotionThreshold = null,
        metadata = {}
      } = productData;

      // Validações
      if (!url || !targetPrice || !channelId || !guildId || !userId) {
        throw new Error('Dados obrigatórios não fornecidos');
      }

      const sql = `
        INSERT INTO products (
          name, url, current_price, target_price, 
          channel_id, guild_id, user_id, promotion_threshold, 
          metadata, last_checked
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `;

      const result = await database.run(sql, [
        name || 'Produto sem nome',
        url,
        currentPrice,
        targetPrice,
        channelId,
        guildId,
        userId,
        promotionThreshold,
        JSON.stringify(metadata)
      ]);

      logger.info('Produto criado', { 
        id: result.id, 
        name, 
        url, 
        targetPrice,
        guildId 
      });

      return { id: result.id, ...productData };

    } catch (error) {
      logger.error('Erro ao criar produto:', error, { productData });
      throw error;
    }
  }

  /**
   * Busca produto por ID
   * @param {number} id - ID do produto
   */
  static async findById(id) {
    try {
      const sql = 'SELECT * FROM products WHERE id = ?';
      const product = await database.get(sql, [id]);
      
      if (product && product.metadata) {
        try {
          product.metadata = JSON.parse(product.metadata);
        } catch (e) {
          product.metadata = {};
        }
      }

      return product;
    } catch (error) {
      logger.error('Erro ao buscar produto por ID:', error, { id });
      throw error;
    }
  }

  /**
   * Busca produtos por guild
   * @param {string} guildId - ID do servidor Discord
   * @param {number} limit - Limite de resultados
   * @param {boolean} activeOnly - Apenas produtos ativos
   */
  static async findByGuild(guildId, limit = 10, activeOnly = true) {
    try {
      const sql = `
        SELECT p.*, 
               (SELECT COUNT(*) FROM price_history ph WHERE ph.product_id = p.id) as history_count,
               (SELECT COUNT(*) FROM notifications n WHERE n.product_id = p.id) as notification_count
        FROM products p 
        WHERE p.guild_id = ? ${activeOnly ? 'AND p.is_active = 1' : ''}
        ORDER BY p.created_at DESC 
        LIMIT ?
      `;

      const products = await database.all(sql, [guildId, limit]);
      
      return products.map(product => {
        if (product.metadata) {
          try {
            product.metadata = JSON.parse(product.metadata);
          } catch (e) {
            product.metadata = {};
          }
        }
        return product;
      });

    } catch (error) {
      logger.error('Erro ao buscar produtos por guild:', error, { guildId, limit });
      throw error;
    }
  }

  /**
   * Busca produtos ativos para monitoramento
   */
  static async findActive() {
    try {
      const sql = `
        SELECT * FROM products 
        WHERE is_active = 1 
        ORDER BY last_checked ASC NULLS FIRST
      `;

      const products = await database.all(sql);
      
      return products.map(product => {
        if (product.metadata) {
          try {
            product.metadata = JSON.parse(product.metadata);
          } catch (e) {
            product.metadata = {};
          }
        }
        return product;
      });

    } catch (error) {
      logger.error('Erro ao buscar produtos ativos:', error);
      throw error;
    }
  }

  /**
   * Busca produtos que precisam de verificação
   * @param {number} intervalMinutes - Intervalo em minutos desde a última verificação
   */
  static async findForCheck(intervalMinutes = 60) {
    try {
      const sql = `
        SELECT * FROM products 
        WHERE is_active = 1 
        AND (
          last_checked IS NULL 
          OR last_checked < datetime('now', '-' || ? || ' minutes')
        )
        AND error_count < 5
        ORDER BY last_checked ASC NULLS FIRST
        LIMIT 50
      `;

      const products = await database.all(sql, [intervalMinutes]);
      
      return products.map(product => {
        if (product.metadata) {
          try {
            product.metadata = JSON.parse(product.metadata);
          } catch (e) {
            product.metadata = {};
          }
        }
        return product;
      });

    } catch (error) {
      logger.error('Erro ao buscar produtos para verificação:', error);
      throw error;
    }
  }

  /**
   * Atualiza um produto
   * @param {number} id - ID do produto
   * @param {Object} updates - Dados para atualizar
   */
  static async update(id, updates) {
    try {
      // Preparar campos para atualização
      const allowedFields = [
        'name', 'current_price', 'target_price', 'last_price',
        'promotion_threshold', 'is_active', 'check_count', 
        'error_count', 'last_error', 'metadata'
      ];

      const fields = Object.keys(updates).filter(key => allowedFields.includes(key));
      
      if (fields.length === 0) {
        throw new Error('Nenhum campo válido para atualização');
      }

      // Converter metadata para JSON se necessário
      if (updates.metadata && typeof updates.metadata === 'object') {
        updates.metadata = JSON.stringify(updates.metadata);
      }

      const values = fields.map(field => updates[field]);
      const sql = `
        UPDATE products 
        SET ${fields.map(field => `${field} = ?`).join(', ')}, 
            last_checked = CURRENT_TIMESTAMP 
        WHERE id = ?
      `;

      const result = await database.run(sql, [...values, id]);

      if (result.changes === 0) {
        throw new Error('Produto não encontrado');
      }

      logger.debug('Produto atualizado', { id, fields, changes: result.changes });
      return result;

    } catch (error) {
      logger.error('Erro ao atualizar produto:', error, { id, updates });
      throw error;
    }
  }

  /**
   * Atualiza preço de um produto
   * @param {number} id - ID do produto
   * @param {number} newPrice - Novo preço
   */
  static async updatePrice(id, newPrice) {
    try {
      // Buscar preço atual
      const product = await this.findById(id);
      if (!product) {
        throw new Error('Produto não encontrado');
      }

      const oldPrice = product.current_price;
      
      // Atualizar produto
      await this.update(id, {
        current_price: newPrice,
        last_price: oldPrice,
        check_count: (product.check_count || 0) + 1,
        error_count: 0, // Reset error count on successful update
        last_error: null
      });

      return {
        oldPrice,
        newPrice,
        priceChange: oldPrice ? ((newPrice - oldPrice) / oldPrice) * 100 : 0
      };

    } catch (error) {
      logger.error('Erro ao atualizar preço:', error, { id, newPrice });
      throw error;
    }
  }

  /**
   * Incrementa contador de erro
   * @param {number} id - ID do produto
   * @param {string} errorMessage - Mensagem de erro
   */
  static async incrementError(id, errorMessage) {
    try {
      const product = await this.findById(id);
      if (!product) {
        throw new Error('Produto não encontrado');
      }

      await this.update(id, {
        error_count: (product.error_count || 0) + 1,
        last_error: errorMessage
      });

      // Desativar produto se muitos erros
      if (product.error_count >= 4) { // Desativar após 5 erros
        await this.update(id, { is_active: false });
        logger.warn('Produto desativado por muitos erros', { 
          id, 
          errorCount: product.error_count + 1,
          lastError: errorMessage 
        });
      }

    } catch (error) {
      logger.error('Erro ao incrementar contador de erro:', error, { id, errorMessage });
      throw error;
    }
  }

  /**
   * Desativa um produto
   * @param {number} id - ID do produto
   * @param {string} guildId - ID do servidor (para validação)
   */
  static async deactivate(id, guildId = null) {
    try {
      let sql = 'UPDATE products SET is_active = 0 WHERE id = ?';
      let params = [id];

      if (guildId) {
        sql += ' AND guild_id = ?';
        params.push(guildId);
      }

      const result = await database.run(sql, params);

      if (result.changes === 0) {
        throw new Error('Produto não encontrado ou sem permissão');
      }

      logger.info('Produto desativado', { id, guildId });
      return result;

    } catch (error) {
      logger.error('Erro ao desativar produto:', error, { id, guildId });
      throw error;
    }
  }

  /**
   * Remove um produto permanentemente
   * @param {number} id - ID do produto
   * @param {string} guildId - ID do servidor (para validação)
   */
  static async delete(id, guildId = null) {
    try {
      let sql = 'DELETE FROM products WHERE id = ?';
      let params = [id];

      if (guildId) {
        sql += ' AND guild_id = ?';
        params.push(guildId);
      }

      const result = await database.run(sql, params);

      if (result.changes === 0) {
        throw new Error('Produto não encontrado ou sem permissão');
      }

      logger.info('Produto removido permanentemente', { id, guildId });
      return result;

    } catch (error) {
      logger.error('Erro ao remover produto:', error, { id, guildId });
      throw error;
    }
  }

  /**
   * Busca produtos em promoção
   * @param {string} guildId - ID do servidor (opcional)
   */
  static async findOnSale(guildId = null) {
    try {
      let sql = `
        SELECT * FROM products 
        WHERE is_active = 1 
        AND current_price IS NOT NULL 
        AND target_price IS NOT NULL 
        AND current_price <= target_price
      `;
      let params = [];

      if (guildId) {
        sql += ' AND guild_id = ?';
        params.push(guildId);
      }

      sql += ' ORDER BY (current_price / target_price) ASC';

      const products = await database.all(sql, params);
      
      return products.map(product => {
        if (product.metadata) {
          try {
            product.metadata = JSON.parse(product.metadata);
          } catch (e) {
            product.metadata = {};
          }
        }
        return product;
      });

    } catch (error) {
      logger.error('Erro ao buscar produtos em promoção:', error, { guildId });
      throw error;
    }
  }

  /**
   * Obtém estatísticas dos produtos
   * @param {string} guildId - ID do servidor (opcional)
   */
  static async getStats(guildId = null) {
    try {
      let baseCondition = 'WHERE 1=1';
      let params = [];

      if (guildId) {
        baseCondition += ' AND guild_id = ?';
        params = [guildId, guildId, guildId, guildId];
      }

      const queries = [
        `SELECT COUNT(*) as count FROM products ${baseCondition} AND is_active = 1`,
        `SELECT COUNT(*) as count FROM products ${baseCondition} AND is_active = 1 AND current_price <= target_price`,
        `SELECT COUNT(*) as count FROM notifications n JOIN products p ON n.product_id = p.id ${baseCondition}`,
        `SELECT AVG(current_price) as avg FROM products ${baseCondition} AND is_active = 1 AND current_price IS NOT NULL`
      ];

      const results = await Promise.all(
        queries.map(sql => database.get(sql, guildId ? [guildId] : []))
      );

      return {
        totalProducts: results[0].count,
        activePromotions: results[1].count,
        totalNotifications: results[2].count,
        averagePrice: parseFloat(results[3].avg || 0)
      };

    } catch (error) {
      logger.error('Erro ao obter estatísticas:', error, { guildId });
      throw error;
    }
  }

  /**
   * Busca produtos por URL (para evitar duplicatas)
   * @param {string} url - URL do produto
   */
  static async findByUrl(url) {
    try {
      const sql = 'SELECT * FROM products WHERE url = ?';
      const product = await database.get(sql, [url]);
      
      if (product && product.metadata) {
        try {
          product.metadata = JSON.parse(product.metadata);
        } catch (e) {
          product.metadata = {};
        }
      }

      return product;
    } catch (error) {
      logger.error('Erro ao buscar produto por URL:', error, { url });
      throw error;
    }
  }

  /**
   * Reativa produtos com muitos erros (para retry)
   */
  static async reactivateErrorProducts() {
    try {
      const sql = `
        UPDATE products 
        SET is_active = 1, error_count = 0, last_error = NULL 
        WHERE is_active = 0 
        AND error_count > 0 
        AND last_checked < datetime('now', '-24 hours')
      `;

      const result = await database.run(sql);
      
      if (result.changes > 0) {
        logger.info(`${result.changes} produtos reativados após período de erro`);
      }

      return result.changes;

    } catch (error) {
      logger.error('Erro ao reativar produtos com erro:', error);
      throw error;
    }
  }
}

module.exports = Product;