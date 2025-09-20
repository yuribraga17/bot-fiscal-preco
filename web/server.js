const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const config = require('../config/config');
const logger = require('../utils/logger');
const Product = require('../database/models/Product');
const PriceHistory = require('../database/models/PriceHistory');
const database = require('../database/database');

/**
 * Servidor web para painel administrativo
 * Interface web para gerenciar produtos e visualizar estatísticas
 */
class WebServer {
  
  constructor() {
    this.app = express();
    this.server = null;
    this.isRunning = false;
  }

  /**
   * Inicializa o servidor web
   */
  async initialize() {
    try {
      logger.info('Inicializando servidor web...');

      // Configurar middlewares de segurança
      this.setupSecurity();
      
      // Configurar middlewares básicos
      this.setupMiddlewares();
      
      // Configurar rotas
      this.setupRoutes();
      
      // Configurar tratamento de erros
      this.setupErrorHandling();

      logger.info('Servidor web configurado');
      return true;

    } catch (error) {
      logger.error('Erro ao inicializar servidor web:', error);
      throw error;
    }
  }

  /**
   * Configura middlewares de segurança
   */
  setupSecurity() {
    // Helmet para headers de segurança
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "https:"],
          fontSrc: ["'self'", "https://cdnjs.cloudflare.com"]
        }
      }
    }));

    // CORS configurado
    this.app.use(cors({
      origin: config.isDevelopment() ? true : false, // Em prod, configurar domínios específicos
      credentials: true
    }));

    // Rate limiting básico
    const rateLimit = require('express-rate-limit');
    this.app.use('/api/', rateLimit({
      windowMs: config.rateLimit.windowMs,
      max: config.rateLimit.maxRequests,
      message: { error: config.rateLimit.message }
    }));
  }

  /**
   * Configura middlewares básicos
   */
  setupMiddlewares() {
    // Body parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Logging de requests
    this.app.use(logger.expressMiddleware());

    // Servir arquivos estáticos
    const publicPath = path.join(__dirname, 'public');
    if (fs.existsSync(publicPath)) {
      this.app.use(express.static(publicPath));
    }

    // Middleware de autenticação simples (para desenvolvimento)
    if (config.server.secretKey && config.server.secretKey !== 'default-secret-key-change-me') {
      this.app.use('/api/', this.authMiddleware.bind(this));
    }
  }

  /**
   * Configura todas as rotas
   */
  setupRoutes() {
    // Rota principal - painel administrativo
    this.app.get('/', this.renderDashboard.bind(this));

    // API Routes
    this.setupApiRoutes();

    // Rota de health check
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        version: require('../package.json').version
      });
    });

    // Rota 404
    this.app.use((req, res) => {
      res.status(404).json({
        error: 'Endpoint não encontrado',
        path: req.path,
        method: req.method
      });
    });
  }

  /**
   * Configura rotas da API
   */
  setupApiRoutes() {
    const apiRouter = express.Router();

    // Estatísticas gerais
    apiRouter.get('/stats', async (req, res) => {
      try {
        const [productStats, dbStats] = await Promise.all([
          Product.getStats(),
          database.getStats()
        ]);

        res.json({
          ...productStats,
          database: dbStats,
          server: {
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            timestamp: new Date().toISOString()
          }
        });
      } catch (error) {
        logger.error('Erro ao obter estatísticas:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
      }
    });

    // Listar produtos
    apiRouter.get('/products', async (req, res) => {
      try {
        const { 
          guild_id, 
          limit = 50, 
          offset = 0, 
          active_only = 'true',
          sort = 'created_at',
          order = 'desc' 
        } = req.query;

        let products = await Product.findByGuild(
          guild_id, 
          parseInt(limit), 
          active_only === 'true'
        );

        // Aplicar ordenação
        products = this.sortProducts(products, sort, order);

        // Aplicar paginação manual se necessário
        const start = parseInt(offset);
        const end = start + parseInt(limit);
        const paginatedProducts = products.slice(start, end);

        res.json({
          products: paginatedProducts,
          total: products.length,
          limit: parseInt(limit),
          offset: parseInt(offset)
        });

      } catch (error) {
        logger.error('Erro ao listar produtos:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
      }
    });

    // Detalhes de um produto
    apiRouter.get('/products/:id', async (req, res) => {
      try {
        const productId = parseInt(req.params.id);
        const product = await Product.findById(productId);

        if (!product) {
          return res.status(404).json({ error: 'Produto não encontrado' });
        }

        // Buscar dados adicionais
        const [history, stats] = await Promise.all([
          PriceHistory.getByProduct(productId, 20, 30),
          PriceHistory.getStatistics(productId, 30)
        ]);

        res.json({
          product,
          history,
          statistics: stats
        });

      } catch (error) {
        logger.error('Erro ao obter produto:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
      }
    });

    // Atualizar produto
    apiRouter.put('/products/:id', async (req, res) => {
      try {
        const productId = parseInt(req.params.id);
        const updates = req.body;

        // Validar campos permitidos
        const allowedFields = ['name', 'target_price', 'promotion_threshold', 'is_active'];
        const filteredUpdates = {};
        
        for (const field of allowedFields) {
          if (field in updates) {
            filteredUpdates[field] = updates[field];
          }
        }

        if (Object.keys(filteredUpdates).length === 0) {
          return res.status(400).json({ error: 'Nenhum campo válido para atualização' });
        }

        const result = await Product.update(productId, filteredUpdates);

        if (result.changes === 0) {
          return res.status(404).json({ error: 'Produto não encontrado' });
        }

        logger.info('Produto atualizado via API', { productId, updates: filteredUpdates });
        res.json({ success: true, changes: result.changes });

      } catch (error) {
        logger.error('Erro ao atualizar produto:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
      }
    });

    // Remover produto
    apiRouter.delete('/products/:id', async (req, res) => {
      try {
        const productId = parseInt(req.params.id);
        const { permanent = false } = req.query;

        let result;
        if (permanent === 'true') {
          result = await Product.delete(productId);
        } else {
          result = await Product.deactivate(productId);
        }

        if (result.changes === 0) {
          return res.status(404).json({ error: 'Produto não encontrado' });
        }

        logger.info(`Produto ${permanent === 'true' ? 'removido' : 'desativado'} via API`, { productId });
        res.json({ success: true, changes: result.changes });

      } catch (error) {
        logger.error('Erro ao remover produto:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
      }
    });

    // Histórico de preços
    apiRouter.get('/products/:id/history', async (req, res) => {
      try {
        const productId = parseInt(req.params.id);
        const { limit = 50, days = 30, format = 'json' } = req.query;

        const history = await PriceHistory.getByProduct(
          productId, 
          parseInt(limit), 
          parseInt(days)
        );

        if (format === 'csv') {
          const csvData = await PriceHistory.export(productId, parseInt(days), 'csv');
          res.setHeader('Content-Type', 'text/csv');
          res.setHeader('Content-Disposition', `attachment; filename="product_${productId}_history.csv"`);
          return res.send(csvData);
        }

        res.json(history);

      } catch (error) {
        logger.error('Erro ao obter histórico:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
      }
    });

    // Análise de tendência
    apiRouter.get('/products/:id/trend', async (req, res) => {
      try {
        const productId = parseInt(req.params.id);
        const { days = 7 } = req.query;

        const trend = await PriceHistory.getTrend(productId, parseInt(days));
        res.json(trend);

      } catch (error) {
        logger.error('Erro ao obter tendência:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
      }
    });

    // Produtos mais voláteis
    apiRouter.get('/analytics/volatile', async (req, res) => {
      try {
        const { days = 7, limit = 10, guild_id } = req.query;

        const volatile = await PriceHistory.getMostVolatile(
          parseInt(days), 
          parseInt(limit), 
          guild_id
        );

        res.json(volatile);

      } catch (error) {
        logger.error('Erro ao obter produtos voláteis:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
      }
    });

    // Maiores quedas recentes
    apiRouter.get('/analytics/drops', async (req, res) => {
      try {
        const { hours = 24, limit = 10, guild_id } = req.query;

        const drops = await PriceHistory.getBiggestDrops(
          parseInt(hours), 
          parseInt(limit), 
          guild_id
        );

        res.json(drops);

      } catch (error) {
        logger.error('Erro ao obter quedas de preço:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
      }
    });

    // Sistema de backup
    apiRouter.post('/system/backup', async (req, res) => {
      try {
        const backupPath = await database.backup();
        res.json({ 
          success: true, 
          backup_path: backupPath,
          timestamp: new Date().toISOString()
        });

      } catch (error) {
        logger.error('Erro ao criar backup:', error);
        res.status(500).json({ error: 'Erro ao criar backup' });
      }
    });

    // Limpeza do banco
    apiRouter.post('/system/cleanup', async (req, res) => {
      try {
        const { days = 90 } = req.body;
        const cleaned = await database.cleanup(parseInt(days));
        
        res.json({ 
          success: true, 
          records_cleaned: cleaned,
          days_kept: parseInt(days)
        });

      } catch (error) {
        logger.error('Erro na limpeza:', error);
        res.status(500).json({ error: 'Erro na limpeza do banco' });
      }
    });

    this.app.use('/api', apiRouter);
  }

  /**
   * Renderiza o dashboard principal
   */
  async renderDashboard(req, res) {
    try {
      const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Monitor de Preços - Painel Admin</title>
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        body { 
            font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            color: #333;
            line-height: 1.6;
        }
        
        .container { 
            max-width: 1400px; 
            margin: 0 auto; 
            padding: 20px;
        }
        
        .header {
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(10px);
            border-radius: 20px;
            padding: 30px;
            margin-bottom: 30px;
            text-align: center;
            box-shadow: 0 20px 40px rgba(0,0,0,0.1);
        }
        
        .header h1 {
            color: #4a5568;
            margin-bottom: 15px;
            font-size: 2.8em;
            font-weight: 700;
        }
        
        .header p { 
            color: #718096; 
            font-size: 1.2em;
        }
        
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 25px;
            margin-bottom: 30px;
        }
        
        .stat-card {
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(10px);
            padding: 30px;
            border-radius: 20px;
            text-align: center;
            box-shadow: 0 10px 30px rgba(0,0,0,0.1);
            transition: all 0.3s ease;
            border: 1px solid rgba(255,255,255,0.2);
        }
        
        .stat-card:hover { 
            transform: translateY(-10px); 
            box-shadow: 0 20px 40px rgba(0,0,0,0.15);
        }
        
        .stat-icon {
            font-size: 3em;
            margin-bottom: 15px;
            opacity: 0.8;
        }
        
        .stat-number {
            font-size: 2.8em;
            font-weight: 800;
            margin-bottom: 10px;
            background: linear-gradient(45deg, #667eea, #764ba2);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }
        
        .stat-label { 
            color: #718096; 
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 1px;
            font-size: 0.9em;
        }
        
        .controls {
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(10px);
            border-radius: 20px;
            padding: 25px;
            margin-bottom: 30px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.1);
        }
        
        .controls h2 {
            margin-bottom: 20px;
            color: #4a5568;
        }
        
        .btn {
            padding: 12px 24px;
            border: none;
            border-radius: 12px;
            cursor: pointer;
            font-size: 1em;
            font-weight: 600;
            transition: all 0.3s ease;
            margin: 5px;
            text-decoration: none;
            display: inline-block;
        }
        
        .btn-primary { 
            background: linear-gradient(45deg, #4299e1, #667eea);
            color: white; 
        }
        
        .btn-success { 
            background: linear-gradient(45deg, #48bb78, #38a169);
            color: white; 
        }
        
        .btn-warning { 
            background: linear-gradient(45deg, #ed8936, #dd6b20);
            color: white; 
        }
        
        .btn-danger { 
            background: linear-gradient(45deg, #f56565, #e53e3e);
            color: white; 
        }
        
        .btn:hover { 
            transform: translateY(-2px); 
            box-shadow: 0 10px 25px rgba(0,0,0,0.2);
        }
        
        .products-section {
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(10px);
            border-radius: 20px;
            padding: 30px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.1);
        }
        
        .products-section h2 {
            margin-bottom: 25px;
            color: #4a5568;
        }
        
        .products-grid {
            display: grid;
            gap: 20px;
        }
        
        .product-card {
            background: #f8f9ff;
            border-radius: 15px;
            padding: 25px;
            box-shadow: 0 5px 15px rgba(0,0,0,0.05);
            transition: all 0.3s ease;
            border-left: 5px solid #667eea;
        }
        
        .product-card:hover {
            transform: translateX(5px);
            box-shadow: 0 10px 25px rgba(0,0,0,0.1);
        }
        
        .product-header {
            display: flex;
            justify-content: space-between;
            align-items: start;
            margin-bottom: 15px;
        }
        
        .product-title {
            font-size: 1.3em;
            font-weight: 700;
            color: #2d3748;
            flex: 1;
            margin-right: 15px;
        }
        
        .status-badge {
            padding: 8px 16px;
            border-radius: 25px;
            font-size: 0.85em;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        
        .status-active { 
            background: linear-gradient(45deg, #c6f6d5, #9ae6b4);
            color: #22543d; 
        }
        
        .status-waiting { 
            background: linear-gradient(45deg, #feebc8, #fbd38d);
            color: #744210; 
        }
        
        .price-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 20px;
            margin: 20px 0;
        }
        
        .price-item {
            text-align: center;
            padding: 20px;
            background: linear-gradient(45deg, #f7fafc, #edf2f7);
            border-radius: 15px;
            border: 2px solid rgba(102, 126, 234, 0.1);
        }
        
        .price-value {
            font-size: 1.5em;
            font-weight: 800;
            color: #2d3748;
            margin-bottom: 5px;
        }
        
        .price-label {
            font-size: 0.9em;
            color: #718096;
            font-weight: 600;
            text-transform: uppercase;
        }
        
        .loading {
            text-align: center;
            padding: 60px;
            color: #718096;
        }
        
        .loading i {
            font-size: 3em;
            margin-bottom: 20px;
            animation: spin 2s linear infinite;
        }
        
        @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }
        
        .empty-state {
            text-align: center;
            padding: 60px;
            background: linear-gradient(45deg, #f7fafc, #edf2f7);
            border-radius: 20px;
            margin: 30px 0;
        }
        
        .empty-state i {
            font-size: 4em;
            color: #cbd5e0;
            margin-bottom: 20px;
        }
        
        .actions {
            margin-top: 20px;
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
        }
        
        .footer {
            margin-top: 40px;
            text-align: center;
            color: rgba(255,255,255,0.8);
            font-size: 0.9em;
        }
        
        @media (max-width: 768px) {
            .container { padding: 15px; }
            .header h1 { font-size: 2.2em; }
            .stat-number { font-size: 2.2em; }
            .product-header { flex-direction: column; }
            .price-grid { grid-template-columns: 1fr 1fr; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1><i class="fas fa-chart-line"></i> Monitor de Preços</h1>
            <p>Painel administrativo profissional para monitoramento de produtos</p>
        </div>

        <div class="stats-grid" id="stats">
            <div class="stat-card">
                <div class="stat-icon" style="color: #4299e1;">
                    <i class="fas fa-box"></i>
                </div>
                <div class="stat-number" id="total-products">-</div>
                <div class="stat-label">Produtos Monitorados</div>
            </div>
            
            <div class="stat-card">
                <div class="stat-icon" style="color: #48bb78;">
                    <i class="fas fa-fire"></i>
                </div>
                <div class="stat-number" id="active-promotions">-</div>
                <div class="stat-label">Promoções Ativas</div>
            </div>
            
            <div class="stat-card">
                <div class="stat-icon" style="color: #ed8936;">
                    <i class="fas fa-bell"></i>
                </div>
                <div class="stat-number" id="total-notifications">-</div>
                <div class="stat-label">Notificações Enviadas</div>
            </div>
            
            <div class="stat-card">
                <div class="stat-icon" style="color: #9f7aea;">
                    <i class="fas fa-database"></i>
                </div>
                <div class="stat-number" id="db-records">-</div>
                <div class="stat-label">Registros no Banco</div>
            </div>
        </div>

        <div class="controls">
            <h2><i class="fas fa-cogs"></i> Controles do Sistema</h2>
            <button class="btn btn-primary" onclick="refreshData()">
                <i class="fas fa-sync"></i> Atualizar Dados
            </button>
            <button class="btn btn-success" onclick="createBackup()">
                <i class="fas fa-download"></i> Fazer Backup
            </button>
            <button class="btn btn-warning" onclick="cleanupData()">
                <i class="fas fa-broom"></i> Limpar Dados Antigos
            </button>
            <button class="btn btn-primary" onclick="exportData()">
                <i class="fas fa-file-export"></i> Exportar Relatório
            </button>
        </div>

        <div class="products-section">
            <h2><i class="fas fa-shopping-cart"></i> Produtos Recentes</h2>
            <div class="products-grid" id="products">
                <div class="loading">
                    <i class="fas fa-spinner"></i>
                    <p>Carregando produtos...</p>
                </div>
            </div>
        </div>

        <div class="footer">
            <p>Monitor de Preços v1.0.0 • Sistema profissional de monitoramento</p>
            <p>Desenvolvido com ❤️ para automação de e-commerce</p>
        </div>
    </div>

    <script>
        // Estado da aplicação
        let appState = {
            products: [],
            stats: {},
            loading: false
        };

        // Função para carregar dados iniciais
        async function loadData() {
            try {
                appState.loading = true;
                updateLoadingState();

                const [statsRes, productsRes] = await Promise.all([
                    fetch('/api/stats'),
                    fetch('/api/products?limit=20')
                ]);
                
                if (!statsRes.ok || !productsRes.ok) {
                    throw new Error('Erro na API');
                }

                const stats = await statsRes.json();
                const productsData = await productsRes.json();
                
                appState.stats = stats;
                appState.products = productsData.products;
                
                updateStats(stats);
                updateProducts(productsData.products);

            } catch (error) {
                console.error('Erro ao carregar dados:', error);
                showError('Erro ao carregar dados. Verifique a conexão.');
            } finally {
                appState.loading = false;
                updateLoadingState();
            }
        }

        // Atualizar estatísticas na interface
        function updateStats(stats) {
            document.getElementById('total-products').textContent = stats.totalProducts || 0;
            document.getElementById('active-promotions').textContent = stats.activePromotions || 0;
            document.getElementById('total-notifications').textContent = stats.totalNotifications || 0;
            document.getElementById('db-records').textContent = 
                (stats.database?.activeProducts || 0) + (stats.database?.priceHistoryRecords || 0);
        }

        // Atualizar lista de produtos
        function updateProducts(products) {
            const container = document.getElementById('products');
            
            if (!products || products.length === 0) {
                container.innerHTML = \`
                    <div class="empty-state">
                        <i class="fas fa-box-open"></i>
                        <h3>Nenhum produto encontrado</h3>
                        <p>Use os comandos do Discord para adicionar produtos ao monitoramento.</p>
                    </div>
                \`;
                return;
            }

            container.innerHTML = products.map(product => \`
                <div class="product-card">
                    <div class="product-header">
                        <div class="product-title">\${escapeHtml(product.name || 'Produto sem nome')}</div>
                        <div class="status-badge \${getStatusClass(product)}">
                            \${getStatusText(product)}
                        </div>
                    </div>
                    
                    <div class="price-grid">
                        <div class="price-item">
                            <div class="price-value">R$ \${(product.current_price || 0).toFixed(2)}</div>
                            <div class="price-label">Preço Atual</div>
                        </div>
                        <div class="price-item">
                            <div class="price-value">R$ \${(product.target_price || 0).toFixed(2)}</div>
                            <div class="price-label">Preço Alvo</div>
                        </div>
                        <div class="price-item">
                            <div class="price-value">\${getPriceChange(product)}%</div>
                            <div class="price-label">Variação</div>
                        </div>
                        <div class="price-item">
                            <div class="price-value">\${product.check_count || 0}</div>
                            <div class="price-label">Verificações</div>
                        </div>
                    </div>

                    <div class="actions">
                        <a href="\${product.url}" target="_blank" class="btn btn-primary">
                            <i class="fas fa-external-link-alt"></i> Ver Produto
                        </a>
                        <button class="btn btn-success" onclick="viewHistory(\${product.id})">
                            <i class="fas fa-chart-line"></i> Histórico
                        </button>
                        <button class="btn btn-warning" onclick="editProduct(\${product.id})">
                            <i class="fas fa-edit"></i> Editar
                        </button>
                        <button class="btn btn-danger" onclick="removeProduct(\${product.id})">
                            <i class="fas fa-trash"></i> Remover
                        </button>
                    </div>
                </div>
            \`).join('');
        }

        // Funções auxiliares para os produtos
        function getStatusClass(product) {
            return product.current_price && product.target_price && product.current_price <= product.target_price 
                ? 'status-active' : 'status-waiting';
        }

        function getStatusText(product) {
            if (!product.current_price || !product.target_price) return '❓ Sem dados';
            return product.current_price <= product.target_price ? '🔥 PROMOÇÃO' : '⏳ Aguardando';
        }

        function getPriceChange(product) {
            if (!product.current_price || !product.last_price) return '0.0';
            const change = ((product.current_price - product.last_price) / product.last_price) * 100;
            return (change > 0 ? '+' : '') + change.toFixed(1);
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        // Controles do sistema
        async function refreshData() {
            await loadData();
            showSuccess('Dados atualizados com sucesso!');
        }

        async function createBackup() {
            try {
                showInfo('Criando backup...');
                const response = await fetch('/api/system/backup', { method: 'POST' });
                
                if (!response.ok) throw new Error('Erro na API');
                
                const result = await response.json();
                showSuccess(\`Backup criado com sucesso!\\nArquivo: \${result.backup_path}\`);
            } catch (error) {
                console.error('Erro ao criar backup:', error);
                showError('Erro ao criar backup. Verifique os logs do servidor.');
            }
        }

        async function cleanupData() {
            if (!confirm('Deseja realmente limpar dados antigos? Esta ação não pode ser desfeita.')) {
                return;
            }
            
            try {
                showInfo('Limpando dados antigos...');
                const response = await fetch('/api/system/cleanup', { 
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ days: 90 })
                });
                
                if (!response.ok) throw new Error('Erro na API');
                
                const result = await response.json();
                showSuccess(\`Limpeza concluída!\\nRegistros removidos: \${result.records_cleaned}\`);
                await loadData(); // Recarregar dados
            } catch (error) {
                console.error('Erro na limpeza:', error);
                showError('Erro na limpeza. Verifique os logs do servidor.');
            }
        }

        async function exportData() {
            try {
                showInfo('Gerando relatório...');
                
                // Buscar dados detalhados
                const [statsRes, productsRes] = await Promise.all([
                    fetch('/api/stats'),
                    fetch('/api/products?limit=1000')
                ]);
                
                const stats = await statsRes.json();
                const productsData = await productsRes.json();
                
                // Gerar CSV
                let csv = 'ID,Nome,URL,Preço Atual,Preço Alvo,Status,Verificações,Criado em\\n';
                
                productsData.products.forEach(product => {
                    const status = getStatusText(product).replace('🔥 ', '').replace('⏳ ', '').replace('❓ ', '');
                    csv += \`\${product.id},"\${(product.name || '').replace(/"/g, '""')}",\${product.url},\${product.current_price || 0},\${product.target_price || 0},\${status},\${product.check_count || 0},\${product.created_at}\\n\`;
                });
                
                // Download do arquivo
                const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
                const link = document.createElement('a');
                link.href = URL.createObjectURL(blob);
                link.download = \`relatorio_produtos_\${new Date().toISOString().split('T')[0]}.csv\`;
                link.click();
                
                showSuccess('Relatório exportado com sucesso!');
            } catch (error) {
                console.error('Erro na exportação:', error);
                showError('Erro ao exportar relatório.');
            }
        }

        // Ações dos produtos
        async function viewHistory(productId) {
            try {
                showInfo('Carregando histórico...');
                const response = await fetch(\`/api/products/\${productId}/history?limit=30\`);
                
                if (!response.ok) throw new Error('Erro na API');
                
                const history = await response.json();
                
                let historyHtml = \`
                    <div style="max-width: 600px; margin: 20px auto; padding: 20px; background: white; border-radius: 10px; box-shadow: 0 5px 15px rgba(0,0,0,0.1);">
                        <h3 style="margin-bottom: 20px; color: #4a5568;">📊 Histórico de Preços</h3>
                        <div style="max-height: 400px; overflow-y: auto;">
                \`;
                
                if (history.length === 0) {
                    historyHtml += '<p>Nenhum registro de histórico encontrado.</p>';
                } else {
                    history.forEach(record => {
                        const date = new Date(record.checked_at).toLocaleString('pt-BR');
                        const changeText = record.price_change_percent ? 
                            \` (\${record.price_change_percent > 0 ? '+' : ''}\${record.price_change_percent.toFixed(1)}%)\` : '';
                        
                        historyHtml += \`
                            <div style="padding: 10px; border-bottom: 1px solid #eee; display: flex; justify-content: space-between;">
                                <span>\${date}</span>
                                <span><strong>R$ \${record.price.toFixed(2)}</strong>\${changeText}</span>
                            </div>
                        \`;
                    });
                }
                
                historyHtml += \`
                        </div>
                        <button onclick="closeModal()" style="margin-top: 15px; padding: 8px 16px; background: #4299e1; color: white; border: none; border-radius: 5px; cursor: pointer;">Fechar</button>
                    </div>
                \`;
                
                showModal(historyHtml);
            } catch (error) {
                console.error('Erro ao carregar histórico:', error);
                showError('Erro ao carregar histórico do produto.');
            }
        }

        async function editProduct(productId) {
            showInfo('🚧 Funcionalidade de edição em desenvolvimento!');
        }

        async function removeProduct(productId) {
            if (!confirm('Deseja realmente remover este produto do monitoramento?')) {
                return;
            }
            
            try {
                const response = await fetch(\`/api/products/\${productId}\`, { method: 'DELETE' });
                
                if (!response.ok) throw new Error('Erro na API');
                
                showSuccess('Produto removido com sucesso!');
                await loadData(); // Recarregar lista
            } catch (error) {
                console.error('Erro ao remover produto:', error);
                showError('Erro ao remover produto.');
            }
        }

        // Sistema de notificações
        function showSuccess(message) {
            showNotification(message, 'success');
        }

        function showError(message) {
            showNotification(message, 'error');
        }

        function showInfo(message) {
            showNotification(message, 'info');
        }

        function showNotification(message, type) {
            const colors = {
                success: '#48bb78',
                error: '#f56565',
                info: '#4299e1'
            };
            
            const notification = document.createElement('div');
            notification.style.cssText = \`
                position: fixed;
                top: 20px;
                right: 20px;
                padding: 15px 25px;
                background: \${colors[type]};
                color: white;
                border-radius: 10px;
                box-shadow: 0 5px 15px rgba(0,0,0,0.2);
                z-index: 10000;
                font-weight: 600;
                max-width: 400px;
                word-wrap: break-word;
            \`;
            notification.textContent = message;
            
            document.body.appendChild(notification);
            
            setTimeout(() => {
                notification.remove();
            }, 5000);
        }

        // Sistema de modal
        function showModal(content) {
            const modal = document.createElement('div');
            modal.id = 'modal';
            modal.style.cssText = \`
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0,0,0,0.8);
                display: flex;
                justify-content: center;
                align-items: center;
                z-index: 10000;
            \`;
            modal.innerHTML = content;
            
            modal.onclick = (e) => {
                if (e.target === modal) closeModal();
            };
            
            document.body.appendChild(modal);
        }

        function closeModal() {
            const modal = document.getElementById('modal');
            if (modal) modal.remove();
        }

        function updateLoadingState() {
            // Atualizar indicadores de loading se necessário
        }

        // Auto-refresh dos dados a cada 5 minutos
        setInterval(() => {
            loadData();
        }, 5 * 60 * 1000);

        // Carregar dados quando a página carrega
        document.addEventListener('DOMContentLoaded', loadData);
    </script>
</body>
</html>
      `;

      res.send(html);

    } catch (error) {
      logger.error('Erro ao renderizar dashboard:', error);
      res.status(500).json({ error: 'Erro interno do servidor' });
    }
  }

  /**
   * Middleware de autenticação simples
   */
  authMiddleware(req, res, next) {
    const apiKey = req.headers['x-api-key'] || req.query.api_key;
    
    if (!apiKey || apiKey !== config.server.secretKey) {
      return res.status(401).json({ 
        error: 'Chave de API necessária',
        message: 'Forneça uma chave válida no header X-API-Key ou parâmetro api_key'
      });
    }
    
    next();
  }

  /**
   * Ordena produtos conforme critério
   */
  sortProducts(products, sort, order) {
    const isDesc = order === 'desc';
    
    products.sort((a, b) => {
      let valueA, valueB;
      
      switch (sort) {
        case 'name':
          valueA = (a.name || '').toLowerCase();
          valueB = (b.name || '').toLowerCase();
          break;
        case 'current_price':
          valueA = a.current_price || 0;
          valueB = b.current_price || 0;
          break;
        case 'target_price':
          valueA = a.target_price || 0;
          valueB = b.target_price || 0;
          break;
        case 'created_at':
        default:
          valueA = new Date(a.created_at || 0);
          valueB = new Date(b.created_at || 0);
      }
      
      if (valueA < valueB) return isDesc ? 1 : -1;
      if (valueA > valueB) return isDesc ? -1 : 1;
      return 0;
    });
    
    return products;
  }

  /**
   * Configura tratamento de erros
   */
  setupErrorHandling() {
    // Handler para 404
    this.app.use((req, res) => {
      res.status(404).json({
        error: 'Endpoint não encontrado',
        path: req.path,
        method: req.method,
        timestamp: new Date().toISOString()
      });
    });

    // Handler para erros gerais
    this.app.use((err, req, res, next) => {
      logger.error('Erro no servidor web:', err, {
        path: req.path,
        method: req.method,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });

      res.status(err.status || 500).json({
        error: 'Erro interno do servidor',
        message: config.isDevelopment() ? err.message : 'Algo deu errado',
        timestamp: new Date().toISOString()
      });
    });
  }

  /**
   * Inicia o servidor
   */
  async start() {
    if (this.isRunning) {
      logger.warn('Servidor web já está rodando');
      return;
    }

    try {
      this.server = this.app.listen(config.server.port, () => {
        this.isRunning = true;
        logger.info(`Servidor web iniciado na porta ${config.server.port}`, {
          url: `http://localhost:${config.server.port}`,
          environment: config.server.nodeEnv
        });
      });

      // Configurar timeout para requests
      this.server.timeout = 30000; // 30 segundos

      return this.server;

    } catch (error) {
      logger.error('Erro ao iniciar servidor web:', error);
      throw error;
    }
  }

  /**
   * Para o servidor
   */
  async stop() {
    if (!this.isRunning || !this.server) {
      logger.warn('Servidor web não está rodando');
      return;
    }

    return new Promise((resolve, reject) => {
      this.server.close((err) => {
        if (err) {
          logger.error('Erro ao parar servidor web:', err);
          reject(err);
        } else {
          this.isRunning = false;
          logger.info('Servidor web parado');
          resolve();
        }
      });
    });
  }

  /**
   * Obtém status do servidor
   */
  getStatus() {
    return {
      running: this.isRunning,
      port: config.server.port,
      environment: config.server.nodeEnv,
      uptime: this.isRunning ? process.uptime() : 0
    };
  }
}

module.exports = new WebServer();