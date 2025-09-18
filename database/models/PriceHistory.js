const database = require('../database');
const logger = require('../../utils/logger');

/**
 * Modelo para gerenciamento do histórico de preços
 * Armazena e gerencia o histórico de variações de preços dos produtos
 */
class PriceHistory {

  /**
   * Adiciona um registro de preço ao histórico
   * @param {number} productId - ID do produto
   * @param {number} price - Preço registrado
   * @param {number} priceChangePercent - Percentual de mudança (opcional)
   * @param {string} source - Fonte do dado (padrão: 'scraping')
   */
  static async add(productId, price, priceChangePercent = null, source = 'scraping') {
    try {
      if (!productId || price === null || price === undefined) {
        throw new Error('ProductId e price são obrigatórios');
      }

      const sql = `
        INSERT INTO price_history (product_id, price, price_change_percent, source) 
        VALUES (?, ?, ?, ?)
      `;

      const result = await database.run(sql, [productId, price, priceChangePercent, source]);

      logger.debug('Histórico de preço adicionado', { 
        historyId: result.id,
        productId, 
        price, 
        priceChangePercent,
        source 
      });

      return { id: result.id, productId, price, priceChangePercent };

    } catch (error) {
      logger.error('Erro ao adicionar histórico de preço:', error, { 
        productId, 
        price, 
        priceChangePercent 
      });
      throw error;
    }
  }

  /**
   * Busca histórico de um produto
   * @param {number} productId - ID do produto
   * @param {number} limit - Limite de registros (padrão: 50)
   * @param {number} days - Número de dias para buscar (padrão: 30)
   */
  static async getByProduct(productId, limit = 50, days = 30) {
    try {
      const sql = `
        SELECT * FROM price_history 
        WHERE product_id = ? 
        AND checked_at >= datetime('now', '-' || ? || ' days')
        ORDER BY checked_at DESC 
        LIMIT ?
      `;

      const history = await database.all(sql, [productId, days, limit]);

      logger.debug('Histórico recuperado', { 
        productId, 
        recordCount: history.length,
        days,
        limit 
      });

      return history;

    } catch (error) {
      logger.error('Erro ao buscar histórico por produto:', error, { productId, limit, days });
      throw error;
    }
  }

  /**
   * Busca o último preço registrado de um produto
   * @param {number} productId - ID do produto
   */
  static async getLatest(productId) {
    try {
      const sql = `
        SELECT * FROM price_history 
        WHERE product_id = ? 
        ORDER BY checked_at DESC 
        LIMIT 1
      `;

      const latest = await database.get(sql, [productId]);
      return latest;

    } catch (error) {
      logger.error('Erro ao buscar último preço:', error, { productId });
      throw error;
    }
  }

  /**
   * Calcula estatísticas de preço para um produto
   * @param {number} productId - ID do produto
   * @param {number} days - Número de dias para análise (padrão: 30)
   */
  static async getStatistics(productId, days = 30) {
    try {
      const sql = `
        SELECT 
          COUNT(*) as total_records,
          MIN(price) as min_price,
          MAX(price) as max_price,
          AVG(price) as avg_price,
          MIN(checked_at) as first_check,
          MAX(checked_at) as last_check
        FROM price_history 
        WHERE product_id = ? 
        AND checked_at >= datetime('now', '-' || ? || ' days')
      `;

      const stats = await database.get(sql, [productId, days]);

      // Buscar maior queda e maior alta
      const extremesQuery = `
        SELECT 
          MAX(price_change_percent) as max_increase,
          MIN(price_change_percent) as max_decrease
        FROM price_history 
        WHERE product_id = ? 
        AND price_change_percent IS NOT NULL
        AND checked_at >= datetime('now', '-' || ? || ' days')
      `;

      const extremes = await database.get(extremesQuery, [productId, days]);

      return {
        totalRecords: stats.total_records,
        minPrice: parseFloat(stats.min_price || 0),
        maxPrice: parseFloat(stats.max_price || 0),
        avgPrice: parseFloat(stats.avg_price || 0),
        priceRange: parseFloat(stats.max_price || 0) - parseFloat(stats.min_price || 0),
        maxIncrease: parseFloat(extremes.max_increase || 0),
        maxDecrease: parseFloat(extremes.max_decrease || 0),
        firstCheck: stats.first_check,
        lastCheck: stats.last_check,
        period: days
      };

    } catch (error) {
      logger.error('Erro ao calcular estatísticas:', error, { productId, days });
      throw error;
    }
  }

