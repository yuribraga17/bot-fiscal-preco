const winston = require('winston');
const path = require('path');
const fs = require('fs');
const config = require('../config/config');

/**
 * Sistema de logging profissional com Winston
 * Suporte para diferentes níveis de log e rotação de arquivos
 */

// Criar diretório de logs se não existir
const logDir = path.dirname(config.logging.file);
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// Formato personalizado para logs
const customFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss'
  }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ level, message, timestamp, stack, ...meta }) => {
    let log = `${timestamp} [${level.toUpperCase()}]: ${message}`;
    
    // Adicionar stack trace se existir
    if (stack) {
      log += `\n${stack}`;
    }
    
    // Adicionar metadados se existirem
    if (Object.keys(meta).length > 0) {
      log += `\n${JSON.stringify(meta, null, 2)}`;
    }
    
    return log;
  })
);

// Configuração dos transports
const transports = [
  // Log para arquivo
  new winston.transports.File({
    filename: config.logging.file,
    level: config.logging.level,
    maxsize: 20 * 1024 * 1024, // 20MB
    maxFiles: 5,
    format: customFormat
  }),

  // Log de erros separado
  new winston.transports.File({
    filename: path.join(logDir, 'error.log'),
    level: 'error',
    maxsize: 10 * 1024 * 1024, // 10MB
    maxFiles: 5,
    format: customFormat
  })
];

// Adicionar console transport em desenvolvimento
if (config.isDevelopment()) {
  transports.push(
    new winston.transports.Console({
      level: 'debug',
      format: winston.format.combine(
        winston.format.colorize({ all: true }),
        winston.format.timestamp({
          format: 'HH:mm:ss'
        }),
        winston.format.printf(({ level, message, timestamp }) => {
          return `${timestamp} ${level}: ${message}`;
        })
      )
    })
  );
}

// Criar logger principal
const logger = winston.createLogger({
  level: config.logging.level,
  format: customFormat,
  defaultMeta: { 
    service: 'price-monitor-bot',
    version: require('../package.json').version || '1.0.0'
  },
  transports,
  // Não sair em caso de erro
  exitOnError: false
});

/**
 * Função para logging estruturado
 */
logger.logStructured = (level, message, metadata = {}) => {
  logger.log(level, message, {
    timestamp: new Date().toISOString(),
    ...metadata
  });
};

/**
 * Função para logging de performance
 */
logger.perf = (operation, duration, metadata = {}) => {
  logger.info(`Performance: ${operation} completed in ${duration}ms`, {
    operation,
    duration,
    ...metadata
  });
};

/**
 * Função para logging de eventos do Discord
 */
logger.discord = (event, details = {}) => {
  logger.info(`Discord Event: ${event}`, {
    event,
    ...details
  });
};

/**
 * Função para logging de scraping
 */
logger.scraping = (url, status, price = null, error = null) => {
  const logData = { url, status };
  
  if (price !== null) logData.price = price;
  if (error) logData.error = error;

  if (status === 'success') {
    logger.info(`Scraping successful: ${url}`, logData);
  } else {
    logger.warn(`Scraping failed: ${url}`, logData);
  }
};

/**
 * Função para logging de notificações
 */
logger.notification = (type, productName, details = {}) => {
  logger.info(`Notification sent: ${type} for ${productName}`, {
    type,
    product: productName,
    ...details
  });
};

/**
 * Função para capturar erros não tratados
 */
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

/**
 * Middleware para Express logging
 */
logger.expressMiddleware = () => {
  return (req, res, next) => {
    const start = Date.now();
    
    res.on('finish', () => {
      const duration = Date.now() - start;
      const statusCode = res.statusCode;
      const method = req.method;
      const url = req.originalUrl;
      
      const logLevel = statusCode >= 400 ? 'warn' : 'info';
      
      logger.log(logLevel, `${method} ${url} ${statusCode} - ${duration}ms`, {
        method,
        url,
        statusCode,
        duration,
        userAgent: req.get('User-Agent'),
        ip: req.ip
      });
    });
    
    next();
  };
};

module.exports = logger;