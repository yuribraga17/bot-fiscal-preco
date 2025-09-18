const axios = require('axios');
const cheerio = require('cheerio');
const config = require('../config/config');
const logger = require('../utils/logger');

/**
 * Serviço profissional de scraping de preços
 * Suporta múltiplos sites e estratégias de extração
 */
class PriceScraper {
  
  constructor() {
    this.requestQueue = [];
    this.isProcessing = false;
    this.retryAttempts = new Map();
    
    // Configurações específicas por site
    this.siteConfigs = {
      'amazon.com.br': {
        selectors: ['.a-price-whole', '.a-price .a-offscreen', '#priceblock_dealprice'],
        nameSelectors: ['#productTitle', 'h1.a-size-large'],
        currency: 'BRL',
        waitTime: 3000
      },
      'mercadolivre.com.br': {
        selectors: ['.andes-money-amount__fraction', '.price-tag-fraction'],
        nameSelectors: ['.ui-pdp-title', '.item-title'],
        currency: 'BRL',
        waitTime: 2000
      },
      'americanas.com.br': {
        selectors: ['.price__Value', '.price-value'],
        nameSelectors: ['.product-title', 'h1'],
        currency: 'BRL',
        waitTime: 2000
      },
      'magazineluiza.com.br': {
        selectors: ['.price-template__text', '[data-testid="price-value"]'],
        nameSelectors: ['.header-product__title', 'h1'],
        currency: 'BRL',
        waitTime: 2000
      },
      'submarino.com.br': {
        selectors: ['.price__Value', '.sales-price'],
        nameSelectors: ['.product-title', 'h1'],
        currency: 'BRL',
        waitTime: 2000
      },
      'casasbahia.com.br': {
        selectors: ['.sales-price', '.price-template__text'],
        nameSelectors: ['.product-title', '.title'],
        currency: 'BRL',
        waitTime: 2000
      }
    };
  }

