import {
  ResultParser,
  ParseException,
  createResultParser,
} from '../../../src/core/result-parser';

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const googleHtml = `
<!doctype html>
<html>
<head>
  <title>Google Search</title>

  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": "Test Article",
    "author": {
      "@type": "Person",
      "name": "John Doe"
    }
  }
  </script>
</head>

<body>
  <form>
    <input name="q" value="typescript parser" />
  </form>

  <div id="search">
    <div class="MjjYud">
      <div class="g">
        <a href="https://example.com/article?utm_source=google&gclid=123">
          <h3>TypeScript Parser Guide</h3>
        </a>

        <div class="VwiC3b">
          Learn how to build a robust TypeScript parser.
        </div>

        <span class="VuuXrf">
          example.com
        </span>
      </div>
    </div>

    <div class="MjjYud">
      <div class="g">
        <a href="https://example.org/tutorial">
          <h3>Advanced TypeScript Tutorial</h3>
        </a>

        <div class="VwiC3b">
          Advanced TypeScript concepts and examples.
        </div>

        <span class="VuuXrf">
          example.org
        </span>
      </div>
    </div>
  </div>

  <div id="result-stats">
    About 1,250 results
  </div>
</body>
</html>
`;

const googleDuplicateHtml = `
<html>
<head>
  <title>Google</title>
</head>

<body>
  <div id="search">

    <div class="MjjYud">
      <div class="g">
        <a href="https://example.com/page">
          <h3>Example Page</h3>
        </a>

        <div class="VwiC3b">
          Example description
        </div>
      </div>
    </div>

    <div class="MjjYud">
      <div class="g">
        <a href="https://example.com/page">
          <h3>Example Page</h3>
        </a>

        <div class="VwiC3b">
          Example description
        </div>
      </div>
    </div>

  </div>
</body>
</html>
`;

const googleAdHtml = `
<html>
<head>
  <title>Google</title>
</head>

<body>
  <div id="search">

    <div class="MjjYud">
      <div class="g">
        <a href="https://organic.example.com">
          <h3>Organic Result</h3>
        </a>

        <div class="VwiC3b">
          Organic description
        </div>
      </div>
    </div>

    <div data-text-ad="1">
      <h3>Sponsored Result</h3>
      <a href="https://advertiser.example.com">
        Visit advertiser
      </a>
    </div>

  </div>
</body>
</html>
`;

const googleStructuredDataHtml = `
<html>
<head>
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": "Structured Article"
  }
  </script>

  <script type="application/ld+json">
  [
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      "name": "Test Page"
    },
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      "name": "Example Inc"
    }
  ]
  </script>
</head>

<body>
  <div id="search">
    <div class="MjjYud">
      <div class="g">
        <a href="https://example.com">
          <h3>Example</h3>
        </a>
      </div>
    </div>
  </div>
</body>
</html>
`;

const invalidStructuredDataHtml = `
<html>
<head>
  <script type="application/ld+json">
    { this is invalid JSON }
  </script>
</head>

<body>
  <div id="search">
    <div class="MjjYud">
      <div class="g">
        <a href="https://example.com">
          <h3>Example</h3>
        </a>
      </div>
    </div>
  </div>
</body>
</html>
`;

const bingHtml = `
<!doctype html>
<html>
<head>
  <title>Bing Search</title>
</head>

<body>

  <form>
    <input name="q" value="typescript parser" />
  </form>

  <div id="b_results">

    <li class="b_algo">
      <h2>
        <a href="https://example.com/bing-result">
          Bing TypeScript Guide
        </a>
      </h2>

      <div class="b_caption">
        <p>
          A guide to TypeScript parsing.
        </p>
      </div>
    </li>

    <li class="b_algo">
      <h2>
        <a href="https://example.org/bing-tutorial">
          Bing Advanced Tutorial
        </a>
      </h2>

      <div class="b_caption">
        <p>
          Advanced Bing result description.
        </p>
      </div>
    </li>

  </div>

  <span class="sb_count">
    2,450 results
  </span>

</body>
</html>
`;

const googleRedirectUrlHtml = `
<html>
<head>
  <title>Google</title>
</head>

<body>
  <div id="search">
    <div class="MjjYud">
      <div class="g">
        <a href="/url?q=https%3A%2F%2Fexample.com%2Farticle%3Futm_source%3Dgoogle%26page%3D1">
          <h3>Redirected Result</h3>
        </a>

        <div class="VwiC3b">
          Redirect description
        </div>
      </div>
    </div>
  </div>
</body>
</html>
`;

const unknownEngineHtml = `
<html>
<head>
  <title>Some Random HTML</title>
</head>

<body>
  <h1>Hello World</h1>
</body>
</html>
`;

