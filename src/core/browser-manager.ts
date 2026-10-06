/**
 * BrowserManager Modülü - Patchright Tabanlı
 * 
 * Özellikler:
 * - Patchright (Playwright'ın stealth versiyonu)
 * - Resource Interceptor (gereksiz kaynakları engelleme)
 * - Lifecycle Manager (crash recovery, timeout handling)
 * - WebRTC Leak Protection
 * - Runtime Fingerprint Randomizer
 * - CDP (Chrome DevTools Protocol) entegrasyonu
 */

import { chromium, Browser, BrowserContext, Page, CDPSession, Route, Request } from 'patchright';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { FingerprintData } from '../types';
import { ProxyStatus } from './proxy-manager';
import { Logger, getLogger } from '../utils/logger';

// Browser instance bilgisi
interface BrowserInstance {
  context: BrowserContext;
  browser: Browser;
  fingerprint: FingerprintData;
  proxy: ProxyStatus;
  createdAt: Date;
  lastUsed: Date;
  pageCount: number;
  cdpSession?: CDPSession;
}

// Resource interception config
interface ResourceInterceptorConfig {
  blockImages: boolean;
  blockFonts: boolean;
  blockMedia: boolean;
  blockCSS: boolean;
  blockWebRTC: boolean;
  allowedDomains?: string[];
}

// Lifecycle config
interface LifecycleConfig {
  navigationTimeout: number;
  pageLoadTimeout: number;
  crashRecovery: boolean;
  maxRecoveryAttempts: number;
  popupHandling: boolean;
  dialogHandling: boolean;
}

// BrowserManager yapılandırması
export interface BrowserManagerConfig {
  maxConcurrentBrowsers: number;
  defaultTimeout: number;
  headless: boolean;
  debugMode: boolean;
  cookieDir: string;
  userDataDir: string;
  resourceInterceptor: Partial<ResourceInterceptorConfig>;
  lifecycle: Partial<LifecycleConfig>;
}

// Varsayılan yapılandırma
const defaultConfig: BrowserManagerConfig = {
  maxConcurrentBrowsers: 5,
  defaultTimeout: 30000,
  headless: true,
  debugMode: false,
  cookieDir: './data/cookies',
  userDataDir: './data/browser-data',
  resourceInterceptor: {
    blockImages: true,
    blockFonts: true,
    blockMedia: true,
    blockCSS: false, // CSS gerekli olabilir
    blockWebRTC: true,
  },
  lifecycle: {
    navigationTimeout: 30000,
    pageLoadTimeout: 60000,
    crashRecovery: true,
    maxRecoveryAttempts: 3,
    popupHandling: true,
    dialogHandling: true,
  },
};

/**
 * BrowserManager sınıfı - Patchright tabanlı
 */
export class BrowserManager {
  private config: BrowserManagerConfig;
  private logger: Logger;
  private activeBrowsers: Map<string, BrowserInstance> = new Map();
  private cookieCache: Map<string, any[]> = new Map();
  private recoveryAttempts: Map<string, number> = new Map();

  constructor(config: Partial<BrowserManagerConfig> = {}, logger?: Logger) {
    this.config = { ...defaultConfig, ...config };
    this.logger = logger || getLogger();
    this.ensureDirectories();
  }

  /**
   * Gerekli dizinleri oluşturur
   */
  private ensureDirectories(): void {
    const dirs = [this.config.cookieDir, this.config.userDataDir];
    dirs.forEach(dir => {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    });
  }

