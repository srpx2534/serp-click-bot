/**
 * BrowserManager Modülü
 * Playwright browser instance yönetimi, stealth entegrasyonu ve fingerprint uygulama
 * Kritik modül - Google bypass için hayati önemde
 */

import { chromium, Browser, BrowserContext, Page, LaunchOptions } from 'playwright';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { FingerprintData } from '../types';
import { ProxyStatus } from './proxy-manager';
import { Logger, getLogger } from '../utils/logger';

// Browser instance bilgisi
interface BrowserInstance {
  context: BrowserContext;
  fingerprint: FingerprintData;
  proxy: ProxyStatus;
  createdAt: Date;
  lastUsed: Date;
  pageCount: number;
}

// BrowserManager yapılandırması
export interface BrowserManagerConfig {
  maxConcurrentBrowsers: number;  // Maksimum eşzamanlı browser
  defaultTimeout: number;           // Sayfa yükleme timeout (ms)
  headless: boolean;              // Headless mod
  debugMode: boolean;             // Debug screenshot'ları al
  cookieDir: string;                // Cookie dosyaları dizini
  userDataDir: string;             // Browser user data dizini
}

// Varsayılan yapılandırma
const defaultConfig: BrowserManagerConfig = {
  maxConcurrentBrowsers: 5,
  defaultTimeout: 30000,
  headless: true,
  debugMode: false,
  cookieDir: './data/cookies',
  userDataDir: './data/browser-data',
};

/**
 * BrowserManager sınıfı
 * Playwright browser yönetimi ve stealth entegrasyonu
 */
