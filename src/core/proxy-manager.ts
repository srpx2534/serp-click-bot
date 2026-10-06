/**
 * ProxyManager - proxy havuzu yönetimi, rotasyon ve sağlık kontrolü
 *
 * Gereksinim: npm i undici
 * (https-proxy-agent artık gerekmiyor; yerleşik fetch `agent` seçeneğini
 *  desteklemediği için sağlık kontrolü undici ProxyAgent ile yapılıyor.)
 */

import * as fs from 'fs';
import { ProxyAgent, fetch as undiciFetch } from 'undici';
import { ProxyItem } from '../types';
import { Logger } from '../utils/logger';

export interface ProxyStatus {
  url: string;
  isActive: boolean;
  lastUsed: Date;
  failCount: number;
  successCount: number;
  averageResponseTime: number;
  isBanned: boolean;
  lastError?: string;
  country?: string;
  provider?: string;
}

export type RotationStrategy = 'round-robin' | 'random' | 'least-used' | 'weighted';

export interface ProxyManagerConfig {
  /** Eski yapılandırmalarla uyumluluk için duruyor; şu an kullanılmıyor. */
  rotationInterval?: number;
  maxFailures: number;
  banDuration: number; // dakika
  healthCheckInterval: number; // dakika
  strategy: RotationStrategy;
  timeout: number; // ms
  healthCheckUrl: string;
  healthCheckConcurrency: number;
}

export class ProxyManager {
  private proxies: ProxyStatus[] = [];
  private currentIndex = 0;
  private readonly config: ProxyManagerConfig;
  private readonly logger?: Logger;
  private healthCheckTimer?: NodeJS.Timeout;
  private healthCheckRunning = false;
  private closed = false;
  private readonly banTimers = new Map<string, NodeJS.Timeout>();
  private readonly usageStats = new Map<string, number>();

  private static readonly defaultConfig: ProxyManagerConfig = {
    maxFailures: 3,
    banDuration: 60,
    healthCheckInterval: 10,
    strategy: 'round-robin',
    timeout: 10000,
    healthCheckUrl: 'https://httpbin.org/ip',
    healthCheckConcurrency: 10,
  };

  constructor(config: Partial<ProxyManagerConfig> = {}, logger?: Logger) {
    this.config = { ...ProxyManager.defaultConfig, ...config };
    this.logger = logger;
  }

  // ---------------------------------------------------------------
  // Yükleme
  // ---------------------------------------------------------------

  /** Dosya formatı: her satır `isim|url` veya sadece `url`. `#` ile başlayan satırlar yok sayılır. */
  public loadFromFile(filePath: string): void {
    this.logger?.info(`Loading proxies from ${filePath}`);

    if (!fs.existsSync(filePath)) {
      this.logger?.error(`Proxy file not found: ${filePath}`);
      throw new Error(`Proxy file not found: ${filePath}`);
    }

    const lines = fs
      .readFileSync(filePath, 'utf-8')
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'));

    const items: ProxyItem[] = lines.map((line, index) => {
      const sep = line.indexOf('|');
      if (sep === -1) return { name: `proxy-${index}`, url: line };
      return {
        name: line.slice(0, sep).trim() || `proxy-${index}`,
        url: line.slice(sep + 1).trim(),
      };
    });

    this.loadProxies(items);
  }

  public loadProxies(proxyList: ProxyItem[]): void {
    this.logger?.info(`Loading ${proxyList.length} proxies`);

    // Önceki durumu temizle (ikinci kez çağrılırsa eski timer/istatistik kalmasın)
    this.clearBanTimers();
    this.usageStats.clear();
    this.currentIndex = 0;
    this.closed = false;

    this.proxies = proxyList.map(item => ({
      url: item.url,
      isActive: true,
      lastUsed: new Date(0),
      failCount: 0,
      successCount: 0,
      averageResponseTime: 0,
      isBanned: false,
      provider: item.name,
    }));

    this.startHealthCheck();
    this.logger?.info(`Loaded ${this.proxies.length} proxies successfully`);
  }

  // ---------------------------------------------------------------
  // Seçim
  // ---------------------------------------------------------------

  public getNextProxy(): ProxyStatus | null {
    const available = this.getAvailableProxies();

    if (available.length === 0) {
      this.logger?.warn('No available proxies found');
      return null;
    }

    let selected: ProxyStatus;

    switch (this.config.strategy) {
      case 'random':
        selected = available[Math.floor(Math.random() * available.length)];
        break;

      case 'least-used':
        selected = available.reduce((best, p) =>
          this.getUsageCount(p.url) < this.getUsageCount(best.url) ? p : best
        );
        break;

      case 'weighted':
        selected = this.selectWeightedProxy(available);
        break;

      case 'round-robin':
      default:
        selected = this.selectRoundRobin();
        break;
    }

    this.usageStats.set(selected.url, this.getUsageCount(selected.url) + 1);
    selected.lastUsed = new Date();

    this.logger?.debug(`Selected proxy: ${this.maskProxyUrl(selected.url)}`);
    return selected;
  }

