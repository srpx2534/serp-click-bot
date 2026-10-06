/**
 * Logger Modülü
 * Uygulama genelinde kullanılan merkezi loglama sistemi
 * Structured JSON logging, dosya rotasyonu ve async desteği sağlar
 */
import { existsSync, mkdirSync, appendFileSync } from 'fs';
import { join } from 'path';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import {
  LogLevel,
  LogEntry,
  LoggerConfig,
  ClickAttempt,
  ClickSuccess,
  ClickFailure,
  BotDetectionEvent,
  DailyMetrics
} from '../types';

// LogLevel'ı dışarıya export et (testler ve diğer modüller için)
export { LogLevel } from '../types';

// Varsayılan logger yapılandırması
const defaultConfig: LoggerConfig = {
  level: LogLevel.DEBUG,           // Varsayılan: tüm seviyeler
  logDir: './data/logs',            // Log dizini
  consoleOutput: true,              // Konsola yaz
  fileOutput: true,                 // Dosyaya yaz
  maxFileSize: 10,                 // Maksimum 10MB
  maxFiles: 10,                    // 10 dosya tut
  includeTimestamp: true,          // Zaman damgası ekle
  includeContext: true             // Bağlam bilgisi ekle
};

/**
 * Logger sınıfı
 * Merkezi loglama yönetimi için kullanılır
 */
export class Logger {
  // Logger yapılandırması
  private config: LoggerConfig;
  // Bellekte biriken loglar (tip -> log dizisi)
  private logBuffer: Map<string, string[]> = new Map();
  // Buffer boyutu (bu sayıya ulaşınca flush edilir)
  private bufferSize: number = 100;
  // Periyodik flush zamanlayıcısı
  private flushInterval: NodeJS.Timeout | null = null;

  /**
   * Logger constructor
   * @param config - Logger yapılandırma seçenekleri
   */
  constructor(config: Partial<LoggerConfig> = {}) {
    // Varsayılan ve kullanıcı yapılandırmasını birleştir
    this.config = { ...defaultConfig, ...config };
    // Log dizinlerini oluştur
    this.ensureLogDirectory();
    // Periyodik flush başlat
    this.startFlushInterval();
  }

  /**
   * Log dizinlerini oluşturur
   * success, failed, debug, system alt dizinlerini oluşturur
   */
  private ensureLogDirectory(): void {
    const dirs = ['success', 'failed', 'debug', 'system'];
    dirs.forEach(dir => {
      const path = join(this.config.logDir, dir);
      if (!existsSync(path)) {
        mkdirSync(path, { recursive: true });
      }
    });
  }

  /**
   * Log dosya adını oluşturur
   * Format: YYYY-MM-DD.log
   * @param type - Log tipi (success, failed, debug, system)
   * @returns Dosya yolu
   */
  private getLogFileName(type: string = 'system'): string {
    const date = format(new Date(), 'yyyy-MM-dd', { locale: tr });
    return join(this.config.logDir, type, `${date}.log`);
  }

  /**
   * Log seviyesi kontrolü
   * @param level - Kontrol edilecek seviye
   * @returns Loglanmalı mı?
   */
  private shouldLog(level: LogLevel): boolean {
    return level <= this.config.level;
  }

  /**
   * Log girişini konsol formatına çevirir
   * @param entry - Log girişi
   * @returns Formatlanmış string
   */
  private formatEntry(entry: LogEntry): string {
    const timestamp = this.config.includeTimestamp 
      ? `[${entry.timestamp}] `
      : '';
    
    const level = `[${entry.level.toUpperCase()}]`;
    const message = entry.message;
    
    let logLine = `${timestamp}${level} ${message}`;

    // Bağlam bilgisini ekle
    if (this.config.includeContext && entry.context) {
      logLine += ` | Context: ${JSON.stringify(entry.context)}`;
    }

    // Ekstra alanları ekle
    if (entry.sessionId) {
      logLine += ` | Session: ${entry.sessionId}`;
    }

    if (entry.proxy) {
      logLine += ` | Proxy: ${entry.proxy}`;
    }

    if (entry.duration) {
      logLine += ` | Duration: ${entry.duration}ms`;
    }

    if (entry.success !== undefined) {
      logLine += ` | Success: ${entry.success}`;
    }

    if (entry.error) {
      logLine += ` | Error: ${entry.error.message}`;
    }

    return logLine;
  }

