/**
 * Logger Modülü Testleri
 * Tüm logger fonksiyonlarının birim testleri
 */

import { Logger, getLogger, resetLogger } from '../../../src/utils/logger';
import { LogLevel } from '../../../src/types';
import { existsSync, readFileSync, rmSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';

/**
 * Test suite: Logger
 */
describe('Logger', () => {
  // Test log dizini
  const testLogDir = './test-logs';
  let logger: Logger;

  /**
   * Log dosya yolunu oluşturur (logger.ts ile aynı mantık)
   * @param type - Log tipi (system, success, failed, debug)
   * @returns Tam dosya yolu
   */
  function getTestLogFilePath(type: string): string {
    const date = format(new Date(), 'yyyy-MM-dd', { locale: tr });
    return join(testLogDir, type, `${date}.log`);
  }

  /**
   * Dizindeki ilk dosyanın içeriğini okur
   * @param dirPath - Dizin yolu
   * @returns Dosya içeriği veya boş string
   */
  function readFirstFileInDir(dirPath: string): string {
    if (!existsSync(dirPath)) return '';
    
    const files = readdirSync(dirPath).filter(f => f.endsWith('.log'));
    if (files.length === 0) return '';
    
    const firstFile = join(dirPath, files[0]);
    return readFileSync(firstFile, 'utf-8');
  }

  /**
   * Her test öncesi çalışır
   * Test log dizinini temizler ve yeni logger oluşturur
   */
  beforeEach(() => {
    // Eski test loglarını temizle
    if (existsSync(testLogDir)) {
      rmSync(testLogDir, { recursive: true, force: true });
    }
    
    // Alt dizinleri oluştur
    ['system', 'success', 'failed', 'debug'].forEach(dir => {
      mkdirSync(join(testLogDir, dir), { recursive: true });
    });

    // Yeni logger instance oluştur
    logger = new Logger({
      level: LogLevel.DEBUG,
      logDir: testLogDir,
      consoleOutput: false,
      fileOutput: true
    });
  });

  /**
   * Her test sonrası çalışır
   * Logger'ı kapatır ve log dosyalarını temizler
   */
  afterEach(() => {
    logger.close();
    if (existsSync(testLogDir)) {
      rmSync(testLogDir, { recursive: true, force: true });
    }
    resetLogger();
  });

  /**
   * Test grubu: Temel Loglama
   */
  describe('Temel Loglama', () => {
    test('log dosyaları oluşturulmalı', () => {
      logger.info('Test mesajı');
      logger.close();

      const systemLogPath = getTestLogFilePath('system');
      expect(existsSync(systemLogPath)).toBe(true);
    });

    test('farklı seviyeler loglanmalı', () => {
      logger.error('Hata mesajı');
      logger.warn('Uyarı mesajı');
      logger.info('Bilgi mesajı');
      logger.debug('Debug mesajı');
      logger.close();

      // Dizinden ilk log dosyasını oku
      const content = readFirstFileInDir(join(testLogDir, 'system'));
      
      expect(content).toContain('ERROR');
      expect(content).toContain('WARN');
      expect(content).toContain('INFO');
      expect(content).toContain('DEBUG');
    });

    test('log seviyesi saygı gösterilmeli', () => {
      const restrictedLogger = new Logger({
        level: LogLevel.ERROR,
        logDir: testLogDir,
        consoleOutput: false,
        fileOutput: true
      });

      restrictedLogger.error('Hata');
      restrictedLogger.info('Bilgi'); // Bu loglanmamalı
      restrictedLogger.close();

      const content = readFirstFileInDir(join(testLogDir, 'system'));
      
      expect(content).toContain('Hata');
      expect(content).not.toContain('Bilgi');
    });
  });

  /**
   * Test grubu: SERP Click Loglama
   */
  describe('SERP Click Loglama', () => {
    test('tıklama denemesi loglanmalı', () => {
      logger.logClickAttempt({
        keyword: 'test anahtar kelime',
        targetUrl: 'https://ornek.com',
        proxy: '185.123.456.78:8080',
        fingerprint: 'chrome-win10',
        sessionId: 'sess-001',
        timestamp: new Date().toISOString()
      });
      logger.close();

      const content = readFirstFileInDir(join(testLogDir, 'system'));
      
      expect(content).toContain('SERP_CLICK_ATTEMPT');
      expect(content).toContain('test anahtar kelime');
      expect(content).toContain('sess-001');
    });

    test('başarılı tıklama loglanmalı', () => {
      logger.logClickSuccess({
        keyword: 'test anahtar kelime',
        targetUrl: 'https://ornek.com',
        proxy: '185.123.456.78:8080',
        fingerprint: 'chrome-win10',
        sessionId: 'sess-001',
        timestamp: new Date().toISOString(),
        position: 5,
        duration: 45000
      });
      logger.close();

      const content = readFirstFileInDir(join(testLogDir, 'success'));
      
      expect(content).toContain('SERP_CLICK_SUCCESS');
      expect(content).toContain('"success":true');
      expect(content).toContain('45000');
    });

    test('başarısız tıklama loglanmalı', () => {
      const error = new Error('CAPTCHA algılandı');
      logger.logClickFailure({
        keyword: 'test anahtar kelime',
        targetUrl: 'https://ornek.com',
        proxy: '185.123.456.78:8080',
        fingerprint: 'chrome-win10',
        sessionId: 'sess-001',
        timestamp: new Date().toISOString(),
        reason: 'CAPTCHA algılandı',
        error
      });
      logger.close();

      const content = readFirstFileInDir(join(testLogDir, 'failed'));
      
      expect(content).toContain('SERP_CLICK_FAILED');
      expect(content).toContain('"success":false');
      expect(content).toContain('CAPTCHA algılandı');
    });

    test('bot tespiti loglanmalı', () => {
      logger.logBotDetection({
        detectionType: 'mouse_pattern',
        confidence: 0.85,
        proxy: '185.123.456.78:8080',
        fingerprint: 'chrome-win10',
        sessionId: 'sess-001',
        pageUrl: 'https://google.com',
        timestamp: new Date().toISOString()
      });
      logger.close();

      const content = readFirstFileInDir(join(testLogDir, 'system'));
      
      expect(content).toContain('BOT_DETECTION_DETECTED');
      expect(content).toContain('mouse_pattern');
      expect(content).toContain('0.85');
    });
  });

  /**
   * Test grubu: Metrik Loglama
   */
  describe('Metrik Loglama', () => {
    test('günlük metrikler loglanmalı', () => {
      logger.logMetrics({
        totalClicks: 100,
        successfulClicks: 85,
        failedClicks: 15,
        successRate: 85,
        avgDuration: 45000,
        activeProxies: 10,
        activeFingerprints: 50,
        timestamp: new Date().toISOString()
      });
      logger.close();

      const content = readFirstFileInDir(join(testLogDir, 'system'));
      
      expect(content).toContain('METRICS');
      expect(content).toContain('"successRate":85');
      expect(content).toContain('"totalClicks":100');
    });
  });

  /**
   * Test grubu: Singleton Pattern
   */
  describe('Singleton Pattern', () => {
    test('getLogger aynı instance döndürmeli', () => {
      const logger1 = getLogger({ logDir: testLogDir, consoleOutput: false });
      const logger2 = getLogger();
      
      expect(logger1).toBe(logger2);
      logger1.close();
    });

    test('setGlobalLogger instance değiştirmeli', () => {
      const newLogger = new Logger({ logDir: testLogDir, consoleOutput: false });
      const { setGlobalLogger } = require('../../../src/utils/logger');
      setGlobalLogger(newLogger);
      
      const retrieved = getLogger();
      expect(retrieved).toBe(newLogger);
      newLogger.close();
    });
  });

  /**
   * Test grubu: Bağlam ve Hata İşleme
   */
  describe('Bağlam ve Hata İşleme', () => {
    test('bağlam loglanmalı', () => {
      logger.info('Bağlamlı mesaj', { userId: '123', action: 'click' });
      logger.close();

      const content = readFirstFileInDir(join(testLogDir, 'system'));
      
      expect(content).toContain('userId');
      expect(content).toContain('123');
    });

    test('hata nesneleri loglanmalı', () => {
      const error = new Error('Test hatası');
      error.stack = 'Error: Test hatası\n    at Test.method';
      
      logger.error('Hata oluştu', error);
      logger.close();

      const content = readFirstFileInDir(join(testLogDir, 'system'));
      
      expect(content).toContain('Test hatası');
    });
  });
});