/**
 * BrowserManager Test Suite
 * Kritik modül - Tüm stealth ve browser yönetimi özellikleri test edilir
 */

import {
  BrowserManager,
  BrowserManagerConfig,
  getBrowserManager,
  resetBrowserManager,
} from '../../src/core/browser-manager';
import { Logger } from '../../src/utils/logger';
import { ProxyStatus } from '../../src/core/proxy-manager';
import { FingerprintData } from '../../src/types';

// Önce tüm mock'ları jest.mock factory içinde tanımla
jest.mock('playwright', () => {
  const mockPage = {
    setDefaultTimeout: jest.fn(),
    setDefaultNavigationTimeout: jest.fn(),
    evaluate: jest.fn(),
    screenshot: jest.fn(),
    close: jest.fn(),
  };

  const mockContext = {
    newPage: jest.fn().mockResolvedValue(mockPage),
    addCookies: jest.fn().mockResolvedValue(undefined),
    cookies: jest.fn().mockResolvedValue([{ name: 'test', value: 'value' }]),
    close: jest.fn().mockResolvedValue(undefined),
    addInitScript: jest.fn().mockResolvedValue(undefined),
  };

  const mockBrowser = {
    newContext: jest.fn().mockResolvedValue(mockContext),
    close: jest.fn().mockResolvedValue(undefined),
    isConnected: jest.fn().mockReturnValue(true),
  };

  return {
    chromium: {
      launch: jest.fn().mockResolvedValue(mockBrowser),
    },
  };
});

// fs mock
jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(false),
  mkdirSync: jest.fn().mockReturnValue(undefined),
  readFileSync: jest.fn().mockReturnValue('[]'),
  writeFileSync: jest.fn().mockReturnValue(undefined),
  appendFileSync: jest.fn().mockReturnValue(undefined), // EKLENDİ
}));

// path mock
jest.mock('path', () => ({
  join: jest.fn((...args: string[]) => args.join('/')),
}));

