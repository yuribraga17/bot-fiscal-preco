const { Client, GatewayIntentBits, Collection, REST, Routes } = require('discord.js');
const { readdirSync } = require('fs');
const path = require('path');
const config = require('../config/config');
const logger = require('../utils/logger');
const NotificationService = require('../services/NotificationService');

/**
 * Classe principal do Bot Discord
 * Gerencia conexão, comandos e eventos
 */
class DiscordBot {
  
  constructor() {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
      ]
    });

    this.commands = new Collection();
    this.notificationService = new NotificationService();
    this.isReady = false;
  }

  /**
   * Inicializa o bot Discord
   */
  async initialize() {
    try {
      logger.info('Inicializando bot Discord...');

      // Carregar comandos
      await this.loadCommands();
      
      // Carregar eventos
      await this.loadEvents();
      
      // Configurar handlers de erro
      this.setupErrorHandlers();
      
      // Fazer login
      await this.client.login(config.discord.token);
      
      // Aguardar bot estar pronto
      await this.waitForReady();
      
      // Configurar serviço de notificações
      this.notificationService.setClient(this.client);
      
      logger.info('Bot Discord inicializado com sucesso');
      return true;

    } catch (error) {
      logger.error('Erro ao inicializar bot Discord:', error);
      throw error;
    }
  }

  /**
   * Carrega todos os comandos da pasta commands
   */
  async loadCommands() {
    const commandsPath = path.join(__dirname, 'commands');
    
    try {
      const commandFiles = readdirSync(commandsPath).filter(file => file.endsWith('.js'));
      
      logger.info(`Carregando ${commandFiles.length} comando(s)...`);

      for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        
        try {
          // Limpar cache do require para hot reload
          delete require.cache[require.resolve(filePath)];
          
          const command = require(filePath);
          
          // Validar estrutura do comando
          if (!command.data || !command.execute) {
            logger.warn(`Comando inválido ignorado: ${file}`);
            continue;
          }
          
          this.commands.set(command.data.name, command);
          logger.debug(`Comando carregado: ${command.data.name}`);
          
        } catch (error) {
          logger.error(`Erro ao carregar comando ${file}:`, error);
        }
      }

      logger.info(`${this.commands.size} comando(s) carregado(s)`);

    } catch (error) {
      logger.error('Erro ao carregar comandos:', error);
      throw error;
    }
  }

  /**
   * Carrega todos os eventos da pasta events
   */
  async loadEvents() {
    const eventsPath = path.join(__dirname, 'events');
    
    try {
      const eventFiles = readdirSync(eventsPath).filter(file => file.endsWith('.js'));
      
      logger.info(`Carregando ${eventFiles.length} evento(s)...`);

      for (const file of eventFiles) {
        const filePath = path.join(eventsPath, file);
        
        try {
          // Limpar cache do require
          delete require.cache[require.resolve(filePath)];
          
          const event = require(filePath);
          
          // Validar estrutura do evento
          if (!event.name || !event.execute) {
            logger.warn(`Evento inválido ignorado: ${file}`);
            continue;
          }
          
          // Registrar evento
          if (event.once) {
            this.client.once(event.name, (...args) => event.execute(...args));
          } else {
            this.client.on(event.name, (...args) => event.execute(...args));
          }
          
          logger.debug(`Evento registrado: ${event.name}`);
          
        } catch (error) {
          logger.error(`Erro ao carregar evento ${file}:`, error);
        }
      }

      logger.info('Eventos carregados com sucesso');

    } catch (error) {
      logger.error('Erro ao carregar eventos:', error);
      throw error;
    }
  }

  /**
   * Registra comandos slash no Discord
   */
  async registerSlashCommands() {
    try {
      logger.info('Registrando comandos slash...');

      const commands = Array.from(this.commands.values()).map(command => command.data.toJSON());
      
      const rest = new REST({ version: '10' }).setToken(config.discord.token);

      // Registrar comandos globalmente
      const data = await rest.put(
        Routes.applicationCommands(config.discord.clientId),
        { body: commands }
      );

      logger.info(`${data.length} comando(s) slash registrado(s) globalmente`);
      return data;

    } catch (error) {
      logger.error('Erro ao registrar comandos slash:', error);
      throw error;
    }
  }

  /**
   * Registra comandos slash para uma guild específica (desenvolvimento)
   * @param {string} guildId - ID da guild
   */
  async registerGuildCommands(guildId) {
    try {
      logger.info(`Registrando comandos slash para guild ${guildId}...`);

      const commands = Array.from(this.commands.values()).map(command => command.data.toJSON());
      
      const rest = new REST({ version: '10' }).setToken(config.discord.token);

      const data = await rest.put(
        Routes.applicationGuildCommands(config.discord.clientId, guildId),
        { body: commands }
      );

      logger.info(`${data.length} comando(s) slash registrado(s) para guild ${guildId}`);
      return data;

    } catch (error) {
      logger.error('Erro ao registrar comandos da guild:', error);
      throw error;
    }
  }

  /**
   * Aguarda o bot estar pronto
   */
  async waitForReady() {
    return new Promise((resolve) => {
      if (this.isReady) {
        resolve();
        return;
      }

      const timeout = setTimeout(() => {
        logger.warn('Timeout aguardando bot ficar pronto');
        resolve();
      }, 30000); // 30 segundos timeout

      this.client.once('ready', () => {
        clearTimeout(timeout);
        this.isReady = true;
        resolve();
      });
    });
  }

  /**
   * Configura handlers de erro do Discord
   */
  setupErrorHandlers() {
    this.client.on('error', error => {
      logger.error('Erro no cliente Discord:', error);
    });

    this.client.on('warn', warning => {
      logger.warn('Aviso do Discord:', warning);
    });

    this.client.on('debug', info => {
      if (config.isDevelopment()) {
        logger.debug('Debug Discord:', info);
      }
    });

    // Handler para reconexão
    this.client.on('disconnect', () => {
      logger.warn('Bot Discord desconectado');
      this.isReady = false;
    });

    this.client.on('reconnecting', () => {
      logger.info('Bot Discord reconectando...');
    });

    this.client.on('resume', () => {
      logger.info('Bot Discord reconectado');
      this.isReady = true;
    });

    // Handler para rate limiting
    this.client.rest.on('rateLimited', rateLimitInfo => {
      logger.warn('Rate limited:', rateLimitInfo);
    });
  }

  /**
   * Recarrega um comando específico
   * @param {string} commandName - Nome do comando
   */
  async reloadCommand(commandName) {
    try {
      const command = this.commands.get(commandName);
      
      if (!command) {
        throw new Error(`Comando ${commandName} não encontrado`);
      }

      // Encontrar arquivo do comando
      const commandsPath = path.join(__dirname, 'commands');
      const commandFiles = readdirSync(commandsPath).filter(file => file.endsWith('.js'));
      
      const commandFile = commandFiles.find(file => {
        const filePath = path.join(commandsPath, file);
        const cmd = require(filePath);
        return cmd.data.name === commandName;
      });

      if (!commandFile) {
        throw new Error(`Arquivo do comando ${commandName} não encontrado`);
      }

      // Recarregar comando
      const filePath = path.join(commandsPath, commandFile);
      delete require.cache[require.resolve(filePath)];
      
      const newCommand = require(filePath);
      this.commands.set(newCommand.data.name, newCommand);
      
      logger.info(`Comando ${commandName} recarregado`);
      return true;

    } catch (error) {
      logger.error(`Erro ao recarregar comando ${commandName}:`, error);
      throw error;
    }
  }

  /**
   * Obtém informações do bot
   */
  getBotInfo() {
    if (!this.client.user) {
      return { ready: false };
    }

    return {
      ready: this.isReady,
      username: this.client.user.username,
      discriminator: this.client.user.discriminator,
      id: this.client.user.id,
      avatar: this.client.user.displayAvatarURL(),
      guilds: this.client.guilds.cache.size,
      users: this.client.users.cache.size,
      channels: this.client.channels.cache.size,
      commands: this.commands.size,
      uptime: this.client.uptime,
      ping: this.client.ws.ping
    };
  }

  /**
   * Obtém estatísticas detalhadas
   */
  getStats() {
    const info = this.getBotInfo();
    
    if (!info.ready) {
      return { ready: false };
    }

    return {
      ...info,
      memory: process.memoryUsage(),
      guildsDetailed: this.client.guilds.cache.map(guild => ({
        id: guild.id,
        name: guild.name,
        memberCount: guild.memberCount,
        channels: guild.channels.cache.size
      })),
      notifications: this.notificationService.getStats()
    };
  }

  /**
   * Envia mensagem para canal específico
   * @param {string} channelId - ID do canal
   * @param {Object} messageData - Dados da mensagem
   */
  async sendMessage(channelId, messageData) {
    try {
      const channel = await this.client.channels.fetch(channelId);
      
      if (!channel) {
        throw new Error(`Canal ${channelId} não encontrado`);
      }

      return await channel.send(messageData);

    } catch (error) {
      logger.error('Erro ao enviar mensagem:', error, { channelId });
      throw error;
    }
  }

  /**
   * Atualiza status/atividade do bot
   * @param {string} activity - Texto da atividade
   * @param {string} type - Tipo da atividade (PLAYING, WATCHING, LISTENING, STREAMING)
   */
  async setActivity(activity, type = 'WATCHING') {
    try {
      if (!this.client.user) {
        throw new Error('Bot não está pronto');
      }

      await this.client.user.setActivity(activity, { type });
      logger.info(`Atividade atualizada: ${type} ${activity}`);

    } catch (error) {
      logger.error('Erro ao atualizar atividade:', error);
      throw error;
    }
  }

  /**
   * Define status do bot
   * @param {string} status - Status (online, idle, dnd, invisible)
   */
  async setStatus(status) {
    try {
      if (!this.client.user) {
        throw new Error('Bot não está pronto');
      }

      await this.client.user.setStatus(status);
      logger.info(`Status atualizado: ${status}`);

    } catch (error) {
      logger.error('Erro ao atualizar status:', error);
      throw error;
    }
  }

  /**
   * Busca usuário por ID
   * @param {string} userId - ID do usuário
   */
  async getUser(userId) {
    try {
      return await this.client.users.fetch(userId);
    } catch (error) {
      logger.error('Erro ao buscar usuário:', error, { userId });
      throw error;
    }
  }

  /**
   * Busca guild por ID
   * @param {string} guildId - ID da guild
   */
  async getGuild(guildId) {
    try {
      return await this.client.guilds.fetch(guildId);
    } catch (error) {
      logger.error('Erro ao buscar guild:', error, { guildId });
      throw error;
    }
  }

  /**
   * Verifica se usuário tem permissão de admin
   * @param {string} userId - ID do usuário
   * @param {string} guildId - ID da guild
   */
  async isAdmin(userId, guildId) {
    try {
      // Admin global
      if (userId === config.discord.adminUserId) {
        return true;
      }

      // Verificar permissões na guild
      const guild = await this.getGuild(guildId);
      const member = await guild.members.fetch(userId);
      
      return member.permissions.has('Administrator') || member.permissions.has('ManageGuild');

    } catch (error) {
      logger.error('Erro ao verificar permissões de admin:', error, { userId, guildId });
      return false;
    }
  }

  /**
   * Obtém client do Discord (para uso externo)
   */
  getClient() {
    return this.client;
  }

  /**
   * Obtém serviço de notificações
   */
  getNotificationService() {
    return this.notificationService;
  }

  /**
   * Finaliza o bot graciosamente
   */
  async shutdown() {
    try {
      logger.info('Finalizando bot Discord...');
      
      // Parar serviço de notificações
      this.notificationService.shutdown();
      
      // Definir status como offline
      await this.setStatus('invisible').catch(() => {});
      
      // Destruir cliente
      this.client.destroy();
      
      this.isReady = false;
      
      logger.info('Bot Discord finalizado');

    } catch (error) {
      logger.error('Erro ao finalizar bot:', error);
    }
  }

  /**
   * Força reconexão do bot
   */
  async reconnect() {
    try {
      logger.info('Forçando reconexão do bot Discord...');
      
      await this.client.destroy();
      await this.client.login(config.discord.token);
      await this.waitForReady();
      
      logger.info('Bot Discord reconectado com sucesso');

    } catch (error) {
      logger.error('Erro ao reconectar bot:', error);
      throw error;
    }
  }
}

module.exports = new DiscordBot();