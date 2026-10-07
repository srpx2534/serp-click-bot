/**
 * ResultParser
 *
 * SERP HTML'lerini parse edip yapılandırılmış veriye dönüştüren,
 * tek dosyalık production-oriented parser.
 *
 * Tasarım hedefleri:
 * - Google + Bing desteği
 * - DOM-aware parsing
 * - Duplicate result protection
 * - Structured data / JSON-LD extraction
 * - Partial failure recovery
 * - Deterministic result ordering
 * - Robust URL normalization
 * - Engine auto detection
 * - Memory-conscious processing
 * - Tek dosya / tek public API
 *
 * Not:
 * Bu modül bir HTML parser kütüphanesi gerektirir.
 * Node.js ortamında "cheerio" kullanılması önerilir.
 */

import { Logger } from '../utils/logger';
import * as cheerio from 'cheerio';

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export type ParseEngine = 'google' | 'bing' | 'auto';

export type ResultType =
  | 'organic'
  | 'ad'
  | 'featured'
  | 'video'
  | 'image'
  | 'news'
  | 'knowledge'
  | 'related';

export interface ParsedResult {
  position: number;
  title: string;
  url: string;
  description: string;
  type: ResultType;

  metadata: {
    publishedAt?: Date;
    siteName?: string;
    rating?: number;
    reviewCount?: number;
    imageUrl?: string;
    videoDuration?: string;
    richSnippetType?: string;

    /**
     * Engine tarafından sağlanan ek metadata.
     * Gelecekte yeni SERP özellikleri eklemek için kullanılır.
     */
    [key: string]: unknown;
  };
}

export interface ParseResult {
  success: boolean;
  results: ParsedResult[];

  totalResults?: number;

  duration: number;

  /**
   * Gerçekte kullanılan engine.
   */
  engine: ParseEngine;

  errors: ParseError[];

  extra: {
    query?: string;

    relatedSearches?: string[];

    featuredSnippet?: {
      title: string;
      content: string;
      url: string;
    };

    knowledgePanel?: Record<string, string>;

    structuredData?: unknown[];
  };
}

export interface ParseError {
  code: string;
  message: string;
  element?: string;
  fatal: boolean;
}

export interface ParserConfig {
  maxResults: number;

  cleanHtml: boolean;

  parseStructuredData: boolean;

  extractRelated: boolean;

  extractFeatured: boolean;

  extractKnowledgePanel: boolean;

  /**
   * Aynı URL'nin birden fazla pattern tarafından yakalanmasını engeller.
   */
  deduplicateResults: boolean;

  /**
   * URL tracking parametrelerini temizler.
   */
  normalizeUrls: boolean;

  /**
   * Empty title/url gibi geçersiz sonuçları atar.
   */
  strictValidation: boolean;
}

const DEFAULT_CONFIG: Readonly<ParserConfig> = {
  maxResults: 100,

  cleanHtml: true,

  parseStructuredData: true,

  extractRelated: true,

  extractFeatured: true,

  extractKnowledgePanel: true,

  deduplicateResults: true,

  normalizeUrls: true,

  strictValidation: true,
};

/* -------------------------------------------------------------------------- */
/* Errors                                                                     */
/* -------------------------------------------------------------------------- */

export class ParseException extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ParseException';

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ParseException);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Internal Types                                                             */
/* -------------------------------------------------------------------------- */

interface EngineParseResult {
  results: ParsedResult[];
  totalResults?: number;
}

interface StructuredDataResult {
  data: unknown[];
}

/* -------------------------------------------------------------------------- */
/* Main Class                                                                 */
/* -------------------------------------------------------------------------- */

export class ResultParser {
  private readonly logger: Logger;
  private readonly config: ParserConfig;

