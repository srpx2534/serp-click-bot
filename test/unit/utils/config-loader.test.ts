/**
 * Config Loader Testleri (Sabit Değerler Modu)
 */

import { ConfigLoader, getConfigLoader, resetConfigLoader } from '../../../src/utils/config-loader';
import { Logger } from '../../../src/utils/logger';

describe('ConfigLoader', () => {
  let configLoader: ConfigLoader;
  let logger: Logger;

  beforeEach(() => {
    // Logger oluştur (konsola yazma)
    logger = new Logger({
      logDir: './test-logs',
      consoleOutput: false,
      fileOutput: false
    });

    // ConfigLoader oluştur
    configLoader = new ConfigLoader(logger);
  });

  afterEach(() => {
    resetConfigLoader();
  });

  describe('Temel Yükleme', () => {
    test('tüm configleri yüklemeli', () => {
      configLoader.loadAll();
      
      expect(configLoader.isConfigLoaded()).toBe(true);
      expect(configLoader.getLoadedConfigs()).toContain('settings');
      expect(configLoader.getLoadedConfigs()).toContain('url-keywords');
      expect(configLoader.getLoadedConfigs()).toContain('proxy');
    });

    test('lazy loading çalışmalı', () => {
      // loadAll çağrılmadan get çalışmalı
      const settings = configLoader.get('settings');
      
      expect(settings).toBeDefined();
      expect(configLoader.isConfigLoaded()).toBe(true);
    });
  });

  describe('AppStart Kontrolü', () => {
    test('appStart true ise çalışmalı', () => {
      const canStart = configLoader.checkAppStart();
      
      expect(canStart).toBe(true);
    });

    test('appStart false ise beklemeli', () => {
      // appStart'ı false yap
      configLoader.set('settings', 'appStart', false);
      
      const canStart = configLoader.checkAppStart();
      
      expect(canStart).toBe(false);
    });
  });

  describe('Settings Config', () => {
    test('settings değerlerini almalı', () => {
      const settings = configLoader.get('settings');
      
      expect(settings.appStart).toBe(true);
      expect(settings.browser.locale).toBe('tr-TR');
      expect(settings.browser.viewport.width).toBe(1920);
    });

    test('nested key ile değer almalı', () => {
      const locale = configLoader.get('settings', 'browser.locale');
      expect(locale).toBe('tr-TR');
      
      const headless = configLoader.get('settings', 'browser.headless');
      expect(headless).toBe(false);
      
      const rotationInterval = configLoader.get('settings', 'proxy.rotationInterval');
      expect(rotationInterval).toBe(300);
    });

    test('olmayan key için undefined dönmeli', () => {
      const value = configLoader.get('settings', 'olmayan.nested.key');
      expect(value).toBeUndefined();
    });
  });

  describe('URL-Keywords Config', () => {
    test('url-keywords listesini almalı', () => {
      const keywords = configLoader.getUrlKeywords();
      
      expect(Array.isArray(keywords)).toBe(true);
      expect(keywords.length).toBeGreaterThan(0);
      
      // İlk keyword yapısını kontrol et
      expect(keywords[0].keyword).toBeDefined();
      expect(keywords[0].targetUrl).toBeDefined();
      expect(keywords[0].dailyClicks).toBeGreaterThan(0);
      expect(keywords[0].maxPage).toBeGreaterThan(0);
      expect(keywords[0].startPage).toBeGreaterThan(0);
    });

    test('maxPage ve startPage değerleri olmalı', () => {
      const keywords = configLoader.getUrlKeywords();
      
      // İlk keyword kontrolü
      expect(keywords[0].maxPage).toBe(10);
      expect(keywords[0].startPage).toBe(1);
      
      // Sonraki keyword kontrolü
      expect(keywords[2].maxPage).toBe(15);
      expect(keywords[2].startPage).toBe(6);
    });

    test('targetPosition alanı olmamalı', () => {
      const keywords = configLoader.getUrlKeywords();
      
      // targetPosition kaldırıldı, olmamalı
      expect(keywords[0]).not.toHaveProperty('targetPosition');
    });

    test('array kopyası döndürmeli', () => {
      const keywords1 = configLoader.getUrlKeywords();
      const keywords2 = configLoader.getUrlKeywords();
      
      // Aynı referans değil
      expect(keywords1).not.toBe(keywords2);
      // Ama içerik aynı
      expect(keywords1).toEqual(keywords2);
    });
  });

  describe('Proxy Config', () => {
    test('proxy listesini almalı', () => {
      const proxyList = configLoader.getProxyList();
      
      expect(Array.isArray(proxyList)).toBe(true);
      expect(proxyList.length).toBe(2);
      
      // Yapı kontrolü
      expect(proxyList[0].name).toBeDefined();
      expect(proxyList[0].url).toBeDefined();
    });

    test('proxy basit yapıda olmalı', () => {
      const proxyList = configLoader.getProxyList();
      
      // Sadece name ve url olmalı
      expect(proxyList[0]).toHaveProperty('name');
      expect(proxyList[0]).toHaveProperty('url');
      expect(proxyList[0]).not.toHaveProperty('id');
      expect(proxyList[0]).not.toHaveProperty('host');
      expect(proxyList[0]).not.toHaveProperty('port');
    });

    test('proxy aktif mi kontrol etmeli', () => {
      const isEnabled = configLoader.isProxyEnabled();
      
      expect(isEnabled).toBe(true);
    });

    test('proxy configini almalı', () => {
      const proxy = configLoader.get('proxy');
      
      expect(proxy.enabled).toBe(true);
      expect(proxy.rotationInterval).toBe(300);
      expect(Array.isArray(proxy.list)).toBe(true);
    });
  });

  describe('Config Güncelleme', () => {
    test('settings değerini güncellemeli', () => {
      configLoader.set('settings', 'browser.headless', true);
      
      const headless = configLoader.get('settings', 'browser.headless');
      expect(headless).toBe(true);
    });

    test('nested key güncellemeli', () => {
      configLoader.set('settings', 'proxy.rotationInterval', 600);
      
      const interval = configLoader.get('settings', 'proxy.rotationInterval');
      expect(interval).toBe(600);
    });

    test('olmayan nested key oluşturmalı', () => {
      configLoader.set('settings', 'yeni.nested.key', 'deger');
      
      const value = configLoader.get('settings', 'yeni.nested.key');
      expect(value).toBe('deger');
    });
  });

  describe('Singleton Pattern', () => {
    test('getConfigLoader aynı instance döndürmeli', () => {
      const loader1 = getConfigLoader(logger);
      const loader2 = getConfigLoader();
      
      expect(loader1).toBe(loader2);
    });

    test('resetConfigLoader temizlemeli', () => {
      const loader = getConfigLoader(logger);
      loader.loadAll();
      
      resetConfigLoader();
      
      const newLoader = getConfigLoader(logger);
      expect(newLoader.isConfigLoaded()).toBe(false);
    });
  });

  describe('Reload İşlemi', () => {
    test('reload sabit değerlere sıfırlamalı', async () => {
      // Bir değeri değiştir
      configLoader.set('settings', 'browser.headless', true);
      expect(configLoader.get('settings', 'browser.headless')).toBe(true);
      
      // Reload yap
      await configLoader.reload();
      
      // Değer sıfırlanmış olmalı
      expect(configLoader.get('settings', 'browser.headless')).toBe(false);
    });
  });

  describe('Hata Durumları', () => {
    test('olmayan config adı hata vermeli', () => {
      expect(() => {
        configLoader.get('olmayan-config');
      }).toThrow('Config bulunamadı');
    });

    test('veritabanı bağlantısı henüz aktif değil', async () => {
      await expect(
        configLoader.connectDatabase('postgresql://localhost:5432/db')
      ).rejects.toThrow('henüz implemente edilmedi');
    });
  });
});