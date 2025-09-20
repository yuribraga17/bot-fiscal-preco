const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const Product = require('../../database/models/Product');
const PriceHistory = require('../../database/models/PriceHistory');
const logger = require('../../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('listproducts')
    .setDescription('Lista produtos em monitoramento')
    .addStringOption(option =>
      option
        .setName('filter')
        .setDescription('Filtrar produtos por status')
        .setRequired(false)
        .addChoices(
          { name: '🔥 Apenas em promoção', value: 'promotion' },
          { name: '⏳ Aguardando preço alvo', value: 'waiting' },
          { name: '❌ Inativos', value: 'inactive' },
          { name: '📊 Todos', value: 'all' }
        ))
    .addStringOption(option =>
      option
        .setName('sort')
        .setDescription('Ordenar produtos por')
        .setRequired(false)
        .addChoices(
          { name: '📅 Mais recentes', value: 'newest' },
          { name: '📅 Mais antigos', value: 'oldest' },
          { name: '💰 Menor preço', value: 'price_low' },
          { name: '💰 Maior preço', value: 'price_high' },
          { name: '📊 Maior desconto', value: 'discount' }
        ))
    .addBooleanOption(option =>
      option
        .setName('detailed')
        .setDescription('Mostrar informações detalhadas')
        .setRequired(false))
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('Mostrar apenas produtos de um usuário específico')
        .setRequired(false)),

  async execute(interaction) {
    try {
      await interaction.deferReply();

      const filter = interaction.options.getString('filter') || 'all';
      const sort = interaction.options.getString('sort') || 'newest';
      const detailed = interaction.options.getBoolean('detailed') || false;
      const targetUser = interaction.options.getUser('user');

      logger.info('Comando listproducts executado', {
        userId: interaction.user.id,
        guildId: interaction.guild.id,
        filter,
        sort,
        detailed,
        targetUser: targetUser?.id
      });

      // Buscar produtos da guild
      let products = await Product.findByGuild(interaction.guild.id, 50, filter !== 'inactive');

      if (products.length === 0) {
        const embed = new EmbedBuilder()
          .setColor(0xFFFF00)
          .setTitle('📦 Nenhum produto encontrado')
          .setDescription('Use `/addproduct` para começar a monitorar produtos!')
          .setTimestamp()
          .setFooter({ text: 'Monitor de Preços' });

        return await interaction.editReply({ embeds: [embed] });
      }

      // Filtrar por usuário se especificado
      if (targetUser) {
        products = products.filter(p => p.user_id === targetUser.id);
        
        if (products.length === 0) {
          const embed = new EmbedBuilder()
            .setColor(0xFFFF00)
            .setTitle('📦 Nenhum produto encontrado')
            .setDescription(`${targetUser.tag} não possui produtos sendo monitorados.`)
            .setTimestamp()
            .setFooter({ text: 'Monitor de Preços' });

          return await interaction.editReply({ embeds: [embed] });
        }
      }

      // Aplicar filtros
      products = await applyFilters(products, filter);

      // Ordenar produtos
      products = sortProducts(products, sort);

      // Criar paginação
      const itemsPerPage = detailed ? 5 : 10;
      const totalPages = Math.ceil(products.length / itemsPerPage);
      let currentPage = 1;

      const generateEmbed = async (page) => {
        const start = (page - 1) * itemsPerPage;
        const end = start + itemsPerPage;
        const pageProducts = products.slice(start, end);

        const embed = new EmbedBuilder()
          .setColor(0x0099FF)
          .setTitle('📊 Produtos Monitorados')
          .setDescription(getFilterDescription(filter, targetUser))
          .setTimestamp()
          .setFooter({ 
            text: `Página ${page}/${totalPages} • ${products.length} produto(s) • Monitor de Preços`
          });

        // Estatísticas rápidas
        const stats = await calculateStats(products);
        embed.addFields({
          name: '📈 Resumo',
          value: `🔥 **${stats.onSale}** em promoção • ⏳ **${stats.waiting}** aguardando • 💰 Economia potencial: **R$ ${stats.totalSavings.toFixed(2)}**`,
          inline: false
        });

        // Adicionar produtos
        for (let i = 0; i < pageProducts.length; i++) {
          const product = pageProducts[i];
          const index = start + i + 1;
          
          if (detailed) {
            await addDetailedProductField(embed, product, index);
          } else {
            addSimpleProductField(embed, product, index);
          }
        }

        return embed;
      };

      const embed = await generateEmbed(currentPage);
      const components = [];

      // Botões de paginação se necessário
      if (totalPages > 1) {
        const paginationRow = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId('first_page')
              .setLabel('⏪')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(currentPage === 1),
            new ButtonBuilder()
              .setCustomId('prev_page')
              .setLabel('◀️')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(currentPage === 1),
            new ButtonBuilder()
              .setCustomId('next_page')
              .setLabel('▶️')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(currentPage === totalPages),
            new ButtonBuilder()
              .setCustomId('last_page')
              .setLabel('⏩')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(currentPage === totalPages)
          );
        
        components.push(paginationRow);
      }

      // Botões de ação
      const actionRow = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setLabel('🔄 Atualizar')
            .setStyle(ButtonStyle.Primary)
            .setCustomId('refresh_list'),
          new ButtonBuilder()
            .setLabel('📊 Estatísticas')
            .setStyle(ButtonStyle.Secondary)
            .setCustomId('show_stats')
        );

      if (products.length > 0) {
        actionRow.addComponents(
          new ButtonBuilder()
            .setLabel('🔍 Buscar')
            .setStyle(ButtonStyle.Secondary)
            .setCustomId('search_products')
        );
      }

      components.push(actionRow);

      const message = await interaction.editReply({ 
        embeds: [embed], 
        components 
      });

      // Coletor de interações para paginação
      const collector = message.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 300000 // 5 minutos
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
            case 'first_page':
              currentPage = 1;
              break;
            case 'prev_page':
              currentPage = Math.max(1, currentPage - 1);
              break;
            case 'next_page':
              currentPage = Math.min(totalPages, currentPage + 1);
              break;
            case 'last_page':
              currentPage = totalPages;
              break;
            case 'refresh_list':
              // Recarregar produtos
              products = await Product.findByGuild(interaction.guild.id, 50, filter !== 'inactive');
              products = await applyFilters(products, filter);
              products = sortProducts(products, sort);
              currentPage = 1;
              break;
            case 'show_stats':
              await showDetailedStats(buttonInteraction, products);
              return;
            case 'search_products':
              await showSearchModal(buttonInteraction);
              return;
          }

          const newEmbed = await generateEmbed(currentPage);
          const newComponents = [...components];

          // Atualizar botões de paginação
          if (totalPages > 1) {
            newComponents[0] = new ActionRowBuilder()
              .addComponents(
                new ButtonBuilder()
                  .setCustomId('first_page')
                  .setLabel('⏪')
                  .setStyle(ButtonStyle.Secondary)
                  .setDisabled(currentPage === 1),
                new ButtonBuilder()
                  .setCustomId('prev_page')
                  .setLabel('◀️')
                  .setStyle(ButtonStyle.Secondary)
                  .setDisabled(currentPage === 1),
                new ButtonBuilder()
                  .setCustomId('next_page')
                  .setLabel('▶️')
                  .setStyle(ButtonStyle.Secondary)
                  .setDisabled(currentPage === totalPages),
                new ButtonBuilder()
                  .setCustomId('last_page')
                  .setLabel('⏩')
                  .setStyle(ButtonStyle.Secondary)
                  .setDisabled(currentPage === totalPages)
              );
          }

          await buttonInteraction.editReply({
            embeds: [newEmbed],
            components: newComponents
          });

        } catch (error) {
          logger.error('Erro ao processar interação de listproducts:', error);
          await buttonInteraction.editReply({
            content: '❌ Erro ao processar ação. Tente novamente.',
            embeds: [],
            components: []
          });
        }
      });

      collector.on('end', async () => {
        try {
          // Desabilitar todos os botões
          const disabledComponents = components.map(row => {
            const newRow = new ActionRowBuilder();
            row.components.forEach(button => {
              newRow.addComponents(
                ButtonBuilder.from(button).setDisabled(true)
              );
            });
            return newRow;
          });

          await message.edit({ components: disabledComponents });
        } catch (error) {
          // Ignorar erro se mensagem foi deletada
        }
      });

    } catch (error) {
      logger.error('Erro no comando listproducts:', error, {
        userId: interaction.user.id,
        guildId: interaction.guild.id
      });

      const errorEmbed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('❌ Erro ao listar produtos')
        .setDescription('Ocorreu um erro inesperado. Tente novamente em alguns minutos.')
        .setTimestamp()
        .setFooter({ text: 'Monitor de Preços' });

      await interaction.editReply({ embeds: [errorEmbed] }).catch(() => {});
    }
  }
};

