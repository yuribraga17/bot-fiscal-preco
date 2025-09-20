#!/usr/bin/env node

/**
 * Monitor de Preços - Sistema Profissional
 * Bot Discord para monitoramento automático de preços de produtos
 * 
 * Funcionalidades:
 * - Scraping automático de preços
 * - Notificações em tempo real via Discord
 * - Painel web administrativo
 * - Histórico detalhado de preços
 * - Análises e estatísticas
 * 
 * Autor: Desenvolvido para automação de e-commerce
 * Versão: 1.0.0
 */

const config = require('./config/config');
const logger = require('./utils/logger');
const database = require('./database/database');
const discordBot = require('./discord/bot');
const webServer = require('./web/server');
const priceMonitor = require('./services/PriceMonitor');

/**
 * Classe principal da aplicação
 * Gerencia inicialização e shutdown de todos os serviços
 */
class PriceMonitorApp {
  
  constructor() {
    this.isRunning = false;
    this.services = {
      database: false,
      discordBot: false,
      webServer: false,
      priceMonitor: false
    };

    this.startTime = null;
    this.setupProcessHandlers();
  }

  /**
   * Inicializa toda a aplicação
   */
  async start() {
    try {
      this.startTime = Date.now();
      logger.info('🚀 Iniciando Monitor de Preços...', {
        version: this.getVersion(),
        nodeVersion: process.version,
        environment: config.server.nodeEnv,
        pid: process.pid
      });

      // Banner de inicialização
      this.showBanner();

      // Validar configurações
      await this.validateConfig();

      // Inicializar serviços em ordem
      await this.initializeDatabase();
      await this.initializeDiscordBot();
      await this.initializeWebServer();
      await this.initializePriceMonitor();

      // Verificar saúde do sistema
      await this.healthCheck();

      this.isRunning = true;
      const startupTime = Date.now() - this.startTime;

      logger.info('✅ Monitor de Preços iniciado com sucesso!', {
        startupTime: `${startupTime}ms`,
        services: this.services,
        webUrl: `http://localhost:${config.server.port}`,
        botReady: discordBot.isReady
      });

      // Notificar admin se configurado
      await this.notifyStartup();

      // Mostrar informações úteis
      this.showStartupInfo();

    } catch (error) {
      logger.error('❌ Erro crítico na inicialização:', error);
      await this.shutdown(1);
    }
  }

  /**
   * Inicializa o banco de dados
   */
  async initializeDatabase() {
    try {
      logger.info('📦 Inicializando banco de dados...');
      
      // O database já é inicializado automaticamente no require
      // Verificar se está funcionando
      const stats = await database.getStats();
      
      this.services.database = true;
      logger.info('✅ Banco de dados inicializado', stats);

    } catch (error) {
      logger.error('❌ Erro ao inicializar banco de dados:', error);
      throw error;
    }
  }

  /**
   * Inicializa o bot Discord
   */
  async initializeDiscordBot() {
    try {
      logger.info('🤖 Inicializando bot Discord...');
      
      await discordBot.initialize();
      
      this.services.discordBot = true;
      logger.info('✅ Bot Discord inicializado', discordBot.getBotInfo());

    } catch (error) {
      logger.error('❌ Erro ao inicializar bot Discord:', error);
      throw error;
    }
  }

  /**
   * Inicializa o servidor web
   */
  async initializeWebServer() {
    try {
      logger.info('🌐 Inicializando servidor web...');
      
      await webServer.initialize();
      await webServer.start();
      
      this.services.webServer = true;
      logger.info('✅ Servidor web inicializado', webServer.getStatus());

    } catch (error) {
      logger.error('❌ Erro ao inicializar servidor web:', error);
      throw error;
    }
  }

  /**
   * Inicializa o monitor de preços
   */
  async initializePriceMonitor() {
    try {
      logger.info('💰 Inicializando monitor de preços...');
      
      await priceMonitor.start();
      
      this.services.priceMonitor = true;
      logger.info('✅ Monitor de preços inicializado', priceMonitor.getStats());

    } catch (error) {
      logger.error('❌ Erro ao inicializar monitor de preços:', error);
      throw error;
    }
  }

  /**
   * Valida configurações essenciais
   */
  async validateConfig() {
    logger.info('🔍 Validando configurações...');

    const validations = [
      {
        name: 'Discord Token',
        valid: !!config.discord.token && config.discord.token !== 'seu_token_do_discord_aqui',
        message: 'Configure DISCORD_TOKEN no arquivo .env'
      },
      {
        name: 'Discord Client ID',
        valid: !!config.discord.clientId && config.discord.clientId !== 'seu_client_id_aqui',
        message: 'Configure CLIENT_ID no arquivo .env'
      },
      {
        name: 'Porta do servidor',
        valid: config.server.port >= 1000 && config.server.port <= 65535,
        message: 'Configure uma porta válida (1000-65535) em PORT'
      }
    ];

    const failures = validations.filter(v => !v.valid);
    
    if (failures.length > 0) {
      logger.error('❌ Falhas na validação de configuração:');
      failures.forEach(failure => {
        logger.error(`   • ${failure.name}: ${failure.message}`);
      });
      throw new Error('Configuração inválida');
    }

    logger.info('✅ Configurações validadas');
  }