  /**
   * Log girişini JSON formatına çevirir (dosya için)
   * @param entry - Log girişi
   * @returns JSON string
   */
  private formatJSON(entry: LogEntry): string {
    const serialized: any = { ...entry };
    
    // entry.error'u düzgün şekilde serialize et
    if (entry.error) {
      serialized.error = {
        message: entry.error.message,
        stack: entry.error.stack,
        name: entry.error.name
      };
    }
    
    // context.error'u da düzgün şekilde serialize et
    if (entry.context?.error && entry.context.error instanceof Error) {
      serialized.context = {
        ...entry.context,
        error: {
          message: entry.context.error.message,
          stack: entry.context.error.stack,
          name: entry.context.error.name
        }
      };
    }
    
    return JSON.stringify(serialized) + '\n';
  }

  /**
   * Konsol renk kodlarını döndürür
   * @param level - Log seviyesi
   * @returns ANSI renk kodu
   */
  private getColor(level: LogLevel): string {
    switch (level) {
      case LogLevel.ERROR: return '\x1b[31m'; // Kırmızı
      case LogLevel.WARN: return '\x1b[33m';  // Sarı
      case LogLevel.INFO: return '\x1b[32m';  // Yeşil
      case LogLevel.DEBUG: return '\x1b[36m'; // Mavi
      case LogLevel.TRACE: return '\x1b[35m'; // Mor
      default: return '\x1b[0m';              // Reset
    }
  }

  /**
   * Ana log metodu
   * @param level - Log seviyesi
   * @param levelName - Seviye adı (string)
   * @param message - Log mesajı
   * @param context - Ekstra bağlam
   */
  private log(level: LogLevel, levelName: string, message: string, context?: Record<string, unknown>): void {
    // Seviye kontrolü
    if (!this.shouldLog(level)) return;

    // Log girişini oluştur
    const entry: LogEntry = {
      timestamp: format(new Date(), 'yyyy-MM-dd HH:mm:ss.SSS', { locale: tr }),
      level: levelName,
      message,
      context
    };

    // Buffer'a ekle
    const logType = 'system';
    if (!this.logBuffer.has(logType)) {
      this.logBuffer.set(logType, []);
    }
    this.logBuffer.get(logType)!.push(this.formatJSON(entry));

    // Konsola yaz
    if (this.config.consoleOutput) {
      const color = this.getColor(level);
      console.log(color, this.formatEntry(entry).trim(), '\x1b[0m');
    }

    // Buffer dolduysa flush et
    if (this.logBuffer.get(logType)!.length >= this.bufferSize) {
      this.flush(logType);
    }
  }

  /**
   * Buffer'daki logları dosyaya yazar
   * @param logType - Log tipi
   */
  private flush(logType: string = 'system'): void {
    const buffer = this.logBuffer.get(logType);
    if (!buffer || buffer.length === 0) return;

    const content = buffer.join('');
    this.logBuffer.set(logType, []);

    if (this.config.fileOutput) {
      const logFile = this.getLogFileName(logType);
      
      // Dizin yoksa oluştur (race condition önlemek için)
      const dir = join(this.config.logDir, logType);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      
      // Senkron yazma - testler için daha güvenli
      appendFileSync(logFile, content);
    }
  }

  /**
   * Periyodik flush zamanlayıcısını başlatır
   * Her 5 saniyede bir buffer'ı temizler
   */
  private startFlushInterval(): void {
    this.flushInterval = setInterval(() => {
      ['system', 'success', 'failed', 'debug'].forEach(type => this.flush(type));
    }, 5000);
  }

  /**
   * Hata logu yazar
   * @param message - Hata mesajı
   * @param error - Hata nesnesi
   * @param context - Ekstra bağlam
   */
  error(message: string, error?: Error | null, context?: Record<string, unknown>): void {
    this.log(LogLevel.ERROR, 'ERROR', message, { ...context, error });
  }