/**
 * Aplica filtros aos produtos
 */
async function applyFilters(products, filter) {
  switch (filter) {
    case 'promotion':
      return products.filter(p => p.current_price && p.target_price && p.current_price <= p.target_price);
    
    case 'waiting':
      return products.filter(p => !p.current_price || !p.target_price || p.current_price > p.target_price);
    
    case 'inactive':
      return products.filter(p => !p.is_active);
    
    default:
      return products.filter(p => p.is_active);
  }
}

/**
 * Ordena produtos conforme critério
 */
function sortProducts(products, sort) {
  switch (sort) {
    case 'oldest':
      return products.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    
    case 'price_low':
      return products.sort((a, b) => (a.current_price || 0) - (b.current_price || 0));
    
    case 'price_high':
      return products.sort((a, b) => (b.current_price || 0) - (a.current_price || 0));
    
    case 'discount':
      return products.sort((a, b) => {
        const discountA = getDiscountPercent(a);
        const discountB = getDiscountPercent(b);
        return discountB - discountA;
      });
    
    default: // newest
      return products.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }
}

/**
 * Adiciona campo de produto simples
 */
function addSimpleProductField(embed, product, index) {
  const status = getProductStatus(product);
  const price = product.current_price ? `R$ ${product.current_price.toFixed(2)}` : 'N/A';
  const target = product.target_price ? `R$ ${product.target_price.toFixed(2)}` : 'N/A';
  
  const name = product.name.length > 40 ? product.name.substring(0, 37) + '...' : product.name;
  
  embed.addFields({
    name: `${index}. ${name}`,
    value: `💰 ${price} | 🎯 ${target} | ${status.icon} ${status.text}`,
    inline: false
  });
}

