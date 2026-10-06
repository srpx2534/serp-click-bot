/**
 * Config Loader Modülü
 * Şu an için sabit değerler kullanıyor
 * İleride veritabanı entegrasyonu eklenecek
 */

import { Logger, getLogger } from './logger';
import { 
  AppConfig,
  UrlKeywordConfig,
  ProxyConfig,
  ProxyItem,
  BrowserConfig,
  BehaviorConfig,
  LoggerConfig
} from '../types';

/**
 * SABİT YAPILANDIRMA DEĞERLERİ
 */

// Uygulama çalışma durumu
const APP_START: boolean = true;

// Tarayıcı ayarları
const DEFAULT_BROWSER: BrowserConfig = {
  headless: false,
  viewport: { width: 1920, height: 1080 },
  locale: 'tr-TR',
  timezone: 'Europe/Istanbul'
};

// Davranış ayarları
const DEFAULT_BEHAVIOR: BehaviorConfig = {
  typingSpeed: { min: 50, max: 150 },
  mouseSpeed: { min: 500, max: 1500 },
  dwellTime: { min: 15000, max: 120000 },
  scrollBehavior: 'natural'
};

// Loglama ayarları
const DEFAULT_LOGGING: LoggerConfig = {
  level: 2,
  logDir: './data/logs',
  consoleOutput: true,
  fileOutput: true,
  maxFileSize: 10,
  maxFiles: 10,
  includeTimestamp: true,
  includeContext: true
};

// URL ve Anahtar Kelimeler (SABİT)
const DEFAULT_URL_KEYWORDS: UrlKeywordConfig[] = [
  {
    keyword: 'web tasarım istanbul',
    targetUrl: 'https://ornekwebsitem.com',
    dailyClicks: 50,
    maxPage: 10,
    startPage: 1,
    isMobil: 0
  },
  {
    keyword: 'seo danışmanlığı',
    targetUrl: 'https://ornekwebsitem.com/hizmetler/seo',
    dailyClicks: 30,
    maxPage: 5,
    startPage: 1,
    isMobil:0
  },
  {
    keyword: 'dijital pazarlama',
    targetUrl: 'https://ornekwebsitem.com/blog',
    dailyClicks: 20,
    maxPage: 15,
    startPage: 6,
    isMobil:0
  }
];

// Proxy ayarları (SABİT)
const DEFAULT_PROXY: ProxyConfig = {
  enabled: true,
  rotationInterval: 300,
  list: [
    {
      name: 'iproyal',
      url: 'http://user:pass@iproyal-proxy.com:8080'
    },
    {
      name: 'smartproxy',
      url: 'http://user:pass@smartproxy.com:8080'
    }
  ]
};

// Ana config (SABİT)
const DEFAULT_APP_CONFIG: AppConfig = {
  appStart: APP_START,
  browser: DEFAULT_BROWSER,
  behavior: DEFAULT_BEHAVIOR,
  logging: DEFAULT_LOGGING,
  proxy: DEFAULT_PROXY
};

/**
 * Config Loader sınıfı
 * Bellekte (in-memory) config yönetimi yapar
 */
export class ConfigLoader {
  private logger: Logger;
  private configs: Map<string, any> = new Map();
  private isLoaded: boolean = false;

  /**
   * ConfigLoader constructor
   * @param logger - Logger instance (opsiyonel)
   */
  constructor(logger?: Logger) {
    this.logger = logger || getLogger();
    this.logger.info('ConfigLoader başlatıldı (sabit değerler modu)');
  }

  /**
   * Uygulama çalışma durumunu kontrol et
   * @returns true ise çalış, false ise bekle
   */
  checkAppStart(): boolean {
    const appStart = this.get('settings', 'appStart');
    
    if (!appStart) {
      this.logger.warn('AppStart = false: Uygulama "Start için bekleniyor..." modunda');
      return false;
    }
    
    return true;
  }