  /**
   * Uyarı logu yazar
   * @param message - Uyarı mesajı
   * @param context - Ekstra bağlam
   */
  warn(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.WARN, 'WARN', message, context);
  }

  /**
   * Bilgi logu yazar
   * @param message - Bilgi mesajı
   * @param context - Ekstra bağlam
   */
  info(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.INFO, 'INFO', message, context);
  }

  /**
   * Debug logu yazar
   * @param message - Debug mesajı
   * @param context - Ekstra bağlam
   */
  debug(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.DEBUG, 'DEBUG', message, context);
  }

  /**
   * Trace logu yazar (en detaylı)
   * @param message - Trace mesajı
   * @param context - Ekstra bağlam
   */
  trace(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.TRACE, 'TRACE', message, context);
  }

  /**
   * SERP tıklama denemesi loglar
   * @param data - Tıklama denemesi bilgisi
   */
  logClickAttempt(data: ClickAttempt): void {
    this.info('SERP_CLICK_ATTEMPT', {
      ...data,
      event: 'click_attempt'
    });
  }

  /**
   * Başarılı SERP tıklaması loglar
   * @param data - Başarılı tıklama bilgisi
   */
  logClickSuccess(data: ClickSuccess): void {
    // timestamp'ı data'dan ayır
    const { timestamp: _dataTimestamp, ...restData } = data as any;
    
    const entry: LogEntry = {
      ...restData,
      timestamp: format(new Date(), 'yyyy-MM-dd HH:mm:ss.SSS', { locale: tr }),
      level: 'SUCCESS',
      message: 'SERP_CLICK_SUCCESS',
      success: true
    };

    // Sadece success dizinine yaz
    const successFile = this.getLogFileName('success');
    
    // Dizin yoksa oluştur
    const successDir = join(this.config.logDir, 'success');
    if (!existsSync(successDir)) {
      mkdirSync(successDir, { recursive: true });
    }
    
    appendFileSync(successFile, this.formatJSON(entry));
    
    // Konsola da bilgi ver (sadece consoleOutput aktifse)
    if (this.config.consoleOutput) {
      const color = '\x1b[32m'; // Yeşil
      console.log(color, `[INFO] SERP_CLICK_SUCCESS | Session: ${data.sessionId} | Success: true`, '\x1b[0m');
    }
  }

  /**
   * Başarısız SERP tıklaması loglar
   * @param data - Başarısız tıklama bilgisi
   */
  logClickFailure(data: ClickFailure): void {
    // timestamp'ı data'dan ayır
    const { timestamp: _dataTimestamp, ...restData } = data as any;
    
    const entry: LogEntry = {
      ...restData,
      timestamp: format(new Date(), 'yyyy-MM-dd HH:mm:ss.SSS', { locale: tr }),
      level: 'FAILED',
      message: 'SERP_CLICK_FAILED',
      success: false
    };

    // Sadece failed dizinine yaz
    const failedFile = this.getLogFileName('failed');
    
    // Dizin yoksa oluştur
    const failedDir = join(this.config.logDir, 'failed');
    if (!existsSync(failedDir)) {
      mkdirSync(failedDir, { recursive: true });
    }
    
    appendFileSync(failedFile, this.formatJSON(entry));
    
    // Konsola da bilgi ver
    if (this.config.consoleOutput) {
      const color = '\x1b[31m'; // Kırmızı
      console.log(color, `[ERROR] SERP_CLICK_FAILED | Session: ${data.sessionId} | Reason: ${data.reason}`, '\x1b[0m');
    }
  }

  /**
   * Bot tespiti olayını loglar
   * @param data - Bot tespiti bilgisi
   */
  logBotDetection(data: BotDetectionEvent): void {
    this.warn('BOT_DETECTION_DETECTED', {
      ...data,
      event: 'bot_detected',
      requiresAction: true
    });
  }

  /**
   * Günlük metrikleri loglar
   * @param data - Günlük metrik bilgisi
   */
  logMetrics(data: DailyMetrics): void {
    this.info('METRICS', {
      ...data,
      event: 'metrics',
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Logger'ı kapatır ve tüm buffer'ları temizler
   */
  close(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }
    // Tüm buffer'ları flush et
    ['system', 'success', 'failed', 'debug'].forEach(type => this.flush(type));
  }
}

// Global logger instance
let globalLogger: Logger | null = null;

/**
 * Global logger instance'ini döndürür
 * Singleton pattern - aynı instance'i paylaşır
 * @param config - Logger yapılandırması (ilk çağrıda kullanılır)
 * @returns Logger instance
 */
export function getLogger(config?: Partial<LoggerConfig>): Logger {
  if (!globalLogger) {
    globalLogger = new Logger(config);
  }
  return globalLogger;
}

/**
 * Global logger instance'ini değiştirir
 * @param logger - Yeni logger instance
 */
export function setGlobalLogger(logger: Logger): void {
  globalLogger = logger;
}

/**
 * Global logger'ı sıfırlar ve kapatır
 */
export function resetLogger(): void {
  if (globalLogger) {
    globalLogger.close();
    globalLogger = null;
  }
}