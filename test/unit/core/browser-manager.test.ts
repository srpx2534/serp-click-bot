/**
 * BrowserManager.test.ts
 *
 * BrowserManager için gerçek browser başlatmadan çalışan
 * deterministic Jest unit testleri.
 *
 * Test edilen başlıklar:
 * - Manager oluşturma
 * - Browser launch
 * - Proxy parsing
 * - Context/page lifecycle
 * - Timeout ayarları
 * - Cookie restore
 * - Cookie persistence
 * - Resource interception
 * - Allowed domain
 * - Tracking blocking
 * - Screenshot
 * - Statistics
 * - Browser close
 * - Factory
 * - Singleton
 * - Invalid proxy
 * - Concurrency
 */

import { EventEmitter } from 'events';

import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';

import { tmpdir } from 'os';
import { join } from 'path';

/* =========================================================
 * MOCK TYPES
 * ======================================================= */

type MockPage = EventEmitter & {
  setDefaultTimeout: jest.Mock;
  setDefaultNavigationTimeout: jest.Mock;
  goto: jest.Mock;
  screenshot: jest.Mock;
  url: jest.Mock;
  off: jest.Mock;
};

type MockContext = EventEmitter & {
  pages: jest.Mock;
  newPage: jest.Mock;
  route: jest.Mock;
  addCookies: jest.Mock;
  cookies: jest.Mock;
  close: jest.Mock;

  __routeHandler?: (
    route: MockRoute,
    request: MockRequest,
  ) => Promise<void>;
};

type MockBrowser = {
  close: jest.Mock;
};

type MockRoute = {
  continue: jest.Mock;
  abort: jest.Mock;
};

type MockRequest = {
  url: jest.Mock;
  resourceType: jest.Mock;
};

/* =========================================================
 * PATCHRIGHT MOCK
 * ======================================================= */

let mockBrowser: MockBrowser;
let mockContext: MockContext;
let mockPages: MockPage[];

function createMockPage(
  url = 'about:blank',
): MockPage {
  const page =
    new EventEmitter() as MockPage;

  page.setDefaultTimeout =
    jest.fn();

  page.setDefaultNavigationTimeout =
    jest.fn();

  page.goto =
    jest.fn().mockResolvedValue(
      undefined,
    );

  page.screenshot =
    jest.fn().mockResolvedValue(
      undefined,
    );

  page.url =
    jest.fn().mockReturnValue(
      url,
    );

  page.off =
    jest.fn(
      EventEmitter.prototype.removeListener.bind(
        page,
      ),
    );

  return page;
}

function createMockContext(): MockContext {
  const context =
    new EventEmitter() as MockContext;

  mockPages = [];

  context.pages =
    jest.fn(
      () => mockPages,
    );

  context.newPage =
    jest.fn(
      async () => {
        const page =
          createMockPage();

        mockPages.push(page);

        /*
         * Gerçek Playwright'da context
         * "page" event'i üretir.
         */
        context.emit(
          'page',
          page,
        );

        return page;
      },
    );

  context.route =
    jest.fn(
      async (
        _pattern: string,
        handler: (
          route: MockRoute,
          request: MockRequest,
        ) => Promise<void>,
      ) => {
        context.__routeHandler =
          handler;
      },
    );

  context.addCookies =
    jest.fn().mockResolvedValue(
      undefined,
    );

  context.cookies =
    jest.fn().mockResolvedValue(
      [],
    );

  context.close =
    jest.fn().mockResolvedValue(
      undefined,
    );

  return context;
}

jest.mock('patchright', () => {
  return {
    chromium: {
      launch: jest.fn(
        async () => {
          mockBrowser = {
            close:
              jest.fn().mockResolvedValue(
                undefined,
              ),
          };

          mockContext =
            createMockContext();

          return {
            ...mockBrowser,

            newContext:
              jest.fn(
                async () =>
                  mockContext,
              ),
          };
        },
      ),
    },
  };
});

/* =========================================================
 * LOGGER MOCK
 * ======================================================= */

jest.mock(
  '../../../src/utils/logger',
  () => {
    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };

    return {
      Logger: jest.fn(),
      getLogger: jest.fn(
        () => logger,
      ),
    };
  },
);

/* =========================================================
 * IMPORT AFTER MOCKS
 * ======================================================= */