  /**
   * Extrai preço e informações de uma URL
   * @param {string} url - URL do produto
   * @param {Object} options - Opções adicionais
   */
  async scrapePrice(url, options = {}) {
    const startTime = Date.now();
    
    try {
      // Validar URL
      if (!this.isValidUrl(url)) {
        throw new Error('URL inválida');
      }

      // Normalizar URL
      const normalizedUrl = this.normalizeUrl(url);
      const domain = this.extractDomain(normalizedUrl);
      
      logger.scraping(url, 'started');

      // Fazer request com retry automático
      const response = await this.makeRequest(normalizedUrl, domain);
      
      // Extrair dados da página
      const scrapedData = await this.extractData(response.data, domain, normalizedUrl);
      
      const duration = Date.now() - startTime;
      logger.perf('scraping', duration, { url: domain, success: scrapedData.success });

      if (scrapedData.success) {
        logger.scraping(url, 'success', scrapedData.price);
        this.retryAttempts.delete(url); // Reset retry count on success
      } else {
        logger.scraping(url, 'failed', null, scrapedData.error);
      }

      return {
        ...scrapedData,
        url: normalizedUrl,
        domain,
        scrapedAt: new Date().toISOString(),
        duration
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      logger.scraping(url, 'error', null, error.message);
      
      return {
        price: null,
        name: null,
        success: false,
        error: error.message,
        url,
        domain: this.extractDomain(url),
        scrapedAt: new Date().toISOString(),
        duration
      };
    }
  }

  /**
   * Faz requisição HTTP com configurações otimizadas
   * @param {string} url - URL para requisição
   * @param {string} domain - Domínio extraído
   */
  async makeRequest(url, domain) {
    const siteConfig = this.siteConfigs[domain] || {};
    const retryCount = this.retryAttempts.get(url) || 0;

    const requestConfig = {
      method: 'GET',
      url,
      timeout: config.scraping.requestTimeoutMs,
      headers: {
        'User-Agent': config.scraping.userAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Cache-Control': 'max-age=0'
      },
      maxRedirects: 5,
      validateStatus: (status) => status < 500 // Aceitar até 4xx
    };

    // Adicionar headers específicos por domínio se necessário
    if (domain.includes('amazon')) {
      requestConfig.headers['Accept'] = 'text/html,application/xhtml+xml';
      requestConfig.headers['Accept-Charset'] = 'utf-8';
    }

    try {
      const response = await axios(requestConfig);
      
      if (response.status >= 400) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Verificar se não foi bloqueado
      if (this.isBlocked(response.data, domain)) {
        throw new Error('Request bloqueado pelo servidor');
      }

      return response;

    } catch (error) {
      // Implementar retry com backoff exponencial
      if (retryCount < config.monitoring.maxRetries && this.shouldRetry(error)) {
        this.retryAttempts.set(url, retryCount + 1);
        const delay = Math.pow(2, retryCount) * 1000; // Exponential backoff
        
        logger.warn(`Tentativa ${retryCount + 1} para ${url} em ${delay}ms`, { error: error.message });
        
        await this.delay(delay);
        return this.makeRequest(url, domain);
      }

      throw error;
    }
  }

  /**
   * Extrai dados da página HTML
   * @param {string} html - Conteúdo HTML
   * @param {string} domain - Domínio do site
   * @param {string} url - URL original
   */
  async extractData(html, domain, url) {
    try {
      const $ = cheerio.load(html);
      const siteConfig = this.siteConfigs[domain] || {};
      
      // Extrair preço
      const price = this.extractPrice($, siteConfig, domain);
      
      // Extrair nome do produto
      const name = this.extractProductName($, siteConfig, domain);
      
      // Verificar se extraiu dados válidos
      const success = price !== null && price > 0;
      
      return {
        price,
        name: name || 'Produto sem nome',
        success,
        error: success ? null : 'Não foi possível extrair o preço'
      };

    } catch (error) {
      logger.error('Erro na extração de dados:', error, { domain, url });
      return {
        price: null,
        name: null,
        success: false,
        error: `Erro na extração: ${error.message}`
      };
    }
  }

  /**
   * Extrai preço usando múltiplas estratégias
   * @param {CheerioAPI} $ - Instância do Cheerio
   * @param {Object} siteConfig - Configuração do site
   * @param {string} domain - Domínio
   */
  extractPrice($, siteConfig, domain) {
    // Seletores específicos do site
    if (siteConfig.selectors) {
      for (const selector of siteConfig.selectors) {
        const price = this.tryExtractPrice($, selector);
        if (price) return price;
      }
    }

    // Seletores genéricos
    const genericSelectors = [
      '.price',
      '.sale-price', 
      '.current-price',
      '.offer-price',
      '[data-price]',
      '.price-current',
      '.product-price',
      '.price-box .price',
      '.price-value',
      '.price-now',
      '.selling-price',
      '.final-price',
      '.discount-price',
      '.special-price',
      '.our-price'
    ];

    for (const selector of genericSelectors) {
      const price = this.tryExtractPrice($, selector);
      if (price) return price;
    }

    // Busca por patterns específicos no HTML
    const htmlText = $.html();
    const patterns = [
      /"price":\s*"?(\d+[.,]\d{2})"?/,
      /"amount":\s*"?(\d+[.,]\d{2})"?/,
      /"value":\s*(\d+[.,]\d{2})/,
      /R\$\s*(\d{1,3}(?:\.\d{3})*,\d{2})/,
      /BRL\s*(\d+[.,]\d{2})/
    ];

    for (const pattern of patterns) {
      const match = htmlText.match(pattern);
      if (match) {
        const price = this.parsePrice(match[1]);
        if (price) return price;
      }
    }

    return null;
  }

  /**
   * Tenta extrair preço de um seletor específico
   * @param {CheerioAPI} $ - Instância do Cheerio
   * @param {string} selector - Seletor CSS
   */
  tryExtractPrice($, selector) {
    try {
      const elements = $(selector);
      
      for (let i = 0; i < elements.length; i++) {
        const element = elements.eq(i);
        
        // Tentar texto direto
        let text = element.text().trim();
        if (text) {
          const price = this.parsePrice(text);
          if (price) return price;
        }

        // Tentar atributos
        const attributes = ['data-price', 'value', 'content', 'title'];
        for (const attr of attributes) {
          const attrValue = element.attr(attr);
          if (attrValue) {
            const price = this.parsePrice(attrValue);
            if (price) return price;
          }
        }
      }
    } catch (error) {
      // Ignorar erros de seletores específicos
    }

    return null;
  }

  /**
   * Extrai nome do produto
   * @param {CheerioAPI} $ - Instância do Cheerio
   * @param {Object} siteConfig - Configuração do site
   * @param {string} domain - Domínio
   */
  extractProductName($, siteConfig, domain) {
    // Seletores específicos do site
    if (siteConfig.nameSelectors) {
      for (const selector of siteConfig.nameSelectors) {
        const name = $(selector).first().text().trim();
        if (name && name.length > 0 && name.length < 200) {
          return this.cleanProductName(name);
        }
      }
    }

    // Seletores genéricos
    const genericSelectors = [
      'h1',
      '.product-title',
      '.product-name',
      '#productTitle',
      '.item-title',
      '.title',
      '.product-info h1',
      '.product-header h1',
      '[data-testid="product-title"]'
    ];

    for (const selector of genericSelectors) {
      const name = $(selector).first().text().trim();
      if (name && name.length > 0 && name.length < 200) {
        return this.cleanProductName(name);
      }
    }

    // Fallback para title da página
    const pageTitle = $('title').text().trim();
    if (pageTitle && pageTitle.length > 0) {
      return this.cleanProductName(pageTitle);
    }

    return null;
  }

  /**
   * Limpa e normaliza o nome do produto
   * @param {string} name - Nome bruto
   */
  cleanProductName(name) {
    return name
      .replace(/\s+/g, ' ') // Múltiplos espaços
      .replace(/[\n\r\t]/g, '') // Quebras de linha e tabs
      .replace(/[|•·]/g, '-') // Separadores
      .trim()
      .substring(0, 150); // Limitar tamanho
  }

  /**
   * Converte string de preço em número
   * @param {string} priceText - Texto do preço
   */
  parsePrice(priceText) {
    if (!priceText || typeof priceText !== 'string') return null;

    // Remover caracteres não numéricos exceto pontos e vírgulas
    const cleanText = priceText.replace(/[^\d.,]/g, '');
    
    if (!cleanText) return null;

    // Patterns para diferentes formatos brasileiros
    const patterns = [
      // 1.234,56 ou 234,56
      /^(\d{1,3}(?:\.\d{3})*),(\d{2})$/,
      // 1234.56 (formato americano)
      /^(\d+)\.(\d{2})$/,
      // 1234,56 (sem separador de milhares)
      /^(\d+),(\d{2})$/,
      // Apenas números inteiros
      /^(\d+)$/
    ];

    for (const pattern of patterns) {
      const match = cleanText.match(pattern);
      if (match) {
        if (pattern.source.includes(',(\\d{2})')) {
          // Formato brasileiro com vírgula decimal
          const integerPart = match[1].replace(/\./g, '');
          const decimalPart = match[2];
          const price = parseFloat(`${integerPart}.${decimalPart}`);
          return price > 0 ? price : null;
        } else if (pattern.source.includes('\\.(\\d{2})')) {
          // Formato americano com ponto decimal
          const price = parseFloat(cleanText);
          return price > 0 ? price : null;
        } else {
          // Número inteiro
          const price = parseFloat(match[1]);
          return price > 0 ? price : null;
        }
      }
    }

    // Último recurso: tentar parseFloat direto
    const directParse = parseFloat(cleanText.replace(/,/g, '.'));
    return (directParse > 0 && directParse < 1000000) ? directParse : null;
  }

  /**
   * Verifica se a URL é válida
   * @param {string} url - URL para validar
   */
  isValidUrl(url) {
    try {
      const urlObj = new URL(url);
      return ['http:', 'https:'].includes(urlObj.protocol);
    } catch {
      return false;
    }
  }

  /**
   * Normaliza a URL removendo parâmetros desnecessários
   * @param {string} url - URL original
   */
  normalizeUrl(url) {
    try {
      const urlObj = new URL(url);
      
      // Remover parâmetros de tracking comuns
      const trackingParams = [
        'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
        'gclid', 'fbclid', 'ref', 'referrer', '_ga', 'mc_cid', 'mc_eid'
      ];
      
      trackingParams.forEach(param => {
        urlObj.searchParams.delete(param);
      });

      return urlObj.toString();
    } catch {
      return url;
    }
  }

  /**
   * Extrai domínio da URL
   * @param {string} url - URL
   */
  extractDomain(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.replace(/^www\./, '');
    } catch {
      return 'unknown';
    }
  }