  constructor(
    logger?: Logger,
    config?: Partial<ParserConfig>,
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

  public parse(
    html: string,
    engine: ParseEngine = 'auto',
  ): ParseResult {
    const startedAt = Date.now();
    const errors: ParseError[] = [];

    this.validateInput(html);

    this.logger.debug('Starting SERP parse', {
      htmlLength: html.length,
      requestedEngine: engine,
    });

    try {
      /*
       * Structured data extraction cleaning'den ÖNCE yapılır.
       * Böylece JSON-LD script'leri kaybolmaz.
       */
      const structuredData = this.config.parseStructuredData
        ? this.extractStructuredData(html, errors)
        : { data: [] };

      const detectedEngine =
        engine === 'auto'
          ? this.detectEngine(html)
          : engine;

      if (detectedEngine === 'auto') {
        throw new ParseException(
          'Could not detect supported search engine',
          'ENGINE_DETECTION_FAILED',
        );
      }

      const document = this.createDocument(html);

      let parsed: EngineParseResult;

      if (detectedEngine === 'google') {
        parsed = this.parseGoogle(document, errors);
      } else {
        parsed = this.parseBing(document, errors);
      }

      let results = parsed.results;

      if (this.config.deduplicateResults) {
        results = this.deduplicateResults(results);
      }

      results = this.normalizeResultPositions(results);

      if (results.length > this.config.maxResults) {
        results = results.slice(0, this.config.maxResults);
      }

      const extra = this.extractExtraData(
        document,
        detectedEngine,
        structuredData,
        errors,
      );

      const duration = Date.now() - startedAt;

      const fatalErrors = errors.filter(error => error.fatal);

      const result: ParseResult = {
        success: fatalErrors.length === 0,
        results,
        totalResults: parsed.totalResults,
        duration,
        engine: detectedEngine,
        errors,
        extra,
      };

      this.logger.info('SERP parse completed', {
        engine: detectedEngine,
        resultCount: results.length,
        duration,
        errorCount: errors.length,
        fatalErrorCount: fatalErrors.length,
      });

      return result;
    } catch (error) {
      const duration = Date.now() - startedAt;

      if (error instanceof ParseException) {
        throw error;
      }

      this.logger.error('SERP parse failed', {
        error:
          error instanceof Error
            ? error.message
            : 'Unknown error',
        duration,
      });

      throw new ParseException(
        `Parse failed: ${
          error instanceof Error
            ? error.message
            : 'Unknown error'
        }`,
        'PARSE_FAILED',
        error,
      );
    }
  }

  /**
   * Toplu parse.
   *
   * Bilinçli olarak synchronous tutulmuştur:
   * public API mevcut kodla uyumludur.
   */
  public parseBatch(
    htmls: Array<{
      html: string;
      engine?: ParseEngine;
    }>,
  ): ParseResult[] {
    if (!Array.isArray(htmls)) {
      throw new TypeError('htmls must be an array');
    }

    return htmls.map(({ html, engine }) => {
      try {
        return this.parse(html, engine);
      } catch (error) {
        this.logger.error('Batch item parse failed', {
          error:
            error instanceof Error
              ? error.message
              : 'Unknown error',
        });

        return {
          success: false,
          results: [],
          duration: 0,
          engine: engine || 'auto',
          errors: [
            {
              code: 'BATCH_ITEM_FAILED',
              message:
                error instanceof Error
                  ? error.message
                  : 'Unknown error',
              fatal: true,
            },
          ],
          extra: {},
        };
      }
    });
  }

  /* ------------------------------------------------------------------------ */
  /* Validation                                                               */
  /* ------------------------------------------------------------------------ */

  private validateConfig(): void {
    if (
      !Number.isInteger(this.config.maxResults) ||
      this.config.maxResults <= 0
    ) {
      throw new TypeError(
        'ParserConfig.maxResults must be a positive integer',
      );
    }
  }

  private validateInput(html: string): void {
    if (typeof html !== 'string') {
      throw new TypeError('HTML must be a string');
    }

    if (!html.trim()) {
      throw new ParseException(
        'HTML input is empty',
        'EMPTY_HTML',
      );
    }
  }

  /* ------------------------------------------------------------------------ */
  /* DOM                                                                      */
  /* ------------------------------------------------------------------------ */

  private createDocument(html: string): cheerio.CheerioAPI {
    /*
     * Cheerio native HTML parsing:
     * - nested element problemini regex'e göre çok daha güvenilir çözer
     * - entity decoding sağlar
     * - selector bazlı extraction sağlar
     */
    return cheerio.load(
      this.config.cleanHtml
        ? this.cleanHtml(html)
        : html,
      {
        decodeEntities: true,
      },
    );
  }

  private cleanHtml(html: string): string {
    /*
     * Scriptleri burada kaldırmıyoruz.
     * JSON-LD extraction parse() öncesinde yapılıyor.
     *
     * DOM parser zaten whitespace ve entity normalization
     * işlemlerinin büyük kısmını güvenli biçimde yapabilir.
     */
    return html
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/\u0000/g, ' ');
  }