/**
 * Adiciona campo de produto detalhado
 */
async function addDetailedProductField(embed, product, index) {
  const status = getProductStatus(product);
  const price = product.current_price ? `R$ ${product.current_price.toFixed(2)}` : 'N/A';
  const target = product.target_price ? `R$ ${product.target_price.toFixed(2)}` : 'N/A';
  
  let value = `💰 **Atual:** ${price} | 🎯 **Alvo:** ${target}\n`;
  value += `📊 **Status:** ${status.icon} ${status.text}\n`;
  
  // Informações adicionais
  if (product.last_checked) {
    const lastCheck = new Date(product.last_checked);
    const timeSince = getTimeSince(lastCheck);
    value += `⏰ **Última verificação:** ${timeSince}\n`;
  }
  
  if (product.check_count > 0) {
    value += `🔍 **Verificações:** ${product.check_count}`;
  }

  if (product.error_count > 0) {
    value += ` | ❌ **Erros:** ${product.error_count}`;
  }

  const name = product.name.length > 50 ? product.name.substring(0, 47) + '...' : product.name;
  
  embed.addFields({
    name: `${index}. ${name}`,
    value,
    inline: false
  });
}

/**
 * Obtém status do produto
 */
function getProductStatus(product) {
  if (!product.current_price || !product.target_price) {
    return { icon: '❓', text: 'Sem dados' };
  }
  
  if (!product.is_active) {
    return { icon: '❌', text: 'Inativo' };
  }
  
  if (product.current_price <= product.target_price) {
    const discount = getDiscountPercent(product);
    return { icon: '🔥', text: `PROMOÇÃO (-${discount.toFixed(1)}%)` };
  }
  
  const difference = ((product.current_price - product.target_price) / product.target_price) * 100;
  return { icon: '⏳', text: `Aguardando (+${difference.toFixed(1)}%)` };
}