  /** Tüm liste üzerinde döner, kullanılamayanları atlar (ban/unban dağılımı kaydırmaz). */
  private selectRoundRobin(): ProxyStatus {
    const n = this.proxies.length;
    for (let i = 0; i < n; i++) {
      const idx = (this.currentIndex + i) % n;
      const p = this.proxies[idx];
      if (p.isActive && !p.isBanned) {
        this.currentIndex = (idx + 1) % n;
        return p;
      }
    }
    // getAvailableProxies() boş değilse buraya gelinmez
    throw new Error('No available proxies');
  }

  private selectWeightedProxy(proxies: ProxyStatus[]): ProxyStatus {
    const weightOf = (p: ProxyStatus) => 1000 / Math.max(p.averageResponseTime, 1);
    const total = proxies.reduce((sum, p) => sum + weightOf(p), 0);
    let r = Math.random() * total;

    for (const p of proxies) {
      r -= weightOf(p);
      if (r <= 0) return p;
    }
    return proxies[proxies.length - 1];
  }

  private getUsageCount(proxyUrl: string): number {
    return this.usageStats.get(proxyUrl) ?? 0;
  }

  public getAvailableProxies(): ProxyStatus[] {
    return this.proxies.filter(p => p.isActive && !p.isBanned);
  }

  // ---------------------------------------------------------------
  // Sonuç bildirimi ve ban
  // ---------------------------------------------------------------

  public markFailed(proxyUrl: string, error?: string): void {
    const proxy = this.proxies.find(p => p.url === proxyUrl);
    if (!proxy) return;

    proxy.failCount++;
    proxy.lastError = error;

    this.logger?.warn(`Proxy marked as failed: ${this.maskProxyUrl(proxyUrl)}`, {
      failCount: proxy.failCount,
      error,
    });

    if (proxy.failCount >= this.config.maxFailures && !proxy.isBanned) {
      this.banProxy(proxyUrl);
    }
  }

  public markSuccess(proxyUrl: string, responseTime: number): void {
    const proxy = this.proxies.find(p => p.url === proxyUrl);
    if (!proxy) return;

    proxy.successCount++;
    proxy.failCount = 0;
    proxy.lastError = undefined;

    // Üstel hareketli ortalama
    proxy.averageResponseTime =
      proxy.averageResponseTime === 0
        ? responseTime
        : proxy.averageResponseTime * 0.7 + responseTime * 0.3;

    this.logger?.debug(`Proxy marked as success: ${this.maskProxyUrl(proxyUrl)}`, {
      responseTime,
      averageResponseTime: proxy.averageResponseTime,
    });
  }

  /** Geçici ban. Zaten banlıysa süre sıfırdan başlar. `duration` dakika cinsindendir. */
  public banProxy(proxyUrl: string, duration?: number): void {
    const proxy = this.proxies.find(p => p.url === proxyUrl);
    if (!proxy) return;

    this.clearBanTimer(proxyUrl);

    proxy.isBanned = true;
    const banDuration = duration ?? this.config.banDuration;

    this.logger?.warn(`Proxy banned: ${this.maskProxyUrl(proxyUrl)} for ${banDuration} minutes`);

    const timer = setTimeout(() => {
      this.banTimers.delete(proxyUrl);
      this.unbanProxy(proxyUrl);
    }, banDuration * 60 * 1000);
    timer.unref?.();

    this.banTimers.set(proxyUrl, timer);
  }

  public unbanProxy(proxyUrl: string): void {
    const proxy = this.proxies.find(p => p.url === proxyUrl);
    if (!proxy) return;

    this.clearBanTimer(proxyUrl);

    proxy.isBanned = false;
    proxy.failCount = 0;
    proxy.lastError = undefined;

    this.logger?.info(`Proxy unbanned: ${this.maskProxyUrl(proxyUrl)}`);
  }

  private clearBanTimer(proxyUrl: string): void {
    const t = this.banTimers.get(proxyUrl);
    if (t) {
      clearTimeout(t);
      this.banTimers.delete(proxyUrl);
    }
  }

  private clearBanTimers(): void {
    for (const t of this.banTimers.values()) clearTimeout(t);
    this.banTimers.clear();
  }

  // ---------------------------------------------------------------
  // Sağlık kontrolü
  // ---------------------------------------------------------------

  private startHealthCheck(): void {
    if (this.healthCheckTimer) clearInterval(this.healthCheckTimer);

    this.healthCheckTimer = setInterval(() => {
      this.performHealthCheck().catch(err =>
        this.logger?.error('Health check crashed', { error: String(err) })
      );
    }, this.config.healthCheckInterval * 60 * 1000);
    this.healthCheckTimer.unref?.();

    this.logger?.info(`Health check started (interval: ${this.config.healthCheckInterval} min)`);
  }

