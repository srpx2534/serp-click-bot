/**
 * SERPScraper
 *
 * Production-oriented Google / Bing SERP scraper.
 *
 * Tasarım hedefleri:
 * - Strong typing
 * - Bounded retry
 * - Exponential backoff + jitter
 * - Proxy health / rotation
 * - Deterministic browser lifecycle
 * - Engine-specific URL + parser mantığı
 * - Selector fallback
 * - Duplicate result protection
 * - CAPTCHA / block detection
 * - Structured error codes
 * - Input normalization
 * - Safe logging
 * - Configurable timeouts / retries
 * - Backwards-compatible public API
 *
 * Not:
 * Bu modül CAPTCHA çözmez veya anti-bot kontrollerini atlatmaya çalışmaz.
 * CAPTCHA / block tespit edildiğinde kontrollü şekilde retry veya hata döner.
 */

import { BrowserManager } from './browser-manager';
import { ProxyManager } from './proxy-manager';
import { FingerprintGenerator } from './fingerprint-generator';
import { Logger } from '../utils/logger';

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export type SearchEngine = 'google' | 'bing';

export type SafeSearch = 'strict' | 'moderate' | 'off';

export type DeviceType = 'desktop' | 'mobile';

export type ScrapingErrorCode =
  | 'INVALID_OPTIONS'
  | 'UNSUPPORTED_ENGINE'
  | 'NO_FINGERPRINT'
  | 'NO_PROXY_AVAILABLE'
  | 'PROXY_FAILED'
  | 'NAVIGATION_FAILED'
  | 'TIMEOUT'
  | 'CAPTCHA_DETECTED'
  | 'BLOCKED'
  | 'PARSER_FAILED'
  | 'NO_RESULTS'
  | 'SCRAPING_FAILED';

export interface SearchResult {
  /** Organic / ad / featured vb. sonucu SERP içerisindeki sırası */
  position: number;

  /** Sayfa başlığı */
  title: string;

  /** Hedef URL */
  url: string;

  /** SERP açıklaması */
  description: string;

  /** Reklam mı? */
  isAd: boolean;

  /** Featured snippet mi? */
  isFeaturedSnippet: boolean;
}

export interface SearchOptions {
  /** Arama sorgusu */
  query: string;

  /** Arama motoru */
  engine?: SearchEngine;

  /** Dil kodu: tr, en, de... */
  language?: string;

  /** Ülke kodu: tr, us, de... */
  country?: string;

  /** SafeSearch */
  safeSearch?: SafeSearch;

  /** İstenen sonuç sayısı */
  numResults?: number;

  /** SERP sayfası */
  page?: number;

  /** Lokasyon bilgisi */
  location?: string;

  /**
   * İsteğe bağlı device tercihi.
   * Belirtilmezse desktop kullanılır.
   */
  device?: DeviceType;
}

export interface ScrapingResult {
  query: string;
  engine: SearchEngine;

  /** Arama motorunun bildirdiği yaklaşık toplam sonuç */
  totalResults: number;

  /** Normalize edilmiş sonuçlar */
  results: SearchResult[];

  /** Toplam işlem süresi */
  duration: number;

  /** Başarılı istekte kullanılan proxy */
  proxy?: string;

  /** Kullanılan fingerprint */
  fingerprint?: string;

  /** Kaçıncı attempt'te başarılı oldu */
  attempts: number;

  /** Parser tarafından kullanılan engine */
  parser: SearchEngine;
}

export interface ScraperConfig {
  /** Browser navigation timeout */
  navigationTimeoutMs: number;

  /** Selector / page action timeout */
  actionTimeoutMs: number;

  /** Maximum scraping attempt */
  maxAttempts: number;

  /** Proxy health-check sırasında maksimum deneme */
  maxProxyAttempts: number;

  /** Retry base delay */
  retryBaseDelayMs: number;

  /** Retry maximum delay */
  retryMaxDelayMs: number;

  /** Result selector bekleme süresi */
  resultWaitTimeoutMs: number;

  /** Maximum sonuç */
  maxResults: number;

  /** Browser headless */
  headless: boolean;

  /** Başarısız proxy'leri attempt içinde tekrar kullanma */
  avoidRepeatedProxy: boolean;

  /** Sonuç bulunamazsa hata mı dönsün? */
  failOnEmptyResults: boolean;
}

const DEFAULT_CONFIG: Readonly<ScraperConfig> = {
  navigationTimeoutMs: 30_000,
  actionTimeoutMs: 5_000,
  maxAttempts: 3,
  maxProxyAttempts: 5,
  retryBaseDelayMs: 500,
  retryMaxDelayMs: 5_000,
  resultWaitTimeoutMs: 5_000,
  maxResults: 100,
  headless: true,
  avoidRepeatedProxy: true,
  failOnEmptyResults: false,
};

/* -------------------------------------------------------------------------- */
/* Minimal structural browser types                                           */
/* -------------------------------------------------------------------------- */

/**
 * BrowserManager'ın gerçek browser tipini dış bağımlılığa bağlamadan
 * structural typing kullanıyoruz.
 *
 * Böylece modül Puppeteer / Playwright wrapper'larıyla daha rahat çalışır.
 */
interface BrowserLike {
  newPage(): Promise<PageLike>;
  close(): Promise<void>;
}