  /**
   * Yeni browser context oluşturur
   */
  public async launchBrowser(
    fingerprint: FingerprintData,
    proxy: ProxyStatus,
    cookies?: any[]
  ): Promise<BrowserContext> {
    if (this.activeBrowsers.size >= this.config.maxConcurrentBrowsers) {
      this.logger.warn('Max concurrent browsers reached, waiting...');
      await this.waitForAvailableSlot();
    }

    const contextId = this.generateContextId();
    
    try {
      this.logger.info(`Launching browser with fingerprint ${fingerprint.id}`, {
        contextId,
        proxy: this.maskProxyUrl(proxy.url),
        type: fingerprint.type,
      });

      // Proxy URL parse
      const proxyUrl = new URL(proxy.url);
      
      // Browser launch options - Patchright stealth args
      const launchOptions = {
        headless: this.config.headless,
        proxy: {
          server: `${proxyUrl.protocol}//${proxyUrl.hostname}:${proxyUrl.port}`,
          username: proxyUrl.username || undefined,
          password: proxyUrl.password || undefined,
        },
        args: [
          '--disable-blink-features=AutomationControlled',
          '--disable-features=IsolateOrigins,site-per-process',
          '--disable-site-isolation-trials',
          '--disable-web-security',
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
          '--window-size=' + `${fingerprint.viewport.width},${fingerprint.viewport.height}`,
          // Patchright stealth args
          '--disable-blink-features=AutomationControlled',
          '--disable-features=IsolateOrigins,site-per-process',
          '--disable-site-isolation-trials',
          '--disable-features=BlockInsecurePrivateNetworkRequests',
          '--disable-features=InterestCohort',
          '--disable-features=SharedArrayBuffer',
          '--disable-features=WebOTP',
          '--disable-features=ConversionMeasurement',
          '--disable-features=AttributionReportingCrossAppWeb',
        ],
      };

      // Browser oluştur (Patchright)
      const browser = await chromium.launch(launchOptions);
      
      // Context oluştur
      const context = await browser.newContext({
        viewport: {
          width: fingerprint.viewport.width,
          height: fingerprint.viewport.height,
        },
        userAgent: fingerprint.userAgent,
        locale: fingerprint.language,
        timezoneId: fingerprint.timezone,
        deviceScaleFactor: fingerprint.pixelRatio,
        isMobile: fingerprint.type === 'mobile',
        hasTouch: fingerprint.touchSupport,
        colorScheme: 'light',
        extraHTTPHeaders: {
          'Accept-Language': fingerprint.languages.join(','),
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Encoding': 'gzip, deflate, br',
          'DNT': '1',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
          'Sec-CH-UA': this.generateSecCHUA(fingerprint),
          'Sec-CH-UA-Mobile': fingerprint.type === 'mobile' ? '?1' : '?0',
          'Sec-CH-UA-Platform': `"${fingerprint.platform}"`,
        },
      });

      // CDP Session oluştur (derin stealth için)
      const page = await context.newPage();
      const cdpSession = await page.context().newCDPSession(page);
      
      // CDP üzerinden stealth uygula
      await this.applyCDPStealth(cdpSession, fingerprint);
      
      // Resource interceptor kur
      await this.setupResourceInterceptor(context, this.config.resourceInterceptor);
      
      // Lifecycle manager kur
      await this.setupLifecycleManager(context, this.config.lifecycle);

      // Stealth scripts uygula
      await this.applyStealthScripts(context, fingerprint);

      // Cookie yükle
      if (cookies && cookies.length > 0) {
        await context.addCookies(cookies);
      } else if (this.cookieCache.has(fingerprint.id)) {
        await context.addCookies(this.cookieCache.get(fingerprint.id)!);
      }

      // Page'i kapat (sadece CDP için açmıştık)
      await page.close();

      // Browser instance kaydet
      const instance: BrowserInstance = {
        context,
        browser,
        fingerprint,
        proxy,
        createdAt: new Date(),
        lastUsed: new Date(),
        pageCount: 0,
        cdpSession,
      };

      this.activeBrowsers.set(contextId, instance);

      this.logger.info(`Browser launched successfully`, {
        contextId,
        activeBrowsers: this.activeBrowsers.size,
      });

      return context;

    } catch (error) {
      this.logger.error(`Failed to launch browser`, error as Error, {
        contextId,
        fingerprint: fingerprint.id,
        proxy: proxy.url,
      });
      throw error;
    }
  }

  /**
   * CDP üzerinden stealth uygula
   */
  private async applyCDPStealth(cdpSession: CDPSession, fingerprint: FingerprintData): Promise<void> {
    try {
      // WebRTC engelle (IP leak'i önle)
      if (this.config.resourceInterceptor.blockWebRTC) {
        await cdpSession.send('WebRTC.disable');
      }

      // Runtime.enable
      await cdpSession.send('Runtime.enable');

      // Console.log'ları yakala
      await cdpSession.send('Console.enable');

      // Network conditions (throttling simülasyonu)
      await cdpSession.send('Network.emulateNetworkConditions', {
        offline: false,
        downloadThroughput: 1.5 * 1024 * 1024, // 1.5 Mbps
        uploadThroughput: 750 * 1024, // 750 Kbps
        latency: 50, // 50ms
      });

      // Device metrics (mobile için)
      if (fingerprint.type === 'mobile') {
        await cdpSession.send('Emulation.setDeviceMetricsOverride', {
          width: fingerprint.viewport.width,
          height: fingerprint.viewport.height,
          deviceScaleFactor: fingerprint.pixelRatio,
          mobile: true,
        });
      }

      // Font families (gerçekçi font listesi)
      await cdpSession.send('CSS.setFonts', {
        fontFamilies: this.generateFontFamilies(fingerprint),
      });

      this.logger.debug('CDP stealth applied');
    } catch (error) {
      this.logger.warn('CDP stealth failed', { error: String(error) });
    }
  }

