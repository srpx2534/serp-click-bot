/**
 * BrowserManager.ts
 *
 * Patchright tabanlı, tek dosyalık browser lifecycle manager.
 *
 * Odak:
 * - Browser / Context lifecycle
 * - Concurrency control
 * - Proxy
 * - Cookie persistence
 * - Resource interception
 * - Page lifecycle
 * - Crash detection
 * - Timeout yönetimi
 * - Graceful shutdown
 *
 * Bilinçli olarak:
 * - navigator spoofing
 * - WebGL spoofing
 * - Canvas noise
 * - sahte PluginArray
 * - sahte window.chrome
 * - sahte CDP stealth komutları
 *
 * kullanılmıyor.
 *
 * Patchright kendi automation düzeltmelerini sağladığı için
 * browser fingerprint'ini gereksiz şekilde bozmak yerine
 * gerçek browser/context ayarlarının tutarlı tutulması tercih edilir.
 */

import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
  type Route,
  type Request,
} from 'patchright';

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'fs';

import { join } from 'path';

import type { FingerprintData } from '../types';
import type { ProxyStatus } from './proxy-manager';

import {
  Logger,
  getLogger,
} from '../utils/logger';

/* =========================================================
 * TYPES
 * ======================================================= */

type Cookie =
  Parameters<BrowserContext['addCookies']>[0][number];

export interface ResourceInterceptorConfig {
  blockImages: boolean;
  blockFonts: boolean;
  blockMedia: boolean;
  blockCSS: boolean;
  blockTracking: boolean;

  allowedDomains: string[];

  trackingHosts: string[];
}

export interface LifecycleConfig {
  navigationTimeout: number;
  defaultTimeout: number;

  crashRecovery: boolean;
  maxRecoveryAttempts: number;

  popupHandling: boolean;
  dialogHandling: boolean;

  /**
   * Browser idle kalırsa otomatik kapat.
   * 0 => disabled
   */
  idleTimeoutMs: number;

  /**
   * Browser maksimum yaşam süresi.
   * 0 => disabled
   */
  maxLifetimeMs: number;
}

export interface BrowserManagerConfig {
  maxConcurrentBrowsers: number;

  headless: boolean;

  channel?: 'chrome' | undefined;

  debugMode: boolean;

  cookieDir: string;

  userDataDir: string;

  resourceInterceptor: Partial<ResourceInterceptorConfig>;

  lifecycle: Partial<LifecycleConfig>;

  launchArgs: string[];

  colorScheme: 'light' | 'dark' | 'no-preference';
}

interface PageHandlers {
  crash: () => void;
  close: () => void;
  dialog?: (dialog: any) => void;
  popup?: (popup: Page) => void;
  pageerror?: (error: Error) => void;
  requestfailed?: (request: Request) => void;
}

interface BrowserInstance {
  id: string;

  browser: Browser;
  context: BrowserContext;

  fingerprint: FingerprintData;
  proxy: ProxyStatus;

  createdAt: Date;
  lastUsed: Date;

  totalPagesCreated: number;
  activePages: number;

  recoveryAttempts: number;

  closing: boolean;

  pageHandlers: Map<Page, PageHandlers>;
}

/* =========================================================
 * DEFAULT CONFIG
 * ======================================================= */

const DEFAULT_CONFIG: BrowserManagerConfig = {
  maxConcurrentBrowsers: 5,

  headless: true,

  channel: undefined,

  debugMode: false,

  cookieDir: './data/cookies',

  userDataDir: './data/browser-data',

  resourceInterceptor: {
    blockImages: true,
    blockFonts: true,
    blockMedia: true,
    blockCSS: false,

    blockTracking: false,

    allowedDomains: [],

    trackingHosts: [
      'google-analytics.com',
      'googletagmanager.com',
      'connect.facebook.net',
      'facebook.com',
      'doubleclick.net',
    ],
  },

  lifecycle: {
    navigationTimeout: 30_000,
    defaultTimeout: 30_000,

    crashRecovery: true,
    maxRecoveryAttempts: 3,

    popupHandling: true,
    dialogHandling: true,

    idleTimeoutMs: 0,
    maxLifetimeMs: 0,
  },

  launchArgs: [
    '--disable-dev-shm-usage',
  ],

  colorScheme: 'light',
};

