// src/core/proxy-manager.ts (DÜZELTİLMİŞ)

import * as fs from 'fs';
import {
  ProxyItem,
} from '../types';
import { Logger } from '../utils/logger';

/**
 * Proxy durum bilgisi
 */
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

/**
 * Proxy rotasyon stratejisi
 */
export type RotationStrategy = 'round-robin' | 'random' | 'least-used' | 'weighted';

/**
 * ProxyManager yapılandırması
 */
export interface ProxyManagerConfig {
  rotationInterval: number; // saniye
  maxFailures: number;
  banDuration: number; // dakika
  healthCheckInterval: number; // dakika
  strategy: RotationStrategy;
  timeout: number; // ms
}

/**
 * ProxyManager sınıfı
 * Proxy listesi yönetimi, rotasyon ve health check işlemlerini yapar
 */
export class ProxyManager {
  private proxies: ProxyStatus[] = [];
  private currentIndex: number = 0;
  private config: ProxyManagerConfig;
  private logger?: Logger;
  private healthCheckTimer?: NodeJS.Timeout;
  private usageStats: Map<string, { count: number; lastUsed: Date }> = new Map();

  // Varsayılan yapılandırma
  private static readonly defaultConfig: ProxyManagerConfig = {
    rotationInterval: 300, // 5 dakika
    maxFailures: 3,
    banDuration: 60, // 1 saat
    healthCheckInterval: 10, // 10 dakika
    strategy: 'round-robin',
    timeout: 10000, // 10 saniye
  };

  constructor(config: Partial<ProxyManagerConfig> = {}, logger?: Logger) {
    this.config = { ...ProxyManager.defaultConfig, ...config };
    this.logger = logger;
  }

  /**
   * Proxy listesini dosyadan yükler
   */
  public loadFromFile(filePath: string): void {
    this.logger?.info(`Loading proxies from ${filePath}`);
    
    if (!fs.existsSync(filePath)) {
      this.logger?.error(`Proxy file not found: ${filePath}`);
      throw new Error(`Proxy file not found: ${filePath}`);
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim());
    
    const proxies: ProxyItem[] = lines.map((line, index) => {
      const parts = line.split('|').map(p => p.trim());
      return {
        name: parts[0] || `proxy-${index}`,
        url: parts[1] || line.trim(),
      };
    });

    this.loadProxies(proxies);
  }

  /**
   * Proxy listesini doğrudan yükler
   */
  public loadProxies(proxyList: ProxyItem[]): void {
    this.logger?.info(`Loading ${proxyList.length} proxies`);
    
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

    // Health check başlat
    this.startHealthCheck();
    
    this.logger?.info(`Loaded ${this.proxies.length} proxies successfully`);
  }

  /**
   * Bir sonraki proxy'yi döndürür (rotasyon stratejisine göre)
   */
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
        selected = available.sort((a, b) => {
          const aStats = this.usageStats.get(a.url)?.count || 0;
          const bStats = this.usageStats.get(b.url)?.count || 0;
          return aStats - bStats;
        })[0];
        break;
        
      case 'weighted':
        // Response time'a göre ağırlıklı seçim
        selected = this.selectWeightedProxy(available);
        break;
        