interface ElementLike {
  $(selector: string): Promise<ElementLike | null>;
  textContent(): Promise<string | null>;
  getAttribute(name: string): Promise<string | null>;
  getProperty?(name: string): Promise<unknown>;
}

interface PageLike {
  goto(
    url: string,
    options?: {
      waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
      timeout?: number;
    }
  ): Promise<unknown>;

  close(): Promise<void>;

  $(selector: string): Promise<ElementLike | null>;

  $$(selector: string): Promise<ElementLike[]>;

  waitForSelector?(
    selector: string,
    options?: {
      timeout?: number;
      state?: 'attached' | 'detached' | 'visible' | 'hidden';
    }
  ): Promise<ElementLike | null>;

  url?(): string;

  title?(): Promise<string>;

  setDefaultTimeout?(timeout: number): void;

  setDefaultNavigationTimeout?(timeout: number): void;
}

/* -------------------------------------------------------------------------- */
/* Errors                                                                     */
/* -------------------------------------------------------------------------- */

export class ScrapingError extends Error {
  constructor(
    message: string,
    public readonly code: ScrapingErrorCode | string,
    public readonly retryable: boolean = false,
    public readonly cause?: unknown
  ) {
    super(message);

    this.name = 'ScrapingError';

    // ES5 transpilation compatibility
    Object.setPrototypeOf(this, ScrapingError.prototype);
  }
}

/* -------------------------------------------------------------------------- */
/* Internal helper types                                                      */
/* -------------------------------------------------------------------------- */

interface ProxyInfo {
  url: string;
}

interface FingerprintInfo {
  id: string;
  [key: string]: unknown;
}

interface ScrapeAttemptContext {
  proxy?: ProxyInfo;
  fingerprint: FingerprintInfo;
  attempt: number;
}

interface ParsedPage {
  results: SearchResult[];
  totalResults: number;
}

interface EngineConfig {
  searchUrl: (options: NormalizedSearchOptions) => string;
  parse: (
    page: PageLike,
    maxResults: number,
    logger: Logger
  ) => Promise<SearchResult[]>;
  totalResults: (
    page: PageLike,
    logger: Logger
  ) => Promise<number>;
  resultSelectors: string[];
}

interface NormalizedSearchOptions {
  query: string;
  engine: SearchEngine;
  language?: string;
  country?: string;
  safeSearch: SafeSearch;
  numResults: number;
  page: number;
  location?: string;
  device: DeviceType;
}

/* -------------------------------------------------------------------------- */
/* Main class                                                                 */
/* -------------------------------------------------------------------------- */

export class SERPScraper {
  private readonly logger: Logger;
  private readonly config: ScraperConfig;

  /**
   * Başarısız attempt'lerde kullanılan proxy'leri aynı search çağrısında
   * tekrar kullanmamak için tutulur.
   */
  private readonly usedProxyUrls = new Set<string>();

  private static readonly ENGINES: Record<SearchEngine, EngineConfig> = {
    google: {
      searchUrl: SERPScraper.buildGoogleUrl,
      parse: SERPScraper.parseGoogleResults,
      totalResults: SERPScraper.extractGoogleTotalResults,
      resultSelectors: [
        '#search .g',
        '#rso .g',
        '#search div[data-snhf]',
        '.MjjYud',
      ],
    },

    bing: {
      searchUrl: SERPScraper.buildBingUrl,
      parse: SERPScraper.parseBingResults,
      totalResults: SERPScraper.extractBingTotalResults,
      resultSelectors: [
        '#b_results .b_algo',
        '.b_algo',
      ],
    },
  };

  constructor(
    private readonly browserManager: BrowserManager,
    private readonly proxyManager: ProxyManager,
    private readonly fingerprintGenerator: FingerprintGenerator,
    logger?: Logger,
    config?: Partial<ScraperConfig>
  ) {
    this.logger = logger || new Logger({ level: 'info' });

    this.config = {
      ...DEFAULT_CONFIG,
      ...(config || {}),
    };

    this.validateConfig();
  }

  /* ------------------------------------------------------------------------ */
  /* Public API                                                               */
  /* ------------------------------------------------------------------------ */

  async search(options: SearchOptions): Promise<ScrapingResult> {
    const startedAt = Date.now();

    const normalized = this.normalizeOptions(options);

    this.usedProxyUrls.clear();

    this.logger.info('SERP scraping started', {
      engine: normalized.engine,
      query: this.safeLogQuery(normalized.query),
      page: normalized.page,
      numResults: normalized.numResults,
      language: normalized.language,
      country: normalized.country,
    });

    let lastError: unknown = undefined;

    for (
      let attempt = 1;
      attempt <= this.config.maxAttempts;
      attempt++
    ) {
      let context: ScrapeAttemptContext | undefined;

      try {
        context = await this.prepareAttempt(normalized, attempt);

        const result = await this.executeAttempt(
          normalized,
          context
        );

        const duration = Date.now() - startedAt;

        this.logger.info('SERP scraping completed', {
          engine: normalized.engine,
          resultCount: result.results.length,
          duration,
          attempts: attempt,
          proxy: this.maskProxy(context.proxy?.url),
        });

        return {
          query: normalized.query,
          engine: normalized.engine,
          totalResults: result.totalResults,
          results: result.results,
          duration,
          proxy: context.proxy?.url,
          fingerprint: context.fingerprint.id,
          attempts: attempt,
          parser: normalized.engine,
        };
      } catch (error) {
        lastError = error;

        const normalizedError = this.normalizeError(error);

        this.logger.warn('SERP attempt failed', {
          attempt,
          maxAttempts: this.config.maxAttempts,
          code: normalizedError.code,
          retryable: normalizedError.retryable,
          error: normalizedError.message,
          proxy: this.maskProxy(context?.proxy?.url),
        });

        if (
          !normalizedError.retryable ||
          attempt >= this.config.maxAttempts
        ) {
          break;
        }

        await this.sleep(
          this.calculateBackoff(attempt)
        );
      }
    }

    const finalError = this.normalizeError(lastError);

    this.logger.error('SERP scraping permanently failed', {
      engine: normalized.engine,
      code: finalError.code,
      error: finalError.message,
      attempts: this.config.maxAttempts,
    });

    throw finalError;
  }