  /**
   * Resource Interceptor kur
   */
  private async setupResourceInterceptor(
    context: BrowserContext,
    config: Partial<ResourceInterceptorConfig>
  ): Promise<void> {
    await context.route('**/*', async (route: Route, request: Request) => {
      const resourceType = request.resourceType();
      const url = request.url();

      // WebRTC engelle
      if (config.blockWebRTC && url.includes('webrtc')) {
        await route.abort();
        return;
      }

      // Gereksiz kaynakları engelle
      if (config.blockImages && resourceType === 'image') {
        await route.abort();
        return;
      }

      if (config.blockFonts && resourceType === 'font') {
        await route.abort();
        return;
      }

      if (config.blockMedia && ['media', 'video', 'audio'].includes(resourceType)) {
        await route.abort();
        return;
      }

      if (config.blockCSS && resourceType === 'stylesheet') {
        await route.abort();
        return;
      }

      // Analytics/tracking engelle
      if (url.includes('google-analytics') || 
          url.includes('googletagmanager') ||
          url.includes('facebook.com/tr') ||
          url.includes('analytics')) {
        await route.abort();
        return;
      }

      await route.continue();
    });

    this.logger.debug('Resource interceptor configured');
  }

  /**
   * Lifecycle Manager kur
   */
  private async setupLifecycleManager(
    context: BrowserContext,
    config: Partial<LifecycleConfig>
  ): Promise<void> {
    // Crash handling
    context.on('crashed', async (event) => {
      this.logger.error('Browser crashed', null, { event });
      if (config.crashRecovery) {
        await this.handleCrash(context);
      }
    });

    // Dialog handling
    if (config.dialogHandling) {
      context.on('dialog', async (dialog) => {
        this.logger.debug(`Dialog appeared: ${dialog.type()}`);
        await dialog.dismiss();
      });
    }

    // Page error handling
    context.on('pageerror', (error) => {
      this.logger.warn('Page error', { error: error.message });
    });

    // Request failed handling
    context.on('requestfailed', (request) => {
      this.logger.debug(`Request failed: ${request.url()}`);
    });

    this.logger.debug('Lifecycle manager configured');
  }

  /**
   * Crash recovery handler
   */
  private async handleCrash(context: BrowserContext): Promise<void> {
    const contextId = this.findContextId(context);
    if (!contextId) return;

    const attempts = this.recoveryAttempts.get(contextId) || 0;
    
    if (attempts >= this.config.lifecycle.maxRecoveryAttempts) {
      this.logger.error('Max recovery attempts reached, closing browser');
      await this.closeBrowser(context, false);
      return;
    }

    this.recoveryAttempts.set(contextId, attempts + 1);
    this.logger.warn(`Attempting crash recovery (${attempts + 1}/${this.config.lifecycle.maxRecoveryAttempts})`);

    try {
      // Yeni page aç
      const page = await context.newPage();
      await page.goto('about:blank');
      this.logger.info('Crash recovery successful');
    } catch (error) {
      this.logger.error('Crash recovery failed', error as Error);
      await this.closeBrowser(context, false);
    }
  }