  /**
   * Verifica se a resposta indica bloqueio
   * @param {string} html - HTML da resposta
   * @param {string} domain - Domínio
   */
  isBlocked(html, domain) {
    const blockIndicators = [
      'captcha',
      'blocked',
      'access denied',
      'too many requests',
      'rate limit',
      'robot',
      'bot detection',
      'cloudflare',
      'please verify',
      'security check'
    ];

    const lowerHtml = html.toLowerCase();
    return blockIndicators.some(indicator => lowerHtml.includes(indicator));
  }

  /**
   * Verifica se deve tentar novamente após erro
   * @param {Error} error - Erro ocorrido
   */
  shouldRetry(error) {
    const retryableErrors = [
      'ECONNRESET',
      'ECONNREFUSED',
      'ETIMEDOUT',
      'timeout',
      'network',
      '5',  // 5xx errors
      'rate limit'
    ];

    const errorMessage = error.message.toLowerCase();
    return retryableErrors.some(indicator => errorMessage.includes(indicator));
  }

  /**
   * Delay assíncrono
   * @param {number} ms - Milissegundos para aguardar
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Scraping em lote com controle de concorrência
   * @param {Array} urls - Lista de URLs
   * @param {Object} options - Opções de configuração
   */
  async scrapeBatch(urls, options = {}) {
    const {
      concurrency = 3,
      delayBetween = 2000,
      onProgress = null
    } = options;

    const results = [];
    const chunks = this.chunkArray(urls, concurrency);

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const chunkPromises = chunk.map(url => this.scrapePrice(url));
      
      try {
        const chunkResults = await Promise.allSettled(chunkPromises);
        
        chunkResults.forEach((result, index) => {
          if (result.status === 'fulfilled') {
            results.push(result.value);
          } else {
            results.push({
              url: chunk[index],
              price: null,
              name: null,
              success: false,
              error: result.reason.message
            });
          }
        });

        // Callback de progresso
        if (onProgress) {
          onProgress({
            completed: results.length,
            total: urls.length,
            progress: Math.round((results.length / urls.length) * 100)
          });
        }

        // Delay entre chunks (exceto no último)
        if (i < chunks.length - 1) {
          await this.delay(delayBetween);
        }

      } catch (error) {
        logger.error('Erro no scraping em lote:', error);
      }
    }

