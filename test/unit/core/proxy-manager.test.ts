// test/unit/core/proxy-manager.test.ts

/**
 * ProxyManager Modülü Testleri
 *
 * Notlar:
 * - undici mock'lanır; gerçek ağ isteği yapılmaz.
 * - Zamanlayıcı testleri jest fake timers kullanır, gerçek bekleme yoktur.
 * - Gereksinim: Node 17.3+ (AbortSignal.timeout için)
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ProxyAgent, fetch as undiciFetch } from 'undici';
import {
  ProxyManager,
  getProxyManager,
  resetProxyManager,
  createProxyManager,
  getNamedProxyManager,
  closeNamedProxyManager,
  closeAllProxyManagers,
} from '../../../src/core/proxy-manager';
import { Logger } from '../../../src/utils/logger';

jest.mock('undici', () => ({
  ProxyAgent: jest.fn(),
  fetch: jest.fn(),
}));

const mockFetch = undiciFetch as unknown as jest.Mock;
const MockProxyAgent = ProxyAgent as unknown as jest.Mock;

const mockLogger: jest.Mocked<Logger> = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as unknown as jest.Mocked<Logger>;

const okResponse = () => ({
  ok: true,
  body: {
    cancel: jest.fn().mockResolvedValue(undefined),
    [Symbol.asyncIterator]: async function* () {},
  },
});

const proxy = (n: number) => ({ name: `Test${n}`, url: `http://proxy${n}.com:8080` });
const proxies = (count: number) => Array.from({ length: count }, (_, i) => proxy(i + 1));
const MINUTE = 60 * 1000;

describe('ProxyManager', () => {
  let proxyManager: ProxyManager;
  let tmpDir: string;
  let testProxyFile: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-test-'));
    testProxyFile = path.join(tmpDir, 'proxies.txt');

    fs.writeFileSync(
      testProxyFile,
      [
        'Provider1|http://user:pass@proxy1.example.com:8080',
        'Provider2|http://proxy2.example.com:8080',
        'Provider3|http://proxy3.example.com:8080',
        'Provider4|socks5://proxy4.example.com:1080',
      ].join('\n')
    );

    MockProxyAgent.mockReset();
    MockProxyAgent.mockImplementation(() => ({
      close: jest.fn().mockResolvedValue(undefined),
    }));
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(okResponse());

    // Timer yalnızca loadProxies/loadFromFile ile başlar; bu örnek tek başına sızıntı yapmaz.
    proxyManager = new ProxyManager({}, mockLogger);
  });

  afterEach(() => {
    // Sıra önemli: timer'lar, hangi saatle (fake/real) oluşturulduysa onunla temizlenmeli.
    proxyManager.close();
    closeAllProxyManagers();
    resetProxyManager();
    jest.useRealTimers();

    fs.rmSync(tmpDir, { recursive: true, force: true });
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  // ---------------------------------------------------------------
  describe('Proxy Yükleme', () => {
    test('dosyadan proxy yüklenmeli', () => {
      proxyManager.loadFromFile(testProxyFile);

      expect(proxyManager.getStats().total).toBe(4);
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Loading proxies'));
    });

    test('dosyada CRLF, yorum satırı, boş satır ve isimsiz satır desteklenmeli', () => {
      fs.writeFileSync(
        testProxyFile,
        '# yorum satırı\r\nA|http://a.com:1\r\n\r\nhttp://b.com:2\r\n'
      );

      proxyManager.loadFromFile(testProxyFile);
      const all = proxyManager.getAllProxies();

      expect(all).toHaveLength(2);
      expect(all[0]).toMatchObject({ provider: 'A', url: 'http://a.com:1' });
      expect(all[1]).toMatchObject({ provider: 'proxy-1', url: 'http://b.com:2' });
    });

    test('doğrudan proxy listesi yüklenmeli', () => {
      proxyManager.loadProxies([proxy(1), proxy(2)]);

      expect(proxyManager.getStats().total).toBe(2);
      expect(mockLogger.info).toHaveBeenCalledWith('Loaded 2 proxies successfully');
    });

    test('olmayan dosya hata vermeli', () => {
      expect(() => proxyManager.loadFromFile('./non-existent.txt')).toThrow('Proxy file not found');
    });

    test('loadProxies tekrar çağrılınca önceki durum sıfırlanmalı', () => {
      jest.useFakeTimers();
      proxyManager = new ProxyManager({}, mockLogger);

      proxyManager.loadProxies(proxies(2));
      proxyManager.banProxy(proxy(1).url);
      expect(proxyManager.getStats().banned).toBe(1);

      proxyManager.loadProxies(proxies(3));

      expect(proxyManager.getStats()).toMatchObject({ total: 3, banned: 0, active: 3 });
      // Geriye sadece health check interval'i kalmalı; eski ban timer'ı temizlenmiş olmalı
      expect(jest.getTimerCount()).toBe(1);
    });
  });

  // ---------------------------------------------------------------
  describe('Proxy Rotasyonu', () => {
    beforeEach(() => {
      proxyManager.loadProxies(proxies(3));
    });

    test('round-robin rotasyonu sırayla dönmeli', () => {
      const urls = [1, 2, 3, 4].map(() => proxyManager.getNextProxy()!.url);

      expect(urls).toEqual([proxy(1).url, proxy(2).url, proxy(3).url, proxy(1).url]);
    });

    test('round-robin banlı proxy\'yi atlamalı ve sırayı bozmamalı', () => {
      proxyManager.banProxy(proxy(2).url);

      const urls = [1, 2, 3, 4].map(() => proxyManager.getNextProxy()!.url);

      expect(urls).toEqual([proxy(1).url, proxy(3).url, proxy(1).url, proxy(3).url]);
    });

    test('random stratejisi Math.random\'a göre seçmeli', () => {
      proxyManager.close();
      proxyManager = new ProxyManager({ strategy: 'random' }, mockLogger);
      proxyManager.loadProxies(proxies(2));

      jest.spyOn(Math, 'random').mockReturnValue(0.99);
      expect(proxyManager.getNextProxy()!.url).toBe(proxy(2).url);

      (Math.random as jest.Mock).mockReturnValue(0);
      expect(proxyManager.getNextProxy()!.url).toBe(proxy(1).url);
    });

    test('least-used stratejisi en az kullanılanı seçmeli', () => {
      proxyManager.close();
      proxyManager = new ProxyManager({ strategy: 'least-used' }, mockLogger);
      proxyManager.loadProxies(proxies(2));

      const first = proxyManager.getNextProxy()!;
      const second = proxyManager.getNextProxy()!;
      const third = proxyManager.getNextProxy()!;

      expect(second.url).not.toBe(first.url);
      expect(third.url).toBe(first.url); // eşitlikte ilk sıradaki
    });

    test('least-used orijinal liste sırasını bozmamalı', () => {
      proxyManager.close();
      proxyManager = new ProxyManager({ strategy: 'least-used' }, mockLogger);
      proxyManager.loadProxies(proxies(3));

      proxyManager.getNextProxy();
      proxyManager.getNextProxy();

      expect(proxyManager.getAllProxies().map(p => p.url)).toEqual(proxies(3).map(p => p.url));
    });

    test('weighted stratejisi hızlı proxy\'ye daha yüksek ağırlık vermeli', () => {
      proxyManager.close();
      proxyManager = new ProxyManager({ strategy: 'weighted' }, mockLogger);
      proxyManager.loadProxies(proxies(2));
      proxyManager.markSuccess(proxy(1).url, 100); // ağırlık 10
      proxyManager.markSuccess(proxy(2).url, 1000); // ağırlık 1

      const random = jest.spyOn(Math, 'random');

      random.mockReturnValue(0.5); // 5.5 -> ilk proxy
      expect(proxyManager.getNextProxy()!.url).toBe(proxy(1).url);

      random.mockReturnValue(0.99); // 10.89 -> ikinci proxy
      expect(proxyManager.getNextProxy()!.url).toBe(proxy(2).url);
    });

    test('kullanılabilir proxy yoksa null dönmeli', () => {
      proxyManager.getAllProxies().forEach(p => proxyManager.banProxy(p.url));

      expect(proxyManager.getNextProxy()).toBeNull();
      expect(mockLogger.warn).toHaveBeenCalledWith('No available proxies found');
    });

    test('hiç proxy yüklenmemişse null dönmeli', () => {
      const empty = new ProxyManager({}, mockLogger);

      expect(empty.getNextProxy()).toBeNull();
    });
  });

  // ---------------------------------------------------------------
  describe('Proxy Durum Yönetimi', () => {
    const url = proxy(1).url;

    beforeEach(() => {
      proxyManager.loadProxies([proxy(1)]);
    });

    test('başarısız proxy işaretlenmeli', () => {
      proxyManager.markFailed(url, 'Connection timeout');

      const p = proxyManager.getAllProxies()[0];
      expect(p.failCount).toBe(1);
      expect(p.lastError).toBe('Connection timeout');
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    test('başarılı proxy işaretlenmeli ve hata sayacı sıfırlanmalı', () => {
      proxyManager.markFailed(url, 'x');
      proxyManager.markSuccess(url, 150);

      const p = proxyManager.getAllProxies()[0];
      expect(p.successCount).toBe(1);
      expect(p.failCount).toBe(0);
      expect(p.lastError).toBeUndefined();
      expect(p.averageResponseTime).toBe(150);
    });

    test('yanıt süresi üstel ortalama ile güncellenmeli', () => {
      proxyManager.markSuccess(url, 100);
      proxyManager.markSuccess(url, 200);

      // 100 * 0.7 + 200 * 0.3 = 130
      expect(proxyManager.getAllProxies()[0].averageResponseTime).toBeCloseTo(130);
    });

    test('maxFailures sonrası proxy banlanmalı', () => {
      proxyManager.markFailed(url, 'Error 1');
      proxyManager.markFailed(url, 'Error 2');
      proxyManager.markFailed(url, 'Error 3');

      expect(proxyManager.getAllProxies()[0].isBanned).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Proxy banned'));
    });

    test('banlı proxy\'de ek hata gelirse tekrar banlanmamalı', () => {
      proxyManager.markFailed(url);
      proxyManager.markFailed(url);
      proxyManager.markFailed(url); // ban
      mockLogger.warn.mockClear();

      proxyManager.markFailed(url);

      const banLogs = mockLogger.warn.mock.calls.filter(([msg]) => String(msg).includes('Proxy banned'));
      expect(banLogs).toHaveLength(0);
    });

    test('olmayan proxy üzerindeki işlemler sessizce yok sayılmalı', () => {
      expect(() => {
        proxyManager.markFailed('http://yok.com:1');
        proxyManager.markSuccess('http://yok.com:1', 10);
        proxyManager.banProxy('http://yok.com:1');
        proxyManager.unbanProxy('http://yok.com:1');
      }).not.toThrow();
    });

    test('proxy banı kaldırılabilmeli', () => {
      proxyManager.banProxy(url);
      expect(proxyManager.getAllProxies()[0].isBanned).toBe(true);

      proxyManager.unbanProxy(url);

      const p = proxyManager.getAllProxies()[0];
      expect(p.isBanned).toBe(false);
      expect(p.failCount).toBe(0);
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Proxy unbanned'));
    });
  });

  // ---------------------------------------------------------------
  describe('Ban Zamanlayıcıları (fake timers)', () => {
    const url = proxy(1).url;

    beforeEach(() => {
      jest.useFakeTimers();
      proxyManager = new ProxyManager({ banDuration: 1 }, mockLogger); // 1 dakika
      proxyManager.loadProxies([proxy(1)]);
    });

    test('ban süresi dolunca otomatik açılmalı', () => {
      proxyManager.banProxy(url);

      jest.advanceTimersByTime(MINUTE - 1);
      expect(proxyManager.getAllProxies()[0].isBanned).toBe(true);

      jest.advanceTimersByTime(1);
      expect(proxyManager.getAllProxies()[0].isBanned).toBe(false);
    });

    test('tekrar banlanınca süre sıfırdan başlamalı', () => {
      proxyManager.banProxy(url);
      jest.advanceTimersByTime(30 * 1000);

      proxyManager.banProxy(url); // yeni 1 dakika, t=30s'den itibaren
      jest.advanceTimersByTime(40 * 1000); // t=70s: eski timer olsaydı açılmış olurdu
      expect(proxyManager.getAllProxies()[0].isBanned).toBe(true);

      jest.advanceTimersByTime(20 * 1000); // t=90s
      expect(proxyManager.getAllProxies()[0].isBanned).toBe(false);
    });

    test('unbanProxy bekleyen ban timer\'ını temizlemeli', () => {
      expect(jest.getTimerCount()).toBe(1); // sadece health check interval'i

      proxyManager.banProxy(url);
      expect(jest.getTimerCount()).toBe(2);

      proxyManager.unbanProxy(url);
      expect(jest.getTimerCount()).toBe(1);
    });

    test('duration 0 verilirse varsayılana düşmemeli', () => {
      proxyManager.banProxy(url, 0);

      jest.advanceTimersByTime(1);

      expect(proxyManager.getAllProxies()[0].isBanned).toBe(false);
    });

    test('close() tüm timer\'ları temizlemeli', () => {
      proxyManager.banProxy(url);
      expect(jest.getTimerCount()).toBe(2);

      proxyManager.close();

      expect(jest.getTimerCount()).toBe(0);
    });
  });

  // ---------------------------------------------------------------
  describe('Health Check', () => {
    test('istek proxy üzerinden (dispatcher ile) gönderilmeli', async () => {
      proxyManager = new ProxyManager({ healthCheckUrl: 'https://example.test/ip' }, mockLogger);
      proxyManager.loadProxies([proxy(1)]);

      await proxyManager.performHealthCheck();

      expect(MockProxyAgent).toHaveBeenCalledWith(proxy(1).url);
      const agentInstance = MockProxyAgent.mock.results[0].value;
      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.test/ip',
        expect.objectContaining({ dispatcher: agentInstance })
      );
      expect(agentInstance.close).toHaveBeenCalled();
    });

    test('başarılı kontrol proxy\'yi aktif işaretlemeli ve yanıt süresini yazmalı', async () => {
      proxyManager.loadProxies([proxy(1)]);

      await proxyManager.performHealthCheck();

      const p = proxyManager.getAllProxies()[0];
      expect(p.isActive).toBe(true);
      expect(p.averageResponseTime).toBeGreaterThanOrEqual(0);
    });

    test('fetch hata verirse proxy pasif işaretlenmeli', async () => {
      proxyManager.loadProxies([proxy(1), proxy(2)]);
      mockFetch
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockResolvedValueOnce(okResponse());

      await proxyManager.performHealthCheck();

      const [p1, p2] = proxyManager.getAllProxies();
      expect(p1.isActive).toBe(false);
      expect(p2.isActive).toBe(true);
      expect(proxyManager.getStats()).toMatchObject({ active: 1, failed: 1 });
    });

    test('HTTP yanıtı ok değilse proxy pasif işaretlenmeli', async () => {
      proxyManager.loadProxies([proxy(1)]);
      mockFetch.mockResolvedValueOnce({ ok: false, body: { cancel: jest.fn() } });

      await proxyManager.performHealthCheck();

      expect(proxyManager.getAllProxies()[0].isActive).toBe(false);
    });

    test('pasif proxy tekrar sağlıklı çıkarsa aktifleşmeli', async () => {
      proxyManager.loadProxies([proxy(1)]);
      mockFetch.mockRejectedValueOnce(new Error('down'));
      await proxyManager.performHealthCheck();
      expect(proxyManager.getAllProxies()[0].isActive).toBe(false);

      await proxyManager.performHealthCheck();

      expect(proxyManager.getAllProxies()[0].isActive).toBe(true);
    });

    test('banlı proxy\'ler kontrol edilmemeli', async () => {
      proxyManager.loadProxies(proxies(3));
      proxyManager.banProxy(proxy(2).url);

      await proxyManager.performHealthCheck();

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(MockProxyAgent).not.toHaveBeenCalledWith(proxy(2).url);
    });

    test('üst üste binen turlar atlanmalı', async () => {
      proxyManager.loadProxies([proxy(1)]);

      let resolveFetch!: (value: unknown) => void;
      mockFetch.mockImplementationOnce(
        () => new Promise(resolve => { resolveFetch = resolve; })
      );

      const first = proxyManager.performHealthCheck();
      await proxyManager.performHealthCheck(); // ilki sürerken: hemen döner
      expect(mockFetch).toHaveBeenCalledTimes(1);

      resolveFetch(okResponse());
      await first;

      await proxyManager.performHealthCheck(); // ilk tur bitti, yenisi çalışabilir
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    test('eşzamanlılık sınırına uyulmalı', async () => {
      proxyManager = new ProxyManager({ healthCheckConcurrency: 2 }, mockLogger);
      proxyManager.loadProxies(proxies(5));

      let inFlight = 0;
      let maxInFlight = 0;
      mockFetch.mockImplementation(async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise(resolve => setImmediate(resolve));
        inFlight--;
        return okResponse();
      });

      await proxyManager.performHealthCheck();

      expect(mockFetch).toHaveBeenCalledTimes(5);
      expect(maxInFlight).toBe(2);
    });

    test('interval süresi dolunca otomatik çalışmalı', async () => {
      jest.useFakeTimers();
      proxyManager = new ProxyManager({ healthCheckInterval: 10 }, mockLogger);
      proxyManager.loadProxies([proxy(1)]);

      jest.advanceTimersByTime(10 * MINUTE - 1);
      expect(mockFetch).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(1);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    test('close() sonrası health check çalışmamalı', async () => {
      proxyManager.loadProxies([proxy(1)]);
      proxyManager.close();

      await proxyManager.performHealthCheck();

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------
  describe('İstatistikler', () => {
    test('boş havuzda istatistikler sıfır olmalı', () => {
      expect(proxyManager.getStats()).toEqual({
        total: 0,
        active: 0,
        banned: 0,
        failed: 0,
        averageResponseTime: 0,
      });
    });

    test('istatistikler doğru hesaplanmalı', () => {
      proxyManager.loadProxies(proxies(3));
      expect(proxyManager.getStats()).toMatchObject({ total: 3, active: 3, banned: 0 });

      proxyManager.banProxy(proxy(1).url); // manuel ban
      proxyManager.markFailed(proxy(2).url, 'Error'); // 3 hata -> otomatik ban
      proxyManager.markFailed(proxy(2).url, 'Error');
      proxyManager.markFailed(proxy(2).url, 'Error');

      expect(proxyManager.getStats()).toMatchObject({ total: 3, banned: 2, active: 1 });
    });

    test('ortalama yanıt süresi hesaplanmalı', () => {
      proxyManager.loadProxies(proxies(2));
      proxyManager.markSuccess(proxy(1).url, 100);
      proxyManager.markSuccess(proxy(2).url, 201);

      expect(proxyManager.getStats().averageResponseTime).toBe(151); // round(150.5)
    });

    test('tüm proxy\'ler listelenebilmeli ve liste kopya olmalı', () => {
      proxyManager.loadProxies(proxies(3));

      const all = proxyManager.getAllProxies();
      expect(all).toHaveLength(3);
      expect(all[0]).toHaveProperty('url');
      expect(all[0]).toHaveProperty('isActive');
      expect(all[0]).toHaveProperty('isBanned');

      all.pop();
      expect(proxyManager.getAllProxies()).toHaveLength(3);
    });
  });

  // ---------------------------------------------------------------
  describe('Dosya Kaydetme', () => {
    test('proxy listesi dosyaya kaydedilebilmeli', () => {
      proxyManager.loadProxies([
        { name: 'Provider1', url: 'http://proxy1.com:8080' },
        { name: 'Provider2', url: 'http://proxy2.com:8080' },
      ]);

      const savePath = path.join(tmpDir, 'saved-proxies.txt');
      proxyManager.saveToFile(savePath);

      const content = fs.readFileSync(savePath, 'utf-8');
      expect(content).toContain('Provider1|http://proxy1.com:8080');
      expect(content).toContain('Provider2|http://proxy2.com:8080');
    });

    test('kaydedilen dosya tekrar yüklenebilmeli (round-trip)', () => {
      proxyManager.loadProxies([
        { name: 'Provider1', url: 'http://user:pass@proxy1.com:8080' },
        { name: 'Provider2', url: 'http://proxy2.com:8080' },
      ]);
      const savePath = path.join(tmpDir, 'roundtrip.txt');
      proxyManager.saveToFile(savePath);

      const other = new ProxyManager({}, mockLogger);
      other.loadFromFile(savePath);

      expect(other.getAllProxies().map(p => [p.provider, p.url])).toEqual([
        ['Provider1', 'http://user:pass@proxy1.com:8080'],
        ['Provider2', 'http://proxy2.com:8080'],
      ]);
      other.close();
    });
  });

  // ---------------------------------------------------------------
  describe('Singleton ve Factory', () => {
    test('getProxyManager aynı instance döndürmeli', () => {
      expect(getProxyManager({}, mockLogger)).toBe(getProxyManager());
    });

    test('resetProxyManager instance sıfırlamalı', () => {
      const manager1 = getProxyManager({}, mockLogger);
      resetProxyManager();
      const manager2 = getProxyManager({}, mockLogger);

      expect(manager1).not.toBe(manager2);
    });

    test('createProxyManager isimli örnek oluşturmalı ve getNamedProxyManager döndürmeli', () => {
      const manager = createProxyManager('a', {}, mockLogger);

      expect(getNamedProxyManager('a')).toBe(manager);
      expect(getNamedProxyManager('b')).toBeUndefined();
    });

    test('aynı isimle tekrar oluşturulunca eski örnek kapatılmalı', () => {
      const first = createProxyManager('a', {}, mockLogger);
      const closeSpy = jest.spyOn(first, 'close');

      const second = createProxyManager('a', {}, mockLogger);

      expect(closeSpy).toHaveBeenCalledTimes(1);
      expect(second).not.toBe(first);
      expect(getNamedProxyManager('a')).toBe(second);
    });

    test('closeNamedProxyManager örneği kapatıp silmeli', () => {
      const manager = createProxyManager('a', {}, mockLogger);
      const closeSpy = jest.spyOn(manager, 'close');

      closeNamedProxyManager('a');

      expect(closeSpy).toHaveBeenCalled();
      expect(getNamedProxyManager('a')).toBeUndefined();
    });

    test('closeAllProxyManagers hepsini kapatmalı', () => {
      const a = createProxyManager('a', {}, mockLogger);
      const b = createProxyManager('b', {}, mockLogger);
      const spyA = jest.spyOn(a, 'close');
      const spyB = jest.spyOn(b, 'close');

      closeAllProxyManagers();

      expect(spyA).toHaveBeenCalled();
      expect(spyB).toHaveBeenCalled();
      expect(getNamedProxyManager('a')).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------
  describe('Proxy URL Maskeleme', () => {
    test('kimlik bilgileri loglarda maskelenmeli', () => {
      proxyManager.loadProxies([
        { name: 'Secure', url: 'http://user:secretpassword@proxy.com:8080' },
      ]);

      proxyManager.getNextProxy();
      proxyManager.markFailed('http://user:secretpassword@proxy.com:8080', 'err');

      const allLogs = [
        ...mockLogger.debug.mock.calls,
        ...mockLogger.info.mock.calls,
        ...mockLogger.warn.mock.calls,
      ].map(args => JSON.stringify(args));

      expect(allLogs.some(l => l.includes('user:****@proxy.com:8080'))).toBe(true);
      expect(allLogs.some(l => l.includes('secretpassword'))).toBe(false);
    });
  });
});