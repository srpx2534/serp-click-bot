import {
  SERPScraper,
  ScrapingError,
  createSERPScraper,
} from '../../../src/core/serp-scraper';

describe('SERPScraper', () => {
  let browserManager: any;
  let proxyManager: any;
  let fingerprintGenerator: any;
  let logger: any;

  let browser: any;
  let page: any;

  beforeEach(() => {
    page = {
      goto: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
      $: jest.fn().mockResolvedValue(null),
      $$: jest.fn().mockResolvedValue([]),
      waitForSelector: jest.fn().mockResolvedValue(null),
      setDefaultTimeout: jest.fn(),
      setDefaultNavigationTimeout: jest.fn(),
    };

    browser = {
      newPage: jest.fn().mockResolvedValue(page),
      close: jest.fn().mockResolvedValue(undefined),
    };

    browserManager = {
      launch: jest.fn().mockResolvedValue(browser),
    };

    proxyManager = {
      getNextProxy: jest.fn().mockReturnValue(undefined),
      checkProxyHealth: jest.fn().mockResolvedValue(true),
    };

    fingerprintGenerator = {
      getRandom: jest.fn().mockReturnValue({
        id: 'fingerprint-test-001',
      }),
    };

    logger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  function createScraper() {
    return new SERPScraper(
      browserManager,
      proxyManager,
      fingerprintGenerator,
      logger
    );
  }

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  describe('constructor', () => {
    it('should create SERPScraper instance', () => {
      const scraper = createScraper();
      expect(scraper).toBeInstanceOf(SERPScraper);
    });

    it('should use provided logger', () => {
      const scraper = createScraper();
      expect(scraper).toBeDefined();
      expect(logger.info).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Basic search
  // -------------------------------------------------------------------------

  describe('search()', () => {
    it('should perform a Google search by default', async () => {
      const scraper = createScraper();
      const result = await scraper.search({ query: 'OpenAI' });

      expect(browserManager.launch).toHaveBeenCalledTimes(1);
      expect(page.goto).toHaveBeenCalledTimes(1);
      expect(page.goto).toHaveBeenCalledWith(
        expect.stringContaining('https://www.google.com/search'),
        expect.objectContaining({
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        })
      );

      expect(result.query).toBe('OpenAI');
      expect(result.engine).toBe('google');
      expect(result.results).toEqual([]);
      expect(result.totalResults).toBe(0);
      expect(result.duration).toEqual(expect.any(Number));
    });

    it('should perform a Bing search', async () => {
      const scraper = createScraper();
      const result = await scraper.search({ query: 'OpenAI', engine: 'bing' });

      expect(page.goto).toHaveBeenCalledWith(
        expect.stringContaining('https://www.bing.com/search'),
        expect.objectContaining({
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        })
      );
      expect(result.engine).toBe('bing');
    });

    it('should return proxy information', async () => {
      proxyManager.getNextProxy.mockReturnValue({ url: 'http://proxy.example:8080' });
      const scraper = createScraper();
      const result = await scraper.search({ query: 'test' });

      expect(result.proxy).toBe('http://proxy.example:8080');
      expect(browserManager.launch).toHaveBeenCalledWith(
        expect.objectContaining({
          proxy: { url: 'http://proxy.example:8080' },
        })
      );
    });

    it('should return fingerprint information', async () => {
      fingerprintGenerator.getRandom.mockReturnValue({ id: 'fp-123' });
      const scraper = createScraper();
      const result = await scraper.search({ query: 'test' });

      expect(result.fingerprint).toBe('fp-123');
    });
  });

  // -------------------------------------------------------------------------
  // URL building
  // -------------------------------------------------------------------------

  describe('search URL', () => {
    // DÜZELTİLDİ: URLSearchParams + kullanır, %20 değil
    it('should encode query', async () => {
      const scraper = createScraper();
      await scraper.search({ query: 'hello world' });

      expect(page.goto).toHaveBeenCalledWith(
        expect.stringContaining('q=hello+world'),
        expect.any(Object)
      );
    });

    it('should add language parameter for Google', async () => {
      const scraper = createScraper();
      await scraper.search({ query: 'test', engine: 'google', language: 'tr' });

      expect(page.goto).toHaveBeenCalledWith(
        expect.stringContaining('hl=tr'),
        expect.any(Object)
      );
    });

    it('should add country parameter for Google', async () => {
      const scraper = createScraper();
      await scraper.search({ query: 'test', engine: 'google', country: 'tr' });

      expect(page.goto).toHaveBeenCalledWith(
        expect.stringContaining('gl=tr'),
        expect.any(Object)
      );
    });

    it('should add Google safe search', async () => {
      const scraper = createScraper();
      await scraper.search({ query: 'test', engine: 'google', safeSearch: 'strict' });

      expect(page.goto).toHaveBeenCalledWith(
        expect.stringContaining('safe=active'),
        expect.any(Object)
      );
    });

    it('should disable Google safe search when off', async () => {
      const scraper = createScraper();
      await scraper.search({ query: 'test', engine: 'google', safeSearch: 'off' });

      expect(page.goto).toHaveBeenCalledWith(
        expect.stringContaining('safe=off'),
        expect.any(Object)
      );
    });

    // DÜZELTİLDİ: Kod throw ediyor, clamp etmiyor
    it('should throw when numResults exceeds max', async () => {
      const scraper = createScraper();
      
      await expect(
        scraper.search({ query: 'test', engine: 'google', numResults: 500 })
      ).rejects.toMatchObject({
        code: 'INVALID_OPTIONS',
      });
    });

    it('should accept valid numResults', async () => {
      const scraper = createScraper();
      await scraper.search({ query: 'test', engine: 'google', numResults: 50 });

      expect(page.goto).toHaveBeenCalledWith(
        expect.stringContaining('num=50'),
        expect.any(Object)
      );
    });

    it('should add Google pagination', async () => {
      const scraper = createScraper();
      await scraper.search({ query: 'test', engine: 'google', page: 3 });

      expect(page.goto).toHaveBeenCalledWith(
        expect.stringContaining('start=20'),
        expect.any(Object)
      );
    });

    it('should add Bing language', async () => {
      const scraper = createScraper();
      await scraper.search({ query: 'test', engine: 'bing', language: 'tr' });

      expect(page.goto).toHaveBeenCalledWith(
        expect.stringContaining('setlang=tr'),
        expect.any(Object)
      );
    });

    it('should add Bing pagination', async () => {
      const scraper = createScraper();
      await scraper.search({ query: 'test', engine: 'bing', page: 2 });

      expect(page.goto).toHaveBeenCalledWith(
        expect.stringContaining('first=11'),
        expect.any(Object)
      );
    });

    // DÜZELTİLDİ: Kod throw ediyor, clamp etmiyor
    it('should throw when Bing count exceeds max', async () => {
      const scraper = createScraper();
      
      await expect(
        scraper.search({ query: 'test', engine: 'bing', numResults: 500 })
      ).rejects.toMatchObject({
        code: 'INVALID_OPTIONS',
      });
    });
  });

  // -------------------------------------------------------------------------
  // Fingerprint
  // -------------------------------------------------------------------------

  describe('fingerprint', () => {
    it('should use desktop fingerprint by default', async () => {
      const scraper = createScraper();
      await scraper.search({ query: 'test' });

      expect(fingerprintGenerator.getRandom).toHaveBeenCalledWith('desktop');
    });

    it('should use desktop fingerprint for Turkish language', async () => {
      const scraper = createScraper();
      await scraper.search({ query: 'test', language: 'tr' });

      expect(fingerprintGenerator.getRandom).toHaveBeenCalledWith('desktop');
    });

    it('should throw when no fingerprint exists', async () => {
      fingerprintGenerator.getRandom.mockReturnValue(undefined);
      const scraper = createScraper();

      await expect(scraper.search({ query: 'test' })).rejects.toMatchObject({
        code: 'NO_FINGERPRINT',
        retryable: false,
      });

      expect(browserManager.launch).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Proxy
  // -------------------------------------------------------------------------

  describe('proxy', () => {
    // DÜZELTİLDİ: Logger signature kontrolü
    it('should work without proxy', async () => {
        proxyManager.getNextProxy.mockReturnValue(undefined);
        const scraper = createScraper();
        const result = await scraper.search({ query: 'test' });

        expect(result.proxy).toBeUndefined();
        
        // DÜZELTİLDİ: Kod sadece string gönderiyor, obje değil
        expect(logger.warn).toHaveBeenCalledWith(
            'No proxy available, using direct connection'
        );
    });

    it('should check proxy health', async () => {
      const proxy = { url: 'http://proxy.example:8080' };
      proxyManager.getNextProxy.mockReturnValue(proxy);
      const scraper = createScraper();

      await scraper.search({ query: 'test' });
      expect(proxyManager.checkProxyHealth).toHaveBeenCalledWith(proxy);
    });

    it('should use healthy proxy', async () => {
      const proxy = { url: 'http://proxy.example:8080' };
      proxyManager.getNextProxy.mockReturnValue(proxy);
      proxyManager.checkProxyHealth.mockResolvedValue(true);
      const scraper = createScraper();

      await scraper.search({ query: 'test' });
      expect(browserManager.launch).toHaveBeenCalledWith(
        expect.objectContaining({ proxy })
      );
    });
  });

  // -------------------------------------------------------------------------
  // Google parser
  // -------------------------------------------------------------------------

  describe('Google result parser', () => {
    // DÜZELTİLDİ: Selector'lar ve mock yapısı güncellendi
    it('should parse organic result', async () => {
      const titleElement = {
        textContent: jest.fn().mockResolvedValue('OpenAI'),
      };

      const linkElement = {
        getAttribute: jest.fn().mockResolvedValue('https://openai.com/'),
      };

      const descriptionElement = {
        textContent: jest.fn().mockResolvedValue('AI research and deployment.'),
      };

      const resultElement = {
        $: jest.fn().mockImplementation(async (selector: string) => {
          if (selector === 'h3') return titleElement;
          if (selector === 'a[href]') return linkElement;
          // Kodda kullanılan selector'lar
          if (selector.includes('.VwiC3b') || selector.includes('.s3v94d') || 
              selector.includes('[data-sncf]') || selector.includes('[data-snf]') || 
              selector.includes('.IsZvec')) {
            return descriptionElement;
          }
          return null;
        }),
      };

      page.waitForSelector = jest.fn().mockResolvedValue(resultElement);
      
      page.$$ = jest.fn().mockImplementation(async (selector: string) => {
        if (selector === '#search .g' || selector === '#rso .g' || selector === '.MjjYud') {
          return [resultElement];
        }
        return [];
      });

      const scraper = createScraper();
      const result = await scraper.search({ query: 'OpenAI', engine: 'google' });

      expect(result.results).toHaveLength(1);
      expect(result.results[0]).toMatchObject({
        position: 1,
        title: 'OpenAI',
        url: 'https://openai.com/',
        isAd: false,
        isFeaturedSnippet: false,
      });
    });

    it('should parse Google result without description', async () => {
      const resultElement = {
        $: jest.fn().mockImplementation(async (selector: string) => {
          if (selector === 'h3') {
            return { textContent: jest.fn().mockResolvedValue('Example') };
          }
          if (selector === 'a[href]') {
            return { getAttribute: jest.fn().mockResolvedValue('https://example.com') };
          }
          return null;
        }),
      };

      page.waitForSelector = jest.fn().mockResolvedValue(resultElement);
      page.$$ = jest.fn().mockResolvedValue([resultElement]);

      const scraper = createScraper();
      const result = await scraper.search({ query: 'example', engine: 'google' });

      expect(result.results[0].description).toBe('');
    });

    it('should ignore result without title', async () => {
      const resultElement = {
        $: jest.fn().mockResolvedValue(null),
      };

      page.waitForSelector = jest.fn().mockResolvedValue(resultElement);
      page.$$ = jest.fn().mockResolvedValue([resultElement]);

      const scraper = createScraper();
      const result = await scraper.search({ query: 'test', engine: 'google' });

      expect(result.results).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Bing parser
  // -------------------------------------------------------------------------

  describe('Bing result parser', () => {
    // DÜZELTİLDİ: URL trailing slash ve description
    it('should parse Bing organic result', async () => {
      const titleElement = {
        textContent: jest.fn().mockResolvedValue('Example Website'),
        getAttribute: jest.fn().mockResolvedValue('https://example.com'),
      };

      const descriptionElement = {
        textContent: jest.fn().mockResolvedValue('Example description'),
      };

      const resultElement = {
        $: jest.fn().mockImplementation(async (selector: string) => {
          if (selector === 'h2 a') return titleElement;
          if (selector.includes('.b_caption p') || selector.includes('.b_snippet')) {
            return descriptionElement;
          }
          return null;
        }),
      };

      page.waitForSelector = jest.fn().mockResolvedValue(resultElement);
      
      page.$$ = jest.fn().mockImplementation(async (selector: string) => {
        if (selector === '#b_results .b_algo' || selector === '.b_algo') {
          return [resultElement];
        }
        return [];
      });

      const scraper = createScraper();
      const result = await scraper.search({ query: 'example', engine: 'bing' });

      expect(result.results).toHaveLength(1);
      // DÜZELTİLDİ: normalizeUrl trailing slash ekliyor
      expect(result.results[0]).toMatchObject({
        position: 1,
        title: 'Example Website',
        url: 'https://example.com/', // Trailing slash eklendi
        isAd: false,
        isFeaturedSnippet: false,
      });
    });

    it('should ignore Bing result without title', async () => {
      const resultElement = {
        $: jest.fn().mockResolvedValue(null),
      };

      page.waitForSelector = jest.fn().mockResolvedValue(resultElement);
      page.$$ = jest.fn().mockResolvedValue([resultElement]);

      const scraper = createScraper();
      const result = await scraper.search({ query: 'test', engine: 'bing' });

      expect(result.results).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // CAPTCHA
  // -------------------------------------------------------------------------

  describe('CAPTCHA detection', () => {
    it('should detect Google CAPTCHA form', async () => {
      page.$ = jest.fn().mockImplementation(async (selector: string) => {
        if (selector === 'form[action="/sorry/index"]') return {};
        return null;
      });

      const scraper = createScraper();
      await expect(scraper.search({ query: 'test' })).rejects.toMatchObject({
        code: 'CAPTCHA_DETECTED',
        retryable: true,
      });
    });

    it('should detect captcha-form', async () => {
      page.$ = jest.fn().mockImplementation(async (selector: string) => {
        if (selector === '#captcha-form') return {};
        return null;
      });

      const scraper = createScraper();
      await expect(scraper.search({ query: 'test' })).rejects.toMatchObject({
        code: 'CAPTCHA_DETECTED',
      });
    });

    it('should detect reCAPTCHA', async () => {
      page.$ = jest.fn().mockImplementation(async (selector: string) => {
        if (selector === '.g-recaptcha') return {};
        return null;
      });

      const scraper = createScraper();
      await expect(scraper.search({ query: 'test' })).rejects.toMatchObject({
        code: 'CAPTCHA_DETECTED',
      });
    });

    it('should continue when CAPTCHA is not present', async () => {
      const scraper = createScraper();
      const result = await scraper.search({ query: 'normal query' });

      expect(result).toBeDefined();
      expect(logger.error).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Total results
  // -------------------------------------------------------------------------

  describe('total results', () => {
    it('should parse Google result count', async () => {
      page.$ = jest.fn().mockImplementation(async (selector: string) => {
        if (selector === '#result-stats' || selector === '#result-stats div') {
          return { textContent: jest.fn().mockResolvedValue('About 1,230,000 results') };
        }
        return null;
      });

      const scraper = createScraper();
      const result = await scraper.search({ query: 'test', engine: 'google' });

      expect(result.totalResults).toBe(1230000);
    });

    it('should parse Bing result count', async () => {
      page.$ = jest.fn().mockImplementation(async (selector: string) => {
        if (selector === '.sb_count' || selector === '#sb_count') {
          return { textContent: jest.fn().mockResolvedValue('1,500 results') };
        }
        return null;
      });

      const scraper = createScraper();
      const result = await scraper.search({ query: 'test', engine: 'bing' });

      expect(result.totalResults).toBe(1500);
    });

    it('should return zero when total cannot be parsed', async () => {
      const scraper = createScraper();
      const result = await scraper.search({ query: 'test' });

      expect(result.totalResults).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe('error handling', () => {
    it('should convert browser errors to ScrapingError', async () => {
      browserManager.launch.mockRejectedValue(new Error('Browser crashed'));
      const scraper = createScraper();

      await expect(scraper.search({ query: 'test' })).rejects.toBeInstanceOf(ScrapingError);
    });

    it('should mark generic errors as retryable', async () => {
      browserManager.launch.mockRejectedValue(new Error('Network error'));
      const scraper = createScraper();

      await expect(scraper.search({ query: 'test' })).rejects.toMatchObject({
        code: 'SCRAPING_FAILED',
        retryable: true,
      });
    });

    it('should preserve ScrapingError', async () => {
      fingerprintGenerator.getRandom.mockReturnValue(undefined);
      const scraper = createScraper();

      await expect(scraper.search({ query: 'test' })).rejects.toMatchObject({
        code: 'NO_FINGERPRINT',
        retryable: false,
      });
    });
  });

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  describe('cleanup', () => {
    it('should close page after successful search', async () => {
      const scraper = createScraper();
      await scraper.search({ query: 'test' });

      expect(page.close).toHaveBeenCalled();
    });

    it('should close browser after successful search', async () => {
      const scraper = createScraper();
      await scraper.search({ query: 'test' });

      expect(browser.close).toHaveBeenCalled();
    });

    // DÜZELTİLDİ: Retry mekanizması nedeniyle multiple call olabilir
    it('should close page after failure', async () => {
      browserManager.launch.mockResolvedValue(browser);
      page.goto.mockRejectedValue(new Error('Navigation failed'));

      const scraper = createScraper();
      await expect(scraper.search({ query: 'test' })).rejects.toThrow();

      // Retry nedeniyle birden fazla çağrı olabilir, en az bir kez çağrıldığını kontrol et
      expect(page.close).toHaveBeenCalled();
    });

    // DÜZELTİLDİ: Retry mekanizması nedeniyle multiple call olabilir
    it('should close browser after failure', async () => {
      page.goto.mockRejectedValue(new Error('Navigation failed'));

      const scraper = createScraper();
      await expect(scraper.search({ query: 'test' })).rejects.toThrow();

      // Retry nedeniyle birden fazla çağrı olabilir
      expect(browser.close).toHaveBeenCalled();
    });

    it('should not fail when page.close throws', async () => {
      page.close.mockRejectedValue(new Error('Page close failed'));
      const scraper = createScraper();

      await expect(scraper.search({ query: 'test' })).resolves.toBeDefined();
    });

    it('should not fail when browser.close throws', async () => {
      browser.close.mockRejectedValue(new Error('Browser close failed'));
      const scraper = createScraper();

      await expect(scraper.search({ query: 'test' })).resolves.toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Logging
  // -------------------------------------------------------------------------

  describe('logging', () => {
    it('should log search start', async () => {
      const scraper = createScraper();
      await scraper.search({ query: 'test', engine: 'google', language: 'tr' });

      expect(logger.info).toHaveBeenCalledWith(
        'SERP scraping started',
        expect.objectContaining({
          engine: 'google',
          language: 'tr',
        })
      );
    });

    it('should log successful completion', async () => {
      const scraper = createScraper();
      await scraper.search({ query: 'test' });

      expect(logger.info).toHaveBeenCalledWith(
        'SERP scraping completed',
        expect.objectContaining({
          engine: 'google',
        })
      );
    });

    it('should log errors', async () => {
      browserManager.launch.mockRejectedValue(new Error('Browser failed'));
      const scraper = createScraper();

      await expect(scraper.search({ query: 'test' })).rejects.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        'SERP scraping permanently failed',
        expect.objectContaining({
          engine: 'google',
        })
      );
    });
  });
});

// -----------------------------------------------------------------------------
// ScrapingError
// -----------------------------------------------------------------------------

describe('ScrapingError', () => {
  it('should extend Error', () => {
    const error = new ScrapingError('Test error', 'TEST_ERROR');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ScrapingError);
  });

  it('should set name', () => {
    const error = new ScrapingError('Test error', 'TEST_ERROR');
    expect(error.name).toBe('ScrapingError');
  });

  it('should expose code', () => {
    const error = new ScrapingError('Test error', 'TEST_ERROR');
    expect(error.code).toBe('TEST_ERROR');
  });

  it('should default retryable to false', () => {
    const error = new ScrapingError('Test error', 'TEST_ERROR');
    expect(error.retryable).toBe(false);
  });

  it('should accept retryable=true', () => {
    const error = new ScrapingError('Test error', 'TEST_ERROR', true);
    expect(error.retryable).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// Factory
// -----------------------------------------------------------------------------

describe('createSERPScraper', () => {
  it('should create a SERPScraper', () => {
    const browserManager = {};
    const proxyManager = {};
    const fingerprintGenerator = {};
    const logger = {};

    const scraper = createSERPScraper(
      browserManager as any,
      proxyManager as any,
      fingerprintGenerator as any,
      logger as any
    );

    expect(scraper).toBeInstanceOf(SERPScraper);
  });
});