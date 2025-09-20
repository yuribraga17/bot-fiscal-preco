const { Events, EmbedBuilder } = require('discord.js');
const logger = require('../../utils/logger');

module.exports = {
  name: Events.InteractionCreate,
  
  async execute(interaction) {
    try {
      if (interaction.isChatInputCommand()) {
        await handleSlashCommand(interaction);
      } else if (interaction.isButton()) {
        await handleButtonInteraction(interaction);
      } else if (interaction.isStringSelectMenu()) {
        await handleSelectMenu(interaction);
      } else if (interaction.isModalSubmit()) {
        await handleModalSubmit(interaction);
      }
    } catch (error) {
      logger.error('Erro no evento interactionCreate:', error, {
        userId: interaction.user?.id,
        guildId: interaction.guild?.id,
        type: interaction.type,
        customId: interaction.customId
      });

      await handleInteractionError(interaction, error);
    }
  }
};

/**
 * Processa comandos slash
 */
async function handleSlashCommand(interaction) {
  const command = interaction.client.commands?.get(interaction.commandName);

  if (!command) {
    logger.warn(`Comando não encontrado: ${interaction.commandName}`);
    return await interaction.reply({
      content: '❌ Este comando não foi encontrado.',
      ephemeral: true
    });
  }

  const startTime = Date.now();

  try {
    // Log da execução do comando
    logger.info('Comando executado', {
      command: interaction.commandName,
      userId: interaction.user.id,
      userTag: interaction.user.tag,
      guildId: interaction.guild?.id,
      guildName: interaction.guild?.name,
      channelId: interaction.channel?.id,
      options: interaction.options.data.map(opt => ({
        name: opt.name,
        value: opt.value,
        type: opt.type
      }))
    });

    // Verificar cooldown se aplicável
    const cooldownKey = `${interaction.commandName}_${interaction.user.id}`;
    if (await isOnCooldown(cooldownKey)) {
      return await interaction.reply({
        content: '⏰ Você precisa aguardar antes de usar este comando novamente.',
        ephemeral: true
      });
    }

    // Executar comando
    await command.execute(interaction);

    // Aplicar cooldown se aplicável
    await applyCooldown(cooldownKey, interaction.commandName);

    const duration = Date.now() - startTime;
    logger.perf('comando', duration, {
      command: interaction.commandName,
      userId: interaction.user.id,
      success: true
    });

  } catch (error) {
    const duration = Date.now() - startTime;
    
    logger.error(`Erro no comando ${interaction.commandName}:`, error, {
      userId: interaction.user.id,
      guildId: interaction.guild?.id,
      duration
    });

    // Tentar responder com erro
    const errorEmbed = new EmbedBuilder()
      .setColor(0xFF0000)
      .setTitle('❌ Erro no Comando')
      .setDescription('Ocorreu um erro inesperado ao executar este comando.')
      .addFields(
        { name: 'Comando', value: interaction.commandName, inline: true },
        { name: 'Erro', value: error.message.substring(0, 1000), inline: false }
      )
      .setTimestamp()
      .setFooter({ text: 'Se o problema persistir, contate um administrador' });

    if (interaction.replied || interaction.deferred) {
      await interaction.editReply({ embeds: [errorEmbed] });
    } else {
      await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
    }
  }
}

/**
 * Processa interações de botões
 */
