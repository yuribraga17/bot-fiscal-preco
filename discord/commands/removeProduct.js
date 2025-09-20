const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const Product = require('../../database/models/Product');
const logger = require('../../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('removeproduct')
    .setDescription('Remove um produto do monitoramento')
    .addIntegerOption(option =>
      option
        .setName('id')
        .setDescription('ID do produto para remover (veja com /listproducts)')
        .setRequired(true)
        .setMinValue(1))
    .addBooleanOption(option =>
      option
        .setName('confirm')
        .setDescription('Confirmar remoção sem perguntar novamente')
        .setRequired(false)),

  async execute(interaction) {
    try {
      await interaction.deferReply();

      const productId = interaction.options.getInteger('id');
      const skipConfirmation = interaction.options.getBoolean('confirm') || false;

      logger.info('Comando removeproduct executado', {
        userId: interaction.user.id,
        guildId: interaction.guild.id,
        productId,
        skipConfirmation
      });

      // Buscar produto
      const product = await Product.findById(productId);

      if (!product) {
        const embed = new EmbedBuilder()
          .setColor(0xFF0000)
          .setTitle('❌ Produto não encontrado')
          .setDescription(`Nenhum produto encontrado com ID **#${productId}**.\n\nUse \`/listproducts\` para ver os produtos disponíveis.`)
          .setTimestamp()
          .setFooter({ text: 'Monitor de Preços' });

        return await interaction.editReply({ embeds: [embed] });
      }

      // Verificar se é da mesma guild
      if (product.guild_id !== interaction.guild.id) {
        const embed = new EmbedBuilder()
          .setColor(0xFF0000)
          .setTitle('❌ Produto não encontrado')
          .setDescription('Este produto não pertence a este servidor.')
          .setTimestamp()
          .setFooter({ text: 'Monitor de Preços' });

        return await interaction.editReply({ embeds: [embed] });
      }

      // Verificar permissões
      const canRemove = await checkRemovePermissions(interaction, product);
      
      if (!canRemove.allowed) {
        const embed = new EmbedBuilder()
          .setColor(0xFF0000)
          .setTitle('❌ Sem permissão')
          .setDescription(canRemove.reason)
          .setTimestamp()
          .setFooter({ text: 'Monitor de Preços' });

        return await interaction.editReply({ embeds: [embed] });
      }

      // Se já está inativo, informar
      if (!product.is_active) {
        const embed = new EmbedBuilder()
          .setColor(0xFFFF00)
          .setTitle('⚠️ Produto já inativo')
          .setDescription(`**${product.name}** já está inativo.\n\nDeseja removê-lo permanentemente do banco de dados?`)
          .addFields(
            { name: '🆔 ID', value: `#${product.id}`, inline: true },
            { name: '📅 Desativado em', value: formatDate(product.updated_at), inline: true }
          )
          .setTimestamp()
          .setFooter({ text: 'Monitor de Preços' });

        if (!skipConfirmation) {
          return await showPermanentDeleteConfirmation(interaction, product, embed);
        }
      }

      // Mostrar informações do produto e confirmar
      const currentStatus = getProductStatus(product);
      
      const confirmEmbed = new EmbedBuilder()
        .setColor(0xFFFF00)
        .setTitle('⚠️ Confirmar remoção')
        .setDescription(`**${product.name}**`)
        .addFields(
          { name: '🆔 ID', value: `#${product.id}`, inline: true },
          { name: '💰 Preço Atual', value: product.current_price ? `R$ ${product.current_price.toFixed(2)}` : 'N/A', inline: true },
          { name: '🎯 Preço Alvo', value: product.target_price ? `R$ ${product.target_price.toFixed(2)}` : 'N/A', inline: true },
          { name: '📊 Status', value: `${currentStatus.icon} ${currentStatus.text}`, inline: true },
          { name: '👤 Adicionado por', value: `<@${product.user_id}>`, inline: true },
          { name: '📅 Criado em', value: formatDate(product.created_at), inline: true }
        )
        .setURL(product.url)
        .setTimestamp()
        .setFooter({ text: 'Esta ação não pode ser desfeita • Monitor de Preços' });

      if (currentStatus.isPromotion) {
        confirmEmbed.addFields({
          name: '🔥 Atenção',
          value: 'Este produto está em promoção! Tem certeza que deseja removê-lo?',
          inline: false
        });
      }

      if (skipConfirmation) {
        return await executeRemoval(interaction, product, 'deactivate');
      }

      // Mostrar botões de confirmação
      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('remove_deactivate')
            .setLabel('🗑️ Desativar')
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId('remove_delete')
            .setLabel('🚫 Excluir Permanentemente')
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId('remove_cancel')
            .setLabel('❌ Cancelar')
            .setStyle(ButtonStyle.Primary)
        );

      const message = await interaction.editReply({ 
        embeds: [confirmEmbed], 
        components: [row] 
      });

      // Coletor de interações
      const collector = message.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 60000 // 1 minuto
      });

      collector.on('collect', async (buttonInteraction) => {
        if (buttonInteraction.user.id !== interaction.user.id) {
          return await buttonInteraction.reply({
            content: '❌ Apenas quem executou o comando pode usar estes botões.',
            ephemeral: true
          });
        }

        await buttonInteraction.deferUpdate();

        try {
          switch (buttonInteraction.customId) {
            case 'remove_deactivate':
              await executeRemoval(buttonInteraction, product, 'deactivate');
              break;
              
            case 'remove_delete':
              await executeRemoval(buttonInteraction, product, 'delete');
              break;
              
            case 'remove_cancel':
              const cancelEmbed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle('✅ Remoção cancelada')
                .setDescription(`**${product.name}** continuará sendo monitorado.`)
                .setTimestamp()
                .setFooter({ text: 'Monitor de Preços' });

              await buttonInteraction.editReply({ 
                embeds: [cancelEmbed], 
                components: [] 
              });
              break;
          }
        } catch (error) {
          logger.error('Erro ao processar remoção:', error);
          
          const errorEmbed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('❌ Erro na remoção')
            .setDescription('Ocorreu um erro inesperado. Tente novamente.')
            .setTimestamp()
            .setFooter({ text: 'Monitor de Preços' });

          await buttonInteraction.editReply({ 
            embeds: [errorEmbed], 
            components: [] 
          });
        }

        collector.stop();
      });

      collector.on('end', async (collected) => {
        if (collected.size === 0) {
          try {
            const timeoutEmbed = new EmbedBuilder()
              .setColor(0xFFFF00)
              .setTitle('⏰ Tempo esgotado')
              .setDescription('Remoção cancelada por inatividade.')
              .setTimestamp()
              .setFooter({ text: 'Monitor de Preços' });

            await message.edit({ 
              embeds: [timeoutEmbed], 
              components: [] 
            });
          } catch (error) {
            // Ignorar erro se mensagem foi deletada
          }
        }
      });

    } catch (error) {
      logger.error('Erro no comando removeproduct:', error, {
        userId: interaction.user.id,
        guildId: interaction.guild.id,
        productId: interaction.options.getInteger('id')
      });

      const errorEmbed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('❌ Erro interno')
        .setDescription('Ocorreu um erro inesperado. Tente novamente em alguns minutos.')
        .setTimestamp()
        .setFooter({ text: 'Monitor de Preços' });

      await interaction.editReply({ embeds: [errorEmbed] }).catch(() => {});
    }
  }
};

