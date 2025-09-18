const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const config = require('../config/config');
const logger = require('../utils/logger');

/**
 * Classe para gerenciamento do banco de dados SQLite
 * Implementa padrão Singleton para garantir uma única instância
 */
class Database {
  constructor() {
    if (Database.instance) {
      return Database.instance;
    }
    
    this.db = null;
    this.isConnected = false;
    Database.instance = this;
    
    this.init();
  }

  /**
   * Inicializa a conexão com o banco de dados
   */
  init() {
    try {
      // Criar diretório se não existir
      const dbDir = path.dirname(config.database.path);
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
        logger.info(`Diretório de banco criado: ${dbDir}`);
      }

      // Conectar ao banco
      this.db = new sqlite3.Database(config.database.path, (err) => {
        if (err) {
          logger.error('Erro ao conectar com o banco de dados:', err);
          process.exit(1);
        }
        
        this.isConnected = true;
        logger.info(`Conectado ao banco de dados: ${config.database.path}`);
        this.setupDatabase();
      });

      // Configurações do SQLite para melhor performance
      this.db.configure('busyTimeout', 30000); // 30 segundos timeout
      this.db.run('PRAGMA journal_mode = WAL'); // Write-Ahead Logging
      this.db.run('PRAGMA synchronous = NORMAL'); // Balance entre performance e segurança
      this.db.run('PRAGMA cache_size = 10000'); // Cache maior
      this.db.run('PRAGMA foreign_keys = ON'); // Habilitar foreign keys

    } catch (error) {
      logger.error('Erro na inicialização do banco:', error);
      process.exit(1);
    }
  }

  /**
   * Configura o banco de dados (tabelas, índices, etc.)
   */
  setupDatabase() {
    this.createTables();
    this.createIndexes();
    this.createTriggers();
  }

  /**
   * Cria as tabelas necessárias
   */
  createTables() {
    const tables = [
      // Tabela de produtos
      {
        name: 'products',
        sql: `CREATE TABLE IF NOT EXISTS products (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          url TEXT NOT NULL UNIQUE,
          current_price REAL,
          target_price REAL,
          last_price REAL,
          channel_id TEXT NOT NULL,
          guild_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          last_checked DATETIME,
          is_active BOOLEAN DEFAULT 1,
          promotion_threshold REAL DEFAULT ${config.monitoring.promotionThreshold},
          check_count INTEGER DEFAULT 0,
          error_count INTEGER DEFAULT 0,
          last_error TEXT,
          metadata TEXT DEFAULT '{}'
        )`
      },

      // Tabela de histórico de preços
      {
        name: 'price_history',
        sql: `CREATE TABLE IF NOT EXISTS price_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          product_id INTEGER NOT NULL,
          price REAL NOT NULL,
          price_change_percent REAL,
          checked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          source TEXT DEFAULT 'scraping',
          FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE
        )`
      },

      // Tabela de notificações
      {
        name: 'notifications',
        sql: `CREATE TABLE IF NOT EXISTS notifications (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          product_id INTEGER NOT NULL,
          type TEXT NOT NULL,
          message TEXT NOT NULL,
          sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          channel_id TEXT,
          user_id TEXT,
          status TEXT DEFAULT 'sent',
          FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE
        )`
      },

      // Tabela de configurações
      {
        name: 'settings',
        sql: `CREATE TABLE IF NOT EXISTS settings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          key TEXT UNIQUE NOT NULL,
          value TEXT NOT NULL,
          description TEXT,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`
      },

      // Tabela de logs de sistema
      {
        name: 'system_logs',
        sql: `CREATE TABLE IF NOT EXISTS system_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          level TEXT NOT NULL,
          message TEXT NOT NULL,
          context TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`
      }
    ];

    this.db.serialize(() => {
      tables.forEach(table => {
        this.db.run(table.sql, (err) => {
          if (err) {
            logger.error(`Erro ao criar tabela ${table.name}:`, err);
          } else {
            logger.debug(`Tabela ${table.name} verificada/criada`);
          }
        });
      });
    });
  }

  /**
   * Cria índices para melhor performance
   */
  createIndexes() {
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_products_guild_active ON products(guild_id, is_active)',
      'CREATE INDEX IF NOT EXISTS idx_products_url ON products(url)',
      'CREATE INDEX IF NOT EXISTS idx_products_last_checked ON products(last_checked)',
      'CREATE INDEX IF NOT EXISTS idx_price_history_product_date ON price_history(product_id, checked_at)',
      'CREATE INDEX IF NOT EXISTS idx_notifications_product ON notifications(product_id)',
      'CREATE INDEX IF NOT EXISTS idx_notifications_date ON notifications(sent_at)',
      'CREATE INDEX IF NOT EXISTS idx_system_logs_level_date ON system_logs(level, created_at)'
    ];

    this.db.serialize(() => {
      indexes.forEach(indexSql => {
        this.db.run(indexSql, (err) => {
          if (err) {
            logger.error('Erro ao criar índice:', err);
          }
        });
      });
    });

    logger.debug('Índices verificados/criados');
  }

  /**
   * Cria triggers para atualizações automáticas
   */
  createTriggers() {
    const triggers = [
      // Trigger para atualizar updated_at em products
      `CREATE TRIGGER IF NOT EXISTS update_products_timestamp 
       AFTER UPDATE ON products
       BEGIN
         UPDATE products SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
       END`,

      // Trigger para calcular mudança percentual de preço
      `CREATE TRIGGER IF NOT EXISTS calculate_price_change
       BEFORE INSERT ON price_history
       WHEN NEW.price_change_percent IS NULL
       BEGIN
         UPDATE NEW SET price_change_percent = (
           SELECT CASE 
             WHEN p.current_price IS NOT NULL AND p.current_price > 0 
             THEN ((NEW.price - p.current_price) / p.current_price) * 100
             ELSE 0
           END
           FROM products p WHERE p.id = NEW.product_id
         );
       END`
    ];

    this.db.serialize(() => {
      triggers.forEach(triggerSql => {
        this.db.run(triggerSql, (err) => {
          if (err) {
            logger.error('Erro ao criar trigger:', err);
          }
        });
      });
    });

    logger.debug('Triggers verificados/criados');
  }

  /**
   * Retorna a instância do banco
   */
  getDB() {
    if (!this.isConnected) {
      throw new Error('Banco de dados não está conectado');
    }
    return this.db;
  }

  /**
   * Executa uma query com promise
   */
  run(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function(err) {
        if (err) {
          logger.error('Erro na query run:', err, { sql, params });
          reject(err);
        } else {
          resolve({ 
            id: this.lastID, 
            changes: this.changes 
          });
        }
      });
    });
  }

  /**
   * Executa uma query get com promise
   */
  get(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) {
          logger.error('Erro na query get:', err, { sql, params });
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  /**
   * Executa uma query all com promise
   */
  all(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) {
          logger.error('Erro na query all:', err, { sql, params });
          reject(err);
        } else {
          resolve(rows || []);
        }
      });
    });
  }

  /**
   * Executa múltiplas queries em uma transação
   */
  async transaction(queries) {
    return new Promise((resolve, reject) => {
      this.db.serialize(() => {
        this.db.run('BEGIN TRANSACTION');
        
        const results = [];
        let hasError = false;

        const executeQuery = (index) => {
          if (index >= queries.length) {
            if (hasError) {
              this.db.run('ROLLBACK', () => reject(new Error('Transaction rolled back')));
            } else {
              this.db.run('COMMIT', () => resolve(results));
            }
            return;
          }

          const { sql, params = [] } = queries[index];
          this.db.run(sql, params, function(err) {
            if (err) {
              hasError = true;
              logger.error('Erro na transação:', err);
              this.db.run('ROLLBACK', () => reject(err));
            } else {
              results.push({ 
                id: this.lastID, 
                changes: this.changes 
              });
              executeQuery(index + 1);
            }
          });
        };

        executeQuery(0);
      });
    });
  }

  /**
   * Backup do banco de dados
   */
  async backup() {
    const backupDir = config.database.backupPath || './backups/';
    
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(backupDir, `backup-${timestamp}.db`);

    return new Promise((resolve, reject) => {
      const backup = this.db.backup(backupPath);
      
      backup.step(-1, (err) => {
        if (err) {
          logger.error('Erro no backup:', err);
          reject(err);
        } else {
          logger.info(`Backup criado: ${backupPath}`);
          resolve(backupPath);
        }
      });
    });
  }

  /**
   * Limpa dados antigos
   */
  async cleanup(daysToKeep = 30) {
    const queries = [
      {
        sql: 'DELETE FROM price_history WHERE checked_at < datetime("now", "-" || ? || " days")',
        params: [daysToKeep]
      },
      {
        sql: 'DELETE FROM system_logs WHERE created_at < datetime("now", "-" || ? || " days")',
        params: [daysToKeep]
      },
      {
        sql: 'DELETE FROM notifications WHERE sent_at < datetime("now", "-" || ? || " days")',
        params: [daysToKeep * 2] // Manter notificações por mais tempo
      }
    ];

    try {
      const results = await this.transaction(queries);
      const totalDeleted = results.reduce((sum, result) => sum + result.changes, 0);
      logger.info(`Limpeza concluída: ${totalDeleted} registros removidos`);
      return totalDeleted;
    } catch (error) {
      logger.error('Erro na limpeza:', error);
      throw error;
    }
  }

  /**
   * Fecha a conexão com o banco
   */
  close() {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        resolve();
        return;
      }

      this.db.close((err) => {
        if (err) {
          logger.error('Erro ao fechar banco de dados:', err);
          reject(err);
        } else {
          this.isConnected = false;
          logger.info('Banco de dados fechado');
          resolve();
        }
      });
    });
  }

  /**
   * Obtém estatísticas do banco
   */
  async getStats() {
    try {
      const stats = await Promise.all([
        this.get('SELECT COUNT(*) as count FROM products WHERE is_active = 1'),
        this.get('SELECT COUNT(*) as count FROM price_history'),
        this.get('SELECT COUNT(*) as count FROM notifications'),
        this.get('SELECT COUNT(*) as count FROM products WHERE is_active = 1 AND current_price <= target_price')
      ]);

      return {
        activeProducts: stats[0].count,
        priceHistoryRecords: stats[1].count,
        totalNotifications: stats[2].count,
        activePromotions: stats[3].count
      };
    } catch (error) {
      logger.error('Erro ao obter estatísticas:', error);
      throw error;
    }
  }
}

// Exporta uma única instância (Singleton)
module.exports = new Database();