/* =========================================================
 * BROWSER MANAGER
 * ======================================================= */

export class BrowserManager {
  private readonly config: BrowserManagerConfig;

  private readonly logger: Logger;

  private readonly activeBrowsers =
    new Map<string, BrowserInstance>();

  private readonly cookieCache =
    new Map<string, Cookie[]>();

  private shuttingDown = false;

  /**
   * Number of browser instances currently occupying
   * the concurrency limit.
   *
   * Bu değer launch sırasında değil,
   * browser instance aktif olduğu sürece tutulur.
   */
  private activeSlots = 0;

  /**
   * Waiting browser launches.
   */
  private readonly waitingLaunches: Array<{
    resolve: () => void;
    reject: (error: Error) => void;
  }> = [];

  private cleanupTimer?: ReturnType<typeof setInterval>;

  constructor(
    config: Partial<BrowserManagerConfig> = {},
    logger?: Logger,
  ) {
    this.config = this.mergeConfig(config);

    this.logger = logger ?? getLogger();

    this.ensureDirectories();

    this.startCleanupTimer();
  }

  /* =======================================================
   * CONFIG
   * ===================================================== */

  private mergeConfig(
    config: Partial<BrowserManagerConfig>,
  ): BrowserManagerConfig {
    const maxConcurrentBrowsers =
      config.maxConcurrentBrowsers ??
      DEFAULT_CONFIG.maxConcurrentBrowsers;

    if (
      !Number.isInteger(maxConcurrentBrowsers) ||
      maxConcurrentBrowsers < 1
    ) {
      throw new Error(
        'maxConcurrentBrowsers must be an integer greater than 0.',
      );
    }

    return {
      ...DEFAULT_CONFIG,
      ...config,

      maxConcurrentBrowsers,

      resourceInterceptor: {
        ...DEFAULT_CONFIG.resourceInterceptor,
        ...(config.resourceInterceptor ?? {}),
      },

      lifecycle: {
        ...DEFAULT_CONFIG.lifecycle,
        ...(config.lifecycle ?? {}),
      },

      launchArgs:
        config.launchArgs ??
        [...DEFAULT_CONFIG.launchArgs],
    };
  }

  /* =======================================================
   * DIRECTORIES
   * ===================================================== */

  private ensureDirectories(): void {
    for (const directory of [
      this.config.cookieDir,
      this.config.userDataDir,
    ]) {
      if (!existsSync(directory)) {
        mkdirSync(directory, {
          recursive: true,
        });
      }
    }
  }

  /* =======================================================
   * LAUNCH
   * ======================================================= */