describe('BrowserManager', () => {
  let browserManager: BrowserManager;
  let mockLogger: jest.Mocked<Logger>;

  // Test data - FingerprintData kullan
  const mockFingerprint: FingerprintData = {
    id: 'fp-test-123',
    type: 'desktop',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    viewport: { width: 1920, height: 1080 },
    screenResolution: { width: 1920, height: 1080 },
    colorDepth: 24,
    pixelRatio: 1,
    timezone: 'Europe/Istanbul',
    language: 'tr-TR',
    languages: ['tr-TR', 'tr', 'en-US', 'en'],
    platform: 'Win32',
    cpuCores: 8,
    memory: 16,
    doNotTrack: null,
    cookiesEnabled: true,
    localStorage: true,
    sessionStorage: true,
    indexedDB: true,
    webGL: {
      vendor: 'Google Inc.',
      renderer: 'ANGLE',
      unmaskedVendor: 'NVIDIA',
      unmaskedRenderer: 'NVIDIA GeForce GTX 1080',
      aliasedLineWidthRange: [1, 1] as [number, number],
      aliasedPointSizeRange: [1, 1024] as [number, number],
      alphaBits: 8,
      blueBits: 8,
      depthBits: 24,
      greenBits: 8,
      redBits: 8,
      maxCombinedTextureImageUnits: 32,
      maxCubeMapTextureSize: 16384,
      maxFragmentUniformVectors: 1024,
      maxRenderbufferSize: 16384,
      maxTextureImageUnits: 16,
      maxTextureSize: 16384,
      maxVaryingVectors: 30,
      maxVertexAttribs: 16,
      maxVertexTextureImageUnits: 16,
      maxVertexUniformVectors: 4096,
      precisionFormats: {},
      extensions: [],
    },
    canvas: {
      type: '2d',
      width: 220,
      height: 30,
      data: 'data:image/png;base64,abc123',
      noise: 0.05,
      features: ['text', 'emoji'],
    },
    fonts: ['Arial', 'Helvetica'],
    plugins: [],
    mimeTypes: [],
    pluginsLength: 0,
    mimeTypesLength: 0,
    webdriver: false,
    chrome: true,
    isMobile: false,
    touchSupport: false,
    deviceMemory: 8,
    hardwareConcurrency: 8,
    maxTouchPoints: 0,
    vendor: 'Google Inc.',
    product: 'Gecko',
    productSub: '20030107',
    ja3Hash: 'abc123',
    akamaiFingerprint: 'def456',
    battery: undefined,
    network: {
      effectiveType: '4g',
      downlink: 10,
      rtt: 50,
      saveData: false,
    },
    speechVoices: [],
    speechSynthesisVoices: 0,
    screen: {
      width: 1920,
      height: 1080,
      availWidth: 1920,
      availHeight: 1050,
      availLeft: 0,
      availTop: 0,
      colorDepth: 24,
      pixelDepth: 24,
      orientation: {
        angle: 0,
        type: 'landscape-primary',
      },
    },
    navigator: {} as any,
    window: {} as any,
    document: {} as any,
    location: {} as any,
    history: {} as any,
    mediaCapabilities: {} as any,
    touchSupportInfo: {} as any,
    keyboard: {} as any,
    pointer: {} as any,
    gamepad: {} as any,
    vr: {} as any,
    mediaSession: {} as any,
    wakeLock: undefined,
    deviceOrientation: undefined,
    deviceMotion: undefined,
    proximity: undefined,
    ambientLight: undefined,
    connection: {
      effectiveType: '4g',
      downlink: 10,
      downlinkMax: 100,
      rtt: 50,
      saveData: false,
      type: 'wifi',
    },
    credentials: {} as any,
    permissions: {} as any,
    payment: {} as any,
    webShare: {} as any,
    contacts: undefined,
    clipboard: {} as any,
    mediaDevices: {} as any,
    pdfViewerEnabled: true,
  };

  const mockProxy: ProxyStatus = {
    url: 'http://user:pass@proxy.example.com:8080',
    isActive: true,
    lastUsed: new Date(),
    failCount: 0,
    successCount: 10,
    averageResponseTime: 150,
    isBanned: false,
    provider: 'TestProxy',
  };

  beforeEach(() => {
    // Reset singleton
    resetBrowserManager();
    
    // Mock logger
    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      trace: jest.fn(),
      logClickAttempt: jest.fn(),
      logClickSuccess: jest.fn(),
      logClickFailure: jest.fn(),
      logBotDetection: jest.fn(),
      logMetrics: jest.fn(),
      close: jest.fn(),
    } as unknown as jest.Mocked<Logger>;

    // Reset mocks
    jest.clearAllMocks();
    
    // Create fresh instance
    browserManager = new BrowserManager({}, mockLogger);
  });

  afterEach(async () => {
    await resetBrowserManager();
    mockLogger.close(); // Logger'ı kapat
    jest.clearAllMocks();
  });

  describe('Constructor', () => {
    it('should create BrowserManager with default config', () => {
      const bm = new BrowserManager();
      expect(bm).toBeDefined();
      expect(bm.getActiveBrowserCount()).toBe(0);
    });

    it('should create BrowserManager with custom config', () => {
      const config: Partial<BrowserManagerConfig> = {
        maxConcurrentBrowsers: 10,
        headless: false,
        debugMode: true,
      };
      const bm = new BrowserManager(config, mockLogger);
      expect(bm).toBeDefined();
    });

    it('should create required directories', () => {
      const mkdirSyncMock = jest.requireMock('fs').mkdirSync;
      new BrowserManager({}, mockLogger);
      expect(mkdirSyncMock).toHaveBeenCalledWith('./data/cookies', { recursive: true });
      expect(mkdirSyncMock).toHaveBeenCalledWith('./data/browser-data', { recursive: true });
    });
  });

  describe('launchBrowser', () => {
    it('should launch browser with fingerprint and proxy', async () => {
      const { chromium } = jest.requireMock('playwright');
      
      const context = await browserManager.launchBrowser(mockFingerprint, mockProxy);
      
      expect(chromium.launch).toHaveBeenCalled();
      expect(chromium.launch.mock.results[0].value).resolves.toBeDefined();
      expect(context).toBeDefined();
      
      // Check logger calls
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Launching browser'),
        expect.any(Object)
      );
    });

    it('should apply stealth scripts', async () => {
      const { chromium } = jest.requireMock('playwright');
      const mockBrowserInstance = await chromium.launch();
      const mockContextInstance = await mockBrowserInstance.newContext();
      
      await browserManager.launchBrowser(mockFingerprint, mockProxy);
      
      expect(mockContextInstance.addInitScript).toHaveBeenCalled();
    });

    it('should load cookies if provided', async () => {
      const cookies = [{ name: 'session', value: 'abc123' }];
      await browserManager.launchBrowser(mockFingerprint, mockProxy, cookies);
      
      // Cookie yükleme işlemi launch sırasında yapılır
      expect(mockLogger.info).toHaveBeenCalled();
    });

    it('should handle launch errors', async () => {
      const { chromium } = jest.requireMock('playwright');
      chromium.launch.mockRejectedValueOnce(new Error('Launch failed'));
      
      await expect(
        browserManager.launchBrowser(mockFingerprint, mockProxy)
      ).rejects.toThrow('Launch failed');
      
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should parse proxy URL correctly', async () => {
      await browserManager.launchBrowser(mockFingerprint, mockProxy);
      
      const { chromium } = jest.requireMock('playwright');
      const launchCall = chromium.launch.mock.calls[0][0];
      
      expect(launchCall.proxy).toBeDefined();
      expect(launchCall.proxy.server).toContain('proxy.example.com:8080');
    });

    it('should apply correct viewport from fingerprint', async () => {
      await browserManager.launchBrowser(mockFingerprint, mockProxy);
      
      const { chromium } = jest.requireMock('playwright');
      const mockBrowserInstance = await chromium.launch();
      
      expect(mockBrowserInstance.newContext).toHaveBeenCalled();
      const contextCall = mockBrowserInstance.newContext.mock.calls[0][0];
      expect(contextCall.viewport.width).toBe(1920);
      expect(contextCall.viewport.height).toBe(1080);
    });

    it('should apply mobile settings for mobile fingerprint', async () => {
      const mobileFingerprint: FingerprintData = {
        ...mockFingerprint,
        id: 'fp-mobile-1',
        type: 'mobile',
        isMobile: true,
        touchSupport: true,
        maxTouchPoints: 5,
        viewport: { width: 390, height: 844 },
      };
      
      await browserManager.launchBrowser(mobileFingerprint, mockProxy);
      
      const { chromium } = jest.requireMock('playwright');
      const mockBrowserInstance = await chromium.launch();
      const contextCall = mockBrowserInstance.newContext.mock.calls[0][0];
      
      expect(contextCall.isMobile).toBe(true);
      expect(contextCall.hasTouch).toBe(true);
    });
  });

  describe('closeBrowser', () => {
    it('should close browser and save cookies', async () => {
      const context = await browserManager.launchBrowser(mockFingerprint, mockProxy);
      
      await browserManager.closeBrowser(context, true);
      
      expect(browserManager.getActiveBrowserCount()).toBe(0);
    });

    it('should close browser without saving cookies', async () => {
      const context = await browserManager.launchBrowser(mockFingerprint, mockProxy);
      
      await browserManager.closeBrowser(context, false);
      
      expect(browserManager.getActiveBrowserCount()).toBe(0);
    });

    it('should handle close errors gracefully', async () => {
      const { chromium } = jest.requireMock('playwright');
      const mockBrowserInstance = await chromium.launch();
      const mockContextInstance = await mockBrowserInstance.newContext();
      
      const context = await browserManager.launchBrowser(mockFingerprint, mockProxy);
      mockContextInstance.close.mockRejectedValueOnce(new Error('Close failed'));
      
      await expect(browserManager.closeBrowser(context)).rejects.toThrow('Close failed');
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('closeAll', () => {
    it('should close all browsers', async () => {
      await browserManager.launchBrowser(mockFingerprint, mockProxy);
      expect(browserManager.getActiveBrowserCount()).toBe(1);
      
      await browserManager.closeAll();
      
      expect(browserManager.getActiveBrowserCount()).toBe(0);
    });
  });

  describe('Cookie Management', () => {
    it('should load cookies from file', () => {
      const cookiesData = JSON.stringify([{ name: 'loaded', value: 'cookie' }]);
      jest.requireMock('fs').existsSync.mockReturnValueOnce(true);
      jest.requireMock('fs').readFileSync.mockReturnValueOnce(cookiesData);
      
      const cookies = browserManager.loadCookies('fp-test-123');
      
      expect(cookies).toEqual([{ name: 'loaded', value: 'cookie' }]);
    });

    it('should return empty array if cookie file not found', () => {
      jest.requireMock('fs').existsSync.mockReturnValueOnce(false);
      
      const cookies = browserManager.loadCookies('non-existent');
      
      expect(cookies).toEqual([]);
    });
  });

  describe('Stats and Getters', () => {
    it('should return active browser count', async () => {
      expect(browserManager.getActiveBrowserCount()).toBe(0);
      
      await browserManager.launchBrowser(mockFingerprint, mockProxy);
      expect(browserManager.getActiveBrowserCount()).toBe(1);
    });

    it('should return detailed stats', async () => {
      await browserManager.launchBrowser(mockFingerprint, mockProxy);
      
      const stats = browserManager.getStats();
      
      expect(stats.active).toBe(1);
      expect(stats.maxAllowed).toBe(5);
    });

    it('should return null for oldest browser if no browsers', () => {
      const stats = browserManager.getStats();
      expect(stats.oldestBrowser).toBeNull();
    });
  });

  describe('Singleton Pattern', () => {
    it('should return same instance via getBrowserManager', () => {
      const instance1 = getBrowserManager();
      const instance2 = getBrowserManager();
      
      expect(instance1).toBe(instance2);
    });

    it('should create new instance after reset', async () => {
      const instance1 = getBrowserManager();
      await resetBrowserManager();
      const instance2 = getBrowserManager();
      
      expect(instance1).not.toBe(instance2);
    });
  });

  describe('Edge Cases', () => {
    it('should handle proxy URL without auth', async () => {
      const proxyWithoutAuth: ProxyStatus = {
        ...mockProxy,
        url: 'http://proxy.example.com:8080',
      };
      
      await browserManager.launchBrowser(mockFingerprint, proxyWithoutAuth);
      
      const { chromium } = jest.requireMock('playwright');
      const launchCall = chromium.launch.mock.calls[0][0];
      
      expect(launchCall.proxy.username).toBeUndefined();
      expect(launchCall.proxy.password).toBeUndefined();
    });

    it('should mask proxy URL in logs', async () => {
      await browserManager.launchBrowser(mockFingerprint, mockProxy);
      
      const logCalls = (mockLogger.info as jest.Mock).mock.calls;
      const logCall = logCalls.find(
        (call: any) => call[0].includes('Launching browser')
      );
      
      expect(logCall).toBeDefined();
      expect(logCall[1].proxy).toContain('****');
    });
  });
});