  /* ------------------------------------------------------------------------ */
  /* Attempt execution                                                        */
  /* ------------------------------------------------------------------------ */

  private async executeAttempt(
    options: NormalizedSearchOptions,
    context: ScrapeAttemptContext
  ): Promise<ParsedPage> {
    let browser: BrowserLike | undefined;
    let page: PageLike | undefined;

    try {
      browser = (await this.browserManager.launch({
        proxy: context.proxy,
        fingerprint: context.fingerprint,
        headless: this.config.headless,
      })) as unknown as BrowserLike;

      if (!browser || typeof browser.newPage !== 'function') {
        throw new ScrapingError(
          'BrowserManager returned an invalid browser instance',
          'SCRAPING_FAILED',
          true
        );
      }

      page = await browser.newPage();

      this.configurePage(page);

      const engineConfig =
        SERPScraper.ENGINES[options.engine];

      const searchUrl =
        engineConfig.searchUrl(options);

      await this.navigate(page, searchUrl);

      await this.assertPageIsUsable(page);

      await this.waitForResults(
        page,
        engineConfig.resultSelectors
      );

      const results =
        await engineConfig.parse(
          page,
          options.numResults,
          this.logger
        );

      const totalResults =
        await engineConfig.totalResults(
          page,
          this.logger
        );

      if (
        results.length === 0 &&
        this.config.failOnEmptyResults
      ) {
        throw new ScrapingError(
          'SERP page loaded but no results were parsed',
          'NO_RESULTS',
          true
        );
      }

      return {
        results: this.normalizeResults(results),
        totalResults,
      };
    } catch (error) {
      throw this.normalizeError(error);
    } finally {
      await this.closePage(page);
      await this.closeBrowser(browser);
    }
  }

  /* ------------------------------------------------------------------------ */
  /* Preparation                                                              */
  /* ------------------------------------------------------------------------ */

  private async prepareAttempt(
    options: NormalizedSearchOptions,
    attempt: number
  ): Promise<ScrapeAttemptContext> {
    const proxy = await this.getWorkingProxy();

    const device =
      options.device;

    const fingerprint =
      this.fingerprintGenerator.getRandom(device) as
        | FingerprintInfo
        | undefined;

    if (!fingerprint) {
      throw new ScrapingError(
        'No fingerprint available',
        'NO_FINGERPRINT',
        false
      );
    }

    this.logger.debug('Prepared scraping attempt', {
      attempt,
      device,
      proxy: this.maskProxy(proxy?.url),
      fingerprint: fingerprint.id,
    });

    return {
      proxy,
      fingerprint,
      attempt,
    };
  }

  /**
   * Recursive proxy retry yerine bounded loop kullanılır.
   */
  private async getWorkingProxy(): Promise<ProxyInfo | undefined> {
    let lastProxyError: unknown;

    for (
      let i = 0;
      i < this.config.maxProxyAttempts;
      i++
    ) {
      const proxy =
        this.proxyManager.getNextProxy() as
          | ProxyInfo
          | undefined;

      if (!proxy) {
        this.logger.warn(
          'No proxy available, using direct connection'
        );

        return undefined;
      }

      if (
        this.config.avoidRepeatedProxy &&
        this.usedProxyUrls.has(proxy.url)
      ) {
        continue;
      }

      this.usedProxyUrls.add(proxy.url);

      try {
        const healthy =
          await this.proxyManager.checkProxyHealth(proxy);

        if (healthy) {
          return proxy;
        }

        this.logger.warn('Proxy health check failed', {
          proxy: this.maskProxy(proxy.url),
        });
      } catch (error) {
        lastProxyError = error;

        this.logger.warn('Proxy health check threw an error', {
          proxy: this.maskProxy(proxy.url),
          error:
            error instanceof Error
              ? error.message
              : 'Unknown error',
        });
      }
    }

    /**
     * Proxy zorunlu değilse direct connection'a izin ver.
     * Burada hata vermek yerine BrowserManager'ın direct connection
     * başlatmasına izin veriyoruz.
     */
    if (this.proxyManager.getNextProxy) {
      this.logger.warn(
        'No healthy proxy found, falling back to direct connection',
        {
          checked: this.usedProxyUrls.size,
          lastError:
            lastProxyError instanceof Error
              ? lastProxyError.message
              : undefined,
        }
      );
    }

    return undefined;
  }