  /** Testlerde doğrudan çağrılabilsin diye public. Üst üste binen turlar atlanır. */
  public async performHealthCheck(): Promise<void> {
    if (this.healthCheckRunning || this.closed) return;
    this.healthCheckRunning = true;

    try {
      this.logger?.debug('Performing health check...');

      const targets = this.proxies.filter(p => !p.isBanned);
      const size = Math.max(1, this.config.healthCheckConcurrency);

      for (let i = 0; i < targets.length; i += size) {
        const batch = targets.slice(i, i + size);
        await Promise.allSettled(
          batch.map(async proxy => {
            const start = Date.now();
            const ok = await this.checkProxyHealth(proxy.url);
            proxy.isActive = ok;
            if (ok) {
              proxy.averageResponseTime = Date.now() - start;
            } else {
              this.logger?.warn(`Health check failed for proxy: ${this.maskProxyUrl(proxy.url)}`);
            }
          })
        );
      }

      this.logger?.debug('Health check completed');
    } finally {
      this.healthCheckRunning = false;
    }
  }

  /** İsteği gerçekten proxy üzerinden gönderir (undici dispatcher). Sadece http(s) proxy; SOCKS desteklenmez. */
  private async checkProxyHealth(proxyUrl: string): Promise<boolean> {
    let dispatcher: ProxyAgent | undefined;
    try {
      dispatcher = new ProxyAgent(proxyUrl);
      const res = await undiciFetch(this.config.healthCheckUrl, {
        method: 'GET',
        dispatcher,
        signal: AbortSignal.timeout(this.config.timeout),
      });
      await res.body?.cancel();
      return res.ok;
    } catch {
      return false;
    } finally {
      await dispatcher?.close().catch(() => undefined);
    }
  }

  // ---------------------------------------------------------------
  // Yardımcılar
  // ---------------------------------------------------------------

  private maskProxyUrl(url: string): string {
    try {
      const parsed = new URL(url);
      const auth = parsed.username ? `${parsed.username}:****@` : '';
      return `${parsed.protocol}//${auth}${parsed.hostname}:${parsed.port}`;
    } catch {
      return url.substring(0, 20) + '...';
    }
  }

  public getStats(): {
    total: number;
    active: number;
    banned: number;
    failed: number;
    averageResponseTime: number;
  } {
    const total = this.proxies.length;
    const active = this.proxies.filter(p => p.isActive && !p.isBanned).length;
    const banned = this.proxies.filter(p => p.isBanned).length;
    const failed = this.proxies.filter(p => !p.isActive && !p.isBanned).length;
    const sum = this.proxies.reduce((s, p) => s + p.averageResponseTime, 0);

    return {
      total,
      active,
      banned,
      failed,
      averageResponseTime: total ? Math.round(sum / total) : 0,
    };
  }

  public getAllProxies(): ProxyStatus[] {
    return [...this.proxies];
  }

  /** DİKKAT: Kimlik bilgileri düz metin yazılır; dosyayı .gitignore'a ekle. */
  public saveToFile(filePath: string): void {
    const lines = this.proxies.map(p => `${p.provider}|${p.url}`);
    fs.writeFileSync(filePath, lines.join('\n'));
    this.logger?.info(`Saved ${this.proxies.length} proxies to ${filePath}`);
  }

  public close(): void {
    this.closed = true;

    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = undefined;
    }

    this.clearBanTimers();
    this.logger?.info('ProxyManager closed');
  }
}

// ---------------------------------------------------------------
// Factory (isimlendirilmiş örnekler)
// ---------------------------------------------------------------

const instances = new Map<string, ProxyManager>();

/** Aynı isimle tekrar çağrılırsa eski örnek kapatılır, timer sızmaz. */
export function createProxyManager(
  name = 'default',
  config?: Partial<ProxyManagerConfig>,
  logger?: Logger
): ProxyManager {
  instances.get(name)?.close();
  const manager = new ProxyManager(config, logger);
  instances.set(name, manager);
  return manager;
}

export function getNamedProxyManager(name = 'default'): ProxyManager | undefined {
  return instances.get(name);
}

export function closeNamedProxyManager(name = 'default'): void {
  instances.get(name)?.close();
  instances.delete(name);
}

export function closeAllProxyManagers(): void {
  for (const manager of instances.values()) manager.close();
  instances.clear();
}

// ---------------------------------------------------------------
// Geriye uyumlu singleton
// ---------------------------------------------------------------

let singletonInstance: ProxyManager | null = null;

export function getProxyManager(config?: Partial<ProxyManagerConfig>, logger?: Logger): ProxyManager {
  if (!singletonInstance) {
    singletonInstance = new ProxyManager(config, logger);
  }
  return singletonInstance;
}

export function resetProxyManager(): void {
  singletonInstance?.close();
  singletonInstance = null;
}