  /**
   * Verifica saúde de todos os serviços
   */
  async healthCheck() {
    logger.info('🏥 Verificando saúde dos serviços...');

    const checks = [
      {
        name: 'Database',
        check: async () => {
          const stats = await database.getStats();
          return stats.activeProducts !== undefined;
        }
      },
      {
        name: 'Discord Bot',
        check: async () => {
          return discordBot.isReady && !!discordBot.getClient().user;
        }
      },
      {
        name: 'Web Server',
        check: async () => {
          return webServer.getStatus().running;
        }
      },
      {
        name: 'Price Monitor',
        check: async () => {
          return priceMonitor.getStats().isRunning;
        }
      }
    ];

    const results = await Promise.all(
      checks.map(async (check) => {
        try {
          const healthy = await check.check();
          return { name: check.name, healthy, error: null };
        } catch (error) {
          return { name: check.name, healthy: false, error: error.message };
        }
      })
    );

    const unhealthy = results.filter(r => !r.healthy);
    
    if (unhealthy.length > 0) {
      logger.error('❌ Serviços com problemas:');
      unhealthy.forEach(service => {
        logger.error(`   • ${service.name}: ${service.error}`);
      });
      throw new Error('Health check falhou');
    }

    logger.info('✅ Todos os serviços estão saudáveis');
  }

  /**
   * Notifica admin sobre inicialização
   */
  async notifyStartup() {
    try {
      if (!config.discord.adminUserId) return;

      const notificationService = discordBot.getNotificationService();
      const stats = await database.getStats();
      
      await notificationService.sendErrorNotification(
        `🚀 **Sistema Inicializado**\n\n` +
        `✅ Todos os serviços online\n` +
        `📦 ${stats.activeProducts} produtos ativos\n` +
        `🔥 ${stats.activePromotions} promoções ativas\n` +
        `🌐 Painel: http://localhost:${config.server.port}\n` +
        `⚡ Tempo de inicialização: ${Date.now() - this.startTime}ms`,
        {
          environment: config.server.nodeEnv,
          version: this.getVersion(),
          services: this.services
        }
      );

    } catch (error) {
      logger.warn('Não foi possível notificar admin sobre inicialização:', error.message);
    }
  }

  /**
   * Exibe banner de inicialização
   */
  showBanner() {
    const banner = `
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║                    🛒 MONITOR DE PREÇOS 💰                    ║
║                                                               ║
║               Sistema Profissional de Monitoramento          ║
║                     de Preços de E-commerce                  ║
║                                                               ║
║  • Bot Discord com comandos intuitivos                       ║
║  • Painel web administrativo completo                        ║
║  • Scraping automático e inteligente                         ║
║  • Notificações em tempo real                                ║
║  • Histórico detalhado e análises                            ║
║                                                               ║
║                        Versão ${this.getVersion().padEnd(8)}                         ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
    `;
    
    console.log(banner);
  }

  /**
   * Mostra informações úteis após inicialização
   */
  showStartupInfo() {
    const botInfo = discordBot.getBotInfo();
    
    console.log('\n' + '='.repeat(60));
    console.log('🎉 SISTEMA ONLINE - INFORMAÇÕES IMPORTANTES');
    console.log('='.repeat(60));
    console.log(`🌐 Painel Web: http://localhost:${config.server.port}`);
    console.log(`🤖 Bot Discord: ${botInfo.username}#${botInfo.discriminator}`);
    console.log(`🏠 Servidores conectados: ${botInfo.guilds}`);
    console.log(`👥 Usuários alcançados: ${botInfo.users}`);
    console.log(`📦 Produtos ativos: ${this.services.database ? 'Carregando...' : 'N/A'}`);
    console.log(`⚙️  Ambiente: ${config.server.nodeEnv.toUpperCase()}`);
    console.log(`🚀 PID: ${process.pid}`);
    console.log('\nCOMANDOS DISCORD DISPONÍVEIS:');
    console.log('  /addproduct     - Adicionar produto ao monitoramento');
    console.log('  /listproducts   - Listar produtos monitorados');
    console.log('  /removeproduct  - Remover produto do monitoramento');
    console.log('\n📊 Acesse o painel web para estatísticas detalhadas!');
    console.log('='.repeat(60) + '\n');
  }

  /**
   * Configura handlers de processo
   */
  setupProcessHandlers() {
    // Shutdown gracioso
    const signals = ['SIGTERM', 'SIGINT'];
    signals.forEach(signal => {
      process.on(signal, () => {
        logger.info(`📥 Sinal ${signal} recebido, iniciando shutdown gracioso...`);
        this.shutdown(0);
      });
    });

    // Erros não tratados
    process.on('uncaughtException', (error) => {
      logger.error('🚨 Exceção não capturada:', error);
      this.shutdown(1);
    });

    process.on('unhandledRejection', (reason, promise) => {
      logger.error('🚨 Promise rejeitada não tratada:', { reason, promise });
      this.shutdown(1);
    });

    // Aviso de memory leak
    process.on('warning', (warning) => {
      logger.warn('⚠️ Aviso do processo:', {
        name: warning.name,
        message: warning.message,
        stack: warning.stack
      });
    });
  }