  /**
   * Stealth scripts uygula (runtime)
   */
  private async applyStealthScripts(
    context: BrowserContext,
    fingerprint: FingerprintData
  ): Promise<void> {
    // Runtime fingerprint randomizer
    const randomCanvasNoise = () => Math.random() * 0.02 - 0.01;
    const randomFontOffset = () => Math.floor(Math.random() * 3);

    await context.addInitScript(`
      // Webdriver kaldır
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
        configurable: true,
      });

      // Chrome runtime
      Object.defineProperty(window, 'chrome', {
        get: () => ({
          runtime: {
            OnInstalledReason: { CHROME_UPDATE: 'chrome_update' },
            OnRestartRequiredReason: { APP_UPDATE: 'app_update' },
            PlatformArch: { X86_64: 'x86-64' },
            PlatformNaclArch: { X86_64: 'x86-64' },
            PlatformOs: { ${fingerprint.platform.toUpperCase()}: '${fingerprint.platform.toLowerCase()}' },
            RequestUpdateCheckStatus: { NO_UPDATE: 'no_update' },
          },
          loadTimes: () => ({
            commitLoadTime: performance.now() / 1000,
            connectionInfo: 'h2',
            finishDocumentLoadTime: performance.now() / 1000,
            finishLoadTime: performance.now() / 1000,
            firstPaintAfterLoadTime: 0,
            firstPaintTime: performance.now() / 1000,
            navigationType: 'Other',
            npnNegotiatedProtocol: 'h2',
            requestTime: performance.now() / 1000,
            startLoadTime: performance.now() / 1000,
            wasAlternateProtocolAvailable: false,
            wasFetchedViaSpdy: true,
            wasNpnNegotiated: true,
          }),
          csi: () => ({
            onloadT: Date.now(),
            pageT: Date.now() - performance.timing.navigationStart,
            startE: performance.timing.navigationStart,
          }),
          app: {},
        }),
        configurable: true,
      });

      // Plugins (gerçekçi liste)
      const generatePlugins = () => {
        const plugins = [
          {
            name: 'Chrome PDF Plugin',
            filename: 'internal-pdf-viewer',
            description: 'Portable Document Format',
            version: 'undefined',
            length: 2,
            item: (index) => plugins[0],
          },
          {
            name: 'Widevine Content Decryption Module',
            filename: 'widevinecdmadapter.dll',
            description: 'Widevine Content Decryption Module',
            version: '4.10.2710.0',
          },
          {
            name: 'Native Client',
            filename: 'internal-nacl-plugin',
            description: 'Native Client module',
          },
        ];
        plugins.length = 3;
        plugins.item = (index) => plugins[index];
        plugins.namedItem = (name) => plugins.find(p => p.name === name);
        return plugins;
      };

      Object.defineProperty(navigator, 'plugins', {
        get: generatePlugins,
        configurable: true,
      });

      // MimeTypes
      Object.defineProperty(navigator, 'mimeTypes', {
        get: () => [
          { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format', enabledPlugin: navigator.plugins[0] },
          { type: 'application/x-google-chrome-pdf', suffixes: 'pdf', description: 'Portable Document Format', enabledPlugin: navigator.plugins[0] },
        ],
        configurable: true,
      });

      // Canvas noise (fingerprint randomization)
      const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData;
      CanvasRenderingContext2D.prototype.getImageData = function(x, y, w, h) {
        const imageData = originalGetImageData.call(this, x, y, w, h);
        const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
          data[i] = Math.max(0, Math.min(255, data[i] + ${randomCanvasNoise}));
          data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + ${randomCanvasNoise}));
          data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + ${randomCanvasNoise}));
        }
        return imageData;
      };

      // WebGL spoofing
      const getParameter = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function(parameter) {
        if (parameter === 37445) return '${fingerprint.webGL?.vendor || 'Google Inc.'}';
        if (parameter === 37446) return '${fingerprint.webGL?.renderer || 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1050 Ti Direct3D11 vs_5_0 ps_5_0, D3D11)'}';
        return getParameter(parameter);
      };

      // Notification
      Object.defineProperty(Notification, 'permission', {
        get: () => 'default',
        configurable: true,
      });

      // Permissions
      const originalQuery = navigator.permissions.query;
      navigator.permissions.query = (parameters) => {
        if (parameters.name === 'notifications') {
          return Promise.resolve({ state: 'default', onchange: null });
        }
        return originalQuery(parameters);
      };

      // Device memory
      Object.defineProperty(navigator, 'deviceMemory', {
        get: () => ${fingerprint.deviceMemory},
        configurable: true,
      });

      // Hardware concurrency
      Object.defineProperty(navigator, 'hardwareConcurrency', {
        get: () => ${fingerprint.hardwareConcurrency},
        configurable: true,
      });

      // Platform
      Object.defineProperty(navigator, 'platform', {
        get: () => '${fingerprint.platform}',
        configurable: true,
      });

      // Max touch points
      Object.defineProperty(navigator, 'maxTouchPoints', {
        get: () => ${fingerprint.maxTouchPoints},
        configurable: true,
      });

      // PDF viewer
      Object.defineProperty(navigator, 'pdfViewerEnabled', {
        get: () => true,
        configurable: true,
      });

      // Connection API
      Object.defineProperty(navigator, 'connection', {
        get: () => ({
          effectiveType: '${fingerprint.network.effectiveType}',
          downlink: ${fingerprint.network.downlink},
          rtt: ${fingerprint.network.rtt},
          saveData: false,
          type: '${fingerprint.network.effectiveType}',
        }),
        configurable: true,
      });

      // Battery API (mobile)
      ${fingerprint.type === 'mobile' ? `
      Object.defineProperty(navigator, 'getBattery', {
        get: () => () => Promise.resolve({
          charging: true,
          chargingTime: 0,
          dischargingTime: Infinity,
          level: 0.85,
          addEventListener: () => {},
          removeEventListener: () => {},
        }),
        configurable: true,
      });
      ` : ''}

      // Screen
      Object.defineProperty(screen, 'width', {
        get: () => ${fingerprint.screenResolution?.width || fingerprint.viewport.width},
        configurable: true,
      });
      Object.defineProperty(screen, 'height', {
        get: () => ${fingerprint.screenResolution?.height || fingerprint.viewport.height},
        configurable: true,
      });
      Object.defineProperty(screen, 'availWidth', {
        get: () => ${fingerprint.screenResolution?.width || fingerprint.viewport.width},
        configurable: true,
      });
      Object.defineProperty(screen, 'availHeight', {
        get: () => ${(fingerprint.screenResolution?.height || fingerprint.viewport.height) - 40},
        configurable: true,
      });
      Object.defineProperty(screen, 'colorDepth', {
        get: () => ${fingerprint.colorDepth},
        configurable: true,
      });
      Object.defineProperty(screen, 'pixelDepth', {
        get: () => ${fingerprint.colorDepth},
        configurable: true,
      });

      // Outer window dimensions (gerçekçi)
      Object.defineProperty(window, 'outerWidth', {
        get: () => ${fingerprint.viewport.width} + ${Math.floor(Math.random() * 20 + 10)},
        configurable: true,
      });
      Object.defineProperty(window, 'outerHeight', {
        get: () => ${fingerprint.viewport.height} + ${Math.floor(Math.random() * 100 + 80)},
        configurable: true,
      });

      // Webdriver property tamamen kaldır
      delete navigator.webdriver;

      // Automation flags
      Object.defineProperty(navigator, 'automationControlled', {
        get: () => false,
        configurable: true,
      });

      // PluginArray ve MimeTypeArray constructor'larını gizle
      Object.setPrototypeOf(navigator.plugins, PluginArray.prototype);
      Object.setPrototypeOf(navigator.mimeTypes, MimeTypeArray.prototype);
    `);

    this.logger.debug(`Stealth scripts applied for ${fingerprint.id}`);
  }