import {
  BrowserManager,
  closeAllBrowserManagers,
  closeNamedBrowserManager,
  createBrowserManager,
  getBrowserManager,
  getNamedBrowserManager,
  resetBrowserManager,
} from '../../../src/core/browser-manager';

import { chromium } from 'patchright';

/* =========================================================
 * FIXTURES
 * ======================================================= */

const createFingerprint = (
  overrides: Record<
    string,
    unknown
  > = {},
): any => ({
  id: 'test-fingerprint',

  type: 'desktop',

  viewport: {
    width: 1280,
    height: 720,
  },

  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',

  language: 'en-US',

  timezone:
    'Europe/Istanbul',

  pixelRatio: 1,

  touchSupport: false,

  ...overrides,
});

const createProxy = (
  url =
    'http://user:password@127.0.0.1:8080',
): any => ({
  url,
});

/* =========================================================
 * TEST SUITE
 * ======================================================= */

describe(
  'BrowserManager',
  () => {
    let tempDirectory: string;
    let cookieDirectory: string;
    let browserDataDirectory: string;

    beforeEach(() => {
      jest.clearAllMocks();

      tempDirectory =
        mkdtempSync(
          join(
            tmpdir(),
            'browser-manager-test-',
          ),
        );

      cookieDirectory =
        join(
          tempDirectory,
          'cookies',
        );

      browserDataDirectory =
        join(
          tempDirectory,
          'browser-data',
        );
    });

    afterEach(
      async () => {
        await resetBrowserManager();

        await closeAllBrowserManagers();

        rmSync(
          tempDirectory,
          {
            recursive: true,
            force: true,
          },
        );
      },
    );

    /* =====================================================
     * CONSTRUCTOR
     * =================================================== */

    describe(
      'constructor',
      () => {
        it(
          'should create required directories',
          () => {
            const manager =
              new BrowserManager({
                cookieDir:
                  cookieDirectory,

                userDataDir:
                  browserDataDirectory,
              });

            expect(
              manager,
            ).toBeInstanceOf(
              BrowserManager,
            );

            expect(
              existsSync(
                cookieDirectory,
              ),
            ).toBe(true);

            expect(
              existsSync(
                browserDataDirectory,
              ),
            ).toBe(true);
          },
        );
      },
    );

    /* =====================================================
     * LAUNCH
     * =================================================== */

    describe(
      'launchBrowser',
      () => {
        it(
          'should launch browser and create context',
          async () => {
            const manager =
              new BrowserManager({
                cookieDir:
                  cookieDirectory,

                userDataDir:
                  browserDataDirectory,
              });

            const context =
              await manager.launchBrowser(
                createFingerprint(),
                createProxy(),
              );

            expect(
              context,
            ).toBe(mockContext);

            expect(
              chromium.launch,
            ).toHaveBeenCalledTimes(
              1,
            );

            expect(
              manager.getActiveBrowserCount(),
            ).toBe(1);

            expect(
              context.route,
            ).toHaveBeenCalledTimes(
              1,
            );
          },
        );

        it(
          'should pass proxy credentials correctly',
          async () => {
            const manager =
              new BrowserManager({
                cookieDir:
                  cookieDirectory,

                userDataDir:
                  browserDataDirectory,
              });

            await manager.launchBrowser(
              createFingerprint(),
              createProxy(
                'http://test-user:test-pass@proxy.example.com:3128',
              ),
            );

            const launchMock =
              chromium.launch as jest.Mock;

            const options =
              launchMock.mock.calls[0][0];

            expect(
              options.proxy,
            ).toEqual({
              server:
                'http://proxy.example.com:3128',

              username:
                'test-user',

              password:
                'test-pass',
            });
          },
        );

        it(
          'should pass configured launch args',
          async () => {
            const manager =
              new BrowserManager({
                cookieDir:
                  cookieDirectory,

                userDataDir:
                  browserDataDirectory,

                launchArgs: [
                  '--disable-dev-shm-usage',
                  '--custom-test-arg',
                ],
              });

            await manager.launchBrowser(
              createFingerprint(),
              createProxy(),
            );

            const launchMock =
              chromium.launch as jest.Mock;

            const options =
              launchMock.mock.calls[0][0];

            expect(
              options.args,
            ).toEqual([
              '--disable-dev-shm-usage',
              '--custom-test-arg',
            ]);
          },
        );

        it(
          'should apply fingerprint context settings',
          async () => {
            const manager =
              new BrowserManager({
                cookieDir:
                  cookieDirectory,

                userDataDir:
                  browserDataDirectory,
              });

            const fingerprint =
              createFingerprint({
                viewport: {
                  width: 1440,
                  height: 900,
                },

                userAgent:
                  'Test-Agent/1.0',

                language:
                  'tr-TR',

                timezone:
                  'Europe/Istanbul',

                pixelRatio: 2,

                touchSupport:
                  true,

                type: 'mobile',
              });

            await manager.launchBrowser(
              fingerprint,
              createProxy(),
            );

            const browser =
              (
                chromium.launch as
                  jest.Mock
              ).mock.results[0]
                .value;

            const resolvedBrowser =
              await browser;

            const contextOptions =
              resolvedBrowser
                .newContext.mock
                .calls[0][0];

            expect(
              contextOptions.viewport,
            ).toEqual({
              width: 1440,
              height: 900,
            });

            expect(
              contextOptions.userAgent,
            ).toBe(
              'Test-Agent/1.0',
            );

            expect(
              contextOptions.locale,
            ).toBe('tr-TR');

            expect(
              contextOptions.timezoneId,
            ).toBe(
              'Europe/Istanbul',
            );

            expect(
              contextOptions
                .deviceScaleFactor,
            ).toBe(2);

            expect(
              contextOptions.isMobile,
            ).toBe(true);

            expect(
              contextOptions.hasTouch,
            ).toBe(true);
          },
        );

        it(
          'should create initial page',
          async () => {
            const manager =
              new BrowserManager({
                cookieDir:
                  cookieDirectory,

                userDataDir:
                  browserDataDirectory,
              });

            const context =
              await manager.launchBrowser(
                createFingerprint(),
                createProxy(),
              );

            expect(
              context.newPage,
            ).toHaveBeenCalled();

            const page =
              mockPages[0];

            expect(
              page.goto,
            ).toHaveBeenCalledWith(
              'about:blank',
            );
          },
        );
      },
    );

    /* =====================================================
     * INVALID PROXY
     * =================================================== */

    describe(
      'proxy validation',
      () => {
        it(
          'should reject unsupported proxy protocol',
          async () => {
            const manager =
              new BrowserManager({
                cookieDir:
                  cookieDirectory,

                userDataDir:
                  browserDataDirectory,
              });

            await expect(
              manager.launchBrowser(
                createFingerprint(),
                createProxy(
                  'ftp://proxy.example.com:21',
                ),
              ),
            ).rejects.toThrow(
              'Unsupported proxy protocol',
            );

            expect(
              manager.getActiveBrowserCount(),
            ).toBe(0);
          },
        );

        it(
          'should reject invalid proxy URL',
          async () => {
            const manager =
              new BrowserManager({
                cookieDir:
                  cookieDirectory,

                userDataDir:
                  browserDataDirectory,
              });

            await expect(
              manager.launchBrowser(
                createFingerprint(),
                createProxy(
                  'not-a-valid-url',
                ),
              ),
            ).rejects.toThrow();

            expect(
              manager.getActiveBrowserCount(),
            ).toBe(0);
          },
        );
      },
    );

    /* =====================================================
     * PAGE
     * =================================================== */

    describe(
      'createPage',
      () => {
        it(
          'should create a page and apply timeout configuration',
          async () => {
            const manager =
              new BrowserManager({
                cookieDir:
                  cookieDirectory,

                userDataDir:
                  browserDataDirectory,

                lifecycle: {
                  defaultTimeout:
                    15_000,

                  navigationTimeout:
                    25_000,
                },
              });

            const context =
              await manager.launchBrowser(
                createFingerprint(),
                createProxy(),
              );

            const page =
              await manager.createPage(
                context,
              );

            expect(
              page.setDefaultTimeout,
            ).toHaveBeenCalledWith(
              15_000,
            );

            expect(
              page.setDefaultNavigationTimeout,
            ).toHaveBeenCalledWith(
              25_000,
            );
          },
        );

        it(
          'should reject unmanaged context',
          async () => {
            const manager =
              new BrowserManager({
                cookieDir:
                  cookieDirectory,

                userDataDir:
                  browserDataDirectory,
              });

            const foreignContext =
              createMockContext();

            await expect(
              manager.createPage(
                foreignContext as any,
              ),
            ).rejects.toThrow(
              'BrowserContext is not managed by this BrowserManager.',
            );
          },
        );
      },
    );

    /* =====================================================
     * COOKIES
     * =================================================== */

    describe(
      'cookies',
      () => {
        it(
          'should restore supplied cookies',
          async () => {
            const manager =
              new BrowserManager({
                cookieDir:
                  cookieDirectory,

                userDataDir:
                  browserDataDirectory,
              });

            const cookies: any[] = [
              {
                name: 'session',
                value: 'abc123',
                domain:
                  'example.com',
                path: '/',
              },
            ];

            await manager.launchBrowser(
              createFingerprint(),
              createProxy(),
              cookies,
            );

            expect(
              mockContext.addCookies,
            ).toHaveBeenCalledWith(
              cookies,
            );
          },
        );

        it(
          'should load cookies from disk when no cookies are supplied',
          async () => {
            const manager =
              new BrowserManager({
                cookieDir:
                  cookieDirectory,

                userDataDir:
                  browserDataDirectory,
              });

            const fingerprintId =
              'disk-cookie-fingerprint';

            const fingerprint =
              createFingerprint({
                id: fingerprintId,
              });

            const cookies: any[] = [
              {
                name: 'persisted',
                value: 'yes',
                domain:
                  'example.com',
                path: '/',
              },
            ];

            const cookieFile =
              join(
                cookieDirectory,
                `${fingerprintId}.json`,
              );

            mkdirSync(
              cookieDirectory,
              {
                recursive: true,
              },
            );

            writeFileSync(
              cookieFile,
              JSON.stringify(
                cookies,
              ),
              'utf8',
            );

            await manager.launchBrowser(
              fingerprint,
              createProxy(),
            );

            expect(
              mockContext.addCookies,
            ).toHaveBeenCalledWith(
              cookies,
            );
          },
        );

        it(
          'should save cookies when browser closes',
          async () => {
            const manager =
              new BrowserManager({
                cookieDir:
                  cookieDirectory,

                userDataDir:
                  browserDataDirectory,
              });

            const fingerprintId =
              'save-cookie-test';

            const fingerprint =
              createFingerprint({
                id: fingerprintId,
              });

            const cookies: any[] = [
              {
                name: 'session',
                value:
                  'saved-value',
                domain:
                  'example.com',
                path: '/',
              },
            ];

            const context =
              await manager.launchBrowser(
                fingerprint,
                createProxy(),
              );

            /*
             * ÖNEMLİ:
             *
             * mockContext launchBrowser() sırasında
             * oluşturulduğu için cookies mock'u
             * launchBrowser() sonrasında ayarlanıyor.
             */
            mockContext.cookies =
              jest
                .fn()
                .mockResolvedValue(
                  cookies,
                );

            await manager.closeBrowser(
              context,
              true,
            );

            const cookieFile =
              join(
                cookieDirectory,
                `${fingerprintId}.json`,
              );

            expect(
              existsSync(
                cookieFile,
              ),
            ).toBe(true);

            const stored =
              JSON.parse(
                readFileSync(
                  cookieFile,
                  'utf8',
                ),
              );

            expect(
              stored,
            ).toEqual(
              cookies,
            );
          },
        );

        it(
          'should not save cookies when disabled',
          async () => {
            const manager =
              new BrowserManager({
                cookieDir:
                  cookieDirectory,

                userDataDir:
                  browserDataDirectory,
              });

            const fingerprintId =
              'no-save-cookie';

            const context =
              await manager.launchBrowser(
                createFingerprint({
                  id: fingerprintId,
                }),
                createProxy(),
              );

            await manager.closeBrowser(
              context,
              false,
            );

            expect(
              mockContext.cookies,
            ).not.toHaveBeenCalled();

            const cookieFile =
              join(
                cookieDirectory,
                `${fingerprintId}.json`,
              );

            expect(
              existsSync(
                cookieFile,
              ),
            ).toBe(false);
          },
        );
      },
    );

    /* =====================================================
     * RESOURCE INTERCEPTION
     * =================================================== */

    describe(
      'resource interceptor',
      () => {
        it(
          'should block images',
          async () => {
            const manager =
              new BrowserManager({
                cookieDir:
                  cookieDirectory,

                userDataDir:
                  browserDataDirectory,

                resourceInterceptor: {
                  blockImages: true,
                },
              });

            await manager.launchBrowser(
              createFingerprint(),
              createProxy(),
            );

            expect(
              mockContext.__routeHandler,
            ).toBeDefined();

            const route: MockRoute = {
              continue: jest.fn(),
              abort: jest.fn(),
            };

            const request: MockRequest =
              {
                url: jest.fn(
                  () =>
                    'https://example.com/test.png',
                ),

                resourceType:
                  jest.fn(
                    () =>
                      'image',
                  ),
              };

            await mockContext
              .__routeHandler!(
                route,
                request,
              );

            expect(
              route.abort,
            ).toHaveBeenCalled();

            expect(
              route.continue,
            ).not.toHaveBeenCalled();
          },
        );

        it(
          'should allow CSS by default',
          async () => {
            const manager =
              new BrowserManager({
                cookieDir:
                  cookieDirectory,

                userDataDir:
                  browserDataDirectory,
              });

            await manager.launchBrowser(
              createFingerprint(),
              createProxy(),
            );

            const route: MockRoute = {
              continue: jest.fn(),
              abort: jest.fn(),
            };

            const request: MockRequest =
              {
                url: jest.fn(
                  () =>
                    'https://example.com/app.css',
                ),

                resourceType:
                  jest.fn(
                    () =>
                      'stylesheet',
                  ),
              };

            await mockContext
              .__routeHandler!(
                route,
                request,
              );

            expect(
              route.continue,
            ).toHaveBeenCalled();

            expect(
              route.abort,
            ).not.toHaveBeenCalled();
          },
        );

        it(
          'should block CSS when enabled',
          async () => {
            const manager =
              new BrowserManager({
                cookieDir:
                  cookieDirectory,

                userDataDir:
                  browserDataDirectory,

                resourceInterceptor: {
                  blockCSS: true,
                },
              });

            await manager.launchBrowser(
              createFingerprint(),
              createProxy(),
            );

            const route: MockRoute = {
              continue: jest.fn(),
              abort: jest.fn(),
            };

            const request: MockRequest =
              {
                url: jest.fn(
                  () =>
                    'https://example.com/app.css',
                ),

                resourceType:
                  jest.fn(
                    () =>
                      'stylesheet',
                  ),
              };

            await mockContext
              .__routeHandler!(
                route,
                request,
              );

            expect(
              route.abort,
            ).toHaveBeenCalled();
          },
        );

        it(
          'should block fonts',
          async () => {
            const manager =
              new BrowserManager({
                cookieDir:
                  cookieDirectory,

                userDataDir:
                  browserDataDirectory,

                resourceInterceptor: {
                  blockFonts: true,
                },
              });

            await manager.launchBrowser(
              createFingerprint(),
              createProxy(),
            );

            const route: MockRoute = {
              continue: jest.fn(),
              abort: jest.fn(),
            };

            const request: MockRequest =
              {
                url: jest.fn(
                  () =>
                    'https://cdn.example.com/font.woff2',
                ),

                resourceType:
                  jest.fn(
                    () => 'font',
                  ),
              };

            await mockContext
              .__routeHandler!(
                route,
                request,
              );

            expect(
              route.abort,
            ).toHaveBeenCalled();
          },
        );

        it(
          'should block media',
          async () => {
            const manager =
              new BrowserManager({
                cookieDir:
                  cookieDirectory,

                userDataDir:
                  browserDataDirectory,

                resourceInterceptor: {
                  blockMedia: true,
                },
              });

            await manager.launchBrowser(
              createFingerprint(),
              createProxy(),
            );

            const route: MockRoute = {
              continue: jest.fn(),
              abort: jest.fn(),
            };

            const request: MockRequest =
              {
                url: jest.fn(
                  () =>
                    'https://example.com/video.mp4',
                ),

                resourceType:
                  jest.fn(
                    () => 'media',
                  ),
              };

            await mockContext
              .__routeHandler!(
                route,
                request,
              );

            expect(
              route.abort,
            ).toHaveBeenCalled();
          },
        );

        it(
          'should allow about URLs',
          async () => {
            const manager =
              new BrowserManager({
                cookieDir:
                  cookieDirectory,

                userDataDir:
                  browserDataDirectory,
              });

            await manager.launchBrowser(
              createFingerprint(),
              createProxy(),
            );

            const route: MockRoute = {
              continue: jest.fn(),
              abort: jest.fn(),
            };

            const request: MockRequest =
              {
                url: jest.fn(
                  () =>
                    'about:blank',
                ),

                resourceType:
                  jest.fn(
                    () => 'document',
                  ),
              };

            await mockContext
              .__routeHandler!(
                route,
                request,
              );

            expect(
              route.continue,
            ).toHaveBeenCalled();
          },
        );

        it(
          'should allow configured domains',
          async () => {
            const manager =
              new BrowserManager({
                cookieDir:
                  cookieDirectory,

                userDataDir:
                  browserDataDirectory,

                resourceInterceptor: {
                  blockImages:
                    true,

                  allowedDomains: [
                    'example.com',
                  ],
                },
              });

            await manager.launchBrowser(
              createFingerprint(),
              createProxy(),
            );

            const route: MockRoute = {
              continue: jest.fn(),
              abort: jest.fn(),
            };

            const request: MockRequest =
              {
                url: jest.fn(
                  () =>
                    'https://cdn.example.com/image.png',
                ),

                resourceType:
                  jest.fn(
                    () => 'image',
                  ),
              };

            await mockContext
              .__routeHandler!(
                route,
                request,
              );

            expect(
              route.continue,
            ).toHaveBeenCalled();

            expect(
              route.abort,
            ).not.toHaveBeenCalled();
          },
        );

        it(
          'should block tracking hosts when enabled',
          async () => {
            const manager =
              new BrowserManager({
                cookieDir:
                  cookieDirectory,

                userDataDir:
                  browserDataDirectory,

                resourceInterceptor: {
                  blockTracking:
                    true,

                  trackingHosts: [
                    'google-analytics.com',
                  ],
                },
              });

            await manager.launchBrowser(
              createFingerprint(),
              createProxy(),
            );

            const route: MockRoute = {
              continue: jest.fn(),
              abort: jest.fn(),
            };

            const request: MockRequest =
              {
                url: jest.fn(
                  () =>
                    'https://www.google-analytics.com/collect',
                ),

                resourceType:
                  jest.fn(
                    () => 'script',
                  ),
              };

            await mockContext
              .__routeHandler!(
                route,
                request,
              );

            expect(
              route.abort,
            ).toHaveBeenCalled();
          },
        );

        it(
          'should allow tracking hosts when blocking is disabled',
          async () => {
            const manager =
              new BrowserManager({
                cookieDir:
                  cookieDirectory,

                userDataDir:
                  browserDataDirectory,

                resourceInterceptor: {
                  blockTracking:
                    false,

                  trackingHosts: [
                    'google-analytics.com',
                  ],
                },
              });

            await manager.launchBrowser(
              createFingerprint(),
              createProxy(),
            );

            const route: MockRoute = {
              continue: jest.fn(),
              abort: jest.fn(),
            };

            const request: MockRequest =
              {
                url: jest.fn(
                  () =>
                    'https://www.google-analytics.com/collect',
                ),

                resourceType:
                  jest.fn(
                    () => 'script',
                  ),
              };

            await mockContext
              .__routeHandler!(
                route,
                request,
              );

            expect(
              route.continue,
            ).toHaveBeenCalled();
          },
        );
      },
    );

    /* =====================================================
     * STATS
     * =================================================== */

    describe(
      'statistics',
      () => {
        it(
          'should report active browser and page counts',
          async () => {
            const manager =
              new BrowserManager({
                cookieDir:
                  cookieDirectory,

                userDataDir:
                  browserDataDirectory,
              });

            const context =
              await manager.launchBrowser(
                createFingerprint(),
                createProxy(),
              );

            await manager.createPage(
              context,
            );

            const stats =
              manager.getStats();

            expect(
              stats.active,
            ).toBe(1);

            expect(
              stats.maxAllowed,
            ).toBe(5);

            expect(
              stats.totalPagesCreated,
            ).toBeGreaterThanOrEqual(
              2,
            );

            expect(
              stats.activePages,
            ).toBeGreaterThanOrEqual(
              2,
            );

            expect(
              stats.oldestBrowser,
            ).toBeInstanceOf(
              Date,
            );
          },
        );
      },
    );

    /* =====================================================
     * SCREENSHOT
     * =================================================== */

    describe(
      'screenshot',
      () => {
        it(
          'should not screenshot when debug mode is disabled',
          async () => {
            const manager =
              new BrowserManager({
                cookieDir:
                  cookieDirectory,

                userDataDir:
                  browserDataDirectory,

                debugMode: false,
              });

            const context =
              await manager.launchBrowser(
                createFingerprint(),
                createProxy(),
              );

            const page =
              await manager.createPage(
                context,
              );

            await manager.takeScreenshot(
              page,
              'test screenshot',
            );

            expect(
              page.screenshot,
            ).not.toHaveBeenCalled();
          },
        );

        it(
          'should take screenshot when debug mode is enabled',
          async () => {
            const manager =
              new BrowserManager({
                cookieDir:
                  cookieDirectory,

                userDataDir:
                  browserDataDirectory,

                debugMode: true,
              });

            const context =
              await manager.launchBrowser(
                createFingerprint(),
                createProxy(),
              );

            const page =
              await manager.createPage(
                context,
              );

            await manager.takeScreenshot(
              page,
              'test screenshot',
            );

            expect(
              page.screenshot,
            ).toHaveBeenCalledTimes(
              1,
            );

            const screenshotOptions =
              page.screenshot.mock
                .calls[0][0];

            expect(
              screenshotOptions.fullPage,
            ).toBe(true);

            expect(
              screenshotOptions.path,
            ).toContain(
              'test_screenshot.png',
            );
          },
        );
      },
    );

    /* =====================================================
     * CLOSE
     * =================================================== */

    describe(
      'closeBrowser',
      () => {
        it(
          'should close context and browser',
          async () => {
            const manager =
              new BrowserManager({
                cookieDir:
                  cookieDirectory,

                userDataDir:
                  browserDataDirectory,
              });

            const context =
              await manager.launchBrowser(
                createFingerprint(),
                createProxy(),
              );

            expect(
              manager.getActiveBrowserCount(),
            ).toBe(1);

            await manager.closeBrowser(
              context,
              false,
            );

            expect(
              mockContext.close,
            ).toHaveBeenCalled();

            expect(
              mockBrowser.close,
            ).toHaveBeenCalled();

            expect(
              manager.getActiveBrowserCount(),
            ).toBe(0);
          },
        );

        it(
          'should safely close unmanaged context',
          async () => {
            const manager =
              new BrowserManager({
                cookieDir:
                  cookieDirectory,

                userDataDir:
                  browserDataDirectory,
              });

            const foreignContext =
              createMockContext();

            await manager.closeBrowser(
              foreignContext as any,
              false,
            );

            expect(
              foreignContext.close,
            ).toHaveBeenCalled();
          },
        );
      },
    );

    /* =====================================================
     * CONCURRENCY
     * =================================================== */

    describe(
      'concurrency',
      () => {
        it(
          'should respect maxConcurrentBrowsers',
          async () => {
            const manager =
              new BrowserManager({
                maxConcurrentBrowsers:
                  1,

                cookieDir:
                  cookieDirectory,

                userDataDir:
                  browserDataDirectory,
              });

            const first =
              await manager.launchBrowser(
                createFingerprint({
                  id: 'first',
                }),
                createProxy(),
              );

            expect(
              manager.getActiveBrowserCount(),
            ).toBe(1);

            let secondResolved =
              false;

            const secondPromise =
              manager
                .launchBrowser(
                  createFingerprint({
                    id: 'second',
                  }),
                  createProxy(),
                )
                .then(context => {
                  secondResolved =
                    true;

                  return context;
                });

            /*
             * İkinci launch slot beklemeli.
             */
            await new Promise(
              resolve =>
                setTimeout(
                  resolve,
                  20,
                ),
            );

            expect(
              secondResolved,
            ).toBe(false);

            expect(
              manager.getActiveBrowserCount(),
            ).toBe(1);

            await manager.closeBrowser(
              first,
              false,
            );

            const second =
              await secondPromise;

            expect(
              second,
            ).toBeDefined();

            expect(
              manager.getActiveBrowserCount(),
            ).toBe(1);

            await manager.closeBrowser(
              second,
              false,
            );

            expect(
              manager.getActiveBrowserCount(),
            ).toBe(0);
          },
        );
      },
    );

    /* =====================================================
     * FACTORY
     * =================================================== */

    describe(
      'factory',
      () => {
        it(
          'should create and retrieve named manager',
          () => {
            const manager =
              createBrowserManager(
                'test-manager',
                {
                  cookieDir:
                    cookieDirectory,

                  userDataDir:
                    browserDataDirectory,
                },
              );

            expect(
              getNamedBrowserManager(
                'test-manager',
              ),
            ).toBe(manager);
          },
        );

        it(
          'should reject duplicate manager names',
          () => {
            createBrowserManager(
              'duplicate',
              {
                cookieDir:
                  cookieDirectory,

                userDataDir:
                  browserDataDirectory,
              },
            );

            expect(() =>
              createBrowserManager(
                'duplicate',
                {
                  cookieDir:
                    cookieDirectory,

                  userDataDir:
                    browserDataDirectory,
                },
              ),
            ).toThrow(
              'already exists',
            );
          },
        );

        it(
          'should close named manager',
          async () => {
            const manager =
              createBrowserManager(
                'close-test',
                {
                  cookieDir:
                    cookieDirectory,

                  userDataDir:
                    browserDataDirectory,
                },
              );

            await manager.launchBrowser(
              createFingerprint(),
              createProxy(),
            );

            await closeNamedBrowserManager(
              'close-test',
            );

            expect(
              getNamedBrowserManager(
                'close-test',
              ),
            ).toBeUndefined();
          },
        );
      },
    );

    /* =====================================================
     * SINGLETON
     * =================================================== */

    describe(
      'singleton',
      () => {
        it(
          'should return same BrowserManager instance',
          () => {
            const first =
              getBrowserManager({
                cookieDir:
                  cookieDirectory,

                userDataDir:
                  browserDataDirectory,
              });

            const second =
              getBrowserManager();

            expect(
              second,
            ).toBe(first);
          },
        );
      },
    );

    /* =====================================================
     * CLEAN SHUTDOWN
     * =================================================== */

    describe(
      'shutdown',
      () => {
        it(
          'should close all active browsers',
          async () => {
            const manager =
              new BrowserManager({
                cookieDir:
                  cookieDirectory,

                userDataDir:
                  browserDataDirectory,
              });

            const first =
              await manager.launchBrowser(
                createFingerprint({
                  id: 'one',
                }),
                createProxy(),
              );

            const second =
              await manager.launchBrowser(
                createFingerprint({
                  id: 'two',
                }),
                createProxy(),
              );

            expect(
              manager.getActiveBrowserCount(),
            ).toBe(2);

            await manager.closeAll();

            expect(
              manager.getActiveBrowserCount(),
            ).toBe(0);

            expect(
              first.close,
            ).toBeDefined();

            expect(
              second.close,
            ).toBeDefined();
          },
        );
      },
    );

    /* =====================================================
     * LOAD COOKIES
     * =================================================== */

    describe(
      'loadCookies',
      () => {
        it(
          'should return empty array for missing cookie file',
          () => {
            const manager =
              new BrowserManager({
                cookieDir:
                  cookieDirectory,

                userDataDir:
                  browserDataDirectory,
              });

            expect(
              manager.loadCookies(
                'does-not-exist',
              ),
            ).toEqual([]);
          },
        );

        it(
          'should return empty array for invalid JSON',
          () => {
            mkdirSync(
              cookieDirectory,
              {
                recursive: true,
              },
            );

            writeFileSync(
              join(
                cookieDirectory,
                'invalid.json',
              ),
              '{invalid-json',
              'utf8',
            );

            const manager =
              new BrowserManager({
                cookieDir:
                  cookieDirectory,

                userDataDir:
                  browserDataDirectory,
              });

            expect(
              manager.loadCookies(
                'invalid',
              ),
            ).toEqual([]);
          },
        );

        it(
          'should return empty array when JSON is not an array',
          () => {
            mkdirSync(
              cookieDirectory,
              {
                recursive: true,
              },
            );

            writeFileSync(
              join(
                cookieDirectory,
                'object.json',
              ),
              JSON.stringify({
                cookie: 'value',
              }),
              'utf8',
            );

            const manager =
              new BrowserManager({
                cookieDir:
                  cookieDirectory,

                userDataDir:
                  browserDataDirectory,
              });

            expect(
              manager.loadCookies(
                'object',
              ),
            ).toEqual([]);
          },
        );
      },
    );
  },
);