  /* ------------------------------------------------------------------------ */
  /* Navigation                                                               */
  /* ------------------------------------------------------------------------ */

  private async navigate(
    page: PageLike,
    url: string
  ): Promise<void> {
    try {
      await page.goto(url, {
        /**
         * networkidle yerine domcontentloaded.
         * SERP sayfalarında üçüncü parti network request'leri
         * navigation'ın gereksiz yere uzamasına neden olabilir.
         */
        waitUntil: 'domcontentloaded',
        timeout: this.config.navigationTimeoutMs,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Navigation failed';

      if (this.isTimeoutError(error)) {
        throw new ScrapingError(
          `Navigation timed out: ${message}`,
          'TIMEOUT',
          true,
          error
        );
      }

      throw new ScrapingError(
        `Navigation failed: ${message}`,
        'NAVIGATION_FAILED',
        true,
        error
      );
    }
  }

  private async waitForResults(
    page: PageLike,
    selectors: string[]
  ): Promise<void> {
    if (!page.waitForSelector) {
      /**
       * Browser wrapper waitForSelector sağlamıyorsa küçük bir
       * fallback veriyoruz.
       */
      await this.sleep(250);
      return;
    }

    for (const selector of selectors) {
      try {
        const element =
          await page.waitForSelector(selector, {
            timeout: this.config.resultWaitTimeoutMs,
            state: 'attached',
          });

        if (element) {
          return;
        }
      } catch {
        // Bir selector çalışmazsa fallback selector'a geç.
      }
    }

    /**
     * Result selector bulunamadı diye hemen CAPTCHA demiyoruz.
     * Önce sayfanın block edilip edilmediğini kontrol edeceğiz.
     */
  }

  private async assertPageIsUsable(
    page: PageLike
  ): Promise<void> {
    if (await this.isCaptchaPresent(page)) {
      throw new ScrapingError(
        'CAPTCHA or unusual traffic page detected',
        'CAPTCHA_DETECTED',
        true
      );
    }

    if (await this.isBlocked(page)) {
      throw new ScrapingError(
        'Search engine blocked the request',
        'BLOCKED',
        true
      );
    }
  }

  /* ------------------------------------------------------------------------ */
  /* Page configuration                                                       */
  /* ------------------------------------------------------------------------ */

  private configurePage(page: PageLike): void {
    page.setDefaultTimeout?.(
      this.config.actionTimeoutMs
    );

    page.setDefaultNavigationTimeout?.(
      this.config.navigationTimeoutMs
    );
  }

  /* ------------------------------------------------------------------------ */
  /* CAPTCHA / block detection                                                */
  /* ------------------------------------------------------------------------ */

  private async isCaptchaPresent(
    page: PageLike
  ): Promise<boolean> {
    const selectors = [
      'form[action="/sorry/index"]',
      '#captcha-form',
      '.g-recaptcha',
      'iframe[src*="recaptcha"]',
      'iframe[src*="captcha"]',
      '[id*="captcha"]',
      '[class*="captcha"]',
    ];

    for (const selector of selectors) {
      try {
        if (await page.$(selector)) {
          this.logger.warn(
            'CAPTCHA indicator detected',
            { selector }
          );

          return true;
        }
      } catch {
        // Detection should never break scraping itself.
      }
    }

    const bodyText =
      await this.getBodyText(page);

    if (!bodyText) {
      return false;
    }

    const normalized =
      bodyText.toLowerCase();

    const indicators = [
      'unusual traffic',
      'our systems have detected unusual traffic',
      'verify you are human',
      'captcha',
      'robot',
      'are you a robot',
    ];

    return indicators.some(
      indicator =>
        normalized.includes(indicator)
    );
  }

  private async isBlocked(
    page: PageLike
  ): Promise<boolean> {
    const bodyText =
      await this.getBodyText(page);

    if (!bodyText) {
      return false;
    }

    const normalized =
      bodyText.toLowerCase();

    const indicators = [
      'access denied',
      'temporarily blocked',
      'request blocked',
      'too many requests',
      'automated queries',
    ];

    return indicators.some(
      indicator =>
        normalized.includes(indicator)
    );
  }

  private async getBodyText(
    page: PageLike
  ): Promise<string> {
    try {
      const body = await page.$('body');

      if (!body) {
        return '';
      }

      return (
        (await body.textContent()) || ''
      ).trim();
    } catch {
      return '';
    }
  }

  /* ------------------------------------------------------------------------ */
  /* Google URL                                                               */
  /* ------------------------------------------------------------------------ */

  private static buildGoogleUrl(
    options: NormalizedSearchOptions
  ): string {
    const params = new URLSearchParams();

    params.set('q', options.query);

    params.set(
      'num',
      String(options.numResults)
    );

    if (options.language) {
      params.set(
        'hl',
        options.language
      );
    }

    if (options.country) {
      params.set(
        'gl',
        options.country
      );
    }

    if (options.safeSearch === 'strict') {
      params.set('safe', 'active');
    } else if (
      options.safeSearch === 'off'
    ) {
      params.set('safe', 'off');
    }

    if (options.page > 1) {
      params.set(
        'start',
        String(
          (options.page - 1) * 10
        )
      );
    }

    /**
     * location doğrudan query'ye eklenmez.
     * Lokasyon semantiği browser/proxy/search engine katmanına bırakılır.
     */
    return (
      'https://www.google.com/search?' +
      params.toString()
    );
  }

  /* ------------------------------------------------------------------------ */
  /* Bing URL                                                                 */
  /* ------------------------------------------------------------------------ */

  private static buildBingUrl(
    options: NormalizedSearchOptions
  ): string {
    const params = new URLSearchParams();

    params.set('q', options.query);

    params.set(
      'count',
      String(options.numResults)
    );

    if (options.language) {
      params.set(
        'setlang',
        options.language
      );
    }

    if (options.page > 1) {
      params.set(
        'first',
        String(
          (options.page - 1) * 10 + 1
        )
      );
    }

    /**
     * Bing SafeSearch:
     * Strict / Moderate / Off
     */
    if (options.safeSearch === 'strict') {
      params.set('safesearch', 'Strict');
    } else if (
      options.safeSearch === 'off'
    ) {
      params.set('safesearch', 'Off');
    } else {
      params.set(
        'safesearch',
        'Moderate'
      );
    }

    return (
      'https://www.bing.com/search?' +
      params.toString()
    );
  }

  /* ------------------------------------------------------------------------ */
  /* Google parser                                                            */
  /* ------------------------------------------------------------------------ */

  private static async parseGoogleResults(
    page: PageLike,
    maxResults: number,
    logger: Logger
  ): Promise<SearchResult[]> {
    const results: SearchResult[] = [];

    const selectors = [
      '#search .g',
      '#rso .g',
      '.MjjYud',
    ];

    const seen = new Set<string>();

    for (const selector of selectors) {
      let elements: ElementLike[] = [];

      try {
        elements =
          await page.$$(selector);
      } catch (error) {
        logger.debug(
          'Google selector failed',
          {
            selector,
            error:
              error instanceof Error
                ? error.message
                : 'Unknown error',
          }
        );

        continue;
      }

      for (const element of elements) {
        if (results.length >= maxResults) {
          break;
        }

        try {
          const parsed =
            await SERPScraper.parseGoogleElement(
              element
            );

          if (!parsed) {
            continue;
          }

          const key =
            SERPScraper.resultKey(parsed);

          if (seen.has(key)) {
            continue;
          }

          seen.add(key);

          results.push({
            ...parsed,
            position:
              results.length + 1,
          });
        } catch (error) {
          logger.debug(
            'Failed to parse Google result',
            {
              error:
                error instanceof Error
                  ? error.message
                  : 'Unknown error',
            }
          );
        }
      }

      if (results.length >= maxResults) {
        break;
      }
    }

    /**
     * Ads ayrı parse edilir.
     * Ancak maxResults sınırını aşmaması sağlanır.
     */
    if (results.length < maxResults) {
      await SERPScraper.parseGoogleAds(
        page,
        results,
        maxResults,
        seen,
        logger
      );
    }

    return results;
  }

  private static async parseGoogleElement(
    element: ElementLike
  ): Promise<
    Omit<SearchResult, 'position'>
    | null
  > {
    const titleEl =
      await element.$('h3');

    if (!titleEl) {
      return null;
    }

    const linkEl =
      await element.$(
        'a[href]'
      );

    if (!linkEl) {
      return null;
    }

    const title =
      SERPScraper.cleanText(
        await titleEl.textContent()
      );

    let url =
      await linkEl.getAttribute('href');

    if (!title || !url) {
      return null;
    }

    url =
      SERPScraper.normalizeUrl(
        url
      );

    if (!url) {
      return null;
    }

    const description =
      SERPScraper.cleanText(
        await SERPScraper.firstText(
          element,
          [
            '.VwiC3b',
            '.s3v94d',
            '[data-sncf]',
            '[data-snf]',
            '.IsZvec',
          ]
        )
      );

    const isFeaturedSnippet =
      await SERPScraper.hasAny(
        element,
        [
          '[data-attrid*="description"]',
          '.kp-blk',
          '.xpdopen',
          '.g-blk',
        ]
      );

    return {
      title,
      url,
      description,
      isAd: false,
      isFeaturedSnippet,
    };
  }

  private static async parseGoogleAds(
    page: PageLike,
    results: SearchResult[],
    maxResults: number,
    seen: Set<string>,
    logger: Logger
  ): Promise<void> {
    const selectors = [
      '[data-text-ad="1"]',
      '.uEierd',
      '.commercial-unit-desktop-top',
    ];

    for (const selector of selectors) {
      if (results.length >= maxResults) {
        return;
      }

      let elements: ElementLike[];

      try {
        elements =
          await page.$$(selector);
      } catch (error) {
        logger.debug(
          'Google ads selector failed',
          {
            selector,
          }
        );

        continue;
      }

      for (const adEl of elements) {
        if (results.length >= maxResults) {
          return;
        }

        try {
          const titleEl =
            await adEl.$(
              'h3, .CCgQ5, .v0rrvd'
            );

          const urlEl =
            await adEl.$(
              'a[href]'
            );

          if (!titleEl || !urlEl) {
            continue;
          }

          const title =
            SERPScraper.cleanText(
              await titleEl.textContent()
            );

          const rawUrl =
            await urlEl.getAttribute(
              'href'
            );

          const url =
            SERPScraper.normalizeUrl(
              rawUrl
            );

          if (!title || !url) {
            continue;
          }

          const candidate: SearchResult = {
            position: -1,
            title,
            url,
            description: '[AD]',
            isAd: true,
            isFeaturedSnippet: false,
          };

          const key =
            SERPScraper.resultKey(
              candidate
            );

          if (seen.has(key)) {
            continue;
          }

          seen.add(key);

          results.push(candidate);
        } catch (error) {
          logger.debug(
            'Failed to parse Google ad',
            {
              error:
                error instanceof Error
                  ? error.message
                  : 'Unknown error',
            }
          );
        }
      }
    }
  }

  /* ------------------------------------------------------------------------ */
  /* Bing parser                                                              */
  /* ------------------------------------------------------------------------ */

  private static async parseBingResults(
    page: PageLike,
    maxResults: number,
    logger: Logger
  ): Promise<SearchResult[]> {
    const results: SearchResult[] = [];

    const selectors = [
      '#b_results .b_algo',
      '.b_algo',
    ];

    const seen = new Set<string>();

    for (const selector of selectors) {
      let elements: ElementLike[] = [];

      try {
        elements =
          await page.$$(selector);
      } catch (error) {
        logger.debug(
          'Bing selector failed',
          {
            selector,
          }
        );

        continue;
      }

      for (const element of elements) {
        if (results.length >= maxResults) {
          break;
        }

        try {
          const titleEl =
            await element.$(
              'h2 a'
            );

          if (!titleEl) {
            continue;
          }

          const title =
            SERPScraper.cleanText(
              await titleEl.textContent()
            );

          const rawUrl =
            await titleEl.getAttribute(
              'href'
            );

          const url =
            SERPScraper.normalizeUrl(
              rawUrl
            );

          if (!title || !url) {
            continue;
          }

          const description =
            SERPScraper.cleanText(
              await SERPScraper.firstText(
                element,
                [
                  '.b_caption p',
                  '.b_snippet',
                ]
              )
            );

          const candidate: SearchResult = {
            position:
              results.length + 1,
            title,
            url,
            description,
            isAd: false,
            isFeaturedSnippet: false,
          };

          const key =
            SERPScraper.resultKey(
              candidate
            );

          if (seen.has(key)) {
            continue;
          }

          seen.add(key);

          results.push(candidate);
        } catch (error) {
          logger.debug(
            'Failed to parse Bing result',
            {
              error:
                error instanceof Error
                  ? error.message
                  : 'Unknown error',
            }
          );
        }
      }

      if (results.length >= maxResults) {
        break;
      }
    }

    return results;
  }

  /* ------------------------------------------------------------------------ */
  /* Total result extraction                                                  */
  /* ------------------------------------------------------------------------ */

  private static async extractGoogleTotalResults(
    page: PageLike,
    logger: Logger
  ): Promise<number> {
    try {
      const selectors = [
        '#result-stats',
        '#result-stats div',
      ];

      for (const selector of selectors) {
        const element =
          await page.$(selector);

        if (!element) {
          continue;
        }

        const text =
          await element.textContent();

        const parsed =
          SERPScraper.parseResultCount(
            text
          );

        if (parsed > 0) {
          return parsed;
        }
      }
    } catch (error) {
      logger.debug(
        'Failed to extract Google result count',
        {
          error:
            error instanceof Error
              ? error.message
              : 'Unknown error',
        }
      );
    }

    return 0;
  }

  private static async extractBingTotalResults(
    page: PageLike,
    logger: Logger
  ): Promise<number> {
    try {
      const selectors = [
        '.sb_count',
        '#sb_count',
      ];

      for (const selector of selectors) {
        const element =
          await page.$(selector);

        if (!element) {
          continue;
        }

        const text =
          await element.textContent();

        const parsed =
          SERPScraper.parseResultCount(
            text
          );

        if (parsed > 0) {
          return parsed;
        }
      }
    } catch (error) {
      logger.debug(
        'Failed to extract Bing result count',
        {
          error:
            error instanceof Error
              ? error.message
              : 'Unknown error',
        }
      );
    }

    return 0;
  }

  /**
   * "Yaklaşık 1.230.000.000 sonuç"
   * "About 1,230,000,000 results"
   * "1,230,000 results"
   *
   * gibi değerleri mümkün olduğunca güvenli parse eder.
   */
  private static parseResultCount(
    text: string | null
  ): number {
    if (!text) {
      return 0;
    }

    const normalized =
      text
        .replace(/\u00a0/g, ' ')
        .trim();

    /**
     * Önce sayı + "results/sonuç" yakınlığını arıyoruz.
     */
    const labeled =
      normalized.match(
        /([\d.,\s]+)\s*(?:results?|sonuç)/i
      );

    const raw =
      labeled?.[1] ||
      normalized.match(
        /[\d][\d.,\s]*/
      )?.[0];

    if (!raw) {
      return 0;
    }

    /**
     * Sayı formatı:
     * 1.230.000
     * 1,230,000
     * 1 230 000
     */
    const digits =
      raw.replace(/[^\d]/g, '');

    if (!digits) {
      return 0;
    }

    const value =
      Number.parseInt(
        digits,
        10
      );

    return Number.isSafeInteger(value)
      ? value
      : 0;
  }

  /* ------------------------------------------------------------------------ */
  /* Normalization                                                            */
  /* ------------------------------------------------------------------------ */

  private normalizeOptions(
    options: SearchOptions
  ): NormalizedSearchOptions {
    if (!options) {
      throw new ScrapingError(
        'Search options are required',
        'INVALID_OPTIONS',
        false
      );
    }

    const query =
      typeof options.query === 'string'
        ? options.query.trim()
        : '';

    if (!query) {
      throw new ScrapingError(
        'Search query cannot be empty',
        'INVALID_OPTIONS',
        false
      );
    }

    const engine =
      options.engine || 'google';

    if (
      engine !== 'google' &&
      engine !== 'bing'
    ) {
      throw new ScrapingError(
        `Unsupported search engine: ${engine}`,
        'UNSUPPORTED_ENGINE',
        false
      );
    }

    const numResults =
      Number.isFinite(options.numResults)
        ? Math.floor(
            options.numResults as number
          )
        : 10;

    const page =
      Number.isFinite(options.page)
        ? Math.floor(
            options.page as number
          )
        : 1;

    if (
      numResults < 1 ||
      numResults > this.config.maxResults
    ) {
      throw new ScrapingError(
        `numResults must be between 1 and ${this.config.maxResults}`,
        'INVALID_OPTIONS',
        false
      );
    }

    if (page < 1) {
      throw new ScrapingError(
        'page must be >= 1',
        'INVALID_OPTIONS',
        false
      );
    }

    const language =
      this.normalizeCode(
        options.language
      );

    const country =
      this.normalizeCode(
        options.country
      );

    return {
      query,
      engine,
      language,
      country,
      safeSearch:
        options.safeSearch ||
        'moderate',
      numResults,
      page,
      location:
        options.location?.trim() ||
        undefined,
      device:
        options.device ||
        'desktop',
    };
  }

  private normalizeCode(
    value?: string
  ): string | undefined {
    if (!value) {
      return undefined;
    }

    const normalized =
      value.trim().toLowerCase();

    if (!/^[a-z]{2,5}(-[a-z]{2})?$/.test(normalized)) {
      throw new ScrapingError(
        `Invalid language/country code: ${value}`,
        'INVALID_OPTIONS',
        false
      );
    }

    return normalized;
  }

  private normalizeResults(
    results: SearchResult[]
  ): SearchResult[] {
    const seen = new Set<string>();

    const normalized: SearchResult[] = [];

    for (const result of results) {
      const title =
        SERPScraper.cleanText(
          result.title
        );

      const url =
        SERPScraper.normalizeUrl(
          result.url
        );

      if (!title || !url) {
        continue;
      }

      const candidate: SearchResult = {
        position:
          result.isAd
            ? -1
            : normalized.length + 1,
        title,
        url,
        description:
          SERPScraper.cleanText(
            result.description
          ),
        isAd: Boolean(result.isAd),
        isFeaturedSnippet:
          Boolean(
            result.isFeaturedSnippet
          ),
      };

      const key =
        SERPScraper.resultKey(
          candidate
        );

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);

      normalized.push(candidate);
    }

    /**
     * Organic position'ları yeniden normalize et.
     * Ads -1 olarak kalır.
     */
    let organicPosition = 1;

    for (const result of normalized) {
      if (!result.isAd) {
        result.position =
          organicPosition++;
      }
    }

    return normalized;
  }

  /* ------------------------------------------------------------------------ */
  /* Generic DOM helpers                                                      */
  /* ------------------------------------------------------------------------ */

  private static async firstText(
    element: ElementLike,
    selectors: string[]
  ): Promise<string> {
    for (const selector of selectors) {
      try {
        const child =
          await element.$(selector);

        if (!child) {
          continue;
        }

        const text =
          await child.textContent();

        if (text?.trim()) {
          return text;
        }
      } catch {
        // Try next selector.
      }
    }

    return '';
  }

  private static async hasAny(
    element: ElementLike,
    selectors: string[]
  ): Promise<boolean> {
    for (const selector of selectors) {
      try {
        if (
          await element.$(selector)
        ) {
          return true;
        }
      } catch {
        // Ignore selector failures.
      }
    }

    return false;
  }

  /* ------------------------------------------------------------------------ */
  /* URL helpers                                                              */
  /* ------------------------------------------------------------------------ */

  private static normalizeUrl(
    rawUrl: string | null
  ): string | null {
    if (!rawUrl) {
      return null;
    }

    const value =
      rawUrl.trim();

    if (!value) {
      return null;
    }

    /**
     * Google/Bing bazı redirect URL'leri kullanabilir.
     * Burada yalnızca absolute http(s) URL kabul ediyoruz.
     */
    try {
      const url =
        new URL(value);

      if (
        url.protocol !== 'http:' &&
        url.protocol !== 'https:'
      ) {
        return null;
      }

      /**
       * Tracking fragment'larını kaldır.
       */
      url.hash = '';

      return url.toString();
    } catch {
      return null;
    }
  }

  private static resultKey(
    result: SearchResult
  ): string {
    return [
      result.isAd ? 'ad' : 'organic',
      result.url.toLowerCase(),
      result.title
        .trim()
        .toLowerCase(),
    ].join('|');
  }

  private static cleanText(
    value: string | null
  ): string {
    if (!value) {
      return '';
    }

    return value
      .replace(/\s+/g, ' ')
      .trim();
  }

  /* ------------------------------------------------------------------------ */
  /* Retry                                                                    */
  /* ------------------------------------------------------------------------ */

  private calculateBackoff(
    attempt: number
  ): number {
    const exponential =
      Math.min(
        this.config.retryMaxDelayMs,
        this.config.retryBaseDelayMs *
          Math.pow(2, attempt - 1)
      );

    /**
     * Full jitter.
     */
    return Math.floor(
      Math.random() * exponential
    );
  }

  private async sleep(
    ms: number
  ): Promise<void> {
    if (ms <= 0) {
      return;
    }

    await new Promise<void>(
      resolve =>
        setTimeout(
          resolve,
          ms
        )
    );
  }

  /* ------------------------------------------------------------------------ */
  /* Error normalization                                                      */
  /* ------------------------------------------------------------------------ */

  private normalizeError(
    error: unknown
  ): ScrapingError {
    if (
      error instanceof ScrapingError
    ) {
      return error;
    }

    if (this.isTimeoutError(error)) {
      return new ScrapingError(
        error instanceof Error
          ? error.message
          : 'Operation timed out',
        'TIMEOUT',
        true,
        error
      );
    }

    return new ScrapingError(
      error instanceof Error
        ? error.message
        : 'Unknown scraping error',
      'SCRAPING_FAILED',
      true,
      error
    );
  }

  private isTimeoutError(
    error: unknown
  ): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    const message =
      error.message.toLowerCase();

    return (
      message.includes('timeout') ||
      message.includes(
        'timed out'
      ) ||
      message.includes(
        'exceeded'
      )
    );
  }