async function handleButtonInteraction(interaction) {
  const customId = interaction.customId;
  
  logger.debug('Interação de botão', {
    customId,
    userId: interaction.user.id,
    guildId: interaction.guild?.id
  });

  try {
    // Botões de histórico de preços
    if (customId.startsWith('history_')) {
      const productId = parseInt(customId.split('_')[1]);
      await handlePriceHistoryButton(interaction, productId);
    }
    
    // Botões de configuração de produto
    else if (customId.startsWith('config_')) {
      const productId = parseInt(customId.split('_')[1]);
      await handleProductConfigButton(interaction, productId);
    }
    
    // Botões de tendência
    else if (customId.startsWith('trend_')) {
      const productId = parseInt(customId.split('_')[1]);
      await handleTrendButton(interaction, productId);
    }
    
    // Botões de ajuste de preço alvo
    else if (customId.startsWith('adjust_')) {
      const productId = parseInt(customId.split('_')[1]);
      await handleAdjustTargetButton(interaction, productId);
    }
    
    // Outros botões são tratados pelos respectivos comandos
    else {
      logger.debug(`Botão não tratado centralmente: ${customId}`);
    }

  } catch (error) {
    logger.error('Erro ao processar interação de botão:', error);
    
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '❌ Erro ao processar ação. Tente novamente.',
        ephemeral: true
      });
    }
  }
}

/**
 * Processa menus de seleção
 */
async function handleSelectMenu(interaction) {
  const customId = interaction.customId;
  
  logger.debug('Interação de select menu', {
    customId,
    values: interaction.values,
    userId: interaction.user.id
  });

  // Implementar handlers de select menu conforme necessário
  await interaction.reply({
    content: '🚧 Funcionalidade em desenvolvimento!',
    ephemeral: true
  });
}

/**
 * Processa envios de modal
 */
async function handleModalSubmit(interaction) {
  const customId = interaction.customId;
  
  logger.debug('Modal submit', {
    customId,
    userId: interaction.user.id
  });

  // Implementar handlers de modal conforme necessário
  await interaction.reply({
    content: '🚧 Funcionalidade em desenvolvimento!',
    ephemeral: true
  });
}

/**
 * Trata botão de histórico de preços
 */
async function handlePriceHistoryButton(interaction, productId) {
  await interaction.deferReply({ ephemeral: true });

  const Product = require('../../database/models/Product');
  const PriceHistory = require('../../database/models/PriceHistory');

  const product = await Product.findById(productId);
  
  if (!product) {
    return await interaction.editReply({
      content: '❌ Produto não encontrado.'
    });
  }

  const history = await PriceHistory.getByProduct(productId, 10, 30);
  const stats = await PriceHistory.getStatistics(productId, 30);

  const embed = new EmbedBuilder()
    .setColor(0x0099FF)
    .setTitle(`📊 Histórico de Preços`)
    .setDescription(`**${product.name}**`)
    .addFields(
      { name: '📈 Estatísticas (30 dias)', value: 
        `**Min:** R$ ${stats.minPrice.toFixed(2)}\n` +
        `**Max:** R$ ${stats.maxPrice.toFixed(2)}\n` +
        `**Média:** R$ ${stats.avgPrice.toFixed(2)}`, 
        inline: true 
      },
      { name: '📊 Variações', value: 
        `**Maior alta:** +${stats.maxIncrease.toFixed(1)}%\n` +
        `**Maior queda:** ${stats.maxDecrease.toFixed(1)}%\n` +
        `**Registros:** ${stats.totalRecords}`, 
        inline: true 
      }
    )
    .setURL(product.url)
    .setTimestamp()
    .setFooter({ text: 'Monitor de Preços • Últimas 10 verificações' });

  if (history.length > 0) {
    const historyText = history
      .slice(0, 5)
      .map(h => {
        const date = new Date(h.checked_at).toLocaleString('pt-BR', {
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit'
        });
        const change = h.price_change_percent ? 
          ` (${h.price_change_percent > 0 ? '+' : ''}${h.price_change_percent.toFixed(1)}%)` : '';
        return `• **${date}:** R$ ${h.price.toFixed(2)}${change}`;
      })
      .join('\n');

    embed.addFields({
      name: '📋 Histórico Recente',
      value: historyText,
      inline: false
    });
  }

  await interaction.editReply({ embeds: [embed] });
}

/**
 * Trata botão de configuração de produto
 */
