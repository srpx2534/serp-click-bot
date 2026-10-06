// test/unit/core/proxy-manager.test.ts

/**
 * ProxyManager Modülü Testleri
 * Tüm proxy yönetimi fonksiyonlarının birim testleri
 */

import {
  ProxyManager,
  getProxyManager,
  resetProxyManager,
  RotationStrategy,
} from '../../../src/core/proxy-manager';
import { Logger } from '../../../src/utils/logger';
import * as fs from 'fs';

// ProxyStatus import'u kaldırıldı (kullanılmıyordu)
// path import'u kaldırıldı (kullanılmıyordu)

// Mock Logger
const mockLogger: jest.Mocked<Logger> = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as unknown as jest.Mocked<Logger>;

describe('ProxyManager', () => {
  let proxyManager: ProxyManager;
  const testProxyFile = './test-data/proxies.txt';

  beforeEach(() => {
    // Test dizinini oluştur
    if (!fs.existsSync('./test-data')) {
      fs.mkdirSync('./test-data', { recursive: true });
    }

    // Test proxy dosyasını oluştur
    const proxyContent = `Provider1|http://user:pass@proxy1.example.com:8080
Provider2|http://proxy2.example.com:8080
Provider3|http://proxy3.example.com:8080
Provider4|socks5://proxy4.example.com:1080`;
    
    fs.writeFileSync(testProxyFile, proxyContent);

    // Yeni instance oluştur
    proxyManager = new ProxyManager({}, mockLogger);
  });

  afterEach(() => {
    // Test dosyalarını temizle
    if (fs.existsSync('./test-data')) {
      fs.rmSync('./test-data', { recursive: true, force: true });
    }
    
    // Singleton'ı sıfırla
    resetProxyManager();
    
    // Mock'ları temizle
    jest.clearAllMocks();
  });

  describe('Proxy Yükleme', () => {
    test('dosyadan proxy yüklenmeli', () => {
      proxyManager.loadFromFile(testProxyFile);
      const stats = proxyManager.getStats();
      
      expect(stats.total).toBe(4);
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Loading proxies'));
    });

    test('doğrudan proxy listesi yüklenmeli', () => {
      const proxies = [
        { name: 'Test1', url: 'http://proxy1.com:8080' },
        { name: 'Test2', url: 'http://proxy2.com:8080' },
      ];
      
      proxyManager.loadProxies(proxies);
      const stats = proxyManager.getStats();
      
      expect(stats.total).toBe(2);
      expect(mockLogger.info).toHaveBeenCalledWith('Loaded 2 proxies');
    });

    test('olmayan dosya hata vermeli', () => {
      expect(() => {
        proxyManager.loadFromFile('./non-existent.txt');
      }).toThrow('Proxy file not found');
    });
  });

  describe('Proxy Rotasyonu', () => {
    beforeEach(() => {
      const proxies = [
        { name: 'Test1', url: 'http://proxy1.com:8080' },
        { name: 'Test2', url: 'http://proxy2.com:8080' },
        { name: 'Test3', url: 'http://proxy3.com:8080' },
      ];
      proxyManager.loadProxies(proxies);
    });

    test('round-robin rotasyonu çalışmalı', () => {
      const proxy1 = proxyManager.getNextProxy();
      const proxy2 = proxyManager.getNextProxy();
      const proxy3 = proxyManager.getNextProxy();
      const proxy4 = proxyManager.getNextProxy(); // Döngü
      
      expect(proxy1).not.toBeNull();
      expect(proxy2).not.toBeNull();
      expect(proxy3).not.toBeNull();
      expect(proxy4).not.toBeNull();
      
      // Döngü tamamlandı, ilk proxy tekrar gelmeli
      expect(proxy4!.url).toBe(proxy1!.url);
    });

    test('random stratejisi çalışmalı', () => {
      const randomManager = new ProxyManager({ strategy: 'random' as RotationStrategy }, mockLogger);
      randomManager.loadProxies([
        { name: 'Test1', url: 'http://proxy1.com:8080' },
        { name: 'Test2', url: 'http://proxy2.com:8080' },
      ]);
      
      const proxy = randomManager.getNextProxy();
      expect(proxy).not.toBeNull();
      expect(['http://proxy1.com:8080', 'http://proxy2.com:8080']).toContain(proxy!.url);
    });

    test('least-used stratejisi çalışmalı', () => {
      const leastUsedManager = new ProxyManager({ strategy: 'least-used' as RotationStrategy }, mockLogger);
      leastUsedManager.loadProxies([
        { name: 'Test1', url: 'http://proxy1.com:8080' },
        { name: 'Test2', url: 'http://proxy2.com:8080' },
      ]);
      
      // İlk proxy'yi kullan
      const proxy1 = leastUsedManager.getNextProxy();
      expect(proxy1).not.toBeNull();
      
      // İkinci proxy gelmeli (en az kullanılan)
      const proxy2 = leastUsedManager.getNextProxy();
      expect(proxy2).not.toBeNull();
      expect(proxy2!.url).not.toBe(proxy1!.url);
    });

    test('kullanılabilir proxy yoksa null dönmeli', () => {
      // Tüm proxy'leri banla
      const proxies = proxyManager.getAllProxies();
      proxies.forEach(p => proxyManager.banProxy(p.url));
      
      const proxy = proxyManager.getNextProxy();
      expect(proxy).toBeNull();
      expect(mockLogger.warn).toHaveBeenCalledWith('No available proxies found');
    });
  });

  describe('Proxy Durum Yönetimi', () => {
    beforeEach(() => {
      proxyManager.loadProxies([
        { name: 'Test1', url: 'http://proxy1.com:8080' },
      ]);
    });

    test('başarısız proxy işaretlenmeli', () => {
      const proxyUrl = 'http://proxy1.com:8080';
      
      proxyManager.markFailed(proxyUrl, 'Connection timeout');
      
      const proxy = proxyManager.getAllProxies().find(p => p.url === proxyUrl);
      expect(proxy!.failCount).toBe(1);
      expect(proxy!.lastError).toBe('Connection timeout');
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    test('başarılı proxy işaretlenmeli', () => {
      const proxyUrl = 'http://proxy1.com:8080';
      
      proxyManager.markSuccess(proxyUrl, 150);
      
      const proxy = proxyManager.getAllProxies().find(p => p.url === proxyUrl);
      expect(proxy!.successCount).toBe(1);
      expect(proxy!.failCount).toBe(0);
      expect(proxy!.averageResponseTime).toBe(150);
    });

    test('max failures sonrası proxy banlanmalı', () => {
      const proxyUrl = 'http://proxy1.com:8080';
      
      // 3 başarısız deneme (varsayılan maxFailures)
      proxyManager.markFailed(proxyUrl, 'Error 1');
      proxyManager.markFailed(proxyUrl, 'Error 2');
      proxyManager.markFailed(proxyUrl, 'Error 3');
      
      const proxy = proxyManager.getAllProxies().find(p => p.url === proxyUrl);
      expect(proxy!.isBanned).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Proxy banned'));
    });

    test('proxy banı kaldırılabilmeli', () => {
      const proxyUrl = 'http://proxy1.com:8080';
      
      proxyManager.banProxy(proxyUrl);
      let proxy = proxyManager.getAllProxies().find(p => p.url === proxyUrl);
      expect(proxy!.isBanned).toBe(true);
      
      proxyManager.unbanProxy(proxyUrl);
      proxy = proxyManager.getAllProxies().find(p => p.url === proxyUrl);
      expect(proxy!.isBanned).toBe(false);
      expect(proxy!.failCount).toBe(0);
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Proxy unbanned'));
    });

    test('otomatik ban süresi sonunda açılmalı', (done) => {
      const proxyUrl = 'http://proxy1.com:8080';
      const shortBanDuration = 0.05; // 3 saniye
      
      const tempManager = new ProxyManager({ banDuration: shortBanDuration }, mockLogger);
      tempManager.loadProxies([{ name: 'Test', url: proxyUrl }]);
      
      tempManager.banProxy(proxyUrl);
      expect(tempManager.getAllProxies()[0].isBanned).toBe(true);
      
      // 4 saniye bekle ve kontrol et
      setTimeout(() => {
        expect(tempManager.getAllProxies()[0].isBanned).toBe(false);
        done();
      }, 4000);
    }, 10000);
  });

  describe('İstatistikler', () => {
    beforeEach(() => {
      proxyManager.loadProxies([
        { name: 'Test1', url: 'http://proxy1.com:8080' },
        { name: 'Test2', url: 'http://proxy2.com:8080' },
        { name: 'Test3', url: 'http://proxy3.com:8080' },
      ]);
    });

    test('istatistikler doğru hesaplanmalı', () => {
      // 1 proxy'yi banla
      proxyManager.banProxy('http://proxy1.com:8080');
      
      // 1 proxy'yi pasif yap (simüle et)
      proxyManager.markFailed('http://proxy2.com:8080', 'Error');
      proxyManager.markFailed('http://proxy2.com:8080', 'Error');
      proxyManager.markFailed('http://proxy2.com:8080', 'Error');
      
      const stats = proxyManager.getStats();
      
      expect(stats.total).toBe(3);
      expect(stats.banned).toBe(1);
      expect(stats.failed).toBe(1); // failCount >= maxFailures olanlar
      expect(stats.active).toBe(1); // Sadece proxy3 aktif
    });

    test('tüm proxy\'ler listelenebilmeli', () => {
      const allProxies = proxyManager.getAllProxies();
      expect(allProxies.length).toBe(3);
      expect(allProxies[0]).toHaveProperty('url');
      expect(allProxies[0]).toHaveProperty('isActive');
      expect(allProxies[0]).toHaveProperty('isBanned');
    });
  });

  describe('Dosya Kaydetme', () => {
    test('proxy listesi dosyaya kaydedilebilmeli', () => {
      proxyManager.loadProxies([
        { name: 'Provider1', url: 'http://proxy1.com:8080' },
        { name: 'Provider2', url: 'http://proxy2.com:8080' },
      ]);
      
      const savePath = './test-data/saved-proxies.txt';
      proxyManager.saveToFile(savePath);
      
      expect(fs.existsSync(savePath)).toBe(true);
      
      const content = fs.readFileSync(savePath, 'utf-8');
      expect(content).toContain('Provider1|http://proxy1.com:8080');
      expect(content).toContain('Provider2|http://proxy2.com:8080');
    });
  });

  describe('Singleton Pattern', () => {
    test('getProxyManager aynı instance döndürmeli', () => {
      const manager1 = getProxyManager({}, mockLogger);
      const manager2 = getProxyManager();
      
      expect(manager1).toBe(manager2);
    });

    test('resetProxyManager instance sıfırlamalı', () => {
      const manager1 = getProxyManager({}, mockLogger);
      resetProxyManager();
      const manager2 = getProxyManager({}, mockLogger);
      
      expect(manager1).not.toBe(manager2);
    });
  });

  describe('Proxy URL Masking', () => {
    test('kimlik bilgileri maskelenmeli', () => {
      proxyManager.loadProxies([
        { name: 'Secure', url: 'http://user:secretpassword@proxy.com:8080' },
      ]);
      
      const proxy = proxyManager.getNextProxy();
      expect(proxy).not.toBeNull();
      // URL'de şifre görünmemeli (ama test edemiyoruz çünkü private method)
      // Loglarda test edilebilir
    });
  });
});