  public async launchBrowser(
    fingerprint: FingerprintData,
    proxy: ProxyStatus,
    cookies?: Cookie[],
  ): Promise<BrowserContext> {
    if (this.shuttingDown) {
      throw new Error(
        'BrowserManager is shutting down.',
      );
    }

    /*
     * Concurrency slot browser kapanana kadar tutulur.
     *
     * Önceki implementasyonda slot launch tamamlandıktan
     * hemen sonra release ediliyordu. Bu nedenle:
     *
     * maxConcurrentBrowsers = 1
     *
     * olsa bile ikinci browser açılabiliyordu.
     */
    await this.acquireSlot();

    const contextId =
      this.generateContextId();

    let browser: Browser | undefined;
    let context: BrowserContext | undefined;

    let registered = false;

    try {
      if (this.shuttingDown) {
        throw new Error(
          'BrowserManager is shutting down.',
        );
      }

      this.logger.info(
        'Launching browser',
        {
          contextId,
          fingerprint: fingerprint.id,
          fingerprintType: fingerprint.type,
          proxy: this.maskProxyUrl(proxy.url),
        },
      );

      const proxyConfig =
        this.parseProxy(proxy.url);

      browser = await chromium.launch({
        headless: this.config.headless,

        ...(this.config.channel
          ? {
              channel: this.config.channel,
            }
          : {}),

        proxy: proxyConfig,

        args: [
          ...this.config.launchArgs,
        ],
      });

      if (this.shuttingDown) {
        throw new Error(
          'BrowserManager is shutting down.',
        );
      }

      context =
        await browser.newContext({
          viewport: {
            width:
              fingerprint.viewport.width,
            height:
              fingerprint.viewport.height,
          },

          userAgent:
            fingerprint.userAgent,

          locale:
            fingerprint.language,

          timezoneId:
            fingerprint.timezone,

          deviceScaleFactor:
            fingerprint.pixelRatio,

          isMobile:
            fingerprint.type === 'mobile',

          hasTouch:
            fingerprint.touchSupport,

          colorScheme:
            this.config.colorScheme,
        });

      /*
       * Resource routing.
       */
      await this.setupResourceInterceptor(
        context,
        this.config.resourceInterceptor,
      );

      /*
       * Cookie restore.
       */
      await this.restoreCookies(
        context,
        fingerprint.id,
        cookies,
      );

      if (this.shuttingDown) {
        throw new Error(
          'BrowserManager is shutting down.',
        );
      }

      const instance: BrowserInstance = {
        id: contextId,

        browser,
        context,

        fingerprint,
        proxy,

        createdAt: new Date(),
        lastUsed: new Date(),

        totalPagesCreated: 0,
        activePages: 0,

        recoveryAttempts: 0,

        closing: false,

        pageHandlers: new Map(),
      };

      this.activeBrowsers.set(
        contextId,
        instance,
      );

      registered = true;

      /*
       * Existing pages.
       */
      for (const page of context.pages()) {
        this.attachPageLifecycle(
          instance,
          page,
        );
      }

      /*
       * Future pages.
       */
      context.on('page', page => {
        if (
          instance.closing ||
          !this.activeBrowsers.has(instance.id)
        ) {
          return;
        }

        this.attachPageLifecycle(
          instance,
          page,
        );
      });

      /*
       * İlk page.
       */
      const page =
        await this.createPage(context);

      await page.goto(
        'about:blank',
      );

      this.logger.info(
        'Browser launched successfully',
        {
          contextId,
          activeBrowsers:
            this.activeBrowsers.size,
        },
      );

      return context;

    } catch (error) {
      this.logger.error(
        'Browser launch failed',
        error as Error,
        {
          contextId,
          fingerprint:
            fingerprint.id,
        },
      );

      if (registered) {
        this.activeBrowsers.delete(
          contextId,
        );
      }

      try {
        await context?.close();
      } catch {
        // ignore cleanup error
      }

      try {
        await browser?.close();
      } catch {
        // ignore cleanup error
      }

      /*
       * Launch başarısızsa slot artık kullanılmıyor.
       */
      if (this.activeSlots > 0) {
        this.releaseSlot();
      }

      throw error;
    }

    /*
     * Başarılı launch'ta slot burada release edilmez.
     *
     * Browser kapanınca closeBrowser() içinden
     * releaseSlot() yapılır.
     */
  }

  /* =======================================================
   * PAGE
   * ======================================================= */

  public async createPage(
    context: BrowserContext,
  ): Promise<Page> {
    const instance =
      this.findInstanceByContext(context);

    if (!instance) {
      throw new Error(
        'BrowserContext is not managed by this BrowserManager.',
      );
    }

    if (instance.closing) {
      throw new Error(
        'Browser instance is closing.',
      );
    }

    const page =
      await context.newPage();

    /*
     * Timeout settings.
     */
    page.setDefaultTimeout(
      this.config.lifecycle.defaultTimeout,
    );

    page.setDefaultNavigationTimeout(
      this.config.lifecycle.navigationTimeout,
    );

    /*
     * newPage() gerçek Playwright/Patchright'ta
     * "page" event'i de tetikleyebilir.
     *
     * attachPageLifecycle duplicate-safe olduğu için
     * burada ikinci kez attach edilmesi güvenlidir.
     */
    this.attachPageLifecycle(
      instance,
      page,
    );

    instance.lastUsed =
      new Date();

    return page;
  }

  /* =======================================================
   * PAGE LIFECYCLE
   * ======================================================= */