  /* ------------------------------------------------------------------------ */
  /* Cleanup                                                                  */
  /* ------------------------------------------------------------------------ */

  private async closePage(
    page?: PageLike
  ): Promise<void> {
    if (!page) {
      return;
    }

    try {
      await page.close();
    } catch (error) {
      this.logger.debug(
        'Failed to close page',
        {
          error:
            error instanceof Error
              ? error.message
              : 'Unknown error',
        }
      );
    }
  }

  private async closeBrowser(
    browser?: BrowserLike
  ): Promise<void> {
    if (!browser) {
      return;
    }

    try {
      await browser.close();
    } catch (error) {
      this.logger.debug(
        'Failed to close browser',
        {
          error:
            error instanceof Error
              ? error.message
              : 'Unknown error',
        }
      );
    }
  }

  /* ------------------------------------------------------------------------ */
  /* Validation                                                               */
  /* ------------------------------------------------------------------------ */

  private validateConfig(): void {
    if (
      this.config.maxAttempts < 1
    ) {
      throw new Error(
        'maxAttempts must be >= 1'
      );
    }

    if (
      this.config.maxProxyAttempts < 1
    ) {
      throw new Error(
        'maxProxyAttempts must be >= 1'
      );
    }

    if (
      this.config.navigationTimeoutMs <= 0
    ) {
      throw new Error(
        'navigationTimeoutMs must be > 0'
      );
    }

    if (
      this.config.actionTimeoutMs <= 0
    ) {
      throw new Error(
        'actionTimeoutMs must be > 0'
      );
    }

    if (
      this.config.maxResults < 1 ||
      this.config.maxResults > 100
    ) {
      throw new Error(
        'maxResults must be between 1 and 100'
      );
    }
  }

