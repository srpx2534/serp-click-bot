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
import { BrowserFingerprint, ProxyStatus } from '../../src/types';

// Playwright mock
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

// Playwright mock
jest.mock('playwright', () => ({
  chromium: {
    launch: jest.fn().mockResolvedValue(mockBrowser),
  },
}));

// fs mock
jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(false),
  mkdirSync: jest.fn().mockReturnValue(undefined),
  readFileSync: jest.fn().mockReturnValue('[]'),
  writeFileSync: jest.fn().mockReturnValue(undefined),
}));

// path mock
jest.mock('path', () => ({
  join: jest.fn((...args: string[]) => args.join('/')),
}));

describe('BrowserManager', () => {
  let browserManager: BrowserManager;
  let mockLogger: Logger;

  // Test data
  const mockFingerprint: BrowserFingerprint = {
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
      aliasedLineWidthRange: [1, 1],
      aliasedPointSizeRange: [1, 1024],
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
    tlsFingerprint: undefined,
    http2Fingerprint: undefined,
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
    } as unknown as Logger;

    // Reset mocks
    jest.clearAllMocks();
    
    // Create fresh instance
    browserManager = new BrowserManager({}, mockLogger);
  });

  afterEach(async () => {
    await resetBrowserManager();
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
      expect(mockBrowser.newContext).toHaveBeenCalled();
      expect(context).toBe(mockContext);
      
      // Check logger calls
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Launching browser'),
        expect.any(Object)
      );
    });

    it('should apply stealth scripts', async () => {
      await browserManager.launchBrowser(mockFingerprint, mockProxy);
      
      expect(mockContext.addInitScript).toHaveBeenCalled();
      const scriptCall = mockContext.addInitScript.mock.calls[0][0];
      expect(scriptCall).toContain('webdriver');
      expect(scriptCall).toContain('chrome');
    });

    it('should load cookies if provided', async () => {
      const cookies = [{ name: 'session', value: 'abc123' }];
      await browserManager.launchBrowser(mockFingerprint, mockProxy, cookies);
      
      expect(mockContext.addCookies).toHaveBeenCalledWith(cookies);
    });

    it('should wait for available slot if max concurrent reached', async () => {
      // Create manager with limit of 1
      const limitedManager = new BrowserManager(
        { maxConcurrentBrowsers: 1 },
        mockLogger
      );
      
      // Launch first browser
      await limitedManager.launchBrowser(mockFingerprint, mockProxy);
      expect(limitedManager.getActiveBrowserCount()).toBe(1);
      
      // Mock setTimeout to speed up test
      jest.useFakeTimers();
      
      // Try to launch second (should wait)
      const launchPromise = limitedManager.launchBrowser(
        { ...mockFingerprint, id: 'fp-2' },
        { ...mockProxy, url: 'http://proxy2:8080' }
      );
      
      // Close first browser to free slot
      setTimeout(() => {
        limitedManager.closeBrowser(mockContext);
      }, 100);
      
      jest.advanceTimersByTime(200);
      
      await launchPromise;
      jest.useRealTimers();
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
      expect(launchCall.proxy.username).toBe('user');
      expect(launchCall.proxy.password).toBe('pass');
    });

    it('should apply correct viewport from fingerprint', async () => {
      await browserManager.launchBrowser(mockFingerprint, mockProxy);
      
      const contextOptions = mockBrowser.newContext.mock.calls[0][0];
      expect(contextOptions.viewport.width).toBe(1920);
      expect(contextOptions.viewport.height).toBe(1080);
    });

    it('should apply mobile settings for mobile fingerprint', async () => {
      const mobileFingerprint = {
        ...mockFingerprint,
        type: 'mobile',
        isMobile: true,
        touchSupport: true,
        maxTouchPoints: 5,
        viewport: { width: 390, height: 844 },
      };
      
      await browserManager.launchBrowser(mobileFingerprint, mockProxy);
      
      const contextOptions = mockBrowser.newContext.mock.calls[0][0];
      expect(contextOptions.isMobile).toBe(true);
      expect(contextOptions.hasTouch).toBe(true);
    });
  });

  describe('createPage', () => {
    it('should create page with stealth check', async () => {
      // First launch browser
      const context = await browserManager.launchBrowser(mockFingerprint, mockProxy);
      
      // Mock bot detection - no bot detected
      mockPage.evaluate.mockResolvedValueOnce([]);
      
      const page = await browserManager.createPage(context);
      
      expect(page).toBe(mockPage);
      expect(mockPage.setDefaultTimeout).toHaveBeenCalled();
      expect(mockPage.setDefaultNavigationTimeout).toHaveBeenCalled();
    });

    it('should apply emergency stealth if bot detected', async () => {
      const context = await browserManager.launchBrowser(mockFingerprint, mockProxy);
      
      // Mock bot detection - bot detected
      mockPage.evaluate.mockResolvedValueOnce(['webdriver', 'no_plugins']);
      
      await browserManager.createPage(context);
      
      expect(mockPage.evaluate).toHaveBeenCalledTimes(2);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Bot detection triggered')
      );
    });

    it('should handle page creation errors', async () => {
      const context = await browserManager.launchBrowser(mockFingerprint, mockProxy);
      mockContext.newPage.mockRejectedValueOnce(new Error('Page creation failed'));
      
      await expect(browserManager.createPage(context)).rejects.toThrow('Page creation failed');
    });
  });

  describe('closeBrowser', () => {
    it('should close browser and save cookies', async () => {
      const context = await browserManager.launchBrowser(mockFingerprint, mockProxy);
      
      await browserManager.closeBrowser(context, true);
      
      expect(mockContext.cookies).toHaveBeenCalled();
      expect(mockContext.close).toHaveBeenCalled();
      expect(browserManager.getActiveBrowserCount()).toBe(0);
    });

    it('should close browser without saving cookies', async () => {
      const context = await browserManager.launchBrowser(mockFingerprint, mockProxy);
      
      await browserManager.closeBrowser(context, false);
      
      expect(mockContext.cookies).not.toHaveBeenCalled();
      expect(mockContext.close).toHaveBeenCalled();
    });

    it('should handle close errors gracefully', async () => {
      const context = await browserManager.launchBrowser(mockFingerprint, mockProxy);
      mockContext.close.mockRejectedValueOnce(new Error('Close failed'));
      
      await expect(browserManager.closeBrowser(context)).rejects.toThrow('Close failed');
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('closeAll', () => {
    it('should close all browsers', async () => {
      // Launch multiple browsers
      const context1 = await browserManager.launchBrowser(mockFingerprint, mockProxy);
      const context2 = await browserManager.launchBrowser(
        { ...mockFingerprint, id: 'fp-2' },
        { ...mockProxy, url: 'http://proxy2:8080' }
      );
      
      expect(browserManager.getActiveBrowserCount()).toBe(2);
      
      await browserManager.closeAll();
      
      expect(browserManager.getActiveBrowserCount()).toBe(0);
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Closing all browsers'));
    });

    it('should handle already closed browsers', async () => {
      await browserManager.launchBrowser(mockFingerprint, mockProxy);
      mockBrowser.close.mockRejectedValueOnce(new Error('Already closed'));
      
      await browserManager.closeAll();
      
      expect(browserManager.getActiveBrowserCount()).toBe(0);
    });
  });

  describe('Cookie Management', () => {
    it('should save cookies to file', async () => {
      const context = await browserManager.launchBrowser(mockFingerprint, mockProxy);
      const cookies = [{ name: 'test', value: 'value', domain: 'google.com' }];
      mockContext.cookies.mockResolvedValueOnce(cookies);
      
      await browserManager.closeBrowser(context, true);
      
      const writeFileSyncMock = jest.requireMock('fs').writeFileSync;
      expect(writeFileSyncMock).toHaveBeenCalled();
    });

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

    it('should handle cookie load errors', () => {
      jest.requireMock('fs').existsSync.mockReturnValueOnce(true);
      jest.requireMock('fs').readFileSync.mockImplementationOnce(() => {
        throw new Error('Read failed');
      });
      
      const cookies = browserManager.loadCookies('error-fp');
      
      expect(cookies).toEqual([]);
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('Stats and Getters', () => {
    it('should return active browser count', async () => {
      expect(browserManager.getActiveBrowserCount()).toBe(0);
      
      await browserManager.launchBrowser(mockFingerprint, mockProxy);
      expect(browserManager.getActiveBrowserCount()).toBe(1);
    });

    it('should return detailed stats', async () => {
      const context = await browserManager.launchBrowser(mockFingerprint, mockProxy);
      
      // Create pages to increment page count
      mockPage.evaluate.mockResolvedValue([]);
      await browserManager.createPage(context);
      await browserManager.createPage(context);
      
      const stats = browserManager.getStats();
      
      expect(stats.active).toBe(1);
      expect(stats.maxAllowed).toBe(5);
      expect(stats.totalPages).toBe(2);
      expect(stats.oldestBrowser).toBeInstanceOf(Date);
    });

    it('should return null for oldest browser if no browsers', () => {
      const stats = browserManager.getStats();
      expect(stats.oldestBrowser).toBeNull();
    });
  });

  describe('Screenshot', () => {
    it('should take screenshot in debug mode', async () => {
      const debugManager = new BrowserManager({ debugMode: true }, mockLogger);
      const context = await debugManager.launchBrowser(mockFingerprint, mockProxy);
      
      await debugManager.takeScreenshot(mockPage as any, 'test-screenshot');
      
      expect(mockPage.screenshot).toHaveBeenCalledWith({
        path: expect.stringContaining('test-screenshot'),
        fullPage: true,
      });
    });

    it('should not take screenshot if debug mode is off', async () => {
      const context = await browserManager.launchBrowser(mockFingerprint, mockProxy);
      
      await browserManager.takeScreenshot(mockPage as any, 'test-screenshot');
      
      expect(mockPage.screenshot).not.toHaveBeenCalled();
    });

    it('should handle screenshot errors', async () => {
      const debugManager = new BrowserManager({ debugMode: true }, mockLogger);
      mockPage.screenshot.mockRejectedValueOnce(new Error('Screenshot failed'));
      
      await debugManager.takeScreenshot(mockPage as any, 'error-test');
      
      expect(mockLogger.error).toHaveBeenCalled();
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

    it('should close all browsers on reset', async () => {
      const manager = getBrowserManager();
      await manager.launchBrowser(mockFingerprint, mockProxy);
      
      await resetBrowserManager();
      
      expect(browserManager.getActiveBrowserCount()).toBe(0);
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

    it('should handle malformed proxy URL gracefully', async () => {
      const badProxy: ProxyStatus = {
        ...mockProxy,
        url: 'not-a-valid-url',
      };
      
      // Should throw or handle gracefully
      await expect(
        browserManager.launchBrowser(mockFingerprint, badProxy)
      ).rejects.toThrow();
    });

    it('should mask proxy URL in logs', async () => {
      await browserManager.launchBrowser(mockFingerprint, mockProxy);
      
      const logCall = mockLogger.info.mock.calls.find(
        call => call[0].includes('Launching browser')
      );
      
      expect(logCall).toBeDefined();
      expect(logCall[1].proxy).toContain('****');
    });

    it('should handle multiple concurrent launches', async () => {
      const promises = [
        browserManager.launchBrowser({ ...mockFingerprint, id: 'fp-1' }, mockProxy),
        browserManager.launchBrowser({ ...mockFingerprint, id: 'fp-2' }, mockProxy),
        browserManager.launchBrowser({ ...mockFingerprint, id: 'fp-3' }, mockProxy),
      ];
      
      const contexts = await Promise.all(promises);
      
      expect(contexts).toHaveLength(3);
      expect(browserManager.getActiveBrowserCount()).toBe(3);
    });
  });
});