/**
 * Verifica permissões para remover produto
 */
async function checkRemovePermissions(interaction, product) {
  // Proprietário do produto pode sempre remover
  if (product.user_id === interaction.user.id) {
    return { allowed: true };
  }

  // Verificar se é admin do servidor
  const member = await interaction.guild.members.fetch(interaction.user.id);
  
  if (member.permissions.has('Administrator') || member.permissions.has('ManageGuild')) {
    return { allowed: true };
  }

  // Verificar se é admin global (configurado no .env)
  const config = require('../../config/config');
  if (interaction.user.id === config.discord.adminUserId) {
    return { allowed: true };
  }

  return { 
    allowed: false, 
    reason: 'Você só pode remover produtos que você mesmo adicionou, ou precisa ter permissões de administrador.' 
  };
}

/**
 * Executa a remoção do produto
 */
async function executeRemoval(interaction, product, type) {
  try {
    let result;
    let successMessage;
    let embedColor;

    if (type === 'delete') {
      result = await Product.delete(product.id, product.guild_id);
      successMessage = 'removido permanentemente';
      embedColor = 0xFF0000;
    } else {
      result = await Product.deactivate(product.id, product.guild_id);
      successMessage = 'desativado';
      embedColor = 0xFFFF00;
    }

    if (result.changes === 0) {
      throw new Error('Nenhuma alteração foi feita');
    }

    const successEmbed = new EmbedBuilder()
      .setColor(embedColor)
      .setTitle(`✅ Produto ${successMessage}`)
      .setDescription(`**${product.name}** foi ${successMessage} com sucesso.`)
      .addFields(
        { name: '🆔 ID', value: `#${product.id}`, inline: true },
        { name: '👤 Removido por', value: `${interaction.user.tag}`, inline: true },
        { name: '📅 Data', value: formatDate(new Date()), inline: true }
      )
      .setTimestamp()
      .setFooter({ text: 'Monitor de Preços' });

    if (type === 'deactivate') {
      successEmbed.addFields({
        name: 'ℹ️ Informação',
        value: 'O produto foi desativado mas seus dados históricos foram preservados.',
        inline: false
      });
    } else {
      successEmbed.addFields({
        name: '⚠️ Atenção',
        value: 'O produto e todo seu histórico foram removidos permanentemente.',
        inline: false
      });
    }

    await interaction.editReply({ 
      embeds: [successEmbed], 
      components: [] 
    });

    // Log da remoção
    logger.info(`Produto ${successMessage}`, {
      productId: product.id,
      productName: product.name,
      removedBy: interaction.user.id,
      guildId: interaction.guild.id,
      type
    });

  } catch (error) {
    logger.error(`Erro ao ${type === 'delete' ? 'excluir' : 'desativar'} produto:`, error);
    throw error;
  }
}