export class BrowserManager {
  private config: BrowserManagerConfig;
  private logger: Logger;
  private activeBrowsers: Map<string, BrowserInstance> = new Map();
  private browserPool: Browser[] = [];
  private cookieCache: Map<string, any[]> = new Map();

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
   * Fingerprint ve proxy entegrasyonu yapar
   */
  public async launchBrowser(
    fingerprint: FingerprintData,
    proxy: ProxyStatus,
    cookies?: any[]
  ): Promise<BrowserContext> {
    // Maksimum browser kontrolü
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
      const proxyConfig = {
        server: `${proxyUrl.protocol}//${proxyUrl.hostname}:${proxyUrl.port}`,
        username: proxyUrl.username || undefined,
        password: proxyUrl.password || undefined,
      };

      // Browser launch options
      const launchOptions: LaunchOptions = {
        headless: this.config.headless,
        proxy: proxyConfig,
        args: [
          '--disable-blink-features=AutomationControlled',
          '--disable-features=IsolateOrigins,site-per-process',
          '--disable-site-isolation-trials',
          '--disable-web-security',
          '--disable-features=BlockInsecurePrivateNetworkRequests',
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
          '--window-size=' + `${fingerprint.viewport.width},${fingerprint.viewport.height}`,
        ],
      };

      // Browser oluştur
      const browser = await chromium.launch(launchOptions);
      
      // Context oluştur (fingerprint uygula)
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
        },
      });

      // Stealth script injection
      await this.applyStealthScripts(context, fingerprint);

      // Cookie yükle
      if (cookies && cookies.length > 0) {
        await context.addCookies(cookies);
      } else if (this.cookieCache.has(fingerprint.id)) {
        await context.addCookies(this.cookieCache.get(fingerprint.id)!);
      }

      // Browser instance kaydet
      const instance: BrowserInstance = {
        context,
        fingerprint,
        proxy,
        createdAt: new Date(),
        lastUsed: new Date(),
        pageCount: 0,
      };

      this.activeBrowsers.set(contextId, instance);
      this.browserPool.push(browser);

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
   * Stealth script'leri uygular
   * Bot detection bypass için kritik
   */
  private async applyStealthScripts(
    context: BrowserContext,
    fingerprint: FingerprintData
  ): Promise<void> {
    
    // Navigator property override
    await context.addInitScript(`
      // Webdriver flag kaldır
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });

      // Chrome runtime mock
      Object.defineProperty(window, 'chrome', {
        get: () => ({
          runtime: {},
          loadTimes: () => {},
          csi: () => {},
          app: {},
        }),
      });

      // Permissions API mock
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) => (
        parameters.name === 'notifications' 
          ? Promise.resolve({ state: Notification.permission, onchange: null })
          : originalQuery(parameters)
      );

      // Plugins mock
      Object.defineProperty(navigator, 'plugins', {
        get: () => ${JSON.stringify(fingerprint.plugins || [])},
      });

      // MimeTypes mock
      Object.defineProperty(navigator, 'mimeTypes', {
        get: () => ${JSON.stringify(fingerprint.mimeTypes || [])},
      });

      // Battery API mock (mobile için)
      if (${fingerprint.type === 'mobile'}) {
        Object.defineProperty(navigator, 'getBattery', {
          get: () => () => Promise.resolve(${JSON.stringify(fingerprint.battery)}),
        });
      }

      // Device memory
      Object.defineProperty(navigator, 'deviceMemory', {
        get: () => ${fingerprint.deviceMemory},
      });

      // Hardware concurrency
      Object.defineProperty(navigator, 'hardwareConcurrency', {
        get: () => ${fingerprint.hardwareConcurrency},
      });

      // Platform
      Object.defineProperty(navigator, 'platform', {
        get: () => '${fingerprint.platform}',
      });

      // Vendor
      Object.defineProperty(navigator, 'vendor', {
        get: () => '${fingerprint.vendor}',
      });

      // Max touch points
      Object.defineProperty(navigator, 'maxTouchPoints', {
        get: () => ${fingerprint.maxTouchPoints},
      });

      // PDF viewer
      Object.defineProperty(navigator, 'pdfViewerEnabled', {
        get: () => ${fingerprint.pdfViewerEnabled},
      });

      // WebGL vendor override
      const getParameter = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function(parameter) {
        if (parameter === 37445) {
          return '${fingerprint.webGL?.vendor || 'WebKit'}';
        }
        if (parameter === 37446) {
          return '${fingerprint.webGL?.renderer || 'WebKit WebGL'}';
        }
        return getParameter(parameter);
      };

      // Canvas fingerprint consistency
      const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
      HTMLCanvasElement.prototype.toDataURL = function(type) {
        if (type === 'image/png' && this.width === 220 && this.height === 30) {
          return '${fingerprint.canvas?.data || ''}';
        }
        return originalToDataURL.apply(this, arguments);
      };

      // Screen resolution consistency
      Object.defineProperty(screen, 'width', {
        get: () => ${fingerprint.screenResolution?.width || fingerprint.viewport.width},
      });
      Object.defineProperty(screen, 'height', {
        get: () => ${fingerprint.screenResolution?.height || fingerprint.viewport.height},
      });
      Object.defineProperty(screen, 'colorDepth', {
        get: () => ${fingerprint.colorDepth},
      });

      // Notification permission
      if (${fingerprint.type === 'mobile'}) {
        Object.defineProperty(Notification, 'permission', {
          get: () => 'default',
        });
      }

      // Connection API mock (mobile network)
      Object.defineProperty(navigator, 'connection', {
        get: () => ${JSON.stringify(fingerprint.connection)},
      });
    `);

    this.logger.debug(`Stealth scripts applied for ${fingerprint.id}`);
  }

  /**
   * Yeni sayfa oluşturur ve stealth kontrolü yapar
   */
  public async createPage(context: BrowserContext): Promise<Page> {
    const instance = this.findInstanceByContext(context);
    
    try {
      const page = await context.newPage();
      
      // Timeout ayarla
      page.setDefaultTimeout(this.config.defaultTimeout);
      page.setDefaultNavigationTimeout(this.config.defaultTimeout);

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
        if ((navigator as any).plugins.length === 0) indicators.push('no_plugins');
        
        // User agent check
        if ((navigator as any).userAgent.includes('HeadlessChrome')) indicators.push('headless_ua');
        
        return indicators;
      });

      return botIndicators.length > 0;

    } catch (error) {
      return false;
    }
  }

  /**
   * Acil stealth uygulama (bot detection sonrası)
   */
  private async applyEmergencyStealth(page: Page): Promise<void> {
    await page.evaluate(() => {
      // Additional evasion techniques
      Object.defineProperty(navigator as any, 'plugins', {
        get: () => [
          { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
          { name: 'Widevine Content Decryption Module', filename: 'widevinecdmadapter.dll' },
        ],
      });

      // Override permissions
      Object.defineProperty(Notification as any, 'permission', {
        get: () => 'default',
      });
    });
  }

  /**
   * Browser context'i kapatır
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

      // Context'i kapat
      await context.close();

      // Instance'ı temizle
      if (contextId) {
        this.activeBrowsers.delete(contextId);
      }

      // Browser pool temizliği
      this.browserPool = this.browserPool.filter(b => b.isConnected());

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
   * Tüm browser'ları kapatır
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

    // Browser pool temizle
    for (const browser of this.browserPool) {
      try {
        await browser.close();
      } catch (error) {
        // Ignore already closed browsers
      }
    }
    this.browserPool = [];

    this.logger.info('All browsers closed');
  }

  /**
   * Cookie'leri dosyaya kaydet
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
   * Cookie'leri dosyadan yükle
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
   * Mevcut slot için bekle
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
   * Context ID'si bul
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
   * Instance'ı context'den bul
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
   * Benzersiz context ID'si oluştur
   */
  private generateContextId(): string {
    return `ctx-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Proxy URL'sini maskele
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
   * Aktive browser'ların istatistikleri
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
   * Debug screenshot al
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

// Singleton instance
let instance: BrowserManager | null = null;

/**
 * BrowserManager singleton getter
 */
export function getBrowserManager(
  config?: Partial<BrowserManagerConfig>,
  logger?: Logger
): BrowserManager {
  if (!instance) {
    instance = new BrowserManager(config, logger);
  }
  return instance;
}

/**
 * Reset singleton instance (for testing)
 */
export function resetBrowserManager(): Promise<void> {
  if (instance) {
    return instance.closeAll().then(() => {
      instance = null;
    });
  }
  return Promise.resolve();
}