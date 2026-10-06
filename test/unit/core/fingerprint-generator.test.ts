import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  FingerprintGenerator,
  getFingerprintGenerator,
  resetFingerprintGenerator,
} from '../../../src/core/fingerprint-generator';

describe('FingerprintGenerator', () => {
  let dataDir: string;
  let generator: FingerprintGenerator;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'fingerprint-generator-test-'),
    );

    generator = new FingerprintGenerator(dataDir, undefined, {
      seed: 'test-seed',
    });

    resetFingerprintGenerator();
  });

  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
    resetFingerprintGenerator();
  });

  describe('constructor', () => {
    it('should create the data directory automatically', () => {
      const nestedDir = path.join(dataDir, 'nested', 'fingerprints');

      expect(fs.existsSync(nestedDir)).toBe(false);

      new FingerprintGenerator(nestedDir);

      expect(fs.existsSync(nestedDir)).toBe(true);
    });

    it('should initialize an empty collection', () => {
      expect(generator.getAllFingerprints()).toEqual([]);

      expect(generator.getCount()).toEqual({
        total: 0,
        mobile: 0,
        desktop: 0,
      });
    });
  });

  describe('generate()', () => {
    it('should generate the requested number of mobile and desktop fingerprints', () => {
      const result = generator.generate(10, 15);

      expect(result.mobile).toHaveLength(10);
      expect(result.desktop).toHaveLength(15);

      expect(result.metadata.totalCount).toBe(25);
      expect(result.metadata.mobileCount).toBe(10);
      expect(result.metadata.desktopCount).toBe(15);
    });

    it('should generate only mobile fingerprints when desktop count is zero', () => {
      const result = generator.generate(5, 0);

      expect(result.mobile).toHaveLength(5);
      expect(result.desktop).toHaveLength(0);

      expect(result.metadata.totalCount).toBe(5);
      expect(result.metadata.mobileCount).toBe(5);
      expect(result.metadata.desktopCount).toBe(0);
    });

    it('should generate only desktop fingerprints when mobile count is zero', () => {
      const result = generator.generate(0, 5);

      expect(result.mobile).toHaveLength(0);
      expect(result.desktop).toHaveLength(5);

      expect(result.metadata.totalCount).toBe(5);
      expect(result.metadata.mobileCount).toBe(0);
      expect(result.metadata.desktopCount).toBe(5);
    });

    it('should allow zero fingerprints', () => {
      const result = generator.generate(0, 0);

      expect(result.mobile).toEqual([]);
      expect(result.desktop).toEqual([]);

      expect(result.metadata.totalCount).toBe(0);
      expect(result.metadata.mobileCount).toBe(0);
      expect(result.metadata.desktopCount).toBe(0);
    });

    it('should reset the previous collection before generating', () => {
      generator.generate(5, 5);

      expect(generator.getCount().total).toBe(10);

      generator.generate(2, 3);

      expect(generator.getCount()).toEqual({
        total: 5,
        mobile: 2,
        desktop: 3,
      });
    });

    it('should generate unique fingerprint IDs', () => {
      const result = generator.generate(100, 100);

      const ids = [
        ...result.mobile.map((fingerprint) => fingerprint.id),
        ...result.desktop.map((fingerprint) => fingerprint.id),
      ];

      expect(new Set(ids).size).toBe(ids.length);
    });

    it('should generate IDs with the expected format', () => {
      const result = generator.generate(3, 3);

      for (const fingerprint of [
        ...result.mobile,
        ...result.desktop,
      ]) {
        expect(fingerprint.id).toMatch(
          /^fp-(mobile|desktop)-[a-f0-9]{20}$/,
        );
      }
    });

    it('should update collection metadata correctly', () => {
      generator.generate(7, 9);

      expect(generator.getStats()).toMatchObject({
        totalCount: 16,
        mobileCount: 7,
        desktopCount: 9,
        version: '2.0.0',
      });
    });
  });

  describe('deterministic RNG', () => {
    it('should produce the same fingerprints with the same seed', () => {
      const generatorA = new FingerprintGenerator(dataDir, undefined, {
        seed: 'same-seed',
      });

      const generatorB = new FingerprintGenerator(dataDir, undefined, {
        seed: 'same-seed',
      });

      const resultA = generatorA.generate(10, 10);
      const resultB = generatorB.generate(10, 10);

      expect(resultA.mobile).toEqual(resultB.mobile);
      expect(resultA.desktop).toEqual(resultB.desktop);
    });

    it('should produce different fingerprints with different seeds', () => {
      const generatorA = new FingerprintGenerator(dataDir, undefined, {
        seed: 'seed-a',
      });

      const generatorB = new FingerprintGenerator(dataDir, undefined, {
        seed: 'seed-b',
      });

      const resultA = generatorA.generate(10, 10);
      const resultB = generatorB.generate(10, 10);

      expect(resultA.mobile).not.toEqual(resultB.mobile);
      expect(resultA.desktop).not.toEqual(resultB.desktop);
    });

    it('should produce deterministic results for numeric seeds', () => {
      const generatorA = new FingerprintGenerator(dataDir, undefined, {
        seed: 12345,
      });

      const generatorB = new FingerprintGenerator(dataDir, undefined, {
        seed: 12345,
      });

      expect(generatorA.generate(5, 5)).toEqual(
        generatorB.generate(5, 5),
      );
    });
  });

  describe('fingerprint validation', () => {
    it('should generate valid mobile fingerprints', () => {
      const { mobile } = generator.generate(20, 0);

      expect(mobile).toHaveLength(20);

      for (const fingerprint of mobile) {
        expect(fingerprint.type).toBe('mobile');
        expect(fingerprint.isMobile).toBe(true);
        expect(fingerprint.maxTouchPoints).toBeGreaterThan(0);
        expect(fingerprint.hardwareConcurrency).toBeGreaterThan(0);
        expect(fingerprint.deviceMemory).toBeGreaterThan(0);
        expect(fingerprint.viewport.width).toBeGreaterThan(0);
        expect(fingerprint.viewport.height).toBeGreaterThan(0);
        expect(fingerprint.screenResolution.width).toBeGreaterThan(0);
        expect(fingerprint.screenResolution.height).toBeGreaterThan(0);
      }
    });

    it('should generate valid desktop fingerprints', () => {
      const { desktop } = generator.generate(0, 20);

      expect(desktop).toHaveLength(20);

      for (const fingerprint of desktop) {
        expect(fingerprint.type).toBe('desktop');
        expect(fingerprint.isMobile).toBe(false);
        expect(fingerprint.maxTouchPoints).toBe(0);
        expect(fingerprint.hardwareConcurrency).toBeGreaterThan(0);
        expect(fingerprint.deviceMemory).toBeGreaterThan(0);
        expect(fingerprint.viewport.width).toBeGreaterThan(0);
        expect(fingerprint.viewport.height).toBeGreaterThan(0);
      }
    });

    it('should keep plugin count consistent', () => {
      const { mobile, desktop } = generator.generate(10, 10);

      for (const fingerprint of [...mobile, ...desktop]) {
        expect(fingerprint.pluginsLength).toBe(
          fingerprint.plugins.length,
        );
      }
    });

    it('should keep MIME type count consistent', () => {
      const { mobile, desktop } = generator.generate(10, 10);

      for (const fingerprint of [...mobile, ...desktop]) {
        expect(fingerprint.mimeTypesLength).toBe(
          fingerprint.mimeTypes.length,
        );
      }
    });

    it('should keep speech voice count consistent', () => {
      const { mobile, desktop } = generator.generate(10, 10);

      for (const fingerprint of [...mobile, ...desktop]) {
        expect(fingerprint.speechSynthesisVoices).toBe(
          fingerprint.speechVoices.length,
        );
      }
    });

    it('should set touch support correctly', () => {
      const { mobile, desktop } = generator.generate(10, 10);

      for (const fingerprint of mobile) {
        expect(fingerprint.touchSupport).toBe(true);
        expect(fingerprint.maxTouchPoints).toBeGreaterThan(0);
      }

      for (const fingerprint of desktop) {
        expect(fingerprint.touchSupport).toBe(false);
        expect(fingerprint.maxTouchPoints).toBe(0);
      }
    });
  });

  describe('generate() validation', () => {
    it('should reject non-integer mobile count', () => {
      expect(() =>
        generator.generate(1.5, 10),
      ).toThrow('mobileCount must be an integer');
    });

    it('should reject non-integer desktop count', () => {
      expect(() =>
        generator.generate(10, 1.5),
      ).toThrow('desktopCount must be an integer');
    });

    it('should reject negative mobile count', () => {
      expect(() =>
        generator.generate(-1, 10),
      ).toThrow('mobileCount cannot be negative');
    });

    it('should reject negative desktop count', () => {
      expect(() =>
        generator.generate(10, -1),
      ).toThrow('desktopCount cannot be negative');
    });

    it('should reject mobile count above safety limit', () => {
      expect(() =>
        generator.generate(100001, 0),
      ).toThrow(
        'mobileCount exceeds the safety limit of 100000',
      );
    });

    it('should reject desktop count above safety limit', () => {
      expect(() =>
        generator.generate(0, 100001),
      ).toThrow(
        'desktopCount exceeds the safety limit of 100000',
      );
    });
  });

  describe('getById()', () => {
    it('should return a fingerprint by ID', () => {
      generator.generate(5, 5);

      const all = generator.getAllFingerprints();
      const expected = all[0];

      const result = generator.getById(expected.id);

      expect(result).toEqual(expected);
    });

    it('should return undefined for an unknown ID', () => {
      generator.generate(5, 5);

      expect(
        generator.getById('fp-mobile-does-not-exist'),
      ).toBeUndefined();
    });

    it('should return undefined for an empty ID', () => {
      generator.generate(5, 5);

      expect(generator.getById('')).toBeUndefined();
    });

    it('should return undefined for non-string values at runtime', () => {
      generator.generate(5, 5);

      expect(
        generator.getById(null as unknown as string),
      ).toBeUndefined();

      expect(
        generator.getById(123 as unknown as string),
      ).toBeUndefined();
    });
  });

  describe('getRandom()', () => {
    it('should return null when collection is empty', () => {
      expect(generator.getRandom()).toBeNull();
    });

    it('should return a fingerprint from the collection', () => {
      generator.generate(10, 10);

      const result = generator.getRandom();

      expect(result).not.toBeNull();
      expect(generator.getById(result!.id)).toEqual(result);
    });

    it('should return only mobile fingerprints when requested', () => {
      generator.generate(20, 20);

      for (let i = 0; i < 20; i++) {
        const result = generator.getRandom('mobile');

        expect(result).not.toBeNull();
        expect(result!.type).toBe('mobile');
      }
    });

    it('should return only desktop fingerprints when requested', () => {
      generator.generate(20, 20);

      for (let i = 0; i < 20; i++) {
        const result = generator.getRandom('desktop');

        expect(result).not.toBeNull();
        expect(result!.type).toBe('desktop');
      }
    });

    it('should return null for a requested type that does not exist', () => {
      generator.generate(10, 0);

      expect(generator.getRandom('desktop')).toBeNull();
    });
  });

  describe('getForKeyword()', () => {
    it('should return null when collection is empty', () => {
      expect(
        generator.getForKeyword({
          isMobile: 1,
          keyword: 'test',
        }),
      ).toBeNull();
    });

    it('should return only mobile fingerprints for isMobile=1', () => {
      generator.generate(20, 20);

      for (let i = 0; i < 20; i++) {
        const result = generator.getForKeyword({
          isMobile: 1,
          keyword: `keyword-${i}`,
        });

        expect(result).not.toBeNull();
        expect(result!.type).toBe('mobile');
      }
    });

    it('should return only desktop fingerprints for isMobile=0', () => {
      generator.generate(20, 20);

      for (let i = 0; i < 20; i++) {
        const result = generator.getForKeyword({
          isMobile: 0,
          keyword: `keyword-${i}`,
        });

        expect(result).not.toBeNull();
        expect(result!.type).toBe('desktop');
      }
    });

    it('should return the same fingerprint for the same keyword', () => {
      generator.generate(50, 50);

      const first = generator.getForKeyword({
        isMobile: 1,
        keyword: 'stable-keyword',
      });

      const second = generator.getForKeyword({
        isMobile: 1,
        keyword: 'stable-keyword',
      });

      expect(first).toEqual(second);
    });

    it('should return a deterministic fingerprint independent of RNG state', () => {
      generator.generate(50, 50);

      const first = generator.getForKeyword({
        isMobile: 1,
        keyword: 'my-keyword',
      });

      generator.getRandom();
      generator.getRandom();
      generator.getMultiple(5);

      const second = generator.getForKeyword({
        isMobile: 1,
        keyword: 'my-keyword',
      });

      expect(second).toEqual(first);
    });

    it('should return a random fingerprint when keyword is omitted', () => {
      generator.generate(10, 10);

      const result = generator.getForKeyword({
        isMobile: 1,
      });

      expect(result).not.toBeNull();
      expect(result!.type).toBe('mobile');
    });
  });

  describe('getMultiple()', () => {
    it('should return an empty array for count zero', () => {
      generator.generate(10, 10);

      expect(generator.getMultiple(0)).toEqual([]);
    });

    it('should return the requested number of fingerprints', () => {
      generator.generate(20, 20);

      expect(generator.getMultiple(10)).toHaveLength(10);
    });

    it('should not return duplicates', () => {
      generator.generate(50, 50);

      const result = generator.getMultiple(50);
      const ids = result.map((fingerprint) => fingerprint.id);

      expect(new Set(ids).size).toBe(ids.length);
    });

    it('should not return more fingerprints than available', () => {
      generator.generate(3, 2);

      expect(generator.getMultiple(100)).toHaveLength(5);
    });

    it('should throw for negative count', () => {
      expect(() => generator.getMultiple(-1)).toThrow(
        'count must be a non-negative integer',
      );
    });

    it('should throw for non-integer count', () => {
      expect(() => generator.getMultiple(1.5)).toThrow(
        'count must be a non-negative integer',
      );
    });

    it('should not modify the underlying collection', () => {
      generator.generate(10, 10);

      const before = generator.getAllFingerprints();

      generator.getMultiple(5);

      const after = generator.getAllFingerprints();

      expect(after).toEqual(before);
    });
  });

  describe('getAllFingerprints()', () => {
    it('should return all fingerprints', () => {
      generator.generate(5, 7);

      expect(generator.getAllFingerprints()).toHaveLength(12);
    });

    it('should return a copy of the collection array', () => {
      generator.generate(5, 5);

      const result = generator.getAllFingerprints();

      result.pop();

      expect(generator.getCount().total).toBe(10);
    });
  });

  describe('getCount()', () => {
    it('should return correct counts', () => {
      generator.generate(13, 17);

      expect(generator.getCount()).toEqual({
        total: 30,
        mobile: 13,
        desktop: 17,
      });
    });
  });

  describe('getStats()', () => {
    it('should return collection metadata', () => {
      generator.generate(3, 4);

      const stats = generator.getStats();

      expect(stats.totalCount).toBe(7);
      expect(stats.mobileCount).toBe(3);
      expect(stats.desktopCount).toBe(4);
      expect(stats.version).toBe('2.0.0');
      expect(stats.createdAt).toBeInstanceOf(Date);
    });

    it('should return a copy of metadata', () => {
      generator.generate(3, 4);

      const stats = generator.getStats();

      stats.totalCount = 999;

      expect(generator.getStats().totalCount).toBe(7);
    });
  });

  describe('saveToFile()', () => {
    it('should save generated fingerprints to a JSON file', () => {
      generator.generate(5, 5);

      generator.saveToFile('fingerprints.json');

      const filePath = path.join(dataDir, 'fingerprints.json');

      expect(fs.existsSync(filePath)).toBe(true);

      const content = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(content);

      expect(parsed.fingerprints).toHaveLength(10);
      expect(parsed.metadata.totalCount).toBe(10);
    });

    it('should overwrite an existing file', () => {
      generator.generate(2, 2);
      generator.saveToFile('fingerprints.json');

      generator.generate(5, 1);
      generator.saveToFile('fingerprints.json');

      const loaded = JSON.parse(
        fs.readFileSync(
          path.join(dataDir, 'fingerprints.json'),
          'utf8',
        ),
      );

      expect(loaded.metadata.totalCount).toBe(6);
    });

    it('should reject empty filenames', () => {
      expect(() =>
        generator.saveToFile(''),
      ).toThrow('filename must be a non-empty string');
    });

    it('should reject whitespace-only filenames', () => {
      expect(() =>
        generator.saveToFile('   '),
      ).toThrow('filename must be a non-empty string');
    });

    it('should reject path traversal', () => {
      expect(() =>
        generator.saveToFile('../outside.json'),
      ).toThrow('Invalid filename');
    });

    it('should reject absolute paths', () => {
      const absolutePath = path.join(
        os.tmpdir(),
        'outside.json',
      );

      expect(() =>
        generator.saveToFile(absolutePath),
      ).toThrow('Invalid filename');
    });

    it('should reject non-string filenames at runtime', () => {
      expect(() =>
        generator.saveToFile(null as unknown as string),
      ).toThrow('filename must be a non-empty string');
    });
  });

  describe('loadFromFile()', () => {
    it('should load a previously saved collection', () => {
      const source = new FingerprintGenerator(
        dataDir,
        undefined,
        { seed: 'load-test' },
      );

      source.generate(5, 7);
      source.saveToFile('collection.json');

      const target = new FingerprintGenerator(dataDir);

      const loaded = target.loadFromFile('collection.json');

      expect(loaded.fingerprints).toHaveLength(12);
      expect(loaded.metadata.totalCount).toBe(12);
      expect(loaded.metadata.mobileCount).toBe(5);
      expect(loaded.metadata.desktopCount).toBe(7);
    });

    it('should update metadata after loading', () => {
      const filePath = path.join(dataDir, 'collection.json');

      const data = {
        fingerprints: [],
        metadata: {
          createdAt: new Date(),
          totalCount: 999,
          mobileCount: 999,
          desktopCount: 999,
          version: '2.0.0',
        },
      };

      fs.writeFileSync(
        filePath,
        JSON.stringify(data),
        'utf8',
      );

      const loaded = generator.loadFromFile('collection.json');

      expect(loaded.metadata.totalCount).toBe(0);
      expect(loaded.metadata.mobileCount).toBe(0);
      expect(loaded.metadata.desktopCount).toBe(0);
    });

    it('should return an empty collection when file does not exist', () => {
      const result = generator.loadFromFile(
        'does-not-exist.json',
      );

      expect(result.fingerprints).toEqual([]);
      expect(result.metadata.totalCount).toBe(0);
    });

    it('should reject invalid JSON', () => {
      fs.writeFileSync(
        path.join(dataDir, 'invalid.json'),
        '{ invalid json',
        'utf8',
      );

      expect(() =>
        generator.loadFromFile('invalid.json'),
      ).toThrow();
    });

    it('should reject an invalid collection structure', () => {
      fs.writeFileSync(
        path.join(dataDir, 'invalid.json'),
        JSON.stringify({
          foo: 'bar',
        }),
        'utf8',
      );

      expect(() =>
        generator.loadFromFile('invalid.json'),
      ).toThrow('Invalid fingerprint collection format');
    });

    it('should reject path traversal while loading', () => {
      expect(() =>
        generator.loadFromFile('../outside.json'),
      ).toThrow('Invalid filename');
    });
  });

  describe('singleton', () => {
    it('should return the same instance', () => {
      const first = getFingerprintGenerator(dataDir);
      const second = getFingerprintGenerator(
        path.join(dataDir, 'different'),
      );

      expect(first).toBe(second);
    });

    it('should return a new instance after reset', () => {
      const first = getFingerprintGenerator(dataDir);

      resetFingerprintGenerator();

      const second = getFingerprintGenerator(dataDir);

      expect(second).not.toBe(first);
    });

    it('should preserve generated data on the singleton instance', () => {
      const singleton = getFingerprintGenerator(dataDir);

      singleton.generate(2, 3);

      const same = getFingerprintGenerator();

      expect(same.getCount()).toEqual({
        total: 5,
        mobile: 2,
        desktop: 3,
      });
    });
  });

  describe('logger', () => {
    it('should log generation start and completion', () => {
      const logger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      };

      const loggedGenerator = new FingerprintGenerator(
        dataDir,
        logger,
        { seed: 'logger-test' },
      );

      loggedGenerator.generate(2, 3);

      expect(logger.info).toHaveBeenCalledTimes(2);

      expect(logger.info).toHaveBeenNthCalledWith(
        1,
        'Generating synthetic fingerprint fixtures',
        {
          mobileCount: 2,
          desktopCount: 3,
        },
      );

      expect(logger.info).toHaveBeenNthCalledWith(
        2,
        'Synthetic fingerprints generated',
        {
          total: 5,
          mobile: 2,
          desktop: 3,
        },
      );
    });

    it('should warn when loading a missing file', () => {
      const logger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      };

      const loggedGenerator = new FingerprintGenerator(
        dataDir,
        logger,
      );

      loggedGenerator.loadFromFile('missing.json');

      expect(logger.warn).toHaveBeenCalledWith(
        'Fingerprint file does not exist',
        expect.objectContaining({
          filePath: path.join(dataDir, 'missing.json'),
        }),
      );
    });
  });

  describe('browser profile consistency', () => {
    it('should generate mobile user agents that match mobile fingerprints', () => {
      const { mobile } = generator.generate(50, 0);

      for (const fingerprint of mobile) {
        expect(fingerprint.isMobile).toBe(true);
        expect(fingerprint.userAgent).toBeTruthy();

        const ua = fingerprint.userAgent;

        expect(
          ua.includes('Mobile') || ua.includes('iPhone'),
        ).toBe(true);
      }
    });

    it('should generate desktop user agents that are not mobile', () => {
      const { desktop } = generator.generate(50, 0);

      for (const fingerprint of desktop) {
        expect(fingerprint.isMobile).toBe(false);
        expect(fingerprint.userAgent).toBeTruthy();
        expect(fingerprint.userAgent).not.toContain(
          ' Mobile/',
        );
      }
    });

    it('should generate WebGL information', () => {
      const { mobile, desktop } = generator.generate(5, 5);

      for (const fingerprint of [...mobile, ...desktop]) {
        expect(fingerprint.webGL).toBeDefined();
        expect(fingerprint.webGL.vendor).toBe('WebKit');
        expect(fingerprint.webGL.renderer).toBe('WebKit WebGL');
        expect(fingerprint.webGL.unmaskedVendor).toBeTruthy();
        expect(fingerprint.webGL.unmaskedRenderer).toBeTruthy();
      }
    });

    it('should generate canvas data', () => {
      const { mobile, desktop } = generator.generate(5, 5);

      for (const fingerprint of [...mobile, ...desktop]) {
        expect(fingerprint.canvas.type).toBe('2d');
        expect(fingerprint.canvas.width).toBeGreaterThan(0);
        expect(fingerprint.canvas.height).toBeGreaterThan(0);
        expect(fingerprint.canvas.data).toMatch(
          /^synthetic-canvas:/,
        );
      }
    });

    it('should generate TLS and HTTP2 fingerprints', () => {
      const { mobile, desktop } = generator.generate(5, 5);

      for (const fingerprint of [...mobile, ...desktop]) {
        expect(fingerprint.tlsFingerprint).toBeDefined();
        expect(fingerprint.http2Fingerprint).toBeDefined();

        expect(
          fingerprint.tlsFingerprint.ja3Hash,
        ).toMatch(/^[a-f0-9]{32}$/);

        expect(
          fingerprint.http2Fingerprint.akamaiFingerprint,
        ).toMatch(/^[a-f0-9]{32}$/);
      }
    });
  });

  describe('zero/empty collection edge cases', () => {
    it('getRandom should return null before generation', () => {
      expect(generator.getRandom()).toBeNull();
      expect(generator.getRandom('mobile')).toBeNull();
      expect(generator.getRandom('desktop')).toBeNull();
    });

    it('getMultiple should return empty array before generation', () => {
      expect(generator.getMultiple(10)).toEqual([]);
    });

    it('getForKeyword should return null before generation', () => {
      expect(
        generator.getForKeyword({
          isMobile: 1,
          keyword: 'test',
        }),
      ).toBeNull();
    });
  });

  describe('large generation smoke test', () => {
    it('should generate a reasonably large collection without errors', () => {
      const result = generator.generate(100, 100);

      expect(result.mobile).toHaveLength(100);
      expect(result.desktop).toHaveLength(100);
      expect(result.metadata.totalCount).toBe(200);

      const allIds = result.mobile
        .concat(result.desktop)
        .map((fingerprint) => fingerprint.id);

      expect(new Set(allIds).size).toBe(200);
    });
  });
});
