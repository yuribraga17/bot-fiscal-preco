require('dotenv').config();

/**
 * Configurações centralizadas do projeto
 * Todas as configurações são carregadas do arquivo .env
 */
const config = {
  // ===== CONFIGURAÇÕES DO DISCORD =====
  discord: {
    token: process.env.DISCORD_TOKEN,
    clientId: process.env.CLIENT_ID,
    adminUserId: process.env.ADMIN_USER_ID,
    intents: ['Guilds', 'GuildMessages', 'MessageContent']
  },

  // ===== CONFIGURAÇÕES DO SERVIDOR WEB =====
  server: {
    port: parseInt(process.env.PORT) || 3000,
    nodeEnv: process.env.NODE_ENV || 'development',
    secretKey: process.env.SECRET_KEY || 'default-secret-key-change-me'
  },

  // ===== CONFIGURAÇÕES DO BANCO DE DADOS =====
  database: {
    path: process.env.DATABASE_PATH || './data/price_monitor.db',
    backupPath: './backups/',
    maxConnections: 10
  },

  // ===== CONFIGURAÇÕES DE MONITORAMENTO =====
  monitoring: {
    checkIntervalMinutes: parseInt(process.env.CHECK_INTERVAL_MINUTES) || 60,
    promotionThreshold: parseFloat(process.env.PROMOTION_THRESHOLD) || 0.1,
    requestDelayMs: parseInt(process.env.REQUEST_DELAY_MS) || 2000,
    maxRetries: 3,
    retryDelay: 5000
  },

  // ===== CONFIGURAÇÕES DE SCRAPING =====
  scraping: {
    userAgent: process.env.USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    requestTimeoutMs: parseInt(process.env.REQUEST_TIMEOUT_MS) || 10000,
    maxConcurrentRequests: 5,
    respectRobotstxt: true
  },

  // ===== CONFIGURAÇÕES DE LOGGING =====
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    file: process.env.LOG_FILE || './logs/bot.log',
    maxFiles: '14d',
    maxSize: '20m'
  },

  // ===== CONFIGURAÇÕES DE NOTIFICAÇÕES =====
  notifications: {
    webhookUrl: process.env.WEBHOOK_URL,
    cooldownMinutes: 10,
    maxNotificationsPerHour: 50
  },

  // ===== CONFIGURAÇÕES DE TIMEZONE =====
  timezone: process.env.TZ || 'America/Sao_Paulo',

  // ===== CONFIGURAÇÕES DE RATE LIMITING =====
  rateLimit: {
    windowMs: 15 * 60 * 1000, // 15 minutos
    maxRequests: 100, // máximo de requests por janela de tempo
    message: 'Muitas requisições deste IP, tente novamente mais tarde.'
  }
};

/**
 * Validação de configurações obrigatórias
 */
const requiredConfigs = [
  'discord.token',
  'discord.clientId'
];

const missingConfigs = [];

for (const configPath of requiredConfigs) {
  const value = getNestedValue(config, configPath);
  if (!value) {
    missingConfigs.push(configPath);
  }
}

if (missingConfigs.length > 0) {
  console.error('❌ Configurações obrigatórias não encontradas:');
  missingConfigs.forEach(config => console.error(`   - ${config}`));
  console.error('Verifique seu arquivo .env');
  process.exit(1);
}

/**
 * Função auxiliar para acessar valores aninhados
 */
function getNestedValue(obj, path) {
  return path.split('.').reduce((current, key) => current?.[key], obj);
}

/**
 * Função para validar se está em ambiente de desenvolvimento
 */
config.isDevelopment = () => config.server.nodeEnv === 'development';

/**
 * Função para validar se está em ambiente de produção
 */
config.isProduction = () => config.server.nodeEnv === 'production';

/**
 * Função para obter configuração com fallback
 */
config.get = (path, defaultValue = null) => {
  return getNestedValue(config, path) || defaultValue;
};

// Exibir aviso se usando configurações padrão em produção
if (config.isProduction()) {
  if (config.server.secretKey === 'default-secret-key-change-me') {
    console.warn('⚠️  AVISO: Usando chave secreta padrão em produção!');
  }
}

module.exports = config;