async function handleProductConfigButton(interaction, productId) {
  await interaction.reply({
    content: '⚙️ **Configurações de Produto**\n\n' +
             '🚧 Esta funcionalidade está em desenvolvimento!\n\n' +
             '**Em breve você poderá:**\n' +
             '• Alterar preço alvo\n' +
             '• Ajustar threshold de promoção\n' +
             '• Configurar notificações\n' +
             '• Pausar/retomar monitoramento',
    ephemeral: true
  });
}

/**
 * Trata botão de tendência
 */
async function handleTrendButton(interaction, productId) {
  await interaction.deferReply({ ephemeral: true });

  const PriceHistory = require('../../database/models/PriceHistory');
  const Product = require('../../database/models/Product');

  const product = await Product.findById(productId);
  
  if (!product) {
    return await interaction.editReply({
      content: '❌ Produto não encontrado.'
    });
  }

  const trend = await PriceHistory.getTrend(productId, 7);

  let trendIcon = '📊';
  let trendText = 'Estável';
  let trendColor = 0x0099FF;

  if (trend.trend === 'rising') {
    trendIcon = '📈';
    trendText = 'Em alta';
    trendColor = 0xFF4444;
  } else if (trend.trend === 'falling') {
    trendIcon = '📉';
    trendText = 'Em queda';
    trendColor = 0x00FF00;
  }

  const embed = new EmbedBuilder()
    .setColor(trendColor)
    .setTitle(`${trendIcon} Análise de Tendência`)
    .setDescription(`**${product.name}**`)
    .addFields(
      { name: '📊 Tendência (7 dias)', value: trendText, inline: true },
      { name: '📈 Confiabilidade', value: `${(trend.correlation * 100).toFixed(1)}%`, inline: true },
      { name: '📊 Pontos de Dados', value: trend.dataPoints.toString(), inline: true }
    )
    .setTimestamp()
    .setFooter({ text: 'Monitor de Preços • Análise de Tendência' });

  if (trend.dataPoints >= 2) {
    embed.addFields(
      { 
        name: '💰 Variação do Período', 
        value: `${trend.priceChange > 0 ? '+' : ''}${trend.priceChange.toFixed(1)}%`,
        inline: true 
      },
      { 
        name: '🎯 Primeiro → Último', 
        value: `R$ ${trend.firstPrice.toFixed(2)} → R$ ${trend.lastPrice.toFixed(2)}`,
        inline: false 
      }
    );
  }

  await interaction.editReply({ embeds: [embed] });
}

/**
 * Trata botão de ajuste de preço alvo
 */
async function handleAdjustTargetButton(interaction, productId) {
  await interaction.reply({
    content: '🎯 **Ajustar Preço Alvo**\n\n' +
             '🚧 Esta funcionalidade está em desenvolvimento!\n\n' +
             'Em breve você poderá ajustar o preço alvo diretamente pelo Discord.',
    ephemeral: true
  });
}

/**
 * Verifica se usuário está em cooldown
 */
async function isOnCooldown(cooldownKey) {
  // Implementar sistema de cooldown se necessário
  // Por enquanto, retorna false (sem cooldown)
  return false;
}

/**
 * Aplica cooldown ao usuário
 */
async function applyCooldown(cooldownKey, commandName) {
  // Implementar sistema de cooldown se necessário
  // Comandos que precisam de cooldown podem ser configurados aqui
}

/**
 * Trata erros de interação
 */
async function handleInteractionError(interaction, error) {
  const errorId = `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  logger.error('Erro em interação:', error, {
    errorId,
    userId: interaction.user?.id,
    guildId: interaction.guild?.id,
    type: interaction.type
  });

  const errorMessage = {
    content: `❌ **Erro Interno** (ID: \`${errorId}\`)\n\n` +
             'Ocorreu um erro inesperado. Se o problema persistir, ' +
             'contate um administrador e forneça o ID do erro.',
    ephemeral: true
  };

  try {
    if (interaction.replied || interaction.deferred) {
      await interaction.editReply(errorMessage);
    } else {
      await interaction.reply(errorMessage);
    }
  } catch (replyError) {
    logger.error('Erro ao responder erro de interação:', replyError);
  }
}