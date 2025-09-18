// ===== ESTRUTURA DO PROJETO =====
/*
project/
├── .env
├── package.json
├── index.js
├── config/
│   └── config.js
├── database/
│   ├── database.js
│   └── models/
│       ├── Product.js
│       ├── PriceHistory.js
│       └── Notification.js
├── services/
│   ├── PriceScraper.js
│   ├── PriceMonitor.js
│   └── NotificationService.js
├── discord/
│   ├── bot.js
│   ├── commands/
│   │   ├── addProduct.js
│   │   ├── listProducts.js
│   │   └── removeProduct.js
│   └── events/
│       ├── ready.js
│       └── interactionCreate.js
├── web/
│   ├── server.js
│   ├── routes/
│   │   └── api.js
│   └── public/
│       └── index.html
└── utils/
    └── logger.js
*/

// ===== .env =====
/*
# Discord Configuration
DISCORD_TOKEN=seu_token_do_discord_aqui
CLIENT_ID=seu_client_id_aqui
ADMIN_USER_ID=seu_user_id_aqui

# Server Configuration
PORT=3000
NODE_ENV=development

# Database Configuration
DATABASE_PATH=./data/price_monitor.db

# Monitoring Configuration
CHECK_INTERVAL_MINUTES=60
PROMOTION_THRESHOLD=0.1
REQUEST_DELAY_MS=2000

# Scraping Configuration
USER_AGENT=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36
REQUEST_TIMEOUT_MS=10000

# Logging
LOG_LEVEL=info
LOG_FILE=./logs/bot.log
*/

// ===== package.json =====
/*
{
  "name": "discord-price-monitor",
  "version": "1.0.0",
  "description": "Bot Discord profissional para monitoramento de preços",
  "main": "index.js",
  "scripts": {
    "start": "node index.js",
    "dev": "nodemon index.js",
    "test": "jest",
    "lint": "eslint .",
    "setup": "node scripts/setup.js"
  },
  "dependencies": {
    "discord.js": "^14.14.1",
    "express": "^4.18.2",
    "sqlite3": "^5.1.6",
    "axios": "^1.6.2",
    "cheerio": "^1.0.0-rc.12",
    "node-cron": "^3.0.3",
    "dotenv": "^16.3.1",
    "winston": "^3.11.0",
    "helmet": "^7.1.0",
    "cors": "^2.8.5"
  },
  "devDependencies": {
    "nodemon": "^3.0.2",
    "jest": "^29.7.0",
    "eslint": "^8.57.0"
  },
  "keywords": ["discord", "bot", "price-monitor", "scraping"],
  "author": "Seu Nome",
  "license": "MIT"
}
*/