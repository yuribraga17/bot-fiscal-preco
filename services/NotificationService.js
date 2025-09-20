const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../config/config');
const logger = require('../utils/logger');

/**
 * Serviço de notificações do Discord
 * Gerencia o envio de todas as notificações do bot
 */
class NotificationService {
  
  constructor() {
    this.client = null;
    this.notificationCooldowns = new Map();
    this.notificationQueue = [];
    this.isProcessingQueue = false;
  }

  /**
   * Inicializa o serviço com o client do Discord
   * @param {Client} discordClient - Cliente do Discord
   */
  setClient(discordClient) {
    this.client = discordClient;
    logger.info('NotificationService inicializado com cliente Discord');
  }

  /**
   * Envia notificação de preço alvo atingido
   * @param {Object} product - Dados do produto
   * @param {number} newPrice - Novo preço
   * @param {number} oldPrice - Preço anterior
   */
  async sendTargetReachedNotification(product, newPrice, oldPrice) {
    try {
      const discount = ((oldPrice - newPrice) / oldPrice) * 100;
      
      const embed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle('🎯 PREÇO ALVO ATINGIDO!')
        .setDescription(`**${product.name}** atingiu seu preço alvo!`)
        .addFields(
          { name: '💰 Preço Atual', value: `R$ ${newPrice.toFixed(2)}`, inline: true },
          { name: '🎯 Preço Alvo', value: `R$ ${product.target_price.toFixed(2)}`, inline: true },
          { name: '📉 Economia', value: `R$ ${(oldPrice - newPrice).toFixed(2)} (-${discount.toFixed(1)}%)`, inline: true }
        )
        .setURL(product.url)
        .setTimestamp()
        .setFooter({ text: 'Monitor de Preços • Aproveite a promoção!' })
        .setThumbnail('https://cdn.discordapp.com/emojis/741690203716608100.png'); // Emoji de sucesso

      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setLabel('🛒 Comprar Agora')
            .setStyle(ButtonStyle.Link)
            .setURL(product.url),
          new ButtonBuilder()
            .setLabel('📊 Ver Histórico')
            .setStyle(ButtonStyle.Secondary)
            .setCustomId(`history_${product.id}`)
        );

      const notificationData = {
        type: 'target_reached',
        product,
        embed,
        components: [row],
        mention: `<@${product.user_id}>`
      };

      await this.queueNotification(notificationData);

      // Salvar notificação no banco
      await this.saveNotification(product.id, 'target_reached', 
        `Preço alvo atingido: R$ ${newPrice.toFixed(2)}`);

      return { sent: true, type: 'target_reached' };

    } catch (error) {
      logger.error('Erro ao enviar notificação de preço alvo:', error);
      return { sent: false, error: error.message };
    }
  }

  /**
   * Envia notificação de queda de preço
   * @param {Object} product - Dados do produto
   * @param {number} newPrice - Novo preço
   * @param {number} oldPrice - Preço anterior
   * @param {number} priceChange - Percentual de mudança
   */
  async sendPriceDropNotification(product, newPrice, oldPrice, priceChange) {
    try {
      const savings = oldPrice - newPrice;
      
      const embed = new EmbedBuilder()
        .setColor(0xFFFF00)
        .setTitle('📉 QUEDA DE PREÇO DETECTADA!')
        .setDescription(`**${product.name}** teve uma queda significativa de preço!`)
        .addFields(
          { name: '💸 Preço Anterior', value: `R$ ${oldPrice.toFixed(2)}`, inline: true },
          { name: '💰 Preço Atual', value: `R$ ${newPrice.toFixed(2)}`, inline: true },
          { name: '📊 Variação', value: `${priceChange.toFixed(1)}%`, inline: true },
          { name: '💵 Economia', value: `R$ ${savings.toFixed(2)}`, inline: true },
          { name: '🎯 Preço Alvo', value: `R$ ${product.target_price.toFixed(2)}`, inline: true },
          { name: '📏 Distância do Alvo', value: `${((newPrice / product.target_price - 1) * 100).toFixed(1)}%`, inline: true }
        )
        .setURL(product.url)
        .setTimestamp()
        .setFooter({ text: 'Monitor de Preços • Oportunidade de compra!' });

      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setLabel('🛒 Ver Produto')
            .setStyle(ButtonStyle.Link)
            .setURL(product.url),
          new ButtonBuilder()
            .setLabel('📈 Tendência')
            .setStyle(ButtonStyle.Secondary)
            .setCustomId(`trend_${product.id}`)
        );

      const notificationData = {
        type: 'price_drop',
        product,
        embed,
        components: [row],
        mention: `<@${product.user_id}>`
      };

      await this.queueNotification(notificationData);

      await this.saveNotification(product.id, 'price_drop', 
        `Queda de ${Math.abs(priceChange).toFixed(1)}%: R$ ${newPrice.toFixed(2)}`);

      return { sent: true, type: 'price_drop' };

    } catch (error) {
      logger.error('Erro ao enviar notificação de queda de preço:', error);
      return { sent: false, error: error.message };
    }
  }

  /**
   * Envia notificação de aumento de preço
   * @param {Object} product - Dados do produto
   * @param {number} newPrice - Novo preço
   * @param {number} oldPrice - Preço anterior
   * @param {number} priceChange - Percentual de mudança
   */
  async sendPriceIncreaseNotification(product, newPrice, oldPrice, priceChange) {
    try {
      const increase = newPrice - oldPrice;
      
      const embed = new EmbedBuilder()
        .setColor(0xFF4444)
        .setTitle('📈 AUMENTO DE PREÇO')
        .setDescription(`**${product.name}** teve um aumento significativo de preço.`)
        .addFields(
          { name: '💰 Preço Anterior', value: `R$ ${oldPrice.toFixed(2)}`, inline: true },
          { name: '💸 Preço Atual', value: `R$ ${newPrice.toFixed(2)}`, inline: true },
          { name: '📊 Variação', value: `+${priceChange.toFixed(1)}%`, inline: true },
          { name: '💔 Aumento', value: `R$ ${increase.toFixed(2)}`, inline: true },
          { name: '🎯 Preço Alvo', value: `R$ ${product.target_price.toFixed(2)}`, inline: true },
          { name: '⏰ Status', value: newPrice > product.target_price ? '❌ Acima do alvo' : '✅ Ainda no alvo', inline: true }
        )
        .setURL(product.url)
        .setTimestamp()
        .setFooter({ text: 'Monitor de Preços • Acompanhe a variação' });

      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setLabel('👀 Ver Produto')
            .setStyle(ButtonStyle.Link)
            .setURL(product.url),
          new ButtonBuilder()
            .setLabel('⚙️ Ajustar Alvo')
            .setStyle(ButtonStyle.Secondary)
            .setCustomId(`adjust_${product.id}`)
        );

      const notificationData = {
        type: 'price_increase',
        product,
        embed,
        components: [row],
        mention: null // Não mencionar em aumentos (menos urgente)
      };

      await this.queueNotification(notificationData);

      await this.saveNotification(product.id, 'price_increase', 
        `Aumento de ${priceChange.toFixed(1)}%: R$ ${newPrice.toFixed(2)}`);

      return { sent: true, type: 'price_increase' };

    } catch (error) {
      logger.error('Erro ao enviar notificação de aumento de preço:', error);
      return { sent: false, error: error.message };
    }
  }

  /**
   * Envia resumo das verificações
   * @param {Object} stats - Estatísticas da verificação
   * @param {Array} results - Resultados detalhados
   */
  async sendSummaryNotification(stats, results) {
    try {
      const promotions = results.filter(r => r.newPrice <= r.product.target_price);
      const bigDrops = results.filter(r => r.priceChange <= -10);
      
      const embed = new EmbedBuilder()
        .setColor(0x0099FF)
        .setTitle('📊 RESUMO DE VERIFICAÇÃO')
        .setDescription(`Verificação automática concluída com ${stats.notifications} notificações enviadas.`)
        .addFields(
          { name: '📦 Produtos Verificados', value: `${stats.total}`, inline: true },
          { name: '✅ Sucessos', value: `${stats.successful}`, inline: true },
          { name: '❌ Falhas', value: `${stats.failed}`, inline: true },
          { name: '🔥 Promoções Ativas', value: `${promotions.length}`, inline: true },
          { name: '📉 Grandes Quedas', value: `${bigDrops.length}`, inline: true },
          { name: '💰 Preço Médio', value: `R$ ${stats.averagePrice.toFixed(2)}`, inline: true }
        )
        .setTimestamp()
        .setFooter({ text: 'Monitor de Preços • Resumo Automático' });

      // Adicionar produtos com maiores quedas
      if (bigDrops.length > 0) {
        const topDrops = bigDrops
          .sort((a, b) => a.priceChange - b.priceChange)
          .slice(0, 3)
          .map(r => `• **${r.product.name.substring(0, 50)}...**: ${r.priceChange.toFixed(1)}%`)
          .join('\n');
        
        embed.addFields({ name: '🏆 Maiores Quedas', value: topDrops, inline: false });
      }

      // Enviar para canal administrativo se configurado
      const adminChannelId = config.discord.adminChannelId;
      if (adminChannelId && this.client) {
        try {
          const channel = await this.client.channels.fetch(adminChannelId);
          await channel.send({ embeds: [embed] });
        } catch (error) {
          logger.warn('Não foi possível enviar resumo para canal admin:', error);
        }
      }

      return { sent: true, type: 'summary' };

    } catch (error) {
      logger.error('Erro ao enviar resumo:', error);
      return { sent: false, error: error.message };
    }
  }

  /**
   * Envia notificação de erro crítico
   * @param {string} message - Mensagem de erro
   * @param {Object} context - Contexto adicional
   */
  async sendErrorNotification(message, context = {}) {
    try {
      if (!config.discord.adminUserId) return;

      const embed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('🚨 ERRO CRÍTICO DO SISTEMA')
        .setDescription(message)
        .addFields(
          { name: '⏰ Timestamp', value: new Date().toISOString(), inline: true },
          { name: '🔧 Ambiente', value: config.server.nodeEnv, inline: true }
        )
        .setTimestamp()
        .setFooter({ text: 'Sistema de Monitoramento' });

      if (Object.keys(context).length > 0) {
        embed.addFields({
          name: '📋 Contexto',
          value: `\`\`\`json\n${JSON.stringify(context, null, 2)}\`\`\``,
          inline: false
        });
      }

      // Tentar enviar DM para admin
      if (this.client) {
        try {
          const adminUser = await this.client.users.fetch(config.discord.adminUserId);
          await adminUser.send({ embeds: [embed] });
        } catch (error) {
          logger.error('Não foi possível enviar erro para admin:', error);
        }
      }

      return { sent: true, type: 'error' };

    } catch (error) {
      logger.error('Erro ao enviar notificação de erro:', error);
      return { sent: false, error: error.message };
    }
  }

  /**
   * Adiciona notificação à fila de envio
   * @param {Object} notificationData - Dados da notificação
   */
  async queueNotification(notificationData) {
    // Verificar cooldown para evitar spam
    const cooldownKey = `${notificationData.product.id}_${notificationData.type}`;
    const cooldownTime = config.notifications.cooldownMinutes * 60 * 1000;
    
    if (this.notificationCooldowns.has(cooldownKey)) {
      const lastSent = this.notificationCooldowns.get(cooldownKey);
      if (Date.now() - lastSent < cooldownTime) {
        logger.debug(`Notificação em cooldown: ${cooldownKey}`);
        return;
      }
    }

    this.notificationQueue.push(notificationData);
    this.notificationCooldowns.set(cooldownKey, Date.now());

    if (!this.isProcessingQueue) {
      await this.processNotificationQueue();
    }
  }

  /**
   * Processa a fila de notificações
   */
  async processNotificationQueue() {
    if (this.isProcessingQueue || this.notificationQueue.length === 0) {
      return;
    }

    this.isProcessingQueue = true;

    while (this.notificationQueue.length > 0) {
      const notification = this.notificationQueue.shift();
      
      try {
        await this.sendDiscordNotification(notification);
        
        // Rate limiting - aguardar entre envios
        if (this.notificationQueue.length > 0) {
          await this.delay(2000); // 2 segundos entre notificações
        }

      } catch (error) {
        logger.error('Erro ao processar notificação da fila:', error);
      }
    }

    this.isProcessingQueue = false;
  }

  /**
   * Envia notificação efetivamente para o Discord
   * @param {Object} notificationData - Dados da notificação
   */
  async sendDiscordNotification(notificationData) {
    if (!this.client) {
      throw new Error('Cliente Discord não configurado');
    }

    const { product, embed, components, mention } = notificationData;

    try {
      const channel = await this.client.channels.fetch(product.channel_id);
      
      if (!channel) {
        throw new Error(`Canal ${product.channel_id} não encontrado`);
      }

      const messageData = {
        embeds: [embed]
      };

      if (components && components.length > 0) {
        messageData.components = components;
      }

      if (mention) {
        messageData.content = mention;
      }

      const sentMessage = await channel.send(messageData);
      
      logger.notification(notificationData.type, product.name, {
        channelId: product.channel_id,
        messageId: sentMessage.id,
        productId: product.id
      });

      return sentMessage;

    } catch (error) {
      logger.error('Erro ao enviar notificação Discord:', error, {
        productId: product.id,
        channelId: product.channel_id,
        type: notificationData.type
      });
      throw error;
    }
  }

  /**
   * Salva notificação no banco de dados
   * @param {number} productId - ID do produto
   * @param {string} type - Tipo de notificação
   * @param {string} message - Mensagem da notificação
   */
  async saveNotification(productId, type, message) {
    try {
      const database = require('../database/database');
      
      await database.run(
        'INSERT INTO notifications (product_id, type, message) VALUES (?, ?, ?)',
        [productId, type, message]
      );

    } catch (error) {
      logger.error('Erro ao salvar notificação no banco:', error);
    }
  }

  /**
   * Cria embed personalizado para produto
   * @param {Object} product - Dados do produto
   * @param {string} title - Título do embed
   * @param {string} color - Cor do embed (hex)
   * @param {Array} fields - Campos adicionais
   */
  createProductEmbed(product, title, color = 0x0099FF, fields = []) {
    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(title)
      .setDescription(product.name)
      .setURL(product.url)
      .setTimestamp()
      .setFooter({ text: 'Monitor de Preços' });

    if (fields.length > 0) {
      embed.addFields(fields);
    }

    return embed;
  }

  /**
   * Cria botões de ação para produto
   * @param {Object} product - Dados do produto
   * @param {Array} customActions - Ações personalizadas
   */
  createProductButtons(product, customActions = []) {
    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setLabel('🛒 Ver Produto')
          .setStyle(ButtonStyle.Link)
          .setURL(product.url)
      );

    customActions.forEach(action => {
      row.addComponents(
        new ButtonBuilder()
          .setLabel(action.label)
          .setStyle(action.style || ButtonStyle.Secondary)
          .setCustomId(action.customId)
      );
    });

    return row;
  }

  /**
   * Limpa cooldowns antigos
   */
  cleanupCooldowns() {
    const now = Date.now();
    const cooldownTime = config.notifications.cooldownMinutes * 60 * 1000;

    for (const [key, timestamp] of this.notificationCooldowns.entries()) {
      if (now - timestamp > cooldownTime) {
        this.notificationCooldowns.delete(key);
      }
    }

    logger.debug(`Limpeza de cooldowns: ${this.notificationCooldowns.size} ativos`);
  }

  /**
   * Obtém estatísticas do serviço
   */
  getStats() {
    return {
      queueLength: this.notificationQueue.length,
      isProcessingQueue: this.isProcessingQueue,
      activeCooldowns: this.notificationCooldowns.size,
      clientConnected: !!this.client
    };
  }

  /**
   * Delay assíncrono
   * @param {number} ms - Milissegundos para aguardar
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Para o processamento e limpa filas
   */
  shutdown() {
    this.notificationQueue = [];
    this.notificationCooldowns.clear();
    this.isProcessingQueue = false;
    this.client = null;
    
    logger.info('NotificationService finalizado');
  }
}

module.exports = NotificationService;