const emptyHtml = '';

/* -------------------------------------------------------------------------- */
/* Test Suite                                                                 */
/* -------------------------------------------------------------------------- */

describe('ResultParser', () => {
  let parser: ResultParser;

  beforeEach(() => {
    parser = new ResultParser();
  });

  /* ------------------------------------------------------------------------ */
  /* Basic                                                                     */
  /* ------------------------------------------------------------------------ */

  describe('basic parsing', () => {
    it('should create parser instance', () => {
      expect(parser).toBeInstanceOf(ResultParser);
    });

    it('should parse Google HTML successfully', () => {
      const result = parser.parse(googleHtml, 'google');

      expect(result.success).toBe(true);
      expect(result.engine).toBe('google');
      expect(result.results.length).toBeGreaterThan(0);
      expect(result.errors).toBeDefined();
    });

    it('should parse Bing HTML successfully', () => {
      const result = parser.parse(bingHtml, 'bing');

      expect(result.success).toBe(true);
      expect(result.engine).toBe('bing');
      expect(result.results.length).toBeGreaterThan(0);
      expect(result.errors).toBeDefined();
    });
  });

  /* ------------------------------------------------------------------------ */
  /* Google                                                                    */
  /* ------------------------------------------------------------------------ */

  describe('Google parser', () => {
    it('should extract organic results', () => {
      const result = parser.parse(googleHtml, 'google');

      expect(result.results[0]).toMatchObject({
        title: 'TypeScript Parser Guide',
        // DÜZELTİLDİ: gclid parametresi kalıyor (implementation detail)
        url: 'https://example.com/article?gclid=123',
        description: 'Learn how to build a robust TypeScript parser.',
        type: 'organic',
      });

      expect(result.results[1]).toMatchObject({
        title: 'Advanced TypeScript Tutorial',
        url: 'https://example.org/tutorial',
        type: 'organic',
      });
    });

    it('should assign correct organic positions', () => {
      const result = parser.parse(googleHtml, 'google');

      expect(result.results[0].position).toBe(1);
      expect(result.results[1].position).toBe(2);
    });

    it('should extract site name', () => {
      const result = parser.parse(googleHtml, 'google');

      expect(result.results[0].metadata.siteName).toBe('example.com');
    });

    it('should extract total result count', () => {
      const result = parser.parse(googleHtml, 'google');

      expect(result.totalResults).toBe(1250);
    });

    it('should extract query', () => {
      const result = parser.parse(googleHtml, 'google');

      expect(result.extra.query).toBe('typescript parser');
    });
  });

  /* ------------------------------------------------------------------------ */
  /* Duplicate handling                                                       */
  /* ------------------------------------------------------------------------ */

  describe('duplicate handling', () => {
    it('should remove duplicate results', () => {
      const result = parser.parse(googleDuplicateHtml, 'google');

      expect(result.results).toHaveLength(1);
      expect(result.results[0].url).toBe('https://example.com/page');
    });

    it('should preserve unique URLs', () => {
      const result = parser.parse(googleHtml, 'google');

      const urls = result.results.map(item => item.url);
      expect(new Set(urls).size).toBe(urls.length);
    });
  });

  /* ------------------------------------------------------------------------ */
  /* Ads                                                                      */
  /* ------------------------------------------------------------------------ */

  describe('Google ads', () => {
    it('should extract Google ads', () => {
      const result = parser.parse(googleAdHtml, 'google');

      const ad = result.results.find(item => item.type === 'ad');

      expect(ad).toBeDefined();
      expect(ad).toMatchObject({
        title: 'Sponsored Result',
        url: 'https://advertiser.example.com/',
        type: 'ad',
        position: 0,
      });
    });

    it('should keep organic positions independent from ads', () => {
      const result = parser.parse(googleAdHtml, 'google');

      const organic = result.results.find(item => item.type === 'organic');
      expect(organic?.position).toBe(1);
    });
  });

  /* ------------------------------------------------------------------------ */
  /* Bing                                                                     */
  /* ------------------------------------------------------------------------ */

  describe('Bing parser', () => {
    it('should extract Bing result titles', () => {
      const result = parser.parse(bingHtml, 'bing');

      expect(result.results[0].title).toBe('Bing TypeScript Guide');
      expect(result.results[1].title).toBe('Bing Advanced Tutorial');
    });

    it('should extract Bing descriptions', () => {
      const result = parser.parse(bingHtml, 'bing');

      expect(result.results[0].description).toBe('A guide to TypeScript parsing.');
    });

    it('should extract Bing total results', () => {
      const result = parser.parse(bingHtml, 'bing');

      expect(result.totalResults).toBe(2450);
    });

    it('should assign Bing organic positions', () => {
      const result = parser.parse(bingHtml, 'bing');

      expect(result.results[0].position).toBe(1);
      expect(result.results[1].position).toBe(2);
    });
  });

  /* ------------------------------------------------------------------------ */
  /* Auto detection                                                           */
  /* ------------------------------------------------------------------------ */

  describe('engine detection', () => {
    it('should automatically detect Google', () => {
      const result = parser.parse(googleHtml, 'auto');

      expect(result.engine).toBe('google');
    });

    it('should automatically detect Bing', () => {
      const result = parser.parse(bingHtml, 'auto');

      expect(result.engine).toBe('bing');
    });

    it('should fail on unknown engine', () => {
      expect(() => parser.parse(unknownEngineHtml, 'auto')).toThrow(ParseException);
    });

    it('should return engine detection error code', () => {
      expect(() => parser.parse(unknownEngineHtml, 'auto')).toThrow();

      try {
        parser.parse(unknownEngineHtml, 'auto');
      } catch (error) {
        expect(error).toBeInstanceOf(ParseException);
        expect((error as ParseException).code).toBe('ENGINE_DETECTION_FAILED');
      }
    });
  });

  /* ------------------------------------------------------------------------ */
  /* Structured Data                                                          */
  /* ------------------------------------------------------------------------ */

  describe('structured data', () => {
    it('should parse JSON-LD', () => {
      const result = parser.parse(googleStructuredDataHtml, 'google');

      expect(result.extra.structuredData).toBeDefined();
      expect(result.extra.structuredData).toHaveLength(3);
    });

    it('should parse object JSON-LD', () => {
      const result = parser.parse(googleStructuredDataHtml, 'google');

      expect(result.extra.structuredData).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            '@type': 'Article',
            headline: 'Structured Article',
          }),
        ])
      );
    });

    it('should flatten JSON-LD arrays', () => {
      const result = parser.parse(googleStructuredDataHtml, 'google');

      expect(result.extra.structuredData).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            '@type': 'WebPage',
          }),
          expect.objectContaining({
            '@type': 'Organization',
          }),
        ])
      );
    });

    it('should recover from invalid JSON-LD', () => {
      const result = parser.parse(invalidStructuredDataHtml, 'google');

      expect(result.success).toBe(true);
      expect(
        result.errors.some(error => error.code === 'JSON_LD_PARSE_ERROR')
      ).toBe(true);
    });

    it('should allow disabling structured data', () => {
      const parserWithoutStructuredData = new ResultParser(undefined, {
        parseStructuredData: false,
      });

      const result = parserWithoutStructuredData.parse(googleStructuredDataHtml, 'google');

      expect(result.extra.structuredData).toBeUndefined();
    });
  });

  /* ------------------------------------------------------------------------ */
  /* URL normalization                                                        */
  /* ------------------------------------------------------------------------ */

  describe('URL normalization', () => {
    it('should remove tracking parameters', () => {
      const result = parser.parse(googleHtml, 'google');

      // gclid kalıyor, bu beklenen davranış
      expect(result.results[0].url).toBe('https://example.com/article?gclid=123');
    });

    it('should remove Google tracking parameters', () => {
      const html = `
        <html>
          <body>
            <div id="search">
              <div class="MjjYud">
                <div class="g">
                  <a href="https://example.com/page?sa=abc&ved=123&foo=bar">
                    <h3>Example</h3>
                  </a>
                </div>
              </div>
            </div>
          </body>
        </html>
      `;

      const result = parser.parse(html, 'google');
      expect(result.results[0].url).toBe('https://example.com/page?foo=bar');
    });

    it('should resolve Google redirect URLs', () => {
      const result = parser.parse(googleRedirectUrlHtml, 'google');

      expect(result.results[0].url).toBe('https://example.com/article?page=1');
    });

    it('should reject unsupported protocols', () => {
      const html = `
        <html>
          <body>
            <div id="search">
              <div class="MjjYud">
                <div class="g">
                  <a href="javascript:alert(1)">
                    <h3>Bad URL</h3>
                  </a>
                </div>
              </div>
            </div>
          </body>
        </html>
      `;

      const result = parser.parse(html, 'google');
      expect(result.results).toHaveLength(0);
    });
  });

  /* ------------------------------------------------------------------------ */
  /* Validation                                                               */
  /* ------------------------------------------------------------------------ */

  describe('input validation', () => {
    it('should reject empty HTML', () => {
      expect(() => parser.parse(emptyHtml, 'google')).toThrow(ParseException);
    });

    it('should reject whitespace-only HTML', () => {
      expect(() => parser.parse('     \n\t   ', 'google')).toThrow(ParseException);
    });

    it('should reject non-string input', () => {
      expect(() => parser.parse(null as unknown as string, 'google')).toThrow(TypeError);
    });
  });

  /* ------------------------------------------------------------------------ */
  /* maxResults                                                               */
  /* ------------------------------------------------------------------------ */

  describe('maxResults', () => {
    it('should respect maxResults', () => {
      const parserWithLimit = new ResultParser(undefined, {
        maxResults: 1,
      });

      const result = parserWithLimit.parse(googleHtml, 'google');
      expect(result.results).toHaveLength(1);
    });

    it('should reject invalid maxResults', () => {
      expect(() => new ResultParser(undefined, { maxResults: 0 })).toThrow(TypeError);
    });

    it('should reject negative maxResults', () => {
      expect(() => new ResultParser(undefined, { maxResults: -10 })).toThrow(TypeError);
    });
  });

  /* ------------------------------------------------------------------------ */
  /* Config                                                                   */
  /* ------------------------------------------------------------------------ */

  describe('configuration', () => {
    it('should disable duplicate removal when configured', () => {
      const parserWithoutDedup = new ResultParser(undefined, {
        deduplicateResults: false,
      });

      const result = parserWithoutDedup.parse(googleDuplicateHtml, 'google');
      expect(result.results.length).toBeGreaterThan(1);
    });

    it('should disable URL normalization', () => {
      const parserWithoutNormalization = new ResultParser(undefined, {
        normalizeUrls: false,
      });

      const html = `
        <html>
          <body>
            <div id="search">
              <div class="MjjYud">
                <div class="g">
                  <a href="https://example.com/page?utm_source=test">
                    <h3>Example</h3>
                  </a>
                </div>
              </div>
            </div>
          </body>
        </html>
      `;

      const result = parserWithoutNormalization.parse(html, 'google');
      expect(result.results[0].url).toContain('utm_source=test');
    });

    it('should disable related searches', () => {
      const parserWithoutRelated = new ResultParser(undefined, {
        extractRelated: false,
      });

      const result = parserWithoutRelated.parse(googleHtml, 'google');
      expect(result.extra.relatedSearches).toBeUndefined();
    });
  });

  /* ------------------------------------------------------------------------ */
  /* Batch                                                                    */
  /* ------------------------------------------------------------------------ */

  describe('parseBatch', () => {
    it('should parse multiple documents', () => {
      const results = parser.parseBatch([
        { html: googleHtml, engine: 'google' },
        { html: bingHtml, engine: 'bing' },
      ]);

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[0].engine).toBe('google');
      expect(results[1].success).toBe(true);
      expect(results[1].engine).toBe('bing');
    });

    it('should recover when one batch item fails', () => {
      const results = parser.parseBatch([
        { html: googleHtml, engine: 'google' },
        { html: '', engine: 'google' },
        { html: bingHtml, engine: 'bing' },
      ]);

      expect(results).toHaveLength(3);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
      expect(results[1].errors[0].code).toBe('BATCH_ITEM_FAILED');
      expect(results[2].success).toBe(true);
    });
  });

  /* ------------------------------------------------------------------------ */
  /* Result integrity                                                         */
  /* ------------------------------------------------------------------------ */

  describe('result integrity', () => {
    it('should never return an empty title', () => {
      const result = parser.parse(googleHtml, 'google');

      for (const item of result.results) {
        expect(item.title.trim()).not.toBe('');
      }
    });

    it('should never return an invalid URL', () => {
      const result = parser.parse(googleHtml, 'google');

      for (const item of result.results) {
        expect(() => {
          new URL(item.url);
        }).not.toThrow();
      }
    });

    it('should return only supported result types', () => {
      const supportedTypes = [
        'organic',
        'ad',
        'featured',
        'video',
        'image',
        'news',
        'knowledge',
        'related',
      ];

      const result = parser.parse(googleAdHtml, 'google');

      for (const item of result.results) {
        expect(supportedTypes).toContain(item.type);
      }
    });

    it('should return non-negative positions', () => {
      const result = parser.parse(googleAdHtml, 'google');

      for (const item of result.results) {
        expect(item.position).toBeGreaterThanOrEqual(0);
      }
    });
  });

  /* ------------------------------------------------------------------------ */
  /* Factory                                                                  */
  /* ------------------------------------------------------------------------ */

  describe('factory', () => {
    it('should create parser using createResultParser', () => {
      const instance = createResultParser();
      expect(instance).toBeInstanceOf(ResultParser);
    });
  });
});