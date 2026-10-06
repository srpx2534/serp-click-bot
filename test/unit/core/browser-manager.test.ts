/**
 * BrowserManager Test Suite - Patchright Tabanlı
 * 
 * Özellikler:
 * - Patchright mock'lanır (gerçek browser açılmaz)
 * - CDP session mock'lanır
 * - Resource interceptor test edilir
 * - Lifecycle manager (crash recovery) test edilir
 * - Stealth scripts doğrulanır
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  BrowserManager,
  BrowserManagerConfig,
  getBrowserManager,
  resetBrowserManager,
  createBrowserManager,
  getNamedBrowserManager,
  closeNamedBrowserManager,
  closeAllBrowserManagers,
} from '../../../src/core/browser-manager';
import { Logger } from '../../../src/utils/logger';
import { FingerprintData } from '../../../src/types';
import { ProxyStatus } from '../../../src/core/proxy-manager';

// Patchright mock
const mockCDPSession = {
  send: jest.fn().mockResolvedValue(undefined),
  detach: jest.fn().mockResolvedValue(undefined),
};

const mockPage = {
  setDefaultTimeout: jest.fn(),
  setDefaultNavigationTimeout: jest.fn(),
  evaluate: jest.fn().mockResolvedValue([]),
  screenshot: jest.fn().mockResolvedValue(undefined),
  close: jest.fn().mockResolvedValue(undefined),
  context: jest.fn().mockReturnValue({
    newCDPSession: jest.fn().mockResolvedValue(mockCDPSession),
  }),
  goto: jest.fn().mockResolvedValue(undefined),
};

const mockContext = {
  newPage: jest.fn().mockResolvedValue(mockPage),
  addCookies: jest.fn().mockResolvedValue(undefined),
  cookies: jest.fn().mockResolvedValue([{ name: 'test', value: 'value' }]),
  close: jest.fn().mockResolvedValue(undefined),
  route: jest.fn().mockResolvedValue(undefined),
  on: jest.fn(),
};

const mockBrowser = {
  newContext: jest.fn().mockResolvedValue(mockContext),
  close: jest.fn().mockResolvedValue(undefined),
  isConnected: jest.fn().mockReturnValue(true),
};

// Patchright mock
jest.mock('patchright', () => ({
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

const mockLogger: jest.Mocked<Logger> = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as unknown as jest.Mocked<Logger>;

// Test data
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

describe('BrowserManager (Patchright)', () => {
  let browserManager: BrowserManager;

  beforeEach(() => {
    // Reset singleton
    resetBrowserManager();
    
    // Reset mocks
    jest.clearAllMocks();
    
    // Create fresh instance
    browserManager = new BrowserManager({}, mockLogger);
  });

  afterEach(async () => {
    await resetBrowserManager();
    await closeAllBrowserManagers();
    jest.clearAllMocks();
  });

  // ---------------------------------------------------------------
  describe('Browser Launch', () => {
    test('Patchright ile browser başlatılmalı', async () => {
      const { chromium } = jest.requireMock('patchright');
      
      const context = await browserManager.launchBrowser(mockFingerprint, mockProxy);
      
      expect(chromium.launch).toHaveBeenCalled();
      expect(mockBrowser.newContext).toHaveBeenCalled();
      expect(context).toBe(mockContext);
      
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Launching browser'),
        expect.any(Object)
      );
    });

    test('Proxy konfigürasyonu doğru ayarlanmalı', async () => {
      const { chromium } = jest.requireMock('patchright');
      
      await browserManager.launchBrowser(mockFingerprint, mockProxy);
      
      const launchCall = chromium.launch.mock.calls[0][0];
      expect(launchCall.proxy.server).toContain('proxy.example.com:8080');
      expect(launchCall.proxy.username).toBe('user');
      expect(launchCall.proxy.password).toBe('pass');
    });

    test('Stealth args eklenmeli', async () => {
      const { chromium } = jest.requireMock('patchright');
      
      await browserManager.launchBrowser(mockFingerprint, mockProxy);
      
      const launchCall = chromium.launch.mock.calls[0][0];
      expect(launchCall.args).toContain('--disable-blink-features=AutomationControlled');
      expect(launchCall.args).toContain('--no-sandbox');
      expect(launchCall.args).toContain('--disable-setuid-sandbox');
    });

    test('Context viewport ve userAgent ayarlanmalı', async () => {
      await browserManager.launchBrowser(mockFingerprint, mockProxy);
      
      const contextCall = mockBrowser.newContext.mock.calls[0][0];
      expect(contextCall.viewport.width).toBe(1920);
      expect(contextCall.viewport.height).toBe(1080);
      expect(contextCall.userAgent).toBe(mockFingerprint.userAgent);
      expect(contextCall.locale).toBe('tr-TR');
    });

    test('Mobile fingerprint için isMobile true olmalı', async () => {
      const mobileFingerprint = { ...mockFingerprint, type: 'mobile', isMobile: true, touchSupport: true };
      
      await browserManager.launchBrowser(mobileFingerprint, mockProxy);
      
      const contextCall = mockBrowser.newContext.mock.calls[0][0];
      expect(contextCall.isMobile).toBe(true);
      expect(contextCall.hasTouch).toBe(true);
    });

    test('Cookie yüklenebilmeli', async () => {
      const cookies = [{ name: 'session', value: 'abc123', domain: 'google.com' }];
      
      await browserManager.launchBrowser(mockFingerprint, mockProxy, cookies);
      
      expect(mockContext.addCookies).toHaveBeenCalledWith(cookies);
    });

    test('Max concurrent limit aşılırsa bekleme yapılmalı', async () => {
      browserManager = new BrowserManager({ maxConcurrentBrowsers: 1 }, mockLogger);
      
      await browserManager.launchBrowser(mockFingerprint, mockProxy);
      
      // İkinci browser için bekleme başlatılacak
      const launchPromise = browserManager.launchBrowser(
        { ...mockFingerprint, id: 'fp-2' },
        mockProxy
      );
      
      // İlkini kapat
      await browserManager.closeBrowser(mockContext);
      
      await launchPromise;
      
      expect(mockLogger.warn).toHaveBeenCalledWith('Max concurrent browsers reached, waiting...');
    });

    test('Launch hatası loglanmalı', async () => {
      const { chromium } = jest.requireMock('patchright');
      chromium.launch.mockRejectedValueOnce(new Error('Launch failed'));
      
      await expect(
        browserManager.launchBrowser(mockFingerprint, mockProxy)
      ).rejects.toThrow('Launch failed');
      
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------
  describe('CDP Integration', () => {
    test('CDP session oluşturulmalı', async () => {
      await browserManager.launchBrowser(mockFingerprint, mockProxy);
      
      expect(mockPage.context().newCDPSession).toHaveBeenCalled();
    });

    test('WebRTC devre dışı bırakılmalı', async () => {
      await browserManager.launchBrowser(mockFingerprint, mockProxy);
      
      expect(mockCDPSession.send).toHaveBeenCalledWith('WebRTC.disable');
    });

    test('Network throttling ayarlanmalı', async () => {
      await browserManager.launchBrowser(mockFingerprint, mockProxy);
      
      const networkCall = mockCDPSession.send.mock.calls.find(
        call => call[0] === 'Network.emulateNetworkConditions'
      );
      
      expect(networkCall).toBeDefined();
      expect(networkCall[1]).toMatchObject({
        offline: false,
        latency: 50,
      });
    });

    test('Mobile için device metrics override yapılmalı', async () => {
      const mobileFingerprint = { ...mockFingerprint, type: 'mobile', isMobile: true };
      
      await browserManager.launchBrowser(mobileFingerprint, mockProxy);
      
      expect(mockCDPSession.send).toHaveBeenCalledWith(
        'Emulation.setDeviceMetricsOverride',
        expect.any(Object)
      );
    });
  });

  // ---------------------------------------------------------------
  describe('Resource Interceptor', () => {
    test('Route handler kurulmalı', async () => {
      await browserManager.launchBrowser(mockFingerprint, mockProxy);
      
      expect(mockContext.route).toHaveBeenCalledWith('**/*', expect.any(Function));
    });

    test('WebRTC istekleri engellenmeli', async () => {
      await browserManager.launchBrowser(mockFingerprint, mockProxy);
      
      const routeHandler = mockContext.route.mock.calls[0][1];
      const mockRoute = {
        request: jest.fn().mockReturnValue({ url: () => 'https://example.com/webrtc', resourceType: () => 'xhr' }),
        abort: jest.fn(),
        continue: jest.fn(),
      };
      
      await routeHandler(mockRoute);
      
      expect(mockRoute.abort).toHaveBeenCalled();
    });

    test('Analytics istekleri engellenmeli', async () => {
      await browserManager.launchBrowser(mockFingerprint, mockProxy);
      
      const routeHandler = mockContext.route.mock.calls[0][1];
      const mockRoute = {
        request: jest.fn().mockReturnValue({ 
          url: () => 'https://google-analytics.com/collect', 
          resourceType: () => 'xhr' 
        }),
        abort: jest.fn(),
        continue: jest.fn(),
      };
      
      await routeHandler(mockRoute);
      
      expect(mockRoute.abort).toHaveBeenCalled();
    });

    test('Normal istekler devam etmeli', async () => {
      await browserManager.launchBrowser(mockFingerprint, mockProxy);
      
      const routeHandler = mockContext.route.mock.calls[0][1];
      const mockRoute = {
        request: jest.fn().mockReturnValue({ 
          url: () => 'https://google.com', 
          resourceType: () => 'document' 
        }),
        abort: jest.fn(),
        continue: jest.fn(),
      };
      
      await routeHandler(mockRoute);
      
      expect(mockRoute.continue).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------
  describe('Lifecycle Manager', () => {
    test('Crash event handler kurulmalı', async () => {
      await browserManager.launchBrowser(mockFingerprint, mockProxy);
      
      expect(mockContext.on).toHaveBeenCalledWith('crashed', expect.any(Function));
    });

    test('Dialog handler kurulmalı', async () => {
      await browserManager.launchBrowser(mockFingerprint, mockProxy);
      
      expect(mockContext.on).toHaveBeenCalledWith('dialog', expect.any(Function));
    });

    test('Page error handler kurulmalı', async () => {
      await browserManager.launchBrowser(mockFingerprint, mockProxy);
      
      expect(mockContext.on).toHaveBeenCalledWith('pageerror', expect.any(Function));
    });

    test('Dialog otomatik dismiss edilmeli', async () => {
      await browserManager.launchBrowser(mockFingerprint, mockProxy);
      
      const dialogHandler = mockContext.on.mock.calls.find(
        call => call[0] === 'dialog'
      )[1];
      
      const mockDialog = {
        type: jest.fn().mockReturnValue('alert'),
        dismiss: jest.fn().mockResolvedValue(undefined),
      };
      
      await dialogHandler(mockDialog);
      
      expect(mockDialog.dismiss).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------
  describe('Stealth Scripts', () => {
    test('Stealth scripts uygulanmalı', async () => {
      await browserManager.launchBrowser(mockFingerprint, mockProxy);
      
      expect(mockContext.addInitScript).toHaveBeenCalled();
      const scriptCall = mockContext.addInitScript.mock.calls[0][0];
      expect(scriptCall).toContain('webdriver');
      expect(scriptCall).toContain('chrome');
      expect(scriptCall).toContain('plugins');
    });

    test('Canvas noise injection içermeli', async () => {
      await browserManager.launchBrowser(mockFingerprint, mockProxy);
      
      const scriptCall = mockContext.addInitScript.mock.calls[0][0];
      expect(scriptCall).toContain('getImageData');
      expect(scriptCall).toContain('noise');
    });

    test('WebGL spoofing içermeli', async () => {
      await browserManager.launchBrowser(mockFingerprint, mockProxy);
      
      const scriptCall = mockContext.addInitScript.mock.calls[0][0];
      expect(scriptCall).toContain('WebGLRenderingContext');
      expect(scriptCall).toContain('37445'); // VENDOR parameter
    });
  });

  // ---------------------------------------------------------------
  describe('Page Creation', () => {
    test('Yeni page oluşturulabilmeli', async () => {
      const context = await browserManager.launchBrowser(mockFingerprint, mockProxy);
      
      const page = await browserManager.createPage(context);
      
      expect(mockContext.newPage).toHaveBeenCalled();
      expect(page).toBe(mockPage);
    });

    test('Bot detection kontrolü yapılmalı', async () => {
      mockPage.evaluate.mockResolvedValueOnce(['webdriver']);
      
      const context = await browserManager.launchBrowser(mockFingerprint, mockProxy);
      await browserManager.createPage(context);
      
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Bot detection triggered, applying additional stealth...'
      );
    });

    test('Timeout ayarlanmalı', async () => {
      const context = await browserManager.launchBrowser(mockFingerprint, mockProxy);
      await browserManager.createPage(context);
      
      expect(mockPage.setDefaultTimeout).toHaveBeenCalled();
      expect(mockPage.setDefaultNavigationTimeout).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------
  describe('Cookie Management', () => {
    test('Cookie kaydedilebilmeli', async () => {
      const context = await browserManager.launchBrowser(mockFingerprint, mockProxy);
      const cookies = [{ name: 'test', value: 'value', domain: 'google.com' }];
      mockContext.cookies.mockResolvedValueOnce(cookies);
      
      await browserManager.closeBrowser(context, true);
      
      const writeFileMock = jest.requireMock('fs').writeFileSync;
      expect(writeFileMock).toHaveBeenCalled();
    });

    test('Cookie yüklenebilmeli', () => {
      const cookiesData = JSON.stringify([{ name: 'loaded', value: 'cookie' }]);
      jest.requireMock('fs').existsSync.mockReturnValueOnce(true);
      jest.requireMock('fs').readFileSync.mockReturnValueOnce(cookiesData);
      
      const cookies = browserManager.loadCookies('fp-test-123');
      
      expect(cookies).toEqual([{ name: 'loaded', value: 'cookie' }]);
    });
  });

  // ---------------------------------------------------------------
  describe('Browser Close', () => {
    test('Browser kapatılabilmeli', async () => {
      const context = await browserManager.launchBrowser(mockFingerprint, mockProxy);
      
      await browserManager.closeBrowser(context, true);
      
      expect(mockContext.close).toHaveBeenCalled();
      expect(mockBrowser.close).toHaveBeenCalled();
      expect(browserManager.getActiveBrowserCount()).toBe(0);
    });

    test('CDP session detach edilmeli', async () => {
      const context = await browserManager.launchBrowser(mockFingerprint, mockProxy);
      
      await browserManager.closeBrowser(context, false);
      
      expect(mockCDPSession.detach).toHaveBeenCalled();
    });

    test('Tüm browser\'lar kapatılabilmeli', async () => {
      await browserManager.launchBrowser(mockFingerprint, mockProxy);
      await browserManager.launchBrowser(
        { ...mockFingerprint, id: 'fp-2' },
        mockProxy
      );
      
      expect(browserManager.getActiveBrowserCount()).toBe(2);
      
      await browserManager.closeAll();
      
      expect(browserManager.getActiveBrowserCount()).toBe(0);
    });
  });

  // ---------------------------------------------------------------
  describe('Stats and Getters', () => {
    test('Aktif browser sayısı döndürülmeli', async () => {
      expect(browserManager.getActiveBrowserCount()).toBe(0);
      
      await browserManager.launchBrowser(mockFingerprint, mockProxy);
      expect(browserManager.getActiveBrowserCount()).toBe(1);
    });

    test('Detaylı istatistikler döndürülmeli', async () => {
      const context = await browserManager.launchBrowser(mockFingerprint, mockProxy);
      await browserManager.createPage(context);
      
      const stats = browserManager.getStats();
      
      expect(stats.active).toBe(1);
      expect(stats.maxAllowed).toBe(5);
      expect(stats.totalPages).toBe(1);
    });
  });

  // ---------------------------------------------------------------
  describe('Factory Pattern', () => {
    test('createBrowserManager isimli instance oluşturmalı', () => {
      const manager = createBrowserManager('test-instance', {}, mockLogger);
      
      expect(getNamedBrowserManager('test-instance')).toBe(manager);
    });

    test('Aynı isimle tekrar oluşturulunca eski kapatılmalı', () => {
      const first = createBrowserManager('test', {}, mockLogger);
      const closeSpy = jest.spyOn(first, 'closeAll');
      
      const second = createBrowserManager('test', {}, mockLogger);
      
      expect(closeSpy).toHaveBeenCalled();
      expect(getNamedBrowserManager('test')).toBe(second);
    });

    test('closeNamedBrowserManager instance kapatıp silmeli', () => {
      const manager = createBrowserManager('close-test', {}, mockLogger);
      const closeSpy = jest.spyOn(manager, 'closeAll');
      
      closeNamedBrowserManager('close-test');
      
      expect(closeSpy).toHaveBeenCalled();
      expect(getNamedBrowserManager('close-test')).toBeUndefined();
    });

    test('closeAllBrowserManagers hepsini kapatmalı', () => {
      const a = createBrowserManager('a', {}, mockLogger);
      const b = createBrowserManager('b', {}, mockLogger);
      const spyA = jest.spyOn(a, 'closeAll');
      const spyB = jest.spyOn(b, 'closeAll');
      
      closeAllBrowserManagers();
      
      expect(spyA).toHaveBeenCalled();
      expect(spyB).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------
  describe('Configuration', () => {
    test('Resource interceptor config uygulanmalı', async () => {
      const config: Partial<BrowserManagerConfig> = {
        resourceInterceptor: {
          blockImages: true,
          blockFonts: true,
          blockCSS: false,
        },
      };
      
      browserManager = new BrowserManager(config, mockLogger);
      await browserManager.launchBrowser(mockFingerprint, mockProxy);
      
      expect(mockContext.route).toHaveBeenCalled();
    });

    test('Lifecycle config uygulanmalı', async () => {
      const config: Partial<BrowserManagerConfig> = {
        lifecycle: {
          navigationTimeout: 45000,
          crashRecovery: true,
          maxRecoveryAttempts: 5,
        },
      };
      
      browserManager = new BrowserManager(config, mockLogger);
      await browserManager.launchBrowser(mockFingerprint, mockProxy);
      
      expect(mockContext.on).toHaveBeenCalledWith('crashed', expect.any(Function));
    });
  });

  // ---------------------------------------------------------------
  describe('Screenshot', () => {
    test('Debug modda screenshot alınabilmeli', async () => {
      browserManager = new BrowserManager({ debugMode: true }, mockLogger);
      const context = await browserManager.launchBrowser(mockFingerprint, mockProxy);
      const page = await browserManager.createPage(context);
      
      await browserManager.takeScreenshot(page, 'test-screenshot');
      
      expect(mockPage.screenshot).toHaveBeenCalledWith({
        path: expect.stringContaining('test-screenshot'),
        fullPage: true,
      });
    });

    test('Debug mod kapalıysa screenshot alınmamalı', async () => {
      browserManager = new BrowserManager({ debugMode: false }, mockLogger);
      const context = await browserManager.launchBrowser(mockFingerprint, mockProxy);
      const page = await browserManager.createPage(context);
      
      await browserManager.takeScreenshot(page, 'test-screenshot');
      
      expect(mockPage.screenshot).not.toHaveBeenCalled();
    });
  });
});