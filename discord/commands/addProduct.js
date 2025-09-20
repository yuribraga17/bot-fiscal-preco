const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const Product = require('../../database/models/Product');
const PriceHistory = require('../../database/models/PriceHistory');
const PriceScraper = require('../../services/PriceScraper');
const logger = require('../../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('addproduct')
    .setDescription('Adiciona um produto para monitoramento de preços')
    .addStringOption(option =>
      option
        .setName('url')
        .setDescription('URL do produto para monitorar')
        .setRequired(true))
    .addNumberOption(option =>
      option
        .setName('target_price')
        .setDescription('Preço alvo para notificação (em reais)')
        .setRequired(true)
        .setMinValue(0.01))
    .addStringOption(option =>
      option
        .setName('name')
        .setDescription('Nome personalizado para o produto (opcional)')
        .setRequired(false)
        .setMaxLength(100))
    .addNumberOption(option =>
      option
        .setName('promotion_threshold')
        .setDescription('Percentual mínimo de queda para notificar (padrão: 10%)')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(50)),

  async execute(interaction) {
    const startTime = Date.now();
    
    try {
      await interaction.deferReply();

      const url = interaction.options.getString('url');
      const targetPrice = interaction.options.getNumber('target_price');
      const customName = interaction.options.getString('name');
      const promotionThreshold = interaction.options.getNumber('promotion_threshold') || 10;

      logger.info('Comando addproduct executado', {
        userId: interaction.user.id,
        guildId: interaction.guild.id,
        url,
        targetPrice,
        customName
      });

      // Validar URL
      if (!isValidUrl(url)) {
        return await interaction.editReply({
          embeds: [createErrorEmbed('❌ URL Inválida', 'Por favor, forneça uma URL válida (deve começar com http:// ou https://)')]
        });
      }

      // Verificar se a URL já está sendo monitorada
      const existingProduct = await Product.findByUrl(url);
      if (existingProduct) {
        return await interaction.editReply({
          embeds: [createErrorEmbed('❌ Produto já monitorado', 
            `Este produto já está sendo monitorado.\n**ID:** ${existingProduct.id}\n**Canal:** <#${existingProduct.channel_id}>`)]
        });
      }

      // Verificar suporte do site
      const siteSupport = PriceScraper.isSupportedSite(url);
      let supportWarning = null;

      if (siteSupport.confidence === 'none') {
        supportWarning = '⚠️ **Site não reconhecido** - O scraping pode não funcionar corretamente.';
      } else if (siteSupport.confidence === 'low') {
        supportWarning = '⚠️ **Site parcialmente suportado** - Alguns recursos podem não funcionar.';
      }

      // Tentar fazer scraping inicial
      const embed = new EmbedBuilder()
        .setColor(0xFFFF00)
        .setTitle('🔍 Verificando produto...')
        .setDescription('Analisando a URL e extraindo informações do produto. Isso pode demorar alguns segundos.')
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

      const scrapedData = await PriceScraper.scrapePrice(url);
      
      if (!scrapedData.success) {
        const errorEmbed = createErrorEmbed('❌ Erro ao analisar produto', 
          `Não foi possível extrair informações do produto.\n\n**Erro:** ${scrapedData.error}\n\n` +
          `**Possíveis soluções:**\n` +
          `• Verifique se a URL está correta\n` +
          `• Tente novamente em alguns minutos\n` +
          `• O site pode estar bloqueando bots\n\n` +
          `**Suporte:** ${siteSupport.confidence === 'high' ? '✅ Site suportado' : '❌ Site não suportado'}`
        );
        
        return await interaction.editReply({ embeds: [errorEmbed] });
      }

      // Usar nome personalizado ou nome extraído
      const productName = customName || scrapedData.name || 'Produto sem nome';
      
      // Criar produto no banco
      const productData = {
        name: productName,
        url: url,
        currentPrice: scrapedData.price,
        targetPrice: targetPrice,
        channelId: interaction.channel.id,
        guildId: interaction.guild.id,
        userId: interaction.user.id,
        promotionThreshold: promotionThreshold / 100, // Converter para decimal
        metadata: {
          addedBy: interaction.user.tag,
          scrapingDuration: scrapedData.duration,
          siteSupport: siteSupport.confidence,
          domain: scrapedData.domain
        }
      };

      const product = await Product.create(productData);

      // Adicionar ao histórico inicial
      await PriceHistory.add(product.id, scrapedData.price, null, 'initial');

      // Determinar status do produto
      const isOnTarget = scrapedData.price <= targetPrice;
      const discount = targetPrice > 0 ? ((targetPrice - scrapedData.price) / targetPrice) * 100 : 0;

      // Criar embed de sucesso
      const successEmbed = new EmbedBuilder()
        .setColor(isOnTarget ? 0x00FF00 : 0x0099FF)
        .setTitle('✅ Produto adicionado com sucesso!')
        .setDescription(`**${productName}**`)
        .addFields(
          { name: '💰 Preço Atual', value: `R$ ${scrapedData.price.toFixed(2)}`, inline: true },
          { name: '🎯 Preço Alvo', value: `R$ ${targetPrice.toFixed(2)}`, inline: true },
          { name: '📊 Status', value: getStatusText(scrapedData.price, targetPrice), inline: true },
          { name: '🔔 Alerta de Queda', value: `${promotionThreshold}%+`, inline: true },
          { name: '🆔 ID do Produto', value: `#${product.id}`, inline: true },
          { name: '⏱️ Próxima Verificação', value: `~${Math.ceil(Math.random() * 60)} min`, inline: true }
        )
        .setURL(url)
        .setTimestamp()
        .setFooter({ 
          text: `Adicionado por ${interaction.user.tag} • Monitor de Preços`,
          iconURL: interaction.user.displayAvatarURL()
        });

      // Adicionar campo de economia se em promoção
      if (isOnTarget && discount > 0) {
        successEmbed.addFields({
          name: '💸 Economia Atual',
          value: `R$ ${(targetPrice - scrapedData.price).toFixed(2)} (${discount.toFixed(1)}%)`,
          inline: true
        });
      }

      // Adicionar aviso de suporte se necessário
      if (supportWarning) {
        successEmbed.addFields({
          name: '⚠️ Aviso',
          value: supportWarning,
          inline: false
        });
      }

      // Criar botões de ação
      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setLabel('🛒 Ver Produto')
            .setStyle(ButtonStyle.Link)
            .setURL(url),
          new ButtonBuilder()
            .setLabel('📊 Histórico')
            .setStyle(ButtonStyle.Secondary)
            .setCustomId(`history_${product.id}`),
          new ButtonBuilder()
            .setLabel('⚙️ Configurar')
            .setStyle(ButtonStyle.Secondary)
            .setCustomId(`config_${product.id}`)
        );

      await interaction.editReply({ 
        embeds: [successEmbed], 
        components: [row] 
      });

      // Log de sucesso
      const duration = Date.now() - startTime;
      logger.info('Produto adicionado com sucesso', {
        productId: product.id,
        userId: interaction.user.id,
        guildId: interaction.guild.id,
        price: scrapedData.price,
        targetPrice,
        isOnTarget,
        duration
      });

      // Enviar notificação imediata se já estiver no preço alvo
      if (isOnTarget) {
        const notificationService = require('../../discord/bot').getNotificationService();
        await notificationService.sendTargetReachedNotification(
          { ...product, ...productData }, 
          scrapedData.price, 
          targetPrice
        );
      }

    } catch (error) {
      logger.error('Erro no comando addproduct:', error, {
        userId: interaction.user.id,
        guildId: interaction.guild.id,
        url: interaction.options.getString('url')
      });

      const errorEmbed = createErrorEmbed('❌ Erro Interno', 
        'Ocorreu um erro inesperado ao adicionar o produto. Tente novamente em alguns minutos.\n\n' +
        'Se o problema persistir, entre em contato com o administrador.'
      );

      await interaction.editReply({ embeds: [errorEmbed] }).catch(() => {
        // Se não conseguir editar, tentar responder
        interaction.reply({ embeds: [errorEmbed], ephemeral: true }).catch(() => {});
      });
    }
  }
};

/**
 * Valida se uma string é uma URL válida
 * @param {string} string - String para validar
 */
function isValidUrl(string) {
  try {
    const url = new URL(string);
    return ['http:', 'https:'].includes(url.protocol);
  } catch {
    return false;
  }
}

/**
 * Cria embed de erro padronizado
 * @param {string} title - Título do erro
 * @param {string} description - Descrição do erro
 */
function createErrorEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(0xFF0000)
    .setTitle(title)
    .setDescription(description)
    .setTimestamp()
    .setFooter({ text: 'Monitor de Preços' });
}

/**
 * Retorna texto de status baseado no preço
 * @param {number} currentPrice - Preço atual
 * @param {number} targetPrice - Preço alvo
 */
function getStatusText(currentPrice, targetPrice) {
  if (currentPrice <= targetPrice) {
    const discount = ((targetPrice - currentPrice) / targetPrice) * 100;
    return `🔥 **PROMOÇÃO ATIVA!** (-${discount.toFixed(1)}%)`;
  } else {
    const difference = ((currentPrice - targetPrice) / targetPrice) * 100;
    return `⏳ Aguardando (+${difference.toFixed(1)}% acima do alvo)`;
  }
}