  /**
   * Busca produtos com maior variação de preço
   * @param {number} days - Período em dias (padrão: 7)
   * @param {number} limit - Limite de resultados (padrão: 10)
   * @param {string} guildId - ID do servidor (opcional)
   */
  static async getMostVolatile(days = 7, limit = 10, guildId = null) {
    try {
      let sql = `
        SELECT 
          p.id,
          p.name,
          p.url,
          p.guild_id,
          COUNT(ph.id) as price_changes,
          MIN(ph.price) as min_price,
          MAX(ph.price) as max_price,
          AVG(ph.price) as avg_price,
          ((MAX(ph.price) - MIN(ph.price)) / MIN(ph.price)) * 100 as volatility_percent
        FROM products p
        JOIN price_history ph ON p.id = ph.product_id
        WHERE p.is_active = 1
        AND ph.checked_at >= datetime('now', '-' || ? || ' days')
      `;

      let params = [days];

      if (guildId) {
        sql += ' AND p.guild_id = ?';
        params.push(guildId);
      }

      sql += `
        GROUP BY p.id
        HAVING COUNT(ph.id) >= 2
        ORDER BY volatility_percent DESC
        LIMIT ?
      `;

      params.push(limit);

      const volatile = await database.all(sql, params);

      return volatile.map(item => ({
        ...item,
        minPrice: parseFloat(item.min_price),
        maxPrice: parseFloat(item.max_price),
        avgPrice: parseFloat(item.avg_price),
        volatilityPercent: parseFloat(item.volatility_percent)
      }));

    } catch (error) {
      logger.error('Erro ao buscar produtos mais voláteis:', error, { days, limit, guildId });
      throw error;
    }
  }

  /**
   * Busca tendências de preço (alta/baixa) nos últimos dias
   * @param {number} productId - ID do produto
   * @param {number} days - Período em dias (padrão: 7)
   */
  static async getTrend(productId, days = 7) {
    try {
      const sql = `
        SELECT 
          price,
          checked_at,
          ROW_NUMBER() OVER (ORDER BY checked_at) as position
        FROM price_history 
        WHERE product_id = ? 
        AND checked_at >= datetime('now', '-' || ? || ' days')
        ORDER BY checked_at ASC
      `;

      const prices = await database.all(sql, [productId, days]);

      if (prices.length < 2) {
        return {
          trend: 'insufficient_data',
          slope: 0,
          correlation: 0,
          dataPoints: prices.length
        };
      }

      // Calcular tendência usando regressão linear simples
      const n = prices.length;
      const sumX = prices.reduce((sum, _, index) => sum + index, 0);
      const sumY = prices.reduce((sum, item) => sum + item.price, 0);
      const sumXY = prices.reduce((sum, item, index) => sum + (index * item.price), 0);
      const sumX2 = prices.reduce((sum, _, index) => sum + (index * index), 0);

      const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
      
      // Determinar tendência
      let trend = 'stable';
      if (slope > 0.1) trend = 'rising';
      else if (slope < -0.1) trend = 'falling';

      // Calcular correlação
      const avgX = sumX / n;
      const avgY = sumY / n;
      
      const numerator = prices.reduce((sum, item, index) => 
        sum + ((index - avgX) * (item.price - avgY)), 0);
      
      const denominatorX = Math.sqrt(prices.reduce((sum, _, index) => 
        sum + Math.pow(index - avgX, 2), 0));
      
      const denominatorY = Math.sqrt(prices.reduce((sum, item) => 
        sum + Math.pow(item.price - avgY, 2), 0));
      
      const correlation = denominatorX && denominatorY ? 
        numerator / (denominatorX * denominatorY) : 0;

      return {
        trend,
        slope,
        correlation: Math.abs(correlation),
        dataPoints: n,
        firstPrice: prices[0].price,
        lastPrice: prices[n - 1].price,
        priceChange: ((prices[n - 1].price - prices[0].price) / prices[0].price) * 100
      };

    } catch (error) {
      logger.error('Erro ao calcular tendência:', error, { productId, days });
      throw error;
    }
  }

