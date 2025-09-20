const { Events, ActivityType } = require('discord.js');
const config = require('../../config/config');
const logger = require('../../utils/logger');
const Product = require('../../database/models/Product');

module.exports = {
  name: Events.ClientReady,
  once: true,
  
  async execute(client) {
    try {
      logger.info(`Bot conectado como ${client.user.tag}!`, {
        botId: client.user.id,
        guilds: client.guilds.cache.size,
        users: client.users.cache.size
      });

      // Registrar comandos slash
      await registerSlashCommands(client);

      // Configurar atividade do bot
      await setInitialActivity(client);

      // Verificar e reportar estatísticas iniciais
      await reportInitialStats(client);

      // Configurar atualizações periódicas
      setupPeriodicUpdates(client);

      // Notificar admin se configurado
      await notifyAdminReady(client);

      logger.info('Bot Discord totalmente inicializado');

    } catch (error) {
      logger.error('Erro no evento ready:', error);
    }
  }
};

/**
 * Registra comandos slash no Discord
 */
async function registerSlashCommands(client) {
  try {
    const { REST, Routes } = require('discord.js');
    const fs = require('fs');
    const path = require('path');

    const commands = [];
    const commandsPath = path.join(__dirname, '..', 'commands');
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

    // Carregar comandos
    for (const file of commandFiles) {
      const filePath = path.join(commandsPath, file);
      const command = require(filePath);
      
      if ('data' in command && 'execute' in command) {
        commands.push(command.data.toJSON());
      }
    }

    const rest = new REST().setToken(config.discord.token);

    if (config.isDevelopment()) {
      // Em desenvolvimento, registrar comandos por guild para atualizações mais rápidas
      logger.info('Registrando comandos em modo desenvolvimento...');
      
      for (const guild of client.guilds.cache.values()) {
        await rest.put(
          Routes.applicationGuildCommands(config.discord.clientId, guild.id),
          { body: commands }
        );
        logger.debug(`Comandos registrados para guild: ${guild.name} (${guild.id})`);
      }
    } else {
      // Em produção, registrar comandos globalmente
      logger.info('Registrando comandos globalmente...');
      
      await rest.put(
        Routes.applicationCommands(config.discord.clientId),
        { body: commands }
      );
    }

    logger.info(`${commands.length} comando(s) slash registrado(s) com sucesso`);

  } catch (error) {
    logger.error('Erro ao registrar comandos slash:', error);
  }
}

/**
 * Define atividade inicial do bot
 */
async function setInitialActivity(client) {
  try {
    const stats = await Product.getStats();
    const activityText = `${stats.totalProducts} produtos • /addproduct`;

    await client.user.setActivity(activityText, { 
      type: ActivityType.Watching 
    });

    logger.info(`Atividade definida: ${activityText}`);

  } catch (error) {
    logger.error('Erro ao definir atividade inicial:', error);
    
    // Fallback para atividade padrão
    await client.user.setActivity('/addproduct para começar!', { 
      type: ActivityType.Watching 
    });
  }
}

/**
 * Reporta estatísticas iniciais
 */
async function reportInitialStats(client) {
  try {
    const stats = await Product.getStats();
    const botInfo = {
      guilds: client.guilds.cache.size,
      users: client.users.cache.size,
      channels: client.channels.cache.size
    };

    logger.info('Estatísticas iniciais do bot:', {
      ...botInfo,
      products: {
        total: stats.totalProducts,
        activePromotions: stats.activePromotions,
        averagePrice: stats.averagePrice
      },
      uptime: process.uptime()
    });

    // Log detalhado das guilds
    client.guilds.cache.forEach(guild => {
      logger.debug(`Guild conectada: ${guild.name} (${guild.id}) - ${guild.memberCount} membros`);
    });

  } catch (error) {
    logger.error('Erro ao reportar estatísticas iniciais:', error);
  }
}

/**
 * Configura atualizações periódicas do status
 */
function setupPeriodicUpdates(client) {
  // Atualizar atividade a cada 10 minutos
  setInterval(async () => {
    try {
      const stats = await Product.getStats();
      let activityText;

      // Alternar entre diferentes tipos de informação
      const messages = [
        `${stats.totalProducts} produtos monitorados`,
        `${stats.activePromotions} promoções ativas`,
        `/addproduct para monitorar`,
        `${client.guilds.cache.size} servidores conectados`
      ];

      const randomMessage = messages[Math.floor(Math.random() * messages.length)];
      
      await client.user.setActivity(randomMessage, { 
        type: ActivityType.Watching 
      });

      logger.debug(`Atividade atualizada: ${randomMessage}`);

    } catch (error) {
      logger.error('Erro ao atualizar atividade periódica:', error);
    }
  }, 10 * 60 * 1000); // 10 minutos

  // Log de estatísticas a cada hora
  setInterval(async () => {
    try {
      const stats = await Product.getStats();
      const memUsage = process.memoryUsage();

      logger.info('Estatísticas horárias:', {
        products: stats,
        guilds: client.guilds.cache.size,
        users: client.users.cache.size,
        uptime: process.uptime(),
        memory: {
          used: `${Math.round(memUsage.heapUsed / 1024 / 1024)} MB`,
          total: `${Math.round(memUsage.heapTotal / 1024 / 1024)} MB`
        }
      });

    } catch (error) {
      logger.error('Erro nas estatísticas horárias:', error);
    }
  }, 60 * 60 * 1000); // 1 hora

  logger.info('Atualizações periódicas configuradas');
}

/**
 * Notifica admin que o bot está online
 */
async function notifyAdminReady(client) {
  try {
    if (!config.discord.adminUserId) {
      return;
    }

    const admin = await client.users.fetch(config.discord.adminUserId);
    const stats = await Product.getStats();

    const { EmbedBuilder } = require('discord.js');
    const embed = new EmbedBuilder()
      .setColor(0x00FF00)
      .setTitle('🤖 Bot Online')
      .setDescription('Monitor de Preços iniciado com sucesso!')
      .addFields(
        { name: '🔧 Ambiente', value: config.server.nodeEnv, inline: true },
        { name: '🏠 Servidores', value: client.guilds.cache.size.toString(), inline: true },
        { name: '👥 Usuários', value: client.users.cache.size.toString(), inline: true },
        { name: '📦 Produtos Ativos', value: stats.totalProducts.toString(), inline: true },
        { name: '🔥 Promoções', value: stats.activePromotions.toString(), inline: true },
        { name: '⏱️ Uptime', value: formatUptime(process.uptime()), inline: true }
      )
      .setTimestamp()
      .setFooter({ 
        text: `Bot ID: ${client.user.id}`,
        iconURL: client.user.displayAvatarURL() 
      });

    await admin.send({ embeds: [embed] });
    logger.info('Notificação de inicialização enviada para admin');

  } catch (error) {
    logger.warn('Não foi possível notificar admin:', error.message);
  }
}

/**
 * Formata uptime em formato legível
 */
function formatUptime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  } else {
    return `${secs}s`;
  }
}