/**
 * Mostra confirmação para exclusão permanente
 */
async function showPermanentDeleteConfirmation(interaction, product, embed) {
  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('permanent_delete')
        .setLabel('🚫 Excluir Permanentemente')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('cancel_delete')
        .setLabel('❌ Cancelar')
        .setStyle(ButtonStyle.Secondary)
    );

  const message = await interaction.editReply({ 
    embeds: [embed], 
    components: [row] 
  });

  const collector = message.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 30000 // 30 segundos
  });

  collector.on('collect', async (buttonInteraction) => {
    if (buttonInteraction.user.id !== interaction.user.id) {
      return await buttonInteraction.reply({
        content: '❌ Apenas quem executou o comando pode usar estes botões.',
        ephemeral: true
      });
    }

    await buttonInteraction.deferUpdate();

    if (buttonInteraction.customId === 'permanent_delete') {
      await executeRemoval(buttonInteraction, product, 'delete');
    } else {
      const cancelEmbed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle('✅ Exclusão cancelada')
        .setDescription('O produto inativo foi mantido no banco de dados.')
        .setTimestamp()
        .setFooter({ text: 'Monitor de Preços' });

      await buttonInteraction.editReply({ 
        embeds: [cancelEmbed], 
        components: [] 
      });
    }

    collector.stop();
  });

  collector.on('end', async (collected) => {
    if (collected.size === 0) {
      try {
        const timeoutEmbed = new EmbedBuilder()
          .setColor(0xFFFF00)
          .setTitle('⏰ Tempo esgotado')
          .setDescription('Exclusão cancelada por inatividade.')
          .setTimestamp()
          .setFooter({ text: 'Monitor de Preços' });

        await message.edit({ 
          embeds: [timeoutEmbed], 
          components: [] 
        });
      } catch (error) {
        // Ignorar erro se mensagem foi deletada
      }
    }
  });
}

/**
 * Obtém status do produto
 */
function getProductStatus(product) {
  if (!product.is_active) {
    return { 
      icon: '❌', 
      text: 'Inativo',
      isPromotion: false
    };
  }

  if (!product.current_price || !product.target_price) {
    return { 
      icon: '❓', 
      text: 'Sem dados',
      isPromotion: false
    };
  }

  if (product.current_price <= product.target_price) {
    const discount = ((product.target_price - product.current_price) / product.target_price) * 100;
    return { 
      icon: '🔥', 
      text: `PROMOÇÃO (-${discount.toFixed(1)}%)`,
      isPromotion: true
    };
  }

  const difference = ((product.current_price - product.target_price) / product.target_price) * 100;
  return { 
    icon: '⏳', 
    text: `Aguardando (+${difference.toFixed(1)}%)`,
    isPromotion: false
  };
}

/**
 * Formata data para exibição
 */
function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}