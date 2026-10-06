import { FingerprintGenerator, getFingerprintGenerator, resetFingerprintGenerator } from '../../../src/core/fingerprint-generator';

interface Logger {
  debug: (message: string, context?: any) => void;
  info: (message: string, context?: any) => void;
  warn: (message: string, context?: any) => void;
  error: (message: string, context?: any) => void;
}

describe('FingerprintGenerator', () => {
  let generator: FingerprintGenerator;
  let mockLogger: jest.Mocked<Logger>;

  beforeEach(() => {
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as jest.Mocked<Logger>;
    
    resetFingerprintGenerator();
    generator = new FingerprintGenerator('./test-data/fingerprints', mockLogger);
  });

  afterEach(() => {
    // Cleanup test data
    const fs = require('fs');
    const path = require('path');
    const testDir = path.join(process.cwd(), 'test-data');
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('generate', () => {
    it('should generate 2000 fingerprints (1000 mobile, 1000 desktop)', () => {
      const result = generator.generate(1000, 1000);
      
      expect(result.metadata.totalCount).toBe(2000);
      expect(result.metadata.mobileCount).toBe(1000);
      expect(result.metadata.desktopCount).toBe(1000);
      expect(result.mobile.length).toBe(1000);
      expect(result.desktop.length).toBe(1000);
    });

    it('should generate mobile fingerprints with correct properties', () => {
      generator.generate(10, 0);
      const fp = generator.getRandom('mobile');
      
      expect(fp).not.toBeNull();
      expect(fp!.type).toBe('mobile');
      expect(fp!.id).toMatch(/^fp-mobile-/);
      expect(fp!.userAgent).toContain('Mobile');
      expect(fp!.maxTouchPoints).toBeGreaterThan(0);
      expect(fp!.deviceMemory).toBeLessThanOrEqual(12);
      expect(fp!.battery).toBeDefined();
    });

    it('should generate desktop fingerprints with correct properties', () => {
      generator.generate(0, 10);
      const fp = generator.getRandom('desktop');
      
      expect(fp).not.toBeNull();
      expect(fp!.type).toBe('desktop');
      expect(fp!.id).toMatch(/^fp-desktop-/);
      expect(fp!.maxTouchPoints).toBe(0);
      expect(fp!.deviceMemory).toBeGreaterThanOrEqual(4);
      expect(fp!.battery).toBeUndefined();
    });

    it('should have consistent fingerprint properties', () => {
      generator.generate(5, 5);
      const fp = generator.getRandom();
      
      expect(fp).not.toBeNull();
      expect(fp!.productSub).toBe('20030107');
    });

    it('should include Google Stealth features', () => {
      generator.generate(5, 5);
      const fp = generator.getRandom();
      
      expect(fp).not.toBeNull();
      expect(fp!.pdfViewerEnabled).toBe(true);
    });

    it('should include plugins and mimeTypes', () => {
      generator.generate(5, 5);
      const fp = generator.getRandom();
      
      expect(fp).not.toBeNull();
      expect(fp!.plugins).toBeDefined();
      expect(fp!.mimeTypes).toBeDefined();
      expect(typeof fp!.pluginsLength).toBe('number');
      expect(typeof fp!.mimeTypesLength).toBe('number');
    });

    it('should include speech synthesis voices', () => {
      generator.generate(5, 5);
      const fp = generator.getRandom();
      
      expect(fp).not.toBeNull();
      expect(fp!.speechSynthesisVoices).toBeGreaterThan(0);
    });
  });

  describe('getForKeyword', () => {
    it('should return mobile fingerprint when isMobile is 1', () => {
      generator.generate(100, 100);
      const fp = generator.getForKeyword({ isMobile: 1 });
      
      expect(fp).not.toBeNull();
      expect(fp!.type).toBe('mobile');
    });

    it('should return desktop fingerprint when isMobile is 0', () => {
      generator.generate(100, 100);
      const fp = generator.getForKeyword({ isMobile: 0 });
      
      expect(fp).not.toBeNull();
      expect(fp!.type).toBe('desktop');
    });
  });

  describe('getById', () => {
    it('should find fingerprint by id', () => {
      generator.generate(10, 10);
      const randomFp = generator.getRandom();
      
      expect(randomFp).not.toBeNull();
      const found = generator.getById(randomFp!.id);
      
      expect(found).toBeDefined();
      expect(found!.id).toBe(randomFp!.id);
    });
  });

  describe('getMultiple', () => {
    it('should return multiple fingerprints', () => {
      generator.generate(100, 100);
      const fps = generator.getMultiple(50);
      
      expect(fps.length).toBe(50);
    });
  });

  describe('getCount', () => {
    it('should return correct counts', () => {
      generator.generate(100, 200);
      const counts = generator.getCount();
      
      expect(counts.total).toBe(300);
      expect(counts.mobile).toBe(100);
      expect(counts.desktop).toBe(200);
    });
  });

  describe('persistence', () => {
    it('should save and load fingerprints', () => {
      generator.generate(10, 10);
      const randomFp = generator.getRandom();
      expect(randomFp).not.toBeNull();
      
      generator.saveToFile('test-fingerprints.json');
      
      const newGenerator = new FingerprintGenerator('./test-data/fingerprints', mockLogger);
      newGenerator.loadFromFile('test-fingerprints.json');
      
      const loadedFp = newGenerator.getById(randomFp!.id);
      expect(loadedFp).toBeDefined();
      expect(loadedFp!.id).toBe(randomFp!.id);
    });
  });

  describe('singleton', () => {
    it('should return same instance via getFingerprintGenerator', () => {
      const instance1 = getFingerprintGenerator('./test-data', mockLogger);
      const instance2 = getFingerprintGenerator('./test-data', mockLogger);
      
      expect(instance1).toBe(instance2);
    });

    it('should create new instance after reset', () => {
      const instance1 = getFingerprintGenerator('./test-data', mockLogger);
      resetFingerprintGenerator();
      const instance2 = getFingerprintGenerator('./test-data', mockLogger);
      
      expect(instance1).not.toBe(instance2);
    });
  });
});