      case 'round-robin':
      default:
        selected = available[this.currentIndex % available.length];
        this.currentIndex = (this.currentIndex + 1) % available.length;
        break;
    }

    // Kullanım istatistiğini güncelle
    const stats = this.usageStats.get(selected.url) || { count: 0, lastUsed: new Date() };
    stats.count++;
    stats.lastUsed = new Date();
    this.usageStats.set(selected.url, stats);

    selected.lastUsed = new Date();
    
    this.logger?.debug(`Selected proxy: ${this.maskProxyUrl(selected.url)}`);
    
    return selected;
  }

  /**
   * Ağırlıklı proxy seçimi (response time'a göre)
   */
  private selectWeightedProxy(proxies: ProxyStatus[]): ProxyStatus {
    // Daha hızlı proxy'ler daha yüksek şansa sahip
    const totalWeight = proxies.reduce((sum, p) => sum + (1000 / Math.max(p.averageResponseTime, 1)), 0);
    let random = Math.random() * totalWeight;
    
    for (const proxy of proxies) {
      const weight = 1000 / Math.max(proxy.averageResponseTime, 1);
      random -= weight;
      if (random <= 0) return proxy;
    }
    
    return proxies[proxies.length - 1];
  }

  /**
   * Kullanılabilir proxy'leri döndürür
   */
  public getAvailableProxies(): ProxyStatus[] {
    return this.proxies.filter(p => p.isActive && !p.isBanned);
  }

  /**
   * Proxy'yi başarısız olarak işaretler
   */
  public markFailed(proxyUrl: string, error?: string): void {
    const proxy = this.proxies.find(p => p.url === proxyUrl);
    if (!proxy) return;

    proxy.failCount++;
    proxy.lastError = error;

    this.logger?.warn(`Proxy marked as failed: ${this.maskProxyUrl(proxyUrl)}`, {
      failCount: proxy.failCount,
      error,
    });

    if (proxy.failCount >= this.config.maxFailures) {
      this.banProxy(proxyUrl);
    }
  }

  /**
   * Proxy'yi başarılı olarak işaretler
   */
  public markSuccess(proxyUrl: string, responseTime: number): void {
    const proxy = this.proxies.find(p => p.url === proxyUrl);
    if (!proxy) return;

    proxy.successCount++;
    proxy.failCount = 0;
    proxy.lastError = undefined;
    
    // Ortalama response time'ı güncelle (EMA - Exponential Moving Average)
    proxy.averageResponseTime = 
      proxy.averageResponseTime === 0 
        ? responseTime 
        : proxy.averageResponseTime * 0.7 + responseTime * 0.3;

    this.logger?.debug(`Proxy marked as success: ${this.maskProxyUrl(proxyUrl)}`, {
      responseTime,
      averageResponseTime: proxy.averageResponseTime,
    });
  }

  /**
   * Proxy'yi banlar (geçici olarak)
   */
  public banProxy(proxyUrl: string, duration?: number): void {
    const proxy = this.proxies.find(p => p.url === proxyUrl);
    if (!proxy) return;

    proxy.isBanned = true;
    const banDuration = duration || this.config.banDuration;
    
    this.logger?.warn(`Proxy banned: ${this.maskProxyUrl(proxyUrl)} for ${banDuration} minutes`);

    // Ban süresi sonunda otomatik aç
    setTimeout(() => {
      this.unbanProxy(proxyUrl);
    }, banDuration * 60 * 1000);
  }

  /**
   * Proxy'nin banını kaldırır
   */
  public unbanProxy(proxyUrl: string): void {
    const proxy = this.proxies.find(p => p.url === proxyUrl);
    if (!proxy) return;

    proxy.isBanned = false;
    proxy.failCount = 0;
    proxy.lastError = undefined;
    
    this.logger?.info(`Proxy unbanned: ${this.maskProxyUrl(proxyUrl)}`);
  }

  /**
   * Health check başlatır
   */
  private startHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }

    this.healthCheckTimer = setInterval(() => {
      this.performHealthCheck();
    }, this.config.healthCheckInterval * 60 * 1000);

    this.logger?.info(`Health check started (interval: ${this.config.healthCheckInterval} min)`);
  }

  /**
   * Health check yapar
   */
  private async performHealthCheck(): Promise<void> {
    this.logger?.debug('Performing health check...');
    
    for (const proxy of this.proxies) {
      if (proxy.isBanned) continue;
      
      const startTime = Date.now();
      const isHealthy = await this.checkProxyHealth(proxy.url);
      const responseTime = Date.now() - startTime;
      
      if (isHealthy) {
        proxy.isActive = true;
        proxy.averageResponseTime = responseTime;
      } else {
        proxy.isActive = false;
        this.logger?.warn(`Health check failed for proxy: ${this.maskProxyUrl(proxy.url)}`);
      }
    }
    
    this.logger?.debug('Health check completed');
  }

  /**
   * Proxy'nin sağlığını kontrol eder
   */
  private async checkProxyHealth(proxyUrl: string): Promise<boolean> {
    try {
      // Basit bir HTTP HEAD request yap
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.timeout);
      
      // Proxy URL'sini parse et
      const url = new URL(proxyUrl);
      const targetUrl = `${url.protocol}//httpbin.org/ip`;
      
      const response = await fetch(targetUrl, {
        method: 'HEAD',
        signal: controller.signal,
      });
      
      clearTimeout(timeout);
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  /**
   * Proxy URL'sini maskele (güvenlik için)
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
   * İstatistikleri döndürür
   */
  public getStats(): {
    total: number;
    active: number;
    banned: number;
    failed: number;
    averageResponseTime: number;
  } {
    const active = this.proxies.filter(p => p.isActive && !p.isBanned).length;
    const banned = this.proxies.filter(p => p.isBanned).length;
    const failed = this.proxies.filter(p => !p.isActive && !p.isBanned).length;
    const avgResponseTime = this.proxies.reduce((sum, p) => sum + p.averageResponseTime, 0) / this.proxies.length || 0;

    return {
      total: this.proxies.length,
      active,
      banned,
      failed,
      averageResponseTime: Math.round(avgResponseTime),
    };
  }

  /**
   * Tüm proxy'leri döndürür
   */
  public getAllProxies(): ProxyStatus[] {
    return [...this.proxies];
  }

  /**
   * Proxy listesini dosyaya kaydeder
   */
  public saveToFile(filePath: string): void {
    const lines = this.proxies.map(p => `${p.provider}|${p.url}`);
    fs.writeFileSync(filePath, lines.join('\n'));
    this.logger?.info(`Saved ${this.proxies.length} proxies to ${filePath}`);
  }

  /**
   * ProxyManager'ı kapatır
   */
  public close(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }
    this.logger?.info('ProxyManager closed');
  }
}

// Singleton instance
let instance: ProxyManager | null = null;

/**
 * ProxyManager singleton getter
 */
export function getProxyManager(config?: Partial<ProxyManagerConfig>, logger?: Logger): ProxyManager {
  if (!instance) {
    instance = new ProxyManager(config, logger);
  }
  return instance;
}

/**
 * Reset singleton instance (for testing)
 */
export function resetProxyManager(): void {
  instance?.close();
  instance = null;
}