  /* ------------------------------------------------------------------------ */
  /* Engine Detection                                                         */
  /* ------------------------------------------------------------------------ */

  private detectEngine(html: string): ParseEngine {
    const lower = html.toLowerCase();

    const googleScore = [
      /google\./i,
      /id=["']search["']/i,
      /id=["']rso["']/i,
      /data-hveid/i,
      /class=["'][^"']*\bg\b[^"']*["']/i,
      /class=["'][^"']*MjjYud[^"']*["']/i,
    ].reduce(
      (score, pattern) =>
        score + (pattern.test(lower) ? 1 : 0),
      0,
    );

    const bingScore = [
      /bing\.com/i,
      /id=["']b_results["']/i,
      /class=["'][^"']*\bb_algo\b[^"']*["']/i,
      /class=["'][^"']*\bb_caption\b[^"']*["']/i,
    ].reduce(
      (score, pattern) =>
        score + (pattern.test(lower) ? 1 : 0),
      0,
    );

    if (googleScore === 0 && bingScore === 0) {
      throw new ParseException(
        'Could not detect Google or Bing SERP',
        'ENGINE_DETECTION_FAILED',
      );
    }

    if (googleScore === bingScore) {
      /*
       * Ambiguous durumda Google'a sessizce düşmek yerine
       * signature'ı daha güçlü olan DOM selector'larına bakıyoruz.
       */
      const hasGoogleDom =
        /id=["']rso["']/i.test(html) ||
        /MjjYud/i.test(html);

      const hasBingDom =
        /id=["']b_results["']/i.test(html) ||
        /\bb_algo\b/i.test(html);

      if (hasGoogleDom && !hasBingDom) {
        return 'google';
      }

      if (hasBingDom && !hasGoogleDom) {
        return 'bing';
      }

      throw new ParseException(
        'Search engine detection is ambiguous',
        'ENGINE_DETECTION_AMBIGUOUS',
      );
    }

    return googleScore > bingScore
      ? 'google'
      : 'bing';
  }

  /* ------------------------------------------------------------------------ */
  /* Google                                                                   */
  /* ------------------------------------------------------------------------ */

  private parseGoogle(
    $: cheerio.CheerioAPI,
    errors: ParseError[],
  ): EngineParseResult {
    const results: ParsedResult[] = [];

    this.extractGoogleOrganic($, results, errors);

    if (results.length < this.config.maxResults) {
      this.extractGoogleAds($, results, errors);
    }

    if (results.length < this.config.maxResults) {
      this.extractGoogleVideos($, results, errors);
    }

    const totalResults =
      this.extractGoogleTotalResults($);

    return {
      results,
      totalResults,
    };
  }

  private extractGoogleOrganic(
    $: cheerio.CheerioAPI,
    results: ParsedResult[],
    errors: ParseError[],
  ): void {
    /*
     * Google'ın DOM yapısı zamanla değişebilir.
     * Bu nedenle birden fazla selector fallback olarak kullanılır.
     */
    const selectors = [
      '#search .MjjYud',
      '#rso .MjjYud',
      '#search div.g',
      '#rso div.g',
    ];

    const seenNodes = new Set<unknown>();

    for (const selector of selectors) {
      $(selector).each((_, element) => {
        /*
         * Aynı node'u ikinci selector ile tekrar parse etmiyoruz.
         */
        if (seenNodes.has(element)) {
          return;
        }

        seenNodes.add(element);

        try {
          const parsed =
            this.parseGoogleResultElement(
              $,
              element,
            );

          if (!parsed) {
            return;
          }

          results.push({
            ...parsed,
            position: 0,
            type: 'organic',
          });
        } catch (error) {
          errors.push({
            code: 'GOOGLE_ORGANIC_PARSE_ERROR',
            message:
              error instanceof Error
                ? error.message
                : 'Unknown error',
            element: selector,
            fatal: false,
          });
        }
      });

      if (results.length >= this.config.maxResults) {
        break;
      }
    }
  }

  private parseGoogleResultElement(
    $: cheerio.CheerioAPI,
    element: cheerio.Element,
  ): Omit<ParsedResult, 'position' | 'type'> | null {
    const root = $(element);

    const titleElement = root.find('h3').first();

    if (!titleElement.length) {
      return null;
    }

    const title = this.cleanText(
      titleElement.text(),
    );

    if (!title) {
      return null;
    }

    /*
     * Önce h3'ün parent anchor'ı,
     * sonra root içindeki ilk anchor.
     */
    let anchor = titleElement.closest('a');

    if (!anchor.length) {
      anchor = root.find('a[href]').first();
    }

    if (!anchor.length) {
      return null;
    }

    const rawUrl =
      anchor.attr('href') || '';

    const url = this.config.normalizeUrls
      ? this.normalizeUrl(rawUrl)
      : this.validateUrl(rawUrl);

    if (!url) {
      return null;
    }

    const description = this.extractGoogleDescription(
      $,
      root,
    );

    const metadata =
      this.extractGoogleResultMetadata(
        $,
        root,
      );

    return {
      title,
      url,
      description,
      metadata,
    };
  }

  private extractGoogleDescription(
    $: cheerio.CheerioAPI,
    root: cheerio.Cheerio<any>,
  ): string {
    const selectors = [
      '.VwiC3b',
      '.s3v94d',
      '.IsZvec',
      '[data-sncf]',
    ];

    for (const selector of selectors) {
      const element = root.find(selector).first();

      if (element.length) {
        const text = this.cleanText(
          element.text(),
        );

        if (text) {
          return text;
        }
      }
    }

    return '';
  }

  private extractGoogleResultMetadata(
    $: cheerio.CheerioAPI,
    root: cheerio.Cheerio<any>,
  ): ParsedResult['metadata'] {
    const metadata: ParsedResult['metadata'] = {};

    const siteNameSelectors = [
      '.VuuXrf',
      '.TbwUpd',
      '[data-snhf]',
    ];

    for (const selector of siteNameSelectors) {
      const element = root.find(selector).first();

      if (element.length) {
        const text = this.cleanText(
          element.text(),
        );

        if (text) {
          metadata.siteName = text;
          break;
        }
      }
    }

    const ratingText = this.cleanText(
      root.text(),
    );

    const ratingMatch = ratingText.match(
      /\b([0-5](?:[.,]\d{1,2})?)\s*(?:★|stars?)\b/i,
    );

    if (ratingMatch) {
      const rating = Number(
        ratingMatch[1].replace(',', '.'),
      );

      if (
        Number.isFinite(rating) &&
        rating >= 0 &&
        rating <= 5
      ) {
        metadata.rating = rating;
      }
    }

    const reviewMatch = ratingText.match(
      /\b([\d.,]+)\s*(?:reviews?|yorum)\b/i,
    );

    if (reviewMatch) {
      const count = this.parseNumber(
        reviewMatch[1],
      );

      if (count !== undefined) {
        metadata.reviewCount = count;
      }
    }

    const date = this.extractDate(
      ratingText,
    );

    if (date) {
      metadata.publishedAt = date;
    }

    return metadata;
  }

  private extractGoogleAds(
    $: cheerio.CheerioAPI,
    results: ParsedResult[],
    errors: ParseError[],
  ): void {
    const selectors = [
      '[data-text-ad="1"]',
      '.uEierd',
      '[aria-label*="Ad"]',
    ];

    const seen = new Set<string>();

    for (const selector of selectors) {
      $(selector).each((_, element) => {
        try {
          const root = $(element);

          const titleElement =
            root.find('h3').first();

          const anchor =
            root.find('a[href]').first();

          if (
            !titleElement.length ||
            !anchor.length
          ) {
            return;
          }

          const title = this.cleanText(
            titleElement.text(),
          );

          const rawUrl =
            anchor.attr('href') || '';

          const url =
            this.config.normalizeUrls
              ? this.normalizeUrl(rawUrl)
              : this.validateUrl(rawUrl);

          if (!title || !url) {
            return;
          }

          const key =
            `${title}|${url}`.toLowerCase();

          if (seen.has(key)) {
            return;
          }

          seen.add(key);

          results.push({
            position: 0,
            title,
            url,
            description: '',
            type: 'ad',
            metadata: {},
          });
        } catch (error) {
          errors.push({
            code: 'GOOGLE_AD_PARSE_ERROR',
            message:
              error instanceof Error
                ? error.message
                : 'Unknown error',
            element: selector,
            fatal: false,
          });
        }
      });
    }
  }

  private extractGoogleVideos(
    $: cheerio.CheerioAPI,
    results: ParsedResult[],
    errors: ParseError[],
  ): void {
    /*
     * Google video SERP markup değişken olduğundan
     * video elementinin kendisine bağımlı değiliz.
     */
    const selectors = [
      '[data-vid]',
      '.MjjYud:has(video)',
      '[role="main"] video',
    ];

    const seen = new Set<string>();

    for (const selector of selectors) {
      $(selector).each((_, element) => {
        try {
          const root = $(element);

          const titleElement =
            root.find('h3').first();

          const anchor =
            root.find('a[href]').first();

          if (
            !titleElement.length ||
            !anchor.length
          ) {
            return;
          }

          const title = this.cleanText(
            titleElement.text(),
          );

          const rawUrl =
            anchor.attr('href') || '';

          const url =
            this.config.normalizeUrls
              ? this.normalizeUrl(rawUrl)
              : this.validateUrl(rawUrl);

          if (!title || !url) {
            return;
          }

          if (seen.has(url)) {
            return;
          }

          seen.add(url);

          const duration =
            this.extractVideoDuration(
              root.text(),
            );

          results.push({
            position: 0,
            title,
            url,
            description: '',
            type: 'video',
            metadata: {
              ...(duration
                ? { videoDuration: duration }
                : {}),
            },
          });
        } catch (error) {
          errors.push({
            code: 'GOOGLE_VIDEO_PARSE_ERROR',
            message:
              error instanceof Error
                ? error.message
                : 'Unknown error',
            element: selector,
            fatal: false,
          });
        }
      });
    }
  }

  private extractGoogleTotalResults(
    $: cheerio.CheerioAPI,
  ): number | undefined {
    const selectors = [
      '#result-stats',
      '#result-stats span',
    ];

    for (const selector of selectors) {
      const element = $(selector).first();

      if (!element.length) {
        continue;
      }

      const text = this.cleanText(
        element.text(),
      );

      const number = this.parseNumberFromText(
        text,
      );

      if (number !== undefined) {
        return number;
      }
    }

    return undefined;
  }

  /* ------------------------------------------------------------------------ */
  /* Bing                                                                     */
  /* ------------------------------------------------------------------------ */

  private parseBing(
    $: cheerio.CheerioAPI,
    errors: ParseError[],
  ): EngineParseResult {
    const results: ParsedResult[] = [];

    this.extractBingOrganic(
      $,
      results,
      errors,
    );

    return {
      results,
      totalResults:
        this.extractBingTotalResults($),
    };
  }

  private extractBingOrganic(
    $: cheerio.CheerioAPI,
    results: ParsedResult[],
    errors: ParseError[],
  ): void {
    const selectors = [
      '#b_results > li.b_algo',
      '#b_results .b_algo',
      'li.b_algo',
    ];

    const seen = new Set<string>();

    for (const selector of selectors) {
      $(selector).each((_, element) => {
        try {
          const root = $(element);

          const anchor =
            root.find('h2 a[href]').first();

          if (!anchor.length) {
            return;
          }

          const title = this.cleanText(
            anchor.text(),
          );

          const rawUrl =
            anchor.attr('href') || '';

          const url =
            this.config.normalizeUrls
              ? this.normalizeUrl(rawUrl)
              : this.validateUrl(rawUrl);

          if (!title || !url) {
            return;
          }

          if (seen.has(url)) {
            return;
          }

          seen.add(url);

          const description =
            this.extractBingDescription(root);

          const metadata =
            this.extractBingMetadata(root);

          results.push({
            position: 0,
            title,
            url,
            description,
            type: 'organic',
            metadata,
          });
        } catch (error) {
          errors.push({
            code: 'BING_ORGANIC_PARSE_ERROR',
            message:
              error instanceof Error
                ? error.message
                : 'Unknown error',
            element: selector,
            fatal: false,
          });
        }
      });

      if (results.length >= this.config.maxResults) {
        break;
      }
    }
  }

  private extractBingDescription(
    root: cheerio.Cheerio<any>,
  ): string {
    const selectors = [
      '.b_caption p',
      '.b_caption',
    ];

    for (const selector of selectors) {
      const element = root.find(selector).first();

      if (element.length) {
        const text = this.cleanText(
          element.text(),
        );

        if (text) {
          return text;
        }
      }
    }

    return '';
  }

  private extractBingMetadata(
    root: cheerio.Cheerio<any>,
  ): ParsedResult['metadata'] {
    const metadata: ParsedResult['metadata'] = {};

    const text = this.cleanText(
      root.text(),
    );

    const date = this.extractDate(text);

    if (date) {
      metadata.publishedAt = date;
    }

    return metadata;
  }

  private extractBingTotalResults(
    $: cheerio.CheerioAPI,
  ): number | undefined {
    const selectors = [
      '.sb_count',
      '#b_tween .sb_count',
    ];

    for (const selector of selectors) {
      const element = $(selector).first();

      if (!element.length) {
        continue;
      }

      const number = this.parseNumberFromText(
        this.cleanText(element.text()),
      );

      if (number !== undefined) {
        return number;
      }
    }

    return undefined;
  }

  /* ------------------------------------------------------------------------ */
  /* Structured Data                                                          */
  /* ------------------------------------------------------------------------ */

  private extractStructuredData(
    html: string,
    errors: ParseError[],
  ): StructuredDataResult {
    const data: unknown[] = [];

    try {
      const $ = cheerio.load(html, {
        decodeEntities: true,
      });

      $('script[type="application/ld+json"]').each(
        (_, element) => {
          const raw = $(element).html();

          if (!raw) {
            return;
          }

          try {
            const parsed = JSON.parse(
              raw.trim(),
            );

            if (Array.isArray(parsed)) {
              data.push(...parsed);
            } else {
              data.push(parsed);
            }
          } catch (error) {
            errors.push({
              code: 'JSON_LD_PARSE_ERROR',
              message:
                error instanceof Error
                  ? error.message
                  : 'Invalid JSON-LD',
              element:
                'script[type="application/ld+json"]',
              fatal: false,
            });
          }
        },
      );
    } catch (error) {
      errors.push({
        code: 'STRUCTURED_DATA_EXTRACTION_ERROR',
        message:
          error instanceof Error
            ? error.message
            : 'Unknown error',
        fatal: false,
      });
    }

    return { data };
  }

  /* ------------------------------------------------------------------------ */
  /* Extra Data                                                               */
  /* ------------------------------------------------------------------------ */

  private extractExtraData(
    $: cheerio.CheerioAPI,
    engine: ParseEngine,
    structuredData: StructuredDataResult,
    errors: ParseError[],
  ): ParseResult['extra'] {
    const extra: ParseResult['extra'] = {};

    try {
      extra.query =
        this.extractQuery($);
    } catch (error) {
      errors.push({
        code: 'QUERY_EXTRACTION_ERROR',
        message:
          error instanceof Error
            ? error.message
            : 'Unknown error',
        fatal: false,
      });
    }

    if (this.config.extractRelated) {
      extra.relatedSearches =
        this.extractRelatedSearches(
          $,
          engine,
        );
    }

    if (this.config.extractFeatured) {
      extra.featuredSnippet =
        this.extractFeaturedSnippet(
          $,
          engine,
        );
    }

    if (
      this.config.extractKnowledgePanel &&
      engine === 'google'
    ) {
      extra.knowledgePanel =
        this.extractKnowledgePanel($);
    }

    if (
      this.config.parseStructuredData &&
      structuredData.data.length > 0
    ) {
      extra.structuredData =
        structuredData.data;
    }

    return extra;
  }

  private extractQuery(
    $: cheerio.CheerioAPI,
  ): string | undefined {
    const inputSelectors = [
      'input[name="q"]',
      'textarea[name="q"]',
    ];

    for (const selector of inputSelectors) {
      const value =
        $(selector).first().attr('value') ||
        $(selector).first().text();

      if (value) {
        return this.cleanText(
          value,
        );
      }
    }

    return undefined;
  }

  private extractRelatedSearches(
    $: cheerio.CheerioAPI,
    engine: ParseEngine,
  ): string[] {
    if (engine !== 'google') {
      return [];
    }

    const selectors = [
      '.related-question-pair',
      '[data-q]',
    ];

    const related: string[] = [];
    const seen = new Set<string>();

    for (const selector of selectors) {
      $(selector).each((_, element) => {
        const text = this.cleanText(
          $(element).text(),
        );

        if (
          text &&
          !seen.has(text.toLowerCase())
        ) {
          seen.add(text.toLowerCase());
          related.push(text);
        }
      });
    }

    return related;
  }

  private extractFeaturedSnippet(
    $: cheerio.CheerioAPI,
    engine: ParseEngine,
  ): ParseResult['extra']['featuredSnippet'] {
    if (engine !== 'google') {
      return undefined;
    }

    const selectors = [
      '.featured-snippet',
      '[data-attrid="wa:/description"]',
      '.xpdopen',
    ];

    for (const selector of selectors) {
      const root = $(selector).first();

      if (!root.length) {
        continue;
      }

      const title =
        this.cleanText(
          root.find('h3').first().text(),
        );

      const content =
        this.cleanText(
          root
            .find(
              '[data-sncf], .hgKElc, .VwiC3b',
            )
            .first()
            .text(),
        );

      const href =
        root.find('a[href]')
          .first()
          .attr('href');

      const url = href
        ? this.normalizeUrl(href)
        : null;

      if (title && content) {
        return {
          title,
          content,
          url: url || '',
        };
      }
    }

    return undefined;
  }

  private extractKnowledgePanel(
    $: cheerio.CheerioAPI,
  ): Record<string, string> | undefined {
    const panel: Record<string, string> = {};

    const selectors = [
      '[class*="knowledge-panel"]',
      '[data-attrid]',
    ];

    for (const selector of selectors) {
      $(selector).each((_, element) => {
        const root = $(element);

        const label =
          root
            .find(
              '.label, [data-attrid="title"]',
            )
            .first()
            .text();

        const value =
          root
            .find(
              '.value, [data-attrid="content"]',
            )
            .first()
            .text();

        const key = this.cleanText(label);
        const cleanValue =
          this.cleanText(value);

        if (key && cleanValue) {
          panel[key] = cleanValue;
        }
      });
    }

    return Object.keys(panel).length > 0
      ? panel
      : undefined;
  }

  /* ------------------------------------------------------------------------ */
  /* Result Normalization                                                     */
  /* ------------------------------------------------------------------------ */

  private deduplicateResults(
    results: ParsedResult[],
  ): ParsedResult[] {
    const seen = new Set<string>();
    const unique: ParsedResult[] = [];

    for (const result of results) {
      const key = this.resultIdentity(result);

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      unique.push(result);
    }

    return unique;
  }

  private resultIdentity(
    result: ParsedResult,
  ): string {
    const normalizedUrl =
      result.url
        .toLowerCase()
        .replace(/\/+$/, '');

    return `${result.type}|${normalizedUrl}`;
  }

  private normalizeResultPositions(
    results: ParsedResult[],
  ): ParsedResult[] {
    /*
     * Position yalnızca organic sonuçlar için anlamlıdır.
     * Ads / features için 0 kullanılır.
     */
    let organicPosition = 0;

    return results.map(result => {
      if (result.type === 'organic') {
        organicPosition += 1;

        return {
          ...result,
          position: organicPosition,
        };
      }

      return {
        ...result,
        position: 0,
      };
    });
  }

  /* ------------------------------------------------------------------------ */
  /* URL                                                                      */
  /* ------------------------------------------------------------------------ */

  private normalizeUrl(
    rawUrl: string,
  ): string | null {
    if (!rawUrl) {
      return null;
    }

    let url = rawUrl.trim();

    if (!url) {
      return null;
    }

    /*
     * Google redirect:
     * /url?q=https://example.com
     */
    if (
      url.startsWith('/url?') ||
      url.startsWith('/url#')
    ) {
      try {
        const parsed = new URL(
          url,
          'https://www.google.com',
        );

        const target =
          parsed.searchParams.get('q') ||
          parsed.searchParams.get('url');

        if (target) {
          url = target;
        }
      } catch {
        return null;
      }
    }

    if (url.startsWith('//')) {
      url = `https:${url}`;
    }

    /*
     * SERP relative URL'lerini dışarıya vermiyoruz.
     */
    if (url.startsWith('/')) {
      return null;
    }

    try {
      const parsed = new URL(url);

      if (
        parsed.protocol !== 'http:' &&
        parsed.protocol !== 'https:'
      ) {
        return null;
      }

      /*
       * Tracking parameters.
       */
      const trackingPrefixes = [
        'utm_',
        'gclid',
        'dclid',
        'fbclid',
        'msclkid',
      ];

      for (const [key] of parsed.searchParams) {
        if (
          trackingPrefixes.some(prefix =>
            key.toLowerCase() === prefix ||
            key.toLowerCase().startsWith(prefix),
          )
        ) {
          parsed.searchParams.delete(key);
        }
      }

      /*
       * Google/Bing specific navigation params.
       */
      parsed.searchParams.delete('sa');
      parsed.searchParams.delete('ved');
      parsed.searchParams.delete('usg');

      /*
       * Hash SERP sonucu açısından genellikle tracking/navigation
       * bilgisidir.
       */
      parsed.hash = '';

      return parsed.toString();
    } catch {
      return null;
    }
  }

  private validateUrl(
    url: string,
  ): string | null {
    try {
      const parsed = new URL(url);

      if (
        parsed.protocol !== 'http:' &&
        parsed.protocol !== 'https:'
      ) {
        return null;
      }

      return parsed.toString();
    } catch {
      return null;
    }
  }

  /* ------------------------------------------------------------------------ */
  /* Text / Date / Number Utilities                                           */
  /* ------------------------------------------------------------------------ */

  private cleanText(
    value: string,
  ): string {
    return value
      .replace(/\s+/g, ' ')
      .trim();
  }

  private extractDate(
    text: string,
  ): Date | undefined {
    const patterns = [
      /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}\b/i,

      /\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}\b/i,

      /\b\d{4}-\d{2}-\d{2}\b/,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);

      if (!match) {
        continue;
      }

      const date = new Date(match[0]);

      if (!Number.isNaN(date.getTime())) {
        return date;
      }
    }

    return undefined;
  }

  private extractVideoDuration(
    text: string,
  ): string | undefined {
    const match = text.match(
      /\b(?:\d{1,2}:)?\d{1,2}:\d{2}\b/,
    );

    return match?.[0];
  }

  private parseNumber(
    value: string,
  ): number | undefined {
    const normalized = value
      .replace(/[^\d]/g, '');

    if (!normalized) {
      return undefined;
    }

    const number = Number(normalized);

    return Number.isFinite(number)
      ? number
      : undefined;
  }

  private parseNumberFromText(
    text: string,
  ): number | undefined {
    /*
     * Öncelik büyük sayı formatlarına verilir.
     */
    const matches = text.match(
      /\b\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?\b|\b\d+\b/g,
    );

    if (!matches) {
      return undefined;
    }

    for (const match of matches) {
      const number = this.parseNumber(match);

      if (
        number !== undefined &&
        number > 0
      ) {
        return number;
      }
    }

    return undefined;
  }
}

/* -------------------------------------------------------------------------- */
/* Singleton / Factory                                                       */
/* -------------------------------------------------------------------------- */

let parserInstance: ResultParser | null = null;

export function createResultParser(
  logger?: Logger,
  config?: Partial<ParserConfig>,
): ResultParser {
  return new ResultParser(
    logger,
    config,
  );
}

export function getResultParser(): ResultParser | null {
  return parserInstance;
}

export function setResultParser(
  parser: ResultParser,
): void {
  if (!(parser instanceof ResultParser)) {
    throw new TypeError(
      'parser must be an instance of ResultParser',
    );
  }

  parserInstance = parser;
}

export default ResultParser;