  /* ------------------------------------------------------------------------ */
  /* Logging / privacy                                                        */
  /* ------------------------------------------------------------------------ */

  private safeLogQuery(
    query: string
  ): string {
    /**
     * Query'yi loglarda sınırsız büyütme.
     */
    if (query.length <= 120) {
      return query;
    }

    return (
      query.slice(0, 117) +
      '...'
    );
  }

  private maskProxy(
    proxy?: string
  ): string | undefined {
    if (!proxy) {
      return undefined;
    }

    try {
      const url =
        new URL(proxy);

      if (url.username) {
        url.username = '***';
      }

      if (url.password) {
        url.password = '***';
      }

      return url.toString();
    } catch {
      /**
       * URL parse edilemiyorsa credential sızıntısı riskine
       * karşı ham proxy'yi loglamıyoruz.
       */
      return '[proxy]';
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Singleton helpers                                                          */
/* -------------------------------------------------------------------------- */

let scraperInstance:
  SERPScraper | null = null;

export function createSERPScraper(
  browserManager: BrowserManager,
  proxyManager: ProxyManager,
  fingerprintGenerator: FingerprintGenerator,
  logger?: Logger,
  config?: Partial<ScraperConfig>
): SERPScraper {
  return new SERPScraper(
    browserManager,
    proxyManager,
    fingerprintGenerator,
    logger,
    config
  );
}

export function getSERPScraper():
  SERPScraper | null {
  return scraperInstance;
}

export function setSERPScraper(
  scraper: SERPScraper
): void {
  scraperInstance = scraper;
}

export default SERPScraper;