/**
 * Calcula percentual de desconto
 */
function getDiscountPercent(product) {
  if (!product.current_price || !product.target_price || product.current_price > product.target_price) {
    return 0;
  }
  return ((product.target_price - product.current_price) / product.target_price) * 100;
}

/**
 * Calcula estatísticas dos produtos
 */
async function calculateStats(products) {
  const stats = {
    total: products.length,
    onSale: 0,
    waiting: 0,
    inactive: 0,
    totalSavings: 0,
    averagePrice: 0,
    averageTarget: 0
  };

  let totalPrice = 0;
  let totalTarget = 0;
  let priceCount = 0;

  products.forEach(product => {
    if (!product.is_active) {
      stats.inactive++;
      return;
    }

    if (product.current_price && product.target_price) {
      totalPrice += product.current_price;
      totalTarget += product.target_price;
      priceCount++;

      if (product.current_price <= product.target_price) {
        stats.onSale++;
        stats.totalSavings += (product.target_price - product.current_price);
      } else {
        stats.waiting++;
      }
    } else {
      stats.waiting++;
    }
  });

  if (priceCount > 0) {
    stats.averagePrice = totalPrice / priceCount;
    stats.averageTarget = totalTarget / priceCount;
  }

  return stats;
}

/**
 * Obtém descrição do filtro
 */
function getFilterDescription(filter, targetUser) {
  let desc = 'Lista de produtos em monitoramento';
  
  if (targetUser) {
    desc += ` de ${targetUser.tag}`;
  }
  
  switch (filter) {
    case 'promotion':
      desc += ' • Apenas em promoção 🔥';
      break;
    case 'waiting':
      desc += ' • Aguardando preço alvo ⏳';
      break;
    case 'inactive':
      desc += ' • Produtos inativos ❌';
      break;
  }
  
  return desc;
}

/**
 * Calcula tempo decorrido
 */
function getTimeSince(date) {
  const now = new Date();
  const diffInSeconds = Math.floor((now - date) / 1000);
  
  if (diffInSeconds < 60) return `${diffInSeconds}s atrás`;
  
  const diffInMinutes = Math.floor(diffInSeconds / 60);
  if (diffInMinutes < 60) return `${diffInMinutes}min atrás`;
  
  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) return `${diffInHours}h atrás`;
  
  const diffInDays = Math.floor(diffInHours / 24);
  return `${diffInDays}d atrás`;
}

/**
 * Mostra estatísticas detalhadas
 */
async function showDetailedStats(interaction, products) {
  const stats = await calculateStats(products);
  
  const embed = new EmbedBuilder()
    .setColor(0x00FF00)
    .setTitle('📊 Estatísticas Detalhadas')
    .addFields(
      { name: '📦 Total de Produtos', value: stats.total.toString(), inline: true },
      { name: '🔥 Em Promoção', value: stats.onSale.toString(), inline: true },
      { name: '⏳ Aguardando', value: stats.waiting.toString(), inline: true },
      { name: '💰 Preço Médio', value: `R$ ${stats.averagePrice.toFixed(2)}`, inline: true },
      { name: '🎯 Alvo Médio', value: `R$ ${stats.averageTarget.toFixed(2)}`, inline: true },
      { name: '💸 Economia Total', value: `R$ ${stats.totalSavings.toFixed(2)}`, inline: true }
    )
    .setTimestamp()
    .setFooter({ text: 'Monitor de Preços • Estatísticas' });

  await interaction.followUp({ embeds: [embed], ephemeral: true });
}

/**
 * Mostra modal de busca (placeholder)
 */
async function showSearchModal(interaction) {
  await interaction.followUp({
    content: '🔍 **Busca de produtos em desenvolvimento!**\n\nEm breve você poderá buscar produtos por nome, preço ou status.',
    ephemeral: true
  });
}