const cron = require('node-cron');
const config = require('../config/config');
const logger = require('../utils/logger');
const Product = require('../database/models/Product');
const PriceHistory = require('../database/models/PriceHistory');
const PriceScraper = require('./PriceScraper');
const NotificationService = require('./NotificationService');

/**
 * Serviço de monitoramento de preços
 * Gerencia a verificação automática e notificações
 */
class PriceMonitor {
  
  constructor() {
    this.isRunning = false;
    this.currentCheck = null;
    this.stats = {
      totalChecks: 0,
      successfulChecks: 0,
      failedChecks: 0,
      notificationsSent: 0,
      lastCheck: null,
      nextCheck: null
    };
    
    this.cronJob = null;
    this.notificationService = null;
  }

  /**
   * Inicializa o monitoramento automático
   */
  async start() {
    if (this.isRunning) {
      logger.warn('Monitor de preços já está rodando');
      return;
    }

    try {
      this.notificationService = new NotificationService();
      
      // Configurar cron job baseado na configuração
      const intervalMinutes = config.monitoring.checkIntervalMinutes;
      const cronExpression = `*/${intervalMinutes} * * * *`;
      
      this.cronJob = cron.schedule(cronExpression, () => {
        this.executeCheck().catch(error => {
          logger.error('Erro na execução automática do monitor:', error);
        });
      }, {
        scheduled: false,
        timezone: config.timezone
      });

      this.cronJob.start();
      this.isRunning = true;

      // Calcular próxima execução
      this.stats.nextCheck = new Date(Date.now() + (intervalMinutes * 60 * 1000));

      logger.info('Monitor de preços iniciado', { 
        interval: `${intervalMinutes} minutos`,
        nextCheck: this.stats.nextCheck 
      });

      // Executar primeira verificação após 1 minuto
      setTimeout(() => {
        this.executeCheck().catch(error => {
          logger.error('Erro na primeira verificação:', error);
        });
      }, 60000);

    } catch (error) {
      logger.error('Erro ao iniciar monitor de preços:', error);
      throw error;
    }
  }

  /**
   * Para o monitoramento automático
   */
  stop() {
    if (!this.isRunning) {
      logger.warn('Monitor de preços não está rodando');
      return;
    }

    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob.destroy();
      this.cronJob = null;
    }

    this.isRunning = false;
    this.stats.nextCheck = null;