  private attachPageLifecycle(
    instance: BrowserInstance,
    page: Page,
  ): void {
    if (
      instance.closing ||
      instance.pageHandlers.has(page)
    ) {
      return;
    }

    instance.activePages++;
    instance.totalPagesCreated++;
    instance.lastUsed = new Date();

    const crash = () => {
      this.handlePageCrash(
        instance,
        page,
      ).catch(error => {
        this.logger.error(
          'Crash handler failed',
          error as Error,
        );
      });
    };

    const close = () => {
      const handlers =
        instance.pageHandlers.get(page);

      if (!handlers) {
        return;
      }

      instance.activePages =
        Math.max(
          0,
          instance.activePages - 1,
        );

      instance.lastUsed =
        new Date();

      instance.pageHandlers.delete(
        page,
      );
    };

    const dialog =
      this.config.lifecycle.dialogHandling
        ? async (dialogObject: any) => {
            try {
              this.logger.debug(
                `Dialog detected: ${dialogObject.type()}`,
              );

              await dialogObject.dismiss();
            } catch {
              // Page may already be closed.
            }
          }
        : undefined;

    const popup =
      this.config.lifecycle.popupHandling
        ? (popupPage: Page) => {
            try {
              this.logger.debug(
                `Popup opened: ${popupPage.url()}`,
              );
            } catch {
              this.logger.debug(
                'Popup opened',
              );
            }

            this.attachPageLifecycle(
              instance,
              popupPage,
            );
          }
        : undefined;

    const pageerror = (
      error: Error,
    ) => {
      this.logger.warn(
        `Page error: ${error.message}`,
      );
    };

    const requestfailed = (
      request: Request,
    ) => {
      this.logger.debug(
        `Request failed: ${request.url()}`,
      );
    };

    instance.pageHandlers.set(
      page,
      {
        crash,
        close,
        dialog,
        popup,
        pageerror,
        requestfailed,
      },
    );

    page.on(
      'crash',
      crash,
    );

    page.on(
      'close',
      close,
    );

    if (dialog) {
      page.on(
        'dialog',
        dialog,
      );
    }

    if (popup) {
      page.on(
        'popup',
        popup,
      );
    }

    page.on(
      'pageerror',
      pageerror,
    );

    page.on(
      'requestfailed',
      requestfailed,
    );
  }

  /* =======================================================
   * CRASH RECOVERY
   * ======================================================= */

  private async handlePageCrash(
    instance: BrowserInstance,
    page: Page,
  ): Promise<void> {
    if (instance.closing) {
      return;
    }

    this.logger.error(
      'Page crashed',
      new Error('Page crashed'),
      {
        contextId: instance.id,
        url: safePageUrl(page),
      },
    );

    if (
      !this.config.lifecycle.crashRecovery
    ) {
      return;
    }

    if (
      instance.recoveryAttempts >=
      this.config.lifecycle
        .maxRecoveryAttempts
    ) {
      this.logger.error(
        'Maximum recovery attempts reached',
        new Error(
          `Recovery failed for ${instance.id}`,
        ),
      );

      await this.closeBrowser(
        instance.context,
        false,
      );

      return;
    }

    instance.recoveryAttempts++;

    try {
      const replacement =
        await instance.context.newPage();

      this.attachPageLifecycle(
        instance,
        replacement,
      );

      replacement.setDefaultTimeout(
        this.config.lifecycle
          .defaultTimeout,
      );

      replacement.setDefaultNavigationTimeout(
        this.config.lifecycle
          .navigationTimeout,
      );

      await replacement.goto(
        'about:blank',
        {
          waitUntil:
            'domcontentloaded',
        },
      );

      instance.recoveryAttempts = 0;
      instance.lastUsed = new Date();

      this.logger.info(
        'Page crash recovered',
        {
          contextId:
            instance.id,
        },
      );

    } catch (error) {
      this.logger.error(
        'Page crash recovery failed',
        error as Error,
        {
          contextId:
            instance.id,
        },
      );

      await this.closeBrowser(
        instance.context,
        false,
      );
    }
  }

  /* =======================================================
   * RESOURCE INTERCEPTION
   * ======================================================= */