  /**
   * Encerra graciosamente todos os serviços
   */
  async shutdown(exitCode = 0) {
    if (!this.isRunning) {
      logger.info('Aplicação já foi encerrada');
      process.exit(exitCode);
      return;
    }

    const shutdownStart = Date.now();
    logger.info('🔄 Iniciando shutdown gracioso...');

    try {
      // Parar serviços em ordem reversa
      if (this.services.priceMonitor) {
        logger.info('⏹️ Parando monitor de preços...');
        priceMonitor.stop();
        this.services.priceMonitor = false;
      }

      if (this.services.webServer) {
        logger.info('⏹️ Parando servidor web...');
        await webServer.stop();
        this.services.webServer = false;
      }

      if (this.services.discordBot) {
        logger.info('⏹️ Desconectando bot Discord...');
        await discordBot.shutdown();
        this.services.discordBot = false;
      }

      if (this.services.database) {
        logger.info('⏹️ Fechando banco de dados...');
        await database.close();
        this.services.database = false;
      }

      this.isRunning = false;
      const shutdownTime = Date.now() - shutdownStart;

      logger.info('✅ Shutdown concluído com sucesso', {
        shutdownTime: `${shutdownTime}ms`,
        exitCode,
        totalUptime: this.startTime ? `${Date.now() - this.startTime}ms` : 'N/A'
      });

      // Pequena pausa para garantir que logs sejam escritos
      await new Promise(resolve => setTimeout(resolve, 100));

    } catch (error) {
      logger.error('❌ Erro durante shutdown:', error);
      exitCode = 1;
    }

    process.exit(exitCode);
  }

  /**
   * Obtém versão da aplicação
   */
  getVersion() {
    try {
      const packageJson = require('./package.json');
      return packageJson.version || '1.0.0';
    } catch {
      return '1.0.0';
    }
  }

  /**
   * Obtém informações completas da aplicação
   */
  getAppInfo() {
    return {
      name: 'Monitor de Preços',
      version: this.getVersion(),
      environment: config.server.nodeEnv,
      startTime: this.startTime,
      uptime: this.startTime ? Date.now() - this.startTime : 0,
      isRunning: this.isRunning,
      services: this.services,
      node: {
        version: process.version,
        platform: process.platform,
        arch: process.arch,
        pid: process.pid
      },
      memory: process.memoryUsage(),
      config: {
        port: config.server.port,
        checkInterval: config.monitoring.checkIntervalMinutes,
        databasePath: config.database.path
      }
    };
  }

  /**
   * Monitora recursos do sistema
   */
  startResourceMonitoring() {
    setInterval(() => {
      const memUsage = process.memoryUsage();
      const cpuUsage = process.cpuUsage();
      
      // Log se uso de memória muito alto
      const memUsedMB = memUsage.heapUsed / 1024 / 1024;
      if (memUsedMB > 500) { // 500MB
        logger.warn('Alto uso de memória detectado', {
          heapUsed: `${memUsedMB.toFixed(2)} MB`,
          heapTotal: `${(memUsage.heapTotal / 1024 / 1024).toFixed(2)} MB`,
          external: `${(memUsage.external / 1024 / 1024).toFixed(2)} MB`
        });
      }

    }, 5 * 60 * 1000); // A cada 5 minutos
  }
}

// Função principal de inicialização
async function main() {
  // Verificar versão do Node.js
  const nodeVersion = process.version.slice(1).split('.').map(Number);
  if (nodeVersion[0] < 16) {
    console.error('❌ Este aplicativo requer Node.js 16 ou superior');
    console.error(`   Versão atual: ${process.version}`);
    console.error('   Por favor, atualize o Node.js: https://nodejs.org/');
    process.exit(1);
  }

  // Verificar se arquivo .env existe
  const fs = require('fs');
  const path = require('path');
  
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) {
    console.error('❌ Arquivo .env não encontrado!');
    console.error('   Crie um arquivo .env baseado no .env.example');
    console.error('   Configure pelo menos DISCORD_TOKEN e CLIENT_ID');
    process.exit(1);
  }

  // Criar diretórios necessários
  const directories = ['./data', './logs', './backups'];
  directories.forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });

  // Inicializar aplicação
  const app = new PriceMonitorApp();
  
  // Adicionar referência global para debugging
  global.app = app;
  
  await app.start();
  
  // Iniciar monitoramento de recursos em produção
  if (config.isProduction()) {
    app.startResourceMonitoring();
  }
}

// Executar apenas se este arquivo for o ponto de entrada
if (require.main === module) {
  main().catch(error => {
    console.error('💥 Falha crítica na inicialização:', error);
    process.exit(1);
  });
}

// Exportar para testes ou uso como módulo
module.exports = PriceMonitorApp;