    return results;
  }

  /**
   * Divide array em chunks
   * @param {Array} array - Array original
   * @param {number} size - Tamanho do chunk
   */
  chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * Valida se o site é suportado
   * @param {string} url - URL do produto
   */
  isSupportedSite(url) {
    const domain = this.extractDomain(url);
    const supportedDomains = Object.keys(this.siteConfigs);
    
    // Verificação exata
    if (supportedDomains.includes(domain)) {
      return { supported: true, confidence: 'high' };
    }

    // Verificação parcial (subdomínios)
    const partialMatch = supportedDomains.find(supported => 
      domain.includes(supported) || supported.includes(domain.split('.').slice(-2).join('.'))
    );

    if (partialMatch) {
      return { supported: true, confidence: 'medium' };
    }

    // Sites genéricos de e-commerce
    const ecommerceIndicators = ['shop', 'store', 'loja', 'compra'];
    const hasEcommerceIndicator = ecommerceIndicators.some(indicator => 
      domain.includes(indicator)
    );

    return { 
      supported: hasEcommerceIndicator, 
      confidence: hasEcommerceIndicator ? 'low' : 'none' 
    };
  }

  /**
   * Obtém estatísticas do scraper
   */
  getStats() {
    return {
      supportedSites: Object.keys(this.siteConfigs).length,
      queueLength: this.requestQueue.length,
      isProcessing: this.isProcessing,
      retryAttempts: this.retryAttempts.size,
      uptime: process.uptime()
    };
  }

  /**
   * Adiciona configuração personalizada para um site
   * @param {string} domain - Domínio do site
   * @param {Object} config - Configuração
   */
  addSiteConfig(domain, config) {
    this.siteConfigs[domain] = {
      selectors: [],
      nameSelectors: [],
      currency: 'BRL',
      waitTime: 2000,
      ...config
    };
    
    logger.info(`Configuração adicionada para ${domain}`, config);
  }

  /**
   * Remove configuração de um site
   * @param {string} domain - Domínio do site
   */
  removeSiteConfig(domain) {
    if (this.siteConfigs[domain]) {
      delete this.siteConfigs[domain];
      logger.info(`Configuração removida para ${domain}`);
      return true;
    }
    return false;
  }

  /**
   * Testa scraping de uma URL (modo debug)
   * @param {string} url - URL para testar
   */
  async debugScrape(url) {
    const startTime = Date.now();
    logger.info(`Iniciando debug scrape para: ${url}`);

    try {
      // Fazer requisição
      const domain = this.extractDomain(url);
      const response = await this.makeRequest(url, domain);
      
      // Carregar HTML
      const $ = cheerio.load(response.data);
      
      // Tentar todos os seletores
      const results = {
        url,
        domain,
        status: response.status,
        contentLength: response.data.length,
        title: $('title').text().trim(),
        selectors: {},
        prices: [],
        names: []
      };

      // Testar seletores de preço
      const allPriceSelectors = [
        ...(this.siteConfigs[domain]?.selectors || []),
        '.price', '.sale-price', '.current-price', '.offer-price'
      ];

      allPriceSelectors.forEach(selector => {
        try {
          const elements = $(selector);
          results.selectors[selector] = {
            found: elements.length,
            texts: elements.map((i, el) => $(el).text().trim()).get().slice(0, 3)
          };
        } catch (error) {
          results.selectors[selector] = { error: error.message };
        }
      });

      // Extrair dados
      const extractedData = await this.extractData(response.data, domain, url);
      results.extracted = extractedData;

      const duration = Date.now() - startTime;
      logger.info(`Debug scrape concluído em ${duration}ms`, { success: extractedData.success });

      return results;

    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error(`Debug scrape falhou em ${duration}ms:`, error);
      
      return {
        url,
        error: error.message,
        duration
      };
    }
  }
}

module.exports = new PriceScraper();