  private async setupResourceInterceptor(
    context: BrowserContext,
    config: Partial<ResourceInterceptorConfig>,
  ): Promise<void> {
    await context.route(
      '**/*',
      async (
        route: Route,
        request: Request,
      ) => {
        try {
          const url =
            request.url();

          if (
            url.startsWith('about:') ||
            url.startsWith('data:') ||
            url.startsWith('blob:')
          ) {
            await route.continue();
            return;
          }

          const hostname =
            safeHostname(url);

          if (
            hostname &&
            this.isAllowedDomain(
              hostname,
              config.allowedDomains ??
                [],
            )
          ) {
            await route.continue();
            return;
          }

          const resourceType =
            request.resourceType();

          if (
            config.blockTracking &&
            hostname &&
            this.isTrackingHost(
              hostname,
              config.trackingHosts ??
                [],
            )
          ) {
            await route.abort();
            return;
          }

          if (
            config.blockImages &&
            resourceType === 'image'
          ) {
            await route.abort();
            return;
          }

          if (
            config.blockFonts &&
            resourceType === 'font'
          ) {
            await route.abort();
            return;
          }

          if (
            config.blockMedia &&
            (
              resourceType === 'media' ||
              resourceType === 'video' ||
              resourceType === 'audio'
            )
          ) {
            await route.abort();
            return;
          }

          if (
            config.blockCSS &&
            resourceType ===
              'stylesheet'
          ) {
            await route.abort();
            return;
          }

          await route.continue();

        } catch {
          try {
            await route.continue();
          } catch {
            // ignored
          }
        }
      },
    );
  }

  /* =======================================================
   * COOKIE MANAGEMENT
   * ======================================================= */

  private async restoreCookies(
    context: BrowserContext,
    fingerprintId: string,
    cookies?: Cookie[],
  ): Promise<void> {
    let source: Cookie[] = [];

    if (cookies?.length) {
      source = cookies;
    } else {
      const cached =
        this.cookieCache.get(
          fingerprintId,
        );

      if (cached?.length) {
        source = cached;
      } else {
        source =
          this.loadCookies(
            fingerprintId,
          );
      }
    }

    if (!source.length) {
      return;
    }

    try {
      await context.addCookies(
        source,
      );

      /*
       * Cache'e aynı array referansını değil,
       * kopyasını koyuyoruz.
       */
      this.cookieCache.set(
        fingerprintId,
        [...source],
      );

    } catch (error) {
      this.logger.warn(
        'Failed to restore cookies',
        {
          fingerprintId,
          error: String(error),
        },
      );
    }
  }

  private async saveContextCookies(
    instance: BrowserInstance,
  ): Promise<void> {
    try {
      const cookies =
        await instance.context.cookies();

      this.cookieCache.set(
        instance.fingerprint.id,
        [...cookies],
      );

      this.saveCookies(
        instance.fingerprint.id,
        cookies,
      );

    } catch (error) {
      this.logger.warn(
        'Failed to save cookies',
        {
          fingerprintId:
            instance.fingerprint.id,
          error: String(error),
        },
      );
    }
  }

  private saveCookies(
    fingerprintId: string,
    cookies: Cookie[],
  ): void {
    try {
      if (
        !existsSync(
          this.config.cookieDir,
        )
      ) {
        mkdirSync(
          this.config.cookieDir,
          {
            recursive: true,
          },
        );
      }

      const filePath =
        join(
          this.config.cookieDir,
          `${fingerprintId}.json`,
        );

      writeFileSync(
        filePath,
        JSON.stringify(
          cookies,
          null,
          2,
        ),
        'utf8',
      );

    } catch (error) {
      this.logger.error(
        'Failed to persist cookies',
        error as Error,
        {
          fingerprintId,
        },
      );
    }
  }

  public loadCookies(
    fingerprintId: string,
  ): Cookie[] {
    try {
      const filePath =
        join(
          this.config.cookieDir,
          `${fingerprintId}.json`,
        );

      if (
        !existsSync(filePath)
      ) {
        return [];
      }

      const raw =
        readFileSync(
          filePath,
          'utf8',
        );

      const parsed =
        JSON.parse(raw);

      if (
        !Array.isArray(parsed)
      ) {
        return [];
      }

      return parsed as Cookie[];

    } catch (error) {
      this.logger.warn(
        'Failed to load cookies',
        {
          fingerprintId,
          error: String(error),
        },
      );

      return [];
    }
  }

  /* =======================================================
   * CLOSE
   * ======================================================= */