  /**
   * Busca maiores quedas de preço recentes
   * @param {number} hours - Período em horas (padrão: 24)
   * @param {number} limit - Limite de resultados (padrão: 10)
   * @param {string} guildId - ID do servidor (opcional)
   */
  static async getBiggestDrops(hours = 24, limit = 10, guildId = null) {
    try {
      let sql = `
        SELECT 
          p.id,
          p.name,
          p.url,
          p.guild_id,
          ph.price,
          ph.price_change_percent,
          ph.checked_at
        FROM price_history ph
        JOIN products p ON p.id = ph.product_id
        WHERE p.is_active = 1
        AND ph.price_change_percent < -5
        AND ph.checked_at >= datetime('now', '-' || ? || ' hours')
      `;

      let params = [hours];

      if (guildId) {
        sql += ' AND p.guild_id = ?';
        params.push(guildId);
      }

      sql += `
        ORDER BY ph.price_change_percent ASC
        LIMIT ?
      `;

      params.push(limit);

      const drops = await database.all(sql, params);

      return drops.map(drop => ({
        ...drop,
        price: parseFloat(drop.price),
        priceChangePercent: parseFloat(drop.price_change_percent)
      }));

    } catch (error) {
      logger.error('Erro ao buscar maiores quedas:', error, { hours, limit, guildId });
      throw error;
    }
  }

  /**
   * Remove histórico antigo para otimização
   * @param {number} daysToKeep - Dias de histórico para manter (padrão: 90)
   */
  static async cleanup(daysToKeep = 90) {
    try {
      const sql = `
        DELETE FROM price_history 
        WHERE checked_at < datetime('now', '-' || ? || ' days')
      `;

      const result = await database.run(sql, [daysToKeep]);

      logger.info('Limpeza do histórico de preços concluída', { 
        recordsDeleted: result.changes,
        daysKept: daysToKeep 
      });

      return result.changes;

    } catch (error) {
      logger.error('Erro na limpeza do histórico:', error, { daysToKeep });
      throw error;
    }
  }

  /**
   * Exporta dados do histórico para análise
   * @param {number} productId - ID do produto
   * @param {number} days - Período em dias (padrão: 30)
   * @param {string} format - Formato de saída ('json' ou 'csv')
   */
  static async export(productId, days = 30, format = 'json') {
    try {
      const sql = `
        SELECT 
          ph.*,
          p.name as product_name,
          p.url as product_url
        FROM price_history ph
        JOIN products p ON p.id = ph.product_id
        WHERE ph.product_id = ? 
        AND ph.checked_at >= datetime('now', '-' || ? || ' days')
        ORDER BY ph.checked_at ASC
      `;

      const data = await database.all(sql, [productId, days]);

      if (format === 'csv') {
        if (data.length === 0) return '';

        const headers = Object.keys(data[0]).join(',');
        const rows = data.map(row => 
          Object.values(row).map(val => 
            typeof val === 'string' ? `"${val}"` : val
          ).join(',')
        );

        return [headers, ...rows].join('\n');
      }

      return {
        product_id: productId,
        export_date: new Date().toISOString(),
        period_days: days,
        total_records: data.length,
        data: data
      };

    } catch (error) {
      logger.error('Erro ao exportar histórico:', error, { productId, days, format });
      throw error;
    }
  }

  /**
   * Busca preços únicos (remove duplicatas por proximidade de tempo)
   * @param {number} productId - ID do produto
   * @param {number} intervalMinutes - Intervalo mínimo entre registros (padrão: 30)
   * @param {number} limit - Limite de registros (padrão: 100)
   */
  static async getUniqueByInterval(productId, intervalMinutes = 30, limit = 100) {
    try {
      const sql = `
        WITH ranked_prices AS (
          SELECT *,
            ROW_NUMBER() OVER (
              PARTITION BY CAST((julianday(checked_at) * 24 * 60) / ? AS INTEGER)
              ORDER BY checked_at DESC
            ) as rn
          FROM price_history
          WHERE product_id = ?
        )
        SELECT * FROM ranked_prices
        WHERE rn = 1
        ORDER BY checked_at DESC
        LIMIT ?
      `;

      const uniquePrices = await database.all(sql, [intervalMinutes, productId, limit]);

      return uniquePrices;

    } catch (error) {
      logger.error('Erro ao buscar preços únicos:', error, { 
        productId, 
        intervalMinutes, 
        limit 
      });
      throw error;
    }
  }
}

module.exports = PriceHistory;