  /**
   * Sec-CH-UA header'ı üret
   */
  private generateSecCHUA(fingerprint: FingerprintData): string {
    const brands = [
      '"Not_A Brand";v="99"',
      '"Chromium";v="120"',
      '"Google Chrome";v="120"',
    ];
    return brands.join(', ');
  }

  /**
   * Font families üret
   */
  private generateFontFamilies(fingerprint: FingerprintData): string[] {
    const baseFonts = ['Arial', 'Helvetica', 'Times New Roman', 'Courier New', 'Georgia'];
    const systemFonts = fingerprint.type === 'mobile' 
      ? ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI']
      : ['Segoe UI', 'Microsoft YaHei', 'Tahoma'];
    return [...baseFonts, ...systemFonts];
  }

  /**
   * Yeni sayfa oluştur
   */
  public async createPage(context: BrowserContext): Promise<Page> {
    const instance = this.findInstanceByContext(context);
    
    try {
      const page = await context.newPage();
      
      // Timeout ayarla
      page.setDefaultTimeout(this.config.defaultTimeout);
      page.setDefaultNavigationTimeout(this.config.lifecycle.navigationTimeout);

      // Bot detection test
      const isBotDetected = await this.checkBotDetection(page);
      if (isBotDetected) {
        this.logger.warn('Bot detection triggered, applying additional stealth...');
        await this.applyEmergencyStealth(page);
      }

      // Instance güncelle
      if (instance) {
        instance.pageCount++;
        instance.lastUsed = new Date();
      }

      this.logger.debug(`New page created`, {
        contextId: instance ? this.findContextId(context) : 'unknown',
      });

      return page;

    } catch (error) {
      this.logger.error(`Failed to create page`, error as Error);
      throw error;
    }
  }