  /**
   * Tüm sabit config değerlerini belleğe yükler
   */
  loadAll(): void {
    if (this.isLoaded) {
      this.logger.warn('Config zaten yüklenmiş, tekrar yükleme yapılmıyor');
      return;
    }

    if (!DEFAULT_APP_CONFIG.appStart) {
      this.logger.warn('UYARI: AppStart = false - Uygulama bekliyor...');
    }

    // DERİN KOPYALAMA (deep copy) - JSON parse/stringify ile
    this.configs.set('settings', JSON.parse(JSON.stringify(DEFAULT_APP_CONFIG)));
    this.configs.set('url-keywords', JSON.parse(JSON.stringify(DEFAULT_URL_KEYWORDS)));
    this.configs.set('proxy', JSON.parse(JSON.stringify(DEFAULT_PROXY)));

    this.isLoaded = true;
    
    this.logger.info('Sabit config değerleri belleğe yüklendi', {
      configs: Array.from(this.configs.keys()),
      appStart: DEFAULT_APP_CONFIG.appStart,
      urlKeywordsCount: DEFAULT_URL_KEYWORDS.length,
      proxyCount: DEFAULT_PROXY.list.length
    });
  }

  /**
   * Belirli bir config değerini alır
   */
  get(configName: string, key?: string): any {
    if (!this.isLoaded) {
      this.loadAll();
    }

    const config = this.configs.get(configName);
    
    if (!config) {
      this.logger.error(`Config bulunamadı: ${configName}`);
      throw new Error(`Config bulunamadı: ${configName}`);
    }
    
    if (key) {
      const keys = key.split('.');
      let value = config;
      
      for (const k of keys) {
        if (value === null || value === undefined || typeof value !== 'object') {
          return undefined;
        }
        value = value[k];
      }
      
      if (Array.isArray(value)) return [...value];
      if (typeof value === 'object' && value !== null) return { ...value };
      return value;
    }
    
    if (Array.isArray(config)) return [...config];
    return { ...config };
  }

  /**
   * Config değerini bellekte günceller
   */
  set(configName: string, key: string, value: any): void {
    if (!this.isLoaded) {
      this.loadAll();
    }

    const config = this.configs.get(configName);
    
    if (!config) {
      throw new Error(`Config bulunamadı: ${configName}`);
    }
    
    const keys = key.split('.');
    let current = config;
    
    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i];
      if (!(k in current) || typeof current[k] !== 'object') {
        current[k] = {};
      }
      current = current[k];
    }
    
    const lastKey = keys[keys.length - 1];
    current[lastKey] = value;
    
    this.logger.debug(`Config güncellendi: ${configName}.${key}`, { value });
  }

  /**
   * URL-Keywords listesini al
   */
  getUrlKeywords(): UrlKeywordConfig[] {
    return this.get('url-keywords');
  }

  /**
   * Proxy listesini al
   */
  getProxyList(): ProxyItem[] {
    const proxy = this.get('proxy');
    return proxy.list || [];
  }

  /**
   * Proxy aktif mi kontrol et
   */
  isProxyEnabled(): boolean {
    return this.get('proxy', 'enabled') === true;
  }

  /**
   * Tüm config'i yeniden yükle
   */
  async reload(): Promise<void> {
    this.logger.info('Config yeniden yükleniyor...');
    this.configs.clear();
    this.isLoaded = false;
    this.loadAll();
    this.logger.info('Config yeniden yüklendi');
  }

  /**
   * Veritabanı bağlantısı (hazırlık)
   */
  async connectDatabase(connectionString: string): Promise<void> {
    this.logger.info('Veritabanı hazırlığı', {
      connectionString: connectionString.replace(/:.*@/, ':***@')
    });
    throw new Error('Veritabanı entegrasyonu henüz implemente edilmedi');
  }

  /**
   * Yüklenmiş config adlarını döndür
   */
  getLoadedConfigs(): string[] {
    return Array.from(this.configs.keys());
  }

  /**
   * Config yüklendi mi?
   */
  isConfigLoaded(): boolean {
    return this.isLoaded;
  }

  /**
   * Belleği temizle
   */
  clear(): void {
    this.configs.clear();
    this.isLoaded = false;
    this.logger.info('Config belleği temizlendi');
  }
}

// Singleton
let globalConfigLoader: ConfigLoader | null = null;

export function getConfigLoader(logger?: Logger): ConfigLoader {
  if (!globalConfigLoader) {
    globalConfigLoader = new ConfigLoader(logger);
  }
  return globalConfigLoader;
}

export function resetConfigLoader(): void {
  if (globalConfigLoader) {
    globalConfigLoader.clear();
    globalConfigLoader = null;
  }
}