    logger.info('Monitor de preços parado');
  }

  /**
   * Executa uma verificação completa
   */
  async executeCheck() {
    if (this.currentCheck) {
      logger.warn('Verificação já em andamento, ignorando');
      return;
    }

    this.currentCheck = {
      startTime: Date.now(),
      products: [],
      results: []
    };

    const checkId = `check_${Date.now()}`;
    logger.info('Iniciando verificação de preços', { checkId });

    try {
      // Buscar produtos que precisam de verificação
      const intervalMinutes = config.monitoring.checkIntervalMinutes;
      const products = await Product.findForCheck(intervalMinutes);
      
      if (products.length === 0) {
        logger.info('Nenhum produto para verificar no momento');
        return;
      }

      this.currentCheck.products = products;
      logger.info(`Verificando ${products.length} produto(s)`, { checkId });

      // Processar produtos em lotes para evitar sobrecarga
      const batchSize = 5;
      const batches = this.chunkArray(products, batchSize);
      
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        logger.debug(`Processando lote ${i + 1}/${batches.length} com ${batch.length} produtos`);
        
        const batchPromises = batch.map(product => 
          this.checkProduct(product).catch(error => {
            logger.error(`Erro ao verificar produto ${product.id}:`, error);
            return { product, success: false, error: error.message };
          })
        );

        const batchResults = await Promise.all(batchPromises);
        this.currentCheck.results.push(...batchResults);

        // Delay entre lotes
        if (i < batches.length - 1) {
          await this.delay(config.monitoring.requestDelayMs);
        }
      }

      await this.processCheckResults();

    } catch (error) {
      logger.error('Erro na execução da verificação:', error, { checkId });
      this.stats.failedChecks++;
    } finally {
      const duration = Date.now() - this.currentCheck.startTime;
      
      this.stats.totalChecks++;
      this.stats.lastCheck = new Date();
      this.stats.nextCheck = new Date(Date.now() + (config.monitoring.checkIntervalMinutes * 60 * 1000));
      
      logger.info('Verificação concluída', { 
        checkId,
        duration: `${duration}ms`,
        productsChecked: this.currentCheck.products.length,
        successful: this.currentCheck.results.filter(r => r.success).length
      });

      this.currentCheck = null;
    }
  }

  /**
   * Verifica um produto específico
   * @param {Object} product - Dados do produto
   */
  async checkProduct(product) {
    const startTime = Date.now();
    
    try {
      logger.debug(`Verificando produto: ${product.name} (${product.id})`);

      // Fazer scraping do preço atual
      const scrapedData = await PriceScraper.scrapePrice(product.url);
      
      if (!scrapedData.success) {
        // Incrementar contador de erro
        await Product.incrementError(product.id, scrapedData.error);
        
        return {
          product,
          success: false,
          error: scrapedData.error,
          duration: Date.now() - startTime
        };
      }

      // Atualizar preço do produto
      const priceUpdate = await Product.updatePrice(product.id, scrapedData.price);
      
      // Adicionar ao histórico
      await PriceHistory.add(
        product.id, 
        scrapedData.price, 
        priceUpdate.priceChange
      );

      // Verificar se deve enviar notificações
      const notifications = await this.checkNotifications(product, scrapedData.price, priceUpdate);
      
      const result = {
        product,
        success: true,
        oldPrice: priceUpdate.oldPrice,
        newPrice: scrapedData.price,
        priceChange: priceUpdate.priceChange,
        notifications,
        duration: Date.now() - startTime
      };

      this.stats.successfulChecks++;
      return result;

    } catch (error) {
      logger.error(`Erro ao verificar produto ${product.id}:`, error);
      
      // Incrementar contador de erro
      await Product.incrementError(product.id, error.message);
      
      return {
        product,
        success: false,
        error: error.message,
        duration: Date.now() - startTime
      };
    }
  }

  /**
   * Verifica se deve enviar notificações
   * @param {Object} product - Dados do produto
   * @param {number} newPrice - Novo preço
   * @param {Object} priceUpdate - Dados da atualização
   */
  async checkNotifications(product, newPrice, priceUpdate) {
    const notifications = [];
    
    try {
      const { oldPrice, priceChange } = priceUpdate;
      
      // Verificar se atingiu preço alvo
      if (newPrice <= product.target_price && oldPrice && oldPrice > product.target_price) {
        const notification = await this.notificationService.sendTargetReachedNotification(
          product, 
          newPrice, 
          oldPrice
        );
        notifications.push({ type: 'target_reached', ...notification });
        this.stats.notificationsSent++;
      }
      
      // Verificar se teve queda significativa
      else if (priceChange && priceChange <= -(product.promotion_threshold * 100)) {
        const notification = await this.notificationService.sendPriceDropNotification(
          product, 
          newPrice, 
          oldPrice, 
          priceChange
        );
        notifications.push({ type: 'price_drop', ...notification });
        this.stats.notificationsSent++;
      }
      
      // Verificar se teve alta significativa (opcional)
      else if (priceChange && priceChange >= (product.promotion_threshold * 200)) {
        const notification = await this.notificationService.sendPriceIncreaseNotification(
          product, 
          newPrice, 
          oldPrice, 
          priceChange
        );
        notifications.push({ type: 'price_increase', ...notification });
        this.stats.notificationsSent++;
      }

    } catch (error) {
      logger.error('Erro ao processar notificações:', error, { productId: product.id });
    }

    return notifications;
  }

  /**
   * Processa os resultados da verificação
   */
  async processCheckResults() {
    if (!this.currentCheck || !this.currentCheck.results) {
      return;
    }

    const results = this.currentCheck.results;
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);
    
    // Estatísticas da verificação
    const stats = {
      total: results.length,
      successful: successful.length,
      failed: failed.length,
      notifications: successful.reduce((sum, r) => sum + (r.notifications?.length || 0), 0),
      averagePrice: successful.length > 0 ? 
        successful.reduce((sum, r) => sum + r.newPrice, 0) / successful.length : 0,
      biggestDrop: successful.reduce((min, r) => 
        r.priceChange < min ? r.priceChange : min, 0),
      biggestIncrease: successful.reduce((max, r) => 
        r.priceChange > max ? r.priceChange : max, 0)
    };

    logger.info('Resultados da verificação processados', stats);

    // Enviar resumo se houver muitas mudanças
    if (stats.notifications >= 5) {
      await this.notificationService.sendSummaryNotification(stats, successful);
    }

    // Limpar dados antigos periodicamente
    if (this.stats.totalChecks % 10 === 0) {
      await this.performMaintenance();
    }
  }

  /**
   * Executa manutenção periódica
   */
  async performMaintenance() {
    try {
      logger.info('Executando manutenção do monitor de preços');

      // Reativar produtos com erro após 24h
      const reactivated = await Product.reactivateErrorProducts();
      
      if (reactivated > 0) {
        logger.info(`${reactivated} produtos reativados após período de erro`);
      }

      // Limpeza de histórico antigo (manter últimos 90 dias)
      const cleanedHistory = await PriceHistory.cleanup(90);
      
      if (cleanedHistory > 0) {
        logger.info(`${cleanedHistory} registros de histórico removidos`);
      }

      // Backup do banco de dados
      if (this.stats.totalChecks % 50 === 0) {
        const database = require('../database/database');
        await database.backup();
      }

    } catch (error) {
      logger.error('Erro na manutenção:', error);
    }
  }

  /**
   * Força uma verificação manual
   * @param {number} productId - ID do produto (opcional)
   */
  async forceCheck(productId = null) {
    try {
      let products;
      
      if (productId) {
        const product = await Product.findById(productId);
        if (!product) {
          throw new Error('Produto não encontrado');
        }
        products = [product];
      } else {
        products = await Product.findActive();
      }

      logger.info(`Iniciando verificação manual de ${products.length} produto(s)`);

      const results = [];
      for (const product of products) {
        const result = await this.checkProduct(product);
        results.push(result);
        
        // Delay entre verificações
        if (products.length > 1) {
          await this.delay(1000);
        }
      }

      const successful = results.filter(r => r.success).length;
      logger.info(`Verificação manual concluída: ${successful}/${results.length} produtos verificados com sucesso`);

      return {
        total: results.length,
        successful,
        failed: results.length - successful,
        results
      };

    } catch (error) {
      logger.error('Erro na verificação manual:', error);
      throw error;
    }
  }

  /**
   * Obtém estatísticas do monitor
   */
  getStats() {
    return {
      ...this.stats,
      isRunning: this.isRunning,
      currentCheck: this.currentCheck ? {
        startTime: this.currentCheck.startTime,
        productsCount: this.currentCheck.products.length,
        progress: this.currentCheck.results.length
      } : null,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage()
    };
  }

  /**
   * Configura intervalo de verificação
   * @param {number} minutes - Intervalo em minutos
   */
  setCheckInterval(minutes) {
    if (minutes < 1 || minutes > 1440) {
      throw new Error('Intervalo deve estar entre 1 e 1440 minutos');
    }

    const wasRunning = this.isRunning;
    
    if (wasRunning) {
      this.stop();
    }

    config.monitoring.checkIntervalMinutes = minutes;
    
    if (wasRunning) {
      this.start();
    }

    logger.info(`Intervalo de verificação alterado para ${minutes} minutos`);
  }

  /**
   * Pausa o monitoramento temporariamente
   * @param {number} minutes - Minutos para pausar
   */
  async pause(minutes = 60) {
    if (!this.isRunning) {
      throw new Error('Monitor não está rodando');
    }

    this.stop();
    
    logger.info(`Monitor pausado por ${minutes} minutos`);
    
    setTimeout(() => {
      this.start().catch(error => {
        logger.error('Erro ao retomar monitor:', error);
      });
      logger.info('Monitor retomado automaticamente');
    }, minutes * 60 * 1000);
  }

  /**
   * Divide array em chunks
   * @param {Array} array - Array original
   * @param {number} size - Tamanho do chunk
   */
  chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * Delay assíncrono
   * @param {number} ms - Milissegundos para aguardar
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Limpa estatísticas
   */
  resetStats() {
    this.stats = {
      totalChecks: 0,
      successfulChecks: 0,
      failedChecks: 0,
      notificationsSent: 0,
      lastCheck: null,
      nextCheck: this.stats.nextCheck
    };
    
    logger.info('Estatísticas do monitor resetadas');
  }
}

module.exports = new PriceMonitor();