  public async closeBrowser(
    context: BrowserContext,
    saveCookies = true,
  ): Promise<void> {
    const instance =
      this.findInstanceByContext(
        context,
      );

    if (!instance) {
      try {
        await context.close();
      } catch {
        // ignored
      }

      return;
    }

    if (instance.closing) {
      return;
    }

    instance.closing = true;

    /*
     * Registry'den hemen çıkar.
     */
    this.activeBrowsers.delete(
      instance.id,
    );

    try {
      if (saveCookies) {
        await this.saveContextCookies(
          instance,
        );
      }

      /*
       * Page listeners.
       */
      for (const [
        page,
        handlers,
      ] of instance.pageHandlers) {
        try {
          page.off(
            'crash',
            handlers.crash,
          );

          page.off(
            'close',
            handlers.close,
          );

          if (handlers.dialog) {
            page.off(
              'dialog',
              handlers.dialog,
            );
          }

          if (handlers.popup) {
            page.off(
              'popup',
              handlers.popup,
            );
          }

          if (handlers.pageerror) {
            page.off(
              'pageerror',
              handlers.pageerror,
            );
          }

          if (handlers.requestfailed) {
            page.off(
              'requestfailed',
              handlers.requestfailed,
            );
          }
        } catch {
          // ignored
        }
      }

      instance.pageHandlers.clear();

      /*
       * Context close.
       */
      try {
        await instance.context.close();
      } catch (error) {
        this.logger.debug(
          `Context close warning: ${String(error)}`,
        );
      }

      /*
       * Browser close.
       */
      try {
        await instance.browser.close();
      } catch (error) {
        this.logger.debug(
          `Browser close warning: ${String(error)}`,
        );
      }

    } finally {
      /*
       * En önemli concurrency düzeltmesi:
       *
       * Browser artık aktif değil.
       * Dolayısıyla slot serbest bırakılır.
       */
      this.releaseSlot();

      this.logger.info(
        'Browser closed',
        {
          contextId:
            instance.id,
          activeBrowsers:
            this.activeBrowsers.size,
        },
      );
    }
  }

  public async closeAll(): Promise<void> {
    /*
     * Yeni launch'ların slot beklemesini engelle.
     */
    this.shuttingDown = true;

    this.stopCleanupTimer();

    /*
     * Waiting launch'ları reject et.
     */
    this.rejectWaitingLaunches(
      new Error(
        'BrowserManager is shutting down.',
      ),
    );

    const instances =
      [
        ...this.activeBrowsers.values(),
      ];

    this.logger.info(
      `Closing ${instances.length} browsers`,
    );

    await Promise.all(
      instances.map(instance =>
        this.closeBrowser(
          instance.context,
          true,
        ).catch(error => {
          this.logger.error(
            `Failed to close browser ${instance.id}`,
            error as Error,
          );
        }),
      ),
    );

    this.activeBrowsers.clear();

    /*
     * Güvenlik amaçlı normalize.
     */
    this.activeSlots = 0;

    this.logger.info(
      'BrowserManager shutdown complete',
    );
  }

  /* =======================================================
   * CONCURRENCY
   * ======================================================= */

  private async acquireSlot(): Promise<void> {
    if (this.shuttingDown) {
      throw new Error(
        'BrowserManager is shutting down.',
      );
    }

    if (
      this.activeSlots <
      this.config.maxConcurrentBrowsers
    ) {
      this.activeSlots++;
      return;
    }

    await new Promise<void>(
      (
        resolve,
        reject,
      ) => {
        this.waitingLaunches.push({
          resolve,
          reject,
        });
      },
    );

    if (this.shuttingDown) {
      throw new Error(
        'BrowserManager is shutting down.',
      );
    }

    /*
     * Slot waiter tarafından devredildi.
     * Burada tekrar increment yapılmaz.
     */
  }

  private releaseSlot(): void {
    if (this.activeSlots > 0) {
      this.activeSlots--;
    }

    if (this.shuttingDown) {
      return;
    }

    const waiter =
      this.waitingLaunches.shift();

    if (!waiter) {
      return;
    }

    /*
     * Slot waiter'a transfer edilir.
     *
     * activeSlots burada tekrar artırılmaz çünkü
     * kapanan browser'ın slotu zaten decrement edilmiştir.
     */
    this.activeSlots++;

    waiter.resolve();
  }

  private rejectWaitingLaunches(
    error: Error,
  ): void {
    const waiters =
      this.waitingLaunches.splice(
        0,
      );

    for (const waiter of waiters) {
      waiter.reject(error);
    }
  }

  /* =======================================================
   * CLEANUP
   * ======================================================= */

