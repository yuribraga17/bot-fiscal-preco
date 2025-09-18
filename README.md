<h1 align="center">🤖💰 Discord Price Monitor Bot</h1>
<p align="center">Um bot profissional para Discord feito em <strong>JavaScript</strong> para monitoramento de preços com painel web e notificações inteligentes.</p>

<p align="center">
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E=18.0.0-green" alt="Node.js"></a>
  <a href="#"><img src="https://img.shields.io/badge/status-em%20desenvolvimento-yellow" alt="Status"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="License"></a>
</p>


## ✨ Funcionalidades

- 🛍️ **Monitoramento de Preços**: Rastreia e compara preços de produtos automaticamente.
- ⏰ **Notificações Inteligentes**: Alerta a cada 1 hora quando o produto entra em promoção.
- 🖥️ **Painel Web Responsivo**: Interface amigável para adicionar e visualizar produtos.
- 📉 **Histórico de Preços**: Armazena os dados de preços ao longo do tempo.
- 🔎 **Scraper Customizado**: Faz scraping com delay e user-agent personalizado.
- 💬 **Administração via Discord**: Gerencie tudo com comandos rápidos no servidor.


--- 

## 📁 Estrutura do Projeto

```bash
project/
├── .env
├── package.json
├── index.js
├── config/
├── database/
├── services/
├── discord/
├── web/
└── utils/
````

> Estrutura modular para código limpo, testável e fácil de manter.

--- 

## ⚙️ Instalação

```bash
git clone https://github.com/yuribraga17/bot-fiscal-preco.git
cd bot-fiscal-preco
npm install
```

--- 

## ▶️ Uso

### Desenvolvimento

```bash
npm run dev
```

### Produção

```bash
npm start
```

--- 
## 📌 Configuração (.env)

Crie um arquivo `.env` com base no exemplo abaixo:

```env
# Discord Bot
DISCORD_TOKEN=seu_token
CLIENT_ID=seu_client_id
ADMIN_USER_ID=seu_user_id

# Web Server
PORT=3000

# Database
DATABASE_PATH=./data/price_monitor.db

# Monitoramento
CHECK_INTERVAL_MINUTES=60
PROMOTION_THRESHOLD=0.1

# Scraper
USER_AGENT=Mozilla/5.0 (...)
REQUEST_DELAY_MS=2000
REQUEST_TIMEOUT_MS=10000

# Logs
LOG_LEVEL=info
LOG_FILE=./logs/bot.log
```

--- 
## 📡 Comandos no Discord

| Comando   | Descrição                                   |
| --------- | ------------------------------------------- |
| `/add`    | Adiciona um produto para monitoramento      |
| `/list`   | Lista todos os produtos monitorados         |
| `/remove` | Remove um produto da lista de monitoramento |

--- 
## 🧪 Tecnologias Utilizadas

* **Node.js**
* **Discord.js**
* **Express**
* **SQLite**
* **Axios + Cheerio**
* **Winston**
* **Dotenv**
* **ESLint / Jest / Nodemon**

## 🖥️ Preview do Painel (em breve)

<!-- Serrá adicionado o preview -->

<!-- ![Painel Preview](./web/public/preview.png) -->

--- 

## 👤 Autor

Desenvolvido por **Yuri Braga**

🔗 [github.com/yuribraga17](https://github.com/yuribraga17)

---

## 📝 Licença

Distribuído sob a licença **MIT**. Veja o arquivo [`LICENSE`](./LICENSE) para mais informações.

--- 

## 🚧 Futuras Melhorias

* 🔒 Autenticação no painel
* 📦 Exportar histórico de preços (CSV)
* 📱 Notificações por Telegram ou Email
* 🖼️ Painel com UI em React ou Vue