  /**
   * Bot detection kontrolü
   */
  private async checkBotDetection(page: Page): Promise<boolean> {
    try {
      const botIndicators = await page.evaluate(() => {
        const indicators: string[] = [];
        
        // Webdriver check
        if ((navigator as any).webdriver) indicators.push('webdriver');
        
        // Chrome check
        if (!(window as any).chrome) indicators.push('no_chrome');
        
        // Plugins check
        if (navigator.plugins.length === 0) indicators.push('no_plugins');
        
        // User agent check
        if (navigator.userAgent.includes('HeadlessChrome')) indicators.push('headless_ua');
        
        // Automation check
        if ((navigator as any).automationControlled) indicators.push('automation');
        
        // Notification permission
        if (Notification.permission !== 'default') indicators.push('notification_permission');
        
        return indicators;
      });

      if (botIndicators.length > 0) {
        this.logger.warn('Bot indicators detected', { indicators: botIndicators });
      }

      return botIndicators.length > 0;

    } catch (error) {
      return false;
    }
  }

  /**
   * Acil stealth uygula
   */
  private async applyEmergencyStealth(page: Page): Promise<void> {
    await page.evaluate(() => {
      // Ekstra evasion
      Object.defineProperty(navigator, 'plugins', {
        get: () => [
          { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
          { name: 'Widevine Content Decryption Module', filename: 'widevinecdmadapter.dll' },
          { name: 'Native Client', filename: 'internal-nacl-plugin' },
        ],
      });

      Object.defineProperty(Notification, 'permission', {
        get: () => 'default',
      });
    });
  }

  /**
   * Browser context'i kapat
   */
  public async closeBrowser(context: BrowserContext, saveCookies: boolean = true): Promise<void> {
    const contextId = this.findContextId(context);
    const instance = contextId ? this.activeBrowsers.get(contextId) : undefined;

    try {
      // Cookie'leri kaydet
      if (saveCookies && instance) {
        const cookies = await context.cookies();
        this.cookieCache.set(instance.fingerprint.id, cookies);
        await this.saveCookies(instance.fingerprint.id, cookies);
      }

      // CDP session kapat
      if (instance?.cdpSession) {
        await instance.cdpSession.detach().catch(() => {});
      }

      // Context'i kapat
      await context.close();

      // Browser'ı kapat
      if (instance?.browser) {
        await instance.browser.close();
      }

      // Instance'ı temizle
      if (contextId) {
        this.activeBrowsers.delete(contextId);
        this.recoveryAttempts.delete(contextId);
      }

      this.logger.info(`Browser closed`, {
        contextId,
        activeBrowsers: this.activeBrowsers.size,
      });

    } catch (error) {
      this.logger.error(`Error closing browser`, error as Error);
      throw error;
    }
  }

  /**
   * Tüm browser'ları kapat
   */
  public async closeAll(): Promise<void> {
    this.logger.info(`Closing all browsers (${this.activeBrowsers.size} active)...`);

    const promises: Promise<void>[] = [];

    for (const [contextId, instance] of this.activeBrowsers) {
      promises.push(
        this.closeBrowser(instance.context, true).catch(error => {
          this.logger.error(`Error closing browser ${contextId}`, error as Error);
        })
      );
    }

    await Promise.all(promises);

    this.logger.info('All browsers closed');
  }

  /**
   * Cookie'leri kaydet
   */
  private async saveCookies(fingerprintId: string, cookies: any[]): Promise<void> {
    try {
      const filePath = join(this.config.cookieDir, `${fingerprintId}.json`);
      writeFileSync(filePath, JSON.stringify(cookies, null, 2));
    } catch (error) {
      this.logger.error(`Failed to save cookies for ${fingerprintId}`, error as Error);
    }
  }

  /**
   * Cookie'leri yükle
   */
  public loadCookies(fingerprintId: string): any[] {
    try {
      const filePath = join(this.config.cookieDir, `${fingerprintId}.json`);
      if (existsSync(filePath)) {
        const data = readFileSync(filePath, 'utf-8');
        return JSON.parse(data);
      }
    } catch (error) {
      this.logger.error(`Failed to load cookies for ${fingerprintId}`, error as Error);
    }
    return [];
  }

  /**
   * Slot bekle
   */
  private async waitForAvailableSlot(): Promise<void> {
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (this.activeBrowsers.size < this.config.maxConcurrentBrowsers) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 1000);
    });
  }

  /**
   * Context ID bul
   */
  private findContextId(context: BrowserContext): string | undefined {
    for (const [id, instance] of this.activeBrowsers) {
      if (instance.context === context) {
        return id;
      }
    }
    return undefined;
  }

  /**
   * Instance bul
   */
  private findInstanceByContext(context: BrowserContext): BrowserInstance | undefined {
    for (const instance of this.activeBrowsers.values()) {
      if (instance.context === context) {
        return instance;
      }
    }
    return undefined;
  }

  /**
   * ID üret
   */
  private generateContextId(): string {
    return `ctx-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Proxy URL maskele
   */
  private maskProxyUrl(url: string): string {
    try {
      const parsed = new URL(url);
      const auth = parsed.username ? `${parsed.username}:****@` : '';
      return `${parsed.protocol}//${auth}${parsed.hostname}:${parsed.port}`;
    } catch {
      return url.substring(0, 20) + '...';
    }
  }

  /**
   * Aktif browser sayısı
   */
  public getActiveBrowserCount(): number {
    return this.activeBrowsers.size;
  }

  /**
   * İstatistikler
   */
  public getStats(): {
    active: number;
    maxAllowed: number;
    totalPages: number;
    oldestBrowser: Date | null;
  } {
    let totalPages = 0;
    let oldestDate: Date | null = null;

    for (const instance of this.activeBrowsers.values()) {
      totalPages += instance.pageCount;
      if (!oldestDate || instance.createdAt < oldestDate) {
        oldestDate = instance.createdAt;
      }
    }

    return {
      active: this.activeBrowsers.size,
      maxAllowed: this.config.maxConcurrentBrowsers,
      totalPages,
      oldestBrowser: oldestDate,
    };
  }

  /**
   * Screenshot al
   */
  public async takeScreenshot(page: Page, name: string): Promise<void> {
    if (!this.config.debugMode) return;

    try {
      const fileName = `${Date.now()}-${name}.png`;
      const filePath = join(this.config.userDataDir, 'screenshots', fileName);
      
      if (!existsSync(join(this.config.userDataDir, 'screenshots'))) {
        mkdirSync(join(this.config.userDataDir, 'screenshots'), { recursive: true });
      }

      await page.screenshot({ path: filePath, fullPage: true });
      this.logger.debug(`Screenshot saved: ${fileName}`);
    } catch (error) {
      this.logger.error('Screenshot failed', error as Error);
    }
  }
}

// ==========================================
// FACTORY PATTERN
// ==========================================

const instances: Map<string, BrowserManager> = new Map();

export function createBrowserManager(
  name: string = 'default',
  config?: Partial<BrowserManagerConfig>,
  logger?: Logger
): BrowserManager {
  instances.get(name)?.closeAll();
  const manager = new BrowserManager(config, logger);
  instances.set(name, manager);
  return manager;
}

export function getNamedBrowserManager(name: string = 'default'): BrowserManager | undefined {
  return instances.get(name);
}

export function closeNamedBrowserManager(name: string = 'default'): void {
  instances.get(name)?.closeAll();
  instances.delete(name);
}

export function closeAllBrowserManagers(): void {
  for (const manager of instances.values()) {
    manager.closeAll();
  }
  instances.clear();
}

// Singleton (geriye uyumluluk)
let singletonInstance: BrowserManager | null = null;

export function getBrowserManager(config?: Partial<BrowserManagerConfig>, logger?: Logger): BrowserManager {
  if (!singletonInstance) {
    singletonInstance = new BrowserManager(config, logger);
  }
  return singletonInstance;
}

export function resetBrowserManager(): Promise<void> {
  if (singletonInstance) {
    return singletonInstance.closeAll().then(() => {
      singletonInstance = null;
    });
  }
  return Promise.resolve();
}