  private startCleanupTimer(): void {
    const lifecycle =
      this.config.lifecycle;

    const hasIdleTimeout =
      (lifecycle.idleTimeoutMs ??
        0) > 0;

    const hasLifetime =
      (lifecycle.maxLifetimeMs ??
        0) > 0;

    if (
      !hasIdleTimeout &&
      !hasLifetime
    ) {
      return;
    }

    this.cleanupTimer =
      setInterval(
        () => {
          this.cleanupStaleBrowsers()
            .catch(error => {
              this.logger.error(
                'Browser cleanup failed',
                error as Error,
              );
            });
        },
        30_000,
      );

    this.cleanupTimer.unref?.();
  }

  private stopCleanupTimer(): void {
    if (!this.cleanupTimer) {
      return;
    }

    clearInterval(
      this.cleanupTimer,
    );

    this.cleanupTimer =
      undefined;
  }

  private async cleanupStaleBrowsers(): Promise<void> {
    if (this.shuttingDown) {
      return;
    }

    const now =
      Date.now();

    const {
      idleTimeoutMs = 0,
      maxLifetimeMs = 0,
    } = this.config.lifecycle;

    const toClose: BrowserInstance[] =
      [];

    for (
      const instance of
        this.activeBrowsers.values()
    ) {
      if (instance.closing) {
        continue;
      }

      const idleFor =
        now -
        instance.lastUsed.getTime();

      const lifetime =
        now -
        instance.createdAt.getTime();

      const idleExpired =
        idleTimeoutMs > 0 &&
        idleFor >= idleTimeoutMs &&
        instance.activePages === 0;

      const lifetimeExpired =
        maxLifetimeMs > 0 &&
        lifetime >= maxLifetimeMs;

      if (
        idleExpired ||
        lifetimeExpired
      ) {
        toClose.push(instance);
      }
    }

    if (!toClose.length) {
      return;
    }

    await Promise.all(
      toClose.map(instance =>
        this.closeBrowser(
          instance.context,
          true,
        ),
      ),
    );
  }

  /* =======================================================
   * DOMAIN HELPERS
   * ======================================================= */

  private isAllowedDomain(
    hostname: string,
    domains: string[],
  ): boolean {
    return domains.some(domain => {
      const normalized =
        domain
          .trim()
          .toLowerCase()
          .replace(/^\.+/, '');

      if (!normalized) {
        return false;
      }

      return (
        hostname === normalized ||
        hostname.endsWith(
          `.${normalized}`,
        )
      );
    });
  }

  private isTrackingHost(
    hostname: string,
    hosts: string[],
  ): boolean {
    return hosts.some(host => {
      const normalized =
        host
          .trim()
          .toLowerCase()
          .replace(/^\.+/, '');

      if (!normalized) {
        return false;
      }

      return (
        hostname === normalized ||
        hostname.endsWith(
          `.${normalized}`,
        )
      );
    });
  }

  /* =======================================================
   * INSTANCE HELPERS
   * ======================================================= */

  private findInstanceByContext(
    context: BrowserContext,
  ): BrowserInstance | undefined {
    for (
      const instance of
        this.activeBrowsers.values()
    ) {
      if (
        instance.context === context
      ) {
        return instance;
      }
    }

    return undefined;
  }

  private generateContextId(): string {
    return [
      'ctx',
      Date.now().toString(36),
      Math.random()
        .toString(36)
        .slice(2, 10),
    ].join('-');
  }

  /* =======================================================
   * PROXY
   * ======================================================= */

  private parseProxy(
    value: string,
  ): {
    server: string;
    username?: string;
    password?: string;
  } {
    const url =
      new URL(value);

    if (
      ![
        'http:',
        'https:',
        'socks4:',
        'socks5:',
      ].includes(
        url.protocol,
      )
    ) {
      throw new Error(
        `Unsupported proxy protocol: ${url.protocol}`,
      );
    }

    return {
      server:
        `${url.protocol}//${url.hostname}` +
        `${
          url.port
            ? `:${url.port}`
            : ''
        }`,

      username:
        url.username
          ? decodeURIComponent(
              url.username,
            )
          : undefined,

      password:
        url.password
          ? decodeURIComponent(
              url.password,
            )
          : undefined,
    };
  }

  private maskProxyUrl(
    value: string,
  ): string {
    try {
      const url =
        new URL(value);

      const auth =
        url.username
          ? `${url.username}:****@`
          : '';

      return (
        `${url.protocol}//` +
        `${auth}` +
        `${url.hostname}` +
        `${
          url.port
            ? `:${url.port}`
            : ''
        }`
      );

    } catch {
      return '[invalid-proxy]';
    }
  }

  /* =======================================================
   * SCREENSHOT
   * ======================================================= */

  public async takeScreenshot(
    page: Page,
    name: string,
  ): Promise<void> {
    if (
      !this.config.debugMode
    ) {
      return;
    }

    try {
      const directory =
        join(
          this.config.userDataDir,
          'screenshots',
        );

      if (
        !existsSync(directory)
      ) {
        mkdirSync(
          directory,
          {
            recursive: true,
          },
        );
      }

      const safeName =
        name
          .replace(
            /[^a-zA-Z0-9._-]/g,
            '_',
          )
          .slice(0, 100);

      const filePath =
        join(
          directory,
          `${Date.now()}-${safeName}.png`,
        );

      await page.screenshot({
        path: filePath,
        fullPage: true,
      });

      this.logger.debug(
        `Screenshot saved: ${filePath}`,
      );

    } catch (error) {
      this.logger.error(
        'Screenshot failed',
        error as Error,
      );
    }
  }

  /* =======================================================
   * STATS
   * ======================================================= */

  public getActiveBrowserCount(): number {
    return this.activeBrowsers.size;
  }

  public getStats(): {
    active: number;
    maxAllowed: number;
    totalPagesCreated: number;
    activePages: number;
    oldestBrowser: Date | null;
  } {
    let totalPagesCreated = 0;
    let activePages = 0;
    let oldestBrowser:
      Date | null = null;

    for (
      const instance of
        this.activeBrowsers.values()
    ) {
      totalPagesCreated +=
        instance.totalPagesCreated;

      activePages +=
        instance.activePages;

      if (
        !oldestBrowser ||
        instance.createdAt <
          oldestBrowser
      ) {
        oldestBrowser =
          instance.createdAt;
      }
    }

    return {
      active:
        this.activeBrowsers.size,

      maxAllowed:
        this.config.maxConcurrentBrowsers,

      totalPagesCreated,

      activePages,

      oldestBrowser,
    };
  }
}

/* =========================================================
 * SAFE HELPERS
 * ======================================================= */

function safeHostname(
  value: string,
): string | null {
  try {
    return new URL(value)
      .hostname
      .toLowerCase();
  } catch {
    return null;
  }
}

function safePageUrl(
  page: Page,
): string {
  try {
    return page.url();
  } catch {
    return '[unknown]';
  }
}

/* =========================================================
 * FACTORY
 * ======================================================= */

const managers =
  new Map<string, BrowserManager>();

export function createBrowserManager(
  name = 'default',
  config?: Partial<BrowserManagerConfig>,
  logger?: Logger,
): BrowserManager {
  if (
    managers.has(name)
  ) {
    throw new Error(
      `BrowserManager "${name}" already exists.`,
    );
  }

  const manager =
    new BrowserManager(
      config,
      logger,
    );

  managers.set(
    name,
    manager,
  );

  return manager;
}

export function getNamedBrowserManager(
  name = 'default',
): BrowserManager | undefined {
  return managers.get(name);
}

export async function closeNamedBrowserManager(
  name = 'default',
): Promise<void> {
  const manager =
    managers.get(name);

  if (!manager) {
    return;
  }

  managers.delete(name);

  await manager.closeAll();
}

export async function closeAllBrowserManagers(): Promise<void> {
  const current =
    [
      ...managers.entries(),
    ];

  managers.clear();

  await Promise.all(
    current.map(
      async ([
        _name,
        manager,
      ]) => {
        try {
          await manager.closeAll();
        } catch {
          // Individual manager failure
          // diğerlerini engellemesin.
        }
      },
    ),
  );
}

/* =========================================================
 * SINGLETON
 * ======================================================= */

let singletonInstance:
  BrowserManager | null = null;

export function getBrowserManager(
  config?: Partial<BrowserManagerConfig>,
  logger?: Logger,
): BrowserManager {
  if (
    !singletonInstance
  ) {
    singletonInstance =
      new BrowserManager(
        config,
        logger,
      );
  }

  return singletonInstance;
}

export async function resetBrowserManager(): Promise<void> {
  if (
    !singletonInstance
  ) {
    return;
  }

  const instance =
    singletonInstance;

  singletonInstance = null;

  await instance.closeAll();
}
