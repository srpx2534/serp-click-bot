/**
 * FingerprintGenerator
 *
 * Gelişmiş, gerçekçi ve tutarlı browser fingerprint üretimi.
 * 2000+ benzersiz fingerprint (1000 mobil, 1000 desktop).
 *
 * Özellikler:
 * - Deterministic RNG (seed-based, test edilebilir)
 * - Gerçekçi cihaz profilleri (iOS, Android, Windows, macOS, Linux)
 * - WebGL/Canvas/TLS/HTTP2 fingerprinting
 * - 50+ browser özelliği
 * - Path traversal koruması
 * - Detaylı validasyon
 *
 * @version 2.0.0
 */

import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

import {
  FingerprintData,
  FingerprintCollection,
  FingerprintType,
  WebGLInfo,
  CanvasRender,
  BrowserPlugin,
  MimeType,
  TLSFingerprint,
  HTTP2Fingerprint,
  BatteryInfo,
  NetworkInfo,
  SpeechVoice,
  ScreenInfo,
  NavigatorInfo,
  WindowInfo,
  DocumentInfo,
  LocationInfo,
  HistoryInfo,
  MediaCapabilities,
  TouchSupportInfo,
  KeyboardInfo,
  PointerInfo,
  GamepadInfo,
  VRInfo,
  MediaSessionInfo,
  WakeLockInfo,
  DeviceOrientationInfo,
  DeviceMotionInfo,
  ProximityInfo,
  AmbientLightInfo,
  NetworkConnectionInfo,
  CredentialInfo,
  PermissionsInfo,
  PaymentInfo,
  WebShareInfo,
  ContactInfo,
  ClipboardInfo,
  MediaDevicesInfo,
} from '../types';

/* =========================================================
 * TYPES & INTERFACES
 * ======================================================= */

interface Logger {
  debug(message: string, context?: unknown): void;
  info(message: string, context?: unknown): void;
  warn(message: string, context?: unknown): void;
  error(message: string, context?: unknown): void;
}

interface GeneratorOptions {
  seed?: number | string;
  resetBeforeGenerate?: boolean;
}

interface SyntheticProfile {
  type: 'mobile' | 'desktop';
  fingerprintType: FingerprintType;
  browser: 'chrome' | 'firefox' | 'safari' | 'edge' | 'samsung';
  os: 'android' | 'ios' | 'windows' | 'macos' | 'linux';
  model: string;
  viewport: { width: number; height: number };
  screen: { width: number; height: number; dpr: number };
  cpuCores: number;
  memory: number;
  language: string;
  languages: string[];
  timezone: string;
  platform: string;
  vendor: string;
  gpuVendor: string;
  gpuRenderer: string;
}

/* =========================================================
 * SINGLETON INSTANCE
 * ======================================================= */

let instance: FingerprintGenerator | null = null;

/**
 * FingerprintGenerator singleton getter
 */
export function getFingerprintGenerator(
  dataDir?: string,
  logger?: Logger,
): FingerprintGenerator {
  if (!instance) {
    instance = new FingerprintGenerator(dataDir, logger);
  }
  return instance;
}

/**
 * Reset singleton instance (for testing)
 */
export function resetFingerprintGenerator(): void {
  instance = null;
}

/* =========================================================
 * MAIN CLASS
 * ======================================================= */

export class FingerprintGenerator {
  private readonly version = '2.0.0';
  private fingerprints: FingerprintCollection;
  private readonly dataDir: string;
  private readonly logger?: Logger;
  private rngState: number;

  constructor(
    dataDir: string = './data/fingerprints',
    logger?: Logger,
    options: GeneratorOptions = {},
  ) {
    this.dataDir = dataDir;
    this.logger = logger;
    this.rngState = this.createSeed(options.seed);
    this.fingerprints = this.initializeCollection();
    this.ensureDirectoryExists();
  }

  /* =======================================================
   * INITIALIZATION
   * ===================================================== */

  private initializeCollection(): FingerprintCollection {
    return {
      fingerprints: [],
      metadata: {
        createdAt: new Date(),
        totalCount: 0,
        mobileCount: 0,
        desktopCount: 0,
        version: this.version,
      },
    };
  }

  private ensureDirectoryExists(): void {
    try {
      fs.mkdirSync(this.dataDir, { recursive: true });
    } catch (error) {
      this.logger?.error('Failed to create fingerprint directory', {
        dataDir: this.dataDir,
        error,
      });
      throw error;
    }
  }

  /* =======================================================
   * SEEDED RNG (Mulberry32)
   * ===================================================== */

  private createSeed(seed?: number | string): number {
    if (typeof seed === 'number' && Number.isFinite(seed)) {
      return Math.abs(Math.floor(seed)) || 1;
    }

    if (typeof seed === 'string' && seed.length > 0) {
      const hash = createHash('sha256').update(seed).digest();
      return (((hash[0] << 24) | (hash[1] << 16) | (hash[2] << 8) | hash[3]) >>> 0) || 1;
    }

    return Date.now() >>> 0;
  }

  private random(): number {
    let t = (this.rngState += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  private randomInt(min: number, max: number): number {
    if (min > max) {
      throw new Error(`Invalid random range: ${min} > ${max}`);
    }
    return Math.floor(this.random() * (max - min + 1)) + min;
  }

  private pick<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new Error('Cannot pick from an empty collection');
    }
    return items[this.randomInt(0, items.length - 1)];
  }

  /* =======================================================
   * GENERATION
   * ===================================================== */

  public generate(
    mobileCount: number = 1000,
    desktopCount: number = 1000,
  ): {
    metadata: FingerprintCollection['metadata'];
    mobile: FingerprintData[];
    desktop: FingerprintData[];
  } {
    this.validateCount(mobileCount, 'mobileCount');
    this.validateCount(desktopCount, 'desktopCount');

    this.logger?.info('Generating synthetic fingerprint fixtures', {
      mobileCount,
      desktopCount,
    });

    // Reset collection for fresh generation
    this.fingerprints = this.initializeCollection();

    const mobile: FingerprintData[] = [];
    const desktop: FingerprintData[] = [];

    // Generate mobile fingerprints
    for (let i = 0; i < mobileCount; i++) {
      const fingerprint = this.createMobileFingerprint(i);
      mobile.push(fingerprint);
      this.fingerprints.fingerprints.push(fingerprint);
    }

    // Generate desktop fingerprints
    for (let i = 0; i < desktopCount; i++) {
      const fingerprint = this.createDesktopFingerprint(i);
      desktop.push(fingerprint);
      this.fingerprints.fingerprints.push(fingerprint);
    }

    this.shuffleArray(this.fingerprints.fingerprints);
    this.updateMetadata();

    this.logger?.info('Synthetic fingerprints generated', {
      total: this.fingerprints.metadata.totalCount,
      mobile: this.fingerprints.metadata.mobileCount,
      desktop: this.fingerprints.metadata.desktopCount,
    });

    return {
      metadata: { ...this.fingerprints.metadata },
      mobile,
      desktop,
    };
  }

  private validateCount(value: number, name: string): void {
    if (!Number.isInteger(value)) {
      throw new TypeError(`${name} must be an integer`);
    }
    if (value < 0) {
      throw new RangeError(`${name} cannot be negative`);
    }
    if (value > 100_000) {
      throw new RangeError(`${name} exceeds the safety limit of 100000`);
    }
  }

  /* =======================================================
   * PROFILE FACTORY
   * ===================================================== */

  private createMobileProfile(): SyntheticProfile {
    const fingerprintType = this.pick([
      FingerprintType.MOBILE_CHROME_ANDROID,
      FingerprintType.MOBILE_CHROME_IOS,
      FingerprintType.MOBILE_SAFARI_IOS,
      FingerprintType.MOBILE_FIREFOX_ANDROID,
      FingerprintType.MOBILE_SAMSUNG_ANDROID,
    ]);

    switch (fingerprintType) {
      case FingerprintType.MOBILE_SAFARI_IOS:
      case FingerprintType.MOBILE_CHROME_IOS:
        return {
          type: 'mobile',
          fingerprintType,
          browser: fingerprintType === FingerprintType.MOBILE_SAFARI_IOS ? 'safari' : 'chrome',
          os: 'ios',
          model: 'iPhone',
          viewport: { width: 390, height: 844 },
          screen: { width: 1179, height: 2556, dpr: 3 },
          cpuCores: 6,
          memory: 6,
          language: 'tr-TR',
          languages: ['tr-TR', 'tr', 'en-US', 'en'],
          timezone: 'Europe/Istanbul',
          platform: 'iPhone',
          vendor: 'Apple Computer, Inc.',
          gpuVendor: 'Apple Inc.',
          gpuRenderer: 'Apple GPU',
        };

      case FingerprintType.MOBILE_FIREFOX_ANDROID:
        return {
          type: 'mobile',
          fingerprintType,
          browser: 'firefox',
          os: 'android',
          model: 'Android Device',
          viewport: { width: 384, height: 824 },
          screen: { width: 1080, height: 2340, dpr: 2.8125 },
          cpuCores: 8,
          memory: 8,
          language: 'tr-TR',
          languages: ['tr-TR', 'tr', 'en-US', 'en'],
          timezone: 'Europe/Istanbul',
          platform: 'Android',
          vendor: '',
          gpuVendor: 'Qualcomm',
          gpuRenderer: 'Adreno',
        };

      case FingerprintType.MOBILE_SAMSUNG_ANDROID:
        return {
          type: 'mobile',
          fingerprintType,
          browser: 'samsung',
          os: 'android',
          model: 'Samsung Android Device',
          viewport: { width: 384, height: 824 },
          screen: { width: 1080, height: 2340, dpr: 2.8125 },
          cpuCores: 8,
          memory: 8,
          language: 'tr-TR',
          languages: ['tr-TR', 'tr', 'en-US', 'en'],
          timezone: 'Europe/Istanbul',
          platform: 'Linux armv8l',
          vendor: 'Samsung',
          gpuVendor: 'ARM',
          gpuRenderer: 'Mali',
        };

      default:
        return {
          type: 'mobile',
          fingerprintType,
          browser: 'chrome',
          os: 'android',
          model: 'Android Device',
          viewport: { width: 384, height: 824 },
          screen: { width: 1080, height: 2340, dpr: 2.8125 },
          cpuCores: 8,
          memory: 8,
          language: 'tr-TR',
          languages: ['tr-TR', 'tr', 'en-US', 'en'],
          timezone: 'Europe/Istanbul',
          platform: 'Linux armv8l',
          vendor: 'Google Inc.',
          gpuVendor: 'Qualcomm',
          gpuRenderer: 'Adreno',
        };
    }
  }

  private createDesktopProfile(): SyntheticProfile {
    const fingerprintType = this.pick([
      FingerprintType.CHROME_WIN,
      FingerprintType.CHROME_MAC,
      FingerprintType.CHROME_LINUX,
      FingerprintType.FIREFOX_WIN,
      FingerprintType.FIREFOX_MAC,
      FingerprintType.FIREFOX_LINUX,
      FingerprintType.SAFARI_MAC,
      FingerprintType.EDGE_WIN,
      FingerprintType.EDGE_MAC,
    ]);

    switch (fingerprintType) {
      case FingerprintType.CHROME_MAC:
        return this.createMacProfile(fingerprintType, 'chrome');
      case FingerprintType.SAFARI_MAC:
        return this.createMacProfile(fingerprintType, 'safari');
      case FingerprintType.EDGE_WIN:
        return this.createWindowsProfile(fingerprintType, 'edge');
      case FingerprintType.EDGE_MAC:
        return this.createMacProfile(fingerprintType, 'edge');
      case FingerprintType.FIREFOX_WIN:
        return this.createWindowsProfile(fingerprintType, 'firefox');
      case FingerprintType.FIREFOX_MAC:
        return this.createMacProfile(fingerprintType, 'firefox');
      case FingerprintType.FIREFOX_LINUX:
        return this.createLinuxProfile(fingerprintType, 'firefox');
      case FingerprintType.CHROME_LINUX:
        return this.createLinuxProfile(fingerprintType, 'chrome');
      default:
        return this.createWindowsProfile(fingerprintType, 'chrome');
    }
  }

  private createWindowsProfile(
    fingerprintType: FingerprintType,
    browser: 'chrome' | 'firefox' | 'edge',
  ): SyntheticProfile {
    return {
      type: 'desktop',
      fingerprintType,
      browser,
      os: 'windows',
      model: 'Windows Desktop',
      viewport: { width: 1366, height: 768 },
      screen: { width: 1920, height: 1080, dpr: 1 },
      cpuCores: 8,
      memory: 16,
      language: 'tr-TR',
      languages: ['tr-TR', 'tr', 'en-US', 'en'],
      timezone: 'Europe/Istanbul',
      platform: 'Win32',
      vendor: browser === 'edge' ? 'Microsoft Corporation' : browser === 'firefox' ? '' : 'Google Inc.',
      gpuVendor: 'NVIDIA Corporation',
      gpuRenderer: 'Generic Desktop GPU',
    };
  }

  private createMacProfile(
    fingerprintType: FingerprintType,
    browser: 'chrome' | 'firefox' | 'safari' | 'edge',
  ): SyntheticProfile {
    return {
      type: 'desktop',
      fingerprintType,
      browser,
      os: 'macos',
      model: 'Mac Desktop',
      viewport: { width: 1440, height: 900 },
      screen: { width: 2560, height: 1440, dpr: 2 },
      cpuCores: 8,
      memory: 16,
      language: 'tr-TR',
      languages: ['tr-TR', 'tr', 'en-US', 'en'],
      timezone: 'Europe/Istanbul',
      platform: 'MacIntel',
      vendor:
        browser === 'safari'
          ? 'Apple Computer, Inc.'
          : browser === 'edge'
            ? 'Microsoft Corporation'
            : browser === 'firefox'
              ? ''
              : 'Google Inc.',
      gpuVendor: 'Apple Inc.',
      gpuRenderer: 'Apple GPU',
    };
  }

  private createLinuxProfile(
    fingerprintType: FingerprintType,
    browser: 'chrome' | 'firefox',
  ): SyntheticProfile {
    return {
      type: 'desktop',
      fingerprintType,
      browser,
      os: 'linux',
      model: 'Linux Desktop',
      viewport: { width: 1920, height: 1080 },
      screen: { width: 1920, height: 1080, dpr: 1 },
      cpuCores: 8,
      memory: 16,
      language: 'tr-TR',
      languages: ['tr-TR', 'tr', 'en-US', 'en'],
      timezone: 'Europe/Istanbul',
      platform: 'Linux x86_64',
      vendor: browser === 'chrome' ? 'Google Inc.' : '',
      gpuVendor: 'Intel Inc.',
      gpuRenderer: 'Generic Linux GPU',
    };
  }

  /* =======================================================
   * FINGERPRINT CREATION
   * ===================================================== */

  private createMobileFingerprint(index: number): FingerprintData {
    const profile = this.createMobileProfile();
    const id = this.createFingerprintId('mobile', index, profile);
    const plugins = this.generateMobilePlugins();
    const mimeTypes = this.generateMobileMimeTypes();
    const speechVoices = this.generateSpeechVoices(true);

    const fingerprint: FingerprintData = {
      id,
      type: 'mobile',
      userAgent: this.getUserAgent(profile),
      viewport: profile.viewport,
      screenResolution: {
        width: profile.screen.width,
        height: profile.screen.height,
      },
      colorDepth: 24,
      pixelRatio: profile.screen.dpr,
      timezone: profile.timezone,
      language: profile.language,
      languages: [...profile.languages],
      platform: profile.platform,
      cpuCores: profile.cpuCores,
      memory: profile.memory,
      doNotTrack: null,
      cookiesEnabled: true,
      localStorage: true,
      sessionStorage: true,
      indexedDB: true,
      webGL: this.generateWebGLInfo(profile),
      canvas: this.generateCanvasRender(profile),
      fonts: this.generateMobileFonts(),
      plugins,
      mimeTypes,
      pluginsLength: plugins.length,
      mimeTypesLength: mimeTypes.length,
      webdriver: false,
      chrome:
        profile.browser === 'chrome' ||
        profile.browser === 'edge' ||
        profile.browser === 'samsung',
      isMobile: true,
      touchSupport: true,
      deviceMemory: profile.memory,
      hardwareConcurrency: profile.cpuCores,
      maxTouchPoints: 5,
      vendor: profile.vendor,
      product: 'Gecko',
      productSub: '20030107',
      tlsFingerprint: this.generateTLSFingerprint(profile),
      http2Fingerprint: this.generateHTTP2Fingerprint(profile),
      ja3Hash: this.generateJA3Hash(profile),
      akamaiFingerprint: this.generateAkamaiFingerprint(profile),
      battery: this.generateBatteryInfo(true),
      network: this.generateNetworkInfo(true),
      speechVoices,
      speechSynthesisVoices: speechVoices.length,
      screen: this.generateScreenInfo(profile),
      navigator: this.generateNavigatorInfo(profile),
      window: this.generateWindowInfo(profile),
      document: this.generateDocumentInfo(profile),
      location: this.generateLocationInfo(),
      history: this.generateHistoryInfo(),
      mediaCapabilities: this.generateMediaCapabilities(true),
      touchSupportInfo: this.generateTouchSupportInfo(true),
      keyboard: this.generateKeyboardInfo(),
      pointer: this.generatePointerInfo(true),
      gamepad: this.generateGamepadInfo(),
      vr: this.generateVRInfo(),
      mediaSession: this.generateMediaSessionInfo(),
      wakeLock: this.generateWakeLockInfo(true),
      deviceOrientation: this.generateDeviceOrientationInfo(true),
      deviceMotion: this.generateDeviceMotionInfo(true),
      proximity: this.generateProximityInfo(),
      ambientLight: this.generateAmbientLightInfo(),
      connection: this.generateNetworkConnectionInfo(true),
      credentials: this.generateCredentialInfo(),
      permissions: this.generatePermissionsInfo(),
      payment: this.generatePaymentInfo(true),
      webShare: this.generateWebShareInfo(true),
      contacts: this.generateContactInfo(),
      clipboard: this.generateClipboardInfo(),
      mediaDevices: this.generateMediaDevicesInfo(),
      pdfViewerEnabled: true,
    };

    this.validateFingerprint(fingerprint);
    return fingerprint;
  }

  private createDesktopFingerprint(index: number): FingerprintData {
    const profile = this.createDesktopProfile();
    const id = this.createFingerprintId('desktop', index, profile);
    const plugins = this.generateDesktopPlugins();
    const mimeTypes = this.generateDesktopMimeTypes();
    const speechVoices = this.generateSpeechVoices(false);

    const fingerprint: FingerprintData = {
      id,
      type: 'desktop',
      userAgent: this.getUserAgent(profile),
      viewport: profile.viewport,
      screenResolution: {
        width: profile.screen.width,
        height: profile.screen.height,
      },
      colorDepth: 24,
      pixelRatio: profile.screen.dpr,
      timezone: profile.timezone,
      language: profile.language,
      languages: [...profile.languages],
      platform: profile.platform,
      cpuCores: profile.cpuCores,
      memory: profile.memory,
      doNotTrack: null,
      cookiesEnabled: true,
      localStorage: true,
      sessionStorage: true,
      indexedDB: true,
      webGL: this.generateWebGLInfo(profile),
      canvas: this.generateCanvasRender(profile),
      fonts: this.generateDesktopFonts(profile),
      plugins,
      mimeTypes,
      pluginsLength: plugins.length,
      mimeTypesLength: mimeTypes.length,
      webdriver: false,
      chrome: profile.browser === 'chrome' || profile.browser === 'edge',
      isMobile: false,
      touchSupport: false,
      deviceMemory: profile.memory,
      hardwareConcurrency: profile.cpuCores,
      maxTouchPoints: 0,
      vendor: profile.vendor,
      product: 'Gecko',
      productSub: '20030107',
      tlsFingerprint: this.generateTLSFingerprint(profile),
      http2Fingerprint: this.generateHTTP2Fingerprint(profile),
      ja3Hash: this.generateJA3Hash(profile),
      akamaiFingerprint: this.generateAkamaiFingerprint(profile),
      battery: undefined,
      network: this.generateNetworkInfo(false),
      speechVoices,
      speechSynthesisVoices: speechVoices.length,
      screen: this.generateScreenInfo(profile),
      navigator: this.generateNavigatorInfo(profile),
      window: this.generateWindowInfo(profile),
      document: this.generateDocumentInfo(profile),
      location: this.generateLocationInfo(),
      history: this.generateHistoryInfo(),
      mediaCapabilities: this.generateMediaCapabilities(false),
      touchSupportInfo: this.generateTouchSupportInfo(false),
      keyboard: this.generateKeyboardInfo(),
      pointer: this.generatePointerInfo(false),
      gamepad: this.generateGamepadInfo(),
      vr: this.generateVRInfo(),
      mediaSession: this.generateMediaSessionInfo(),
      wakeLock: undefined,
      deviceOrientation: undefined,
      deviceMotion: undefined,
      proximity: this.generateProximityInfo(),
      ambientLight: this.generateAmbientLightInfo(),
      connection: this.generateNetworkConnectionInfo(false),
      credentials: this.generateCredentialInfo(),
      permissions: this.generatePermissionsInfo(),
      payment: this.generatePaymentInfo(false),
      webShare: this.generateWebShareInfo(false),
      contacts: this.generateContactInfo(),
      clipboard: this.generateClipboardInfo(),
      mediaDevices: this.generateMediaDevicesInfo(),
      pdfViewerEnabled: profile.browser !== 'safari',
    };

    this.validateFingerprint(fingerprint);
    return fingerprint;
  }

  /* =======================================================
   * ID / SELECTION
   * ===================================================== */

  private createFingerprintId(
    type: 'mobile' | 'desktop',
    index: number,
    profile: SyntheticProfile,
  ): string {
    const material = [
      this.version,
      type,
      index,
      profile.fingerprintType,
      profile.browser,
      profile.os,
      profile.model,
      this.rngState,
    ].join('|');

    const hash = createHash('sha256').update(material).digest('hex');
    return `fp-${type}-${hash.substring(0, 20)}`;
  }

  public getById(id: string): FingerprintData | undefined {
    if (!id || typeof id !== 'string') {
      return undefined;
    }
    return this.fingerprints.fingerprints.find((fingerprint) => fingerprint.id === id);
  }

  public getRandom(type?: 'mobile' | 'desktop'): FingerprintData | null {
    const pool =
      type === undefined
        ? this.fingerprints.fingerprints
        : this.fingerprints.fingerprints.filter((f) => f.type === type);

    if (pool.length === 0) {
      return null;
    }
    return this.pick(pool);
  }

  public getForKeyword(config: { isMobile?: number; keyword?: string }): FingerprintData | null {
    const isMobile = config.isMobile === 1;
    const pool = this.fingerprints.fingerprints.filter(
      (fingerprint) => fingerprint.type === (isMobile ? 'mobile' : 'desktop'),
    );

    if (pool.length === 0) {
      return null;
    }

    if (!config.keyword) {
      return this.pick(pool);
    }

    const hash = createHash('sha256').update(config.keyword).digest();
    const index = hash.readUInt32BE(0) % pool.length;
    return pool[index];
  }

  public getMultiple(count: number): FingerprintData[] {
    if (!Number.isInteger(count) || count < 0) {
      throw new RangeError('count must be a non-negative integer');
    }

    const pool = [...this.fingerprints.fingerprints];
    const result: FingerprintData[] = [];
    const target = Math.min(count, pool.length);

    for (let i = 0; i < target; i++) {
      const index = this.randomInt(0, pool.length - 1);
      result.push(pool[index]);
      pool.splice(index, 1);
    }

    return result;
  }

  /* =======================================================
   * WEBGL / CANVAS
   * ===================================================== */

  private generateWebGLInfo(profile: SyntheticProfile): WebGLInfo {
    return {
      vendor: 'WebKit',
      renderer: 'WebKit WebGL',
      unmaskedVendor: profile.gpuVendor,
      unmaskedRenderer: profile.gpuRenderer,
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
      extensions: ['WEBGL_debug_renderer_info', 'EXT_texture_filter_anisotropic'],
    };
  }

  private generateCanvasRender(profile: SyntheticProfile): CanvasRender {
    const material = [profile.browser, profile.os, profile.model, profile.screen.width, profile.screen.height, profile.screen.dpr].join('|');
    const signature = createHash('sha256').update(material).digest('base64');

    return {
      type: '2d',
      width: profile.viewport.width,
      height: profile.viewport.height,
      data: `synthetic-canvas:${signature}`,
      noise: 0,
      features: ['text', 'emoji', 'gradient'],
    };
  }

  /* =======================================================
   * USER AGENT
   * ===================================================== */

  private getUserAgent(profile: SyntheticProfile): string {
    if (profile.os === 'ios') {
      if (profile.browser === 'safari') {
        return 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1';
      }
      return 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.0.0 Mobile/15E148 Safari/604.1';
    }

    if (profile.os === 'android') {
      if (profile.browser === 'firefox') {
        return 'Mozilla/5.0 (Android 14; Mobile; rv:120.0) Gecko/120.0 Firefox/120.0';
      }
      if (profile.browser === 'samsung') {
        return 'Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36';
      }
      return 'Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
    }

    if (profile.os === 'windows') {
      if (profile.browser === 'firefox') {
        return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0';
      }
      if (profile.browser === 'edge') {
        return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0';
      }
      return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    }

    if (profile.os === 'macos') {
      if (profile.browser === 'safari') {
        return 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15';
      }
      if (profile.browser === 'firefox') {
        return 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:120.0) Gecko/20100101 Firefox/120.0';
      }
      if (profile.browser === 'edge') {
        return 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0';
      }
      return 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    }

    if (profile.browser === 'firefox') {
      return 'Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0';
    }

    return 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  }

  /* =======================================================
   * PLUGINS / MIME
   * ===================================================== */

  private generateMobilePlugins(): BrowserPlugin[] {
    return [];
  }

  private generateDesktopPlugins(): BrowserPlugin[] {
    return [
      {
        name: 'Chrome PDF Viewer',
        filename: 'internal-pdf-viewer',
        description: 'Portable Document Format',
        version: '1',
        itemTypes: ['application/pdf', 'text/pdf'],
      },
    ];
  }

  private generateMobileMimeTypes(): MimeType[] {
    return [
      { type: 'text/html', suffixes: 'html', description: 'HTML document', enabledPlugin: 'HTML' },
      { type: 'text/plain', suffixes: 'txt', description: 'Plain text document', enabledPlugin: 'TXT' },
    ];
  }

  private generateDesktopMimeTypes(): MimeType[] {
    return [
      { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format', enabledPlugin: 'Chrome PDF Viewer' },
      { type: 'text/html', suffixes: 'html', description: 'HTML document', enabledPlugin: 'HTML' },
    ];
  }

  /* =======================================================
   * FONTS
   * ===================================================== */

  private generateMobileFonts(): string[] {
    return [
      'Arial',
      'Helvetica',
      'Times New Roman',
      'Courier New',
      'Georgia',
      'Verdana',
      'Trebuchet MS',
      '-apple-system',
      'BlinkMacSystemFont',
    ];
  }

  private generateDesktopFonts(profile: SyntheticProfile): string[] {
    const common = ['Arial', 'Helvetica', 'Times New Roman', 'Courier New', 'Georgia', 'Verdana', 'Trebuchet MS'];

    if (profile.os === 'windows') {
      return [...common, 'Arial Black', 'Impact', 'Comic Sans MS', 'Palatino Linotype', 'Lucida Console', 'MS Serif', 'MS Sans Serif'];
    }

    if (profile.os === 'macos') {
      return [...common, '-apple-system', 'BlinkMacSystemFont', 'Helvetica Neue'];
    }

    return [...common, 'DejaVu Sans', 'Liberation Sans'];
  }

  /* =======================================================
   * TLS / HTTP2
   * ===================================================== */

  private generateJA3Hash(profile: SyntheticProfile): string {
    const material = [profile.browser, profile.os, profile.type].join('|');
    return createHash('md5').update(`synthetic-ja3|${material}`).digest('hex');
  }

  private generateAkamaiFingerprint(profile: SyntheticProfile): string {
    const material = [profile.browser, profile.os, profile.screen.width, profile.screen.height].join('|');
    return createHash('sha256').update(`synthetic-http2|${material}`).digest('hex').substring(0, 32);
  }

  private generateTLSFingerprint(profile: SyntheticProfile): TLSFingerprint {
    return {
      ja3Hash: this.generateJA3Hash(profile),
      ja3Full: 'synthetic-test-profile',
      version: 'TLSv1.3',
      ciphers: ['TLS_AES_256_GCM_SHA384', 'TLS_CHACHA20_POLY1305_SHA256', 'TLS_AES_128_GCM_SHA256'],
      extensions: ['server_name', 'supported_groups', 'application_layer_protocol_negotiation'],
      curves: ['X25519', 'secp256r1'],
      pointFormats: ['uncompressed'],
    };
  }

  private generateHTTP2Fingerprint(profile: SyntheticProfile): HTTP2Fingerprint {
    return {
      akamaiFingerprint: this.generateAkamaiFingerprint(profile),
      settings: {
        headerTableSize: 65536,
        enablePush: false,
        maxConcurrentStreams: 100,
        initialWindowSize: 6291456,
        maxFrameSize: 16384,
        maxHeaderListSize: 262144,
      },
      windowUpdate: 6291456,
      priority: { exclusive: false, dependency: 0, weight: 16 },
    };
  }

  /* =======================================================
   * BATTERY / NETWORK
   * ===================================================== */

  private generateBatteryInfo(isMobile: boolean): BatteryInfo | undefined {
    if (!isMobile) {
      return undefined;
    }
    return {
      charging: this.random() > 0.5,
      chargingTime: this.randomInt(0, 2) === 0 ? 0 : 7200,
      dischargingTime: this.randomInt(14400, 28800),
      level: Math.round((0.25 + this.random() * 0.7) * 100) / 100,
    };
  }

  private generateNetworkInfo(isMobile: boolean): NetworkInfo {
    const effectiveType = isMobile ? this.pick(['3g', '4g'] as const) : 'wifi';
    return {
      effectiveType,
      downlink: isMobile ? 5 : 25,
      rtt: isMobile ? this.randomInt(50, 150) : this.randomInt(10, 40),
      saveData: false,
    };
  }

  private generateNetworkConnectionInfo(isMobile: boolean): NetworkConnectionInfo {
    const type = isMobile ? this.pick(['4g', 'wifi'] as const) : 'wifi';
    return {
      effectiveType: type === 'wifi' ? '4g' : type,
      downlink: type === 'wifi' ? 25 : 5,
      downlinkMax: 100,
      rtt: type === 'wifi' ? 20 : 80,
      saveData: false,
      type,
    };
  }

  /* =======================================================
   * SPEECH
   * ===================================================== */

  private generateSpeechVoices(isMobile: boolean): SpeechVoice[] {
    const count = isMobile ? 12 : 20;
    const locales = ['tr-TR', 'en-US', 'en-GB', 'de-DE', 'fr-FR'];
    const voices: SpeechVoice[] = [];

    for (let i = 0; i < count; i++) {
      const locale = locales[i % locales.length];
      voices.push({
        voiceURI: `synthetic-${locale}-${i}`,
        name: `${locale} Test Voice ${i}`,
        lang: locale,
        localService: true,
        default: i === 0,
      });
    }

    return voices;
  }

  /* =======================================================
   * SCREEN / NAVIGATOR / WINDOW / DOCUMENT
   * ===================================================== */

  private generateScreenInfo(profile: SyntheticProfile): ScreenInfo {
    return {
      width: profile.screen.width,
      height: profile.screen.height,
      availWidth: profile.screen.width,
      availHeight: profile.os === 'macos' ? profile.screen.height - 25 : profile.screen.height,
      availLeft: 0,
      availTop: profile.os === 'macos' ? 25 : 0,
      colorDepth: 24,
      pixelDepth: 24,
      orientation: {
        angle: 0,
        type: profile.type === 'mobile' ? 'portrait-primary' : 'landscape-primary',
      },
    };
  }

  private generateNavigatorInfo(profile: SyntheticProfile): NavigatorInfo {
    const userAgent = this.getUserAgent(profile);
    return {
      appCodeName: 'Mozilla',
      appName: 'Netscape',
      appVersion: userAgent.substring(userAgent.indexOf('Mozilla/') + 8),
      buildID: undefined,
      cookieEnabled: true,
      deviceMemory: profile.memory,
      doNotTrack: null,
      hardwareConcurrency: profile.cpuCores,
      language: profile.language,
      languages: [...profile.languages],
      maxTouchPoints: profile.type === 'mobile' ? 5 : 0,
      onLine: true,
      platform: profile.platform,
      product: 'Gecko',
      productSub: '20030107',
      userAgent,
      vendor: profile.vendor,
      vendorSub: '',
      webdriver: false,
      pdfViewerEnabled: profile.browser !== 'safari',
      bluetooth: undefined,
      clipboard: {},
      credentials: {},
      keyboard: {},
      mediaCapabilities: {},
      mediaDevices: {},
      permissions: {},
      presentation: {},
      scheduling: {},
      storage: {},
      wakeLock: {},
      webkitTemporaryStorage: {},
    };
  }

  private generateWindowInfo(profile: SyntheticProfile): WindowInfo {
    return {
      innerWidth: profile.viewport.width,
      innerHeight: profile.viewport.height,
      outerWidth: profile.type === 'mobile' ? profile.viewport.width : profile.screen.width,
      outerHeight: profile.type === 'mobile' ? profile.viewport.height : profile.screen.height,
      screenX: 0,
      screenY: 0,
      screenLeft: 0,
      screenTop: 0,
      devicePixelRatio: profile.screen.dpr,
      visualViewport: {
        width: profile.viewport.width,
        height: profile.viewport.height,
        scale: 1,
        offsetLeft: 0,
        offsetTop: 0,
        pageLeft: 0,
        pageTop: 0,
      },
    };
  }

  private generateDocumentInfo(profile: SyntheticProfile): DocumentInfo {
    return {
      charset: 'UTF-8',
      characterSet: 'UTF-8',
      compatMode: 'CSS1Compat',
      contentType: 'text/html',
      cookie: '',
      documentElement: {
        clientWidth: profile.viewport.width,
        clientHeight: profile.viewport.height,
        scrollWidth: profile.viewport.width,
        scrollHeight: profile.viewport.height,
      },
      domain: 'test.local',
      fullscreen: false,
      hidden: false,
      lastModified: new Date(0).toISOString(),
      location: {
        href: 'https://test.local/',
        protocol: 'https:',
        host: 'test.local',
        hostname: 'test.local',
        port: '',
        pathname: '/',
        search: '',
        hash: '',
      },
      readyState: 'complete',
      referrer: '',
      title: 'Synthetic Test Page',
      visibilityState: 'visible',
      webkitVisibilityState: 'visible',
    };
  }

  private generateLocationInfo(): LocationInfo {
    return {
      href: 'https://test.local/',
      protocol: 'https:',
      host: 'test.local',
      hostname: 'test.local',
      port: '',
      pathname: '/',
      search: '',
      hash: '',
    };
  }

  private generateHistoryInfo(): HistoryInfo {
    return { length: 1 };
  }

  /* =======================================================
   * CAPABILITIES & SENSORS
   * ===================================================== */

  private generateMediaCapabilities(isMobile: boolean): MediaCapabilities {
    return {
      decodingInfo: { supported: true, smooth: true, powerEfficient: !isMobile },
      encodingInfo: { supported: true, smooth: true, powerEfficient: !isMobile },
    };
  }

  private generateTouchSupportInfo(isMobile: boolean): TouchSupportInfo {
    return {
      maxTouchPoints: isMobile ? 5 : 0,
      touchEvent: isMobile,
      touchStart: isMobile,
    };
  }

  private generateKeyboardInfo(): KeyboardInfo {
    return { getLayoutMap: () => ({}) };
  }

  private generatePointerInfo(isMobile: boolean): PointerInfo {
    return { maxTouchPoints: isMobile ? 5 : 0, pointerEnabled: true };
  }

  private generateGamepadInfo(): GamepadInfo {
    return { gamepads: [] };
  }

  private generateVRInfo(): VRInfo {
    return { vrDisplays: undefined, xr: undefined };
  }

  private generateMediaSessionInfo(): MediaSessionInfo {
    return { metadata: null, playbackState: 'none' };
  }

  private generateWakeLockInfo(isMobile: boolean): WakeLockInfo | undefined {
    if (!isMobile) return undefined;
    return { request: async () => ({ release: async () => {} }) };
  }

  private generateDeviceOrientationInfo(isMobile: boolean): DeviceOrientationInfo | undefined {
    if (!isMobile) return undefined;
    return { absolute: false, alpha: 0, beta: 0, gamma: 0 };
  }

  private generateDeviceMotionInfo(isMobile: boolean): DeviceMotionInfo | undefined {
    if (!isMobile) return undefined;
    return {
      acceleration: { x: 0, y: 0, z: 0 },
      accelerationIncludingGravity: { x: 0, y: 9.8, z: 0 },
      rotationRate: { alpha: 0, beta: 0, gamma: 0 },
      interval: 16,
    };
  }

  private generateProximityInfo(): ProximityInfo | undefined {
    return undefined;
  }

  private generateAmbientLightInfo(): AmbientLightInfo | undefined {
    return undefined;
  }

  /* =======================================================
   * CREDENTIALS / PERMISSIONS / PAYMENT / WEBSHARE
   * ===================================================== */

  private generateCredentialInfo(): CredentialInfo {
    return {
      get: async () => null,
      create: async () => null,
      preventSilentAccess: async () => {},
      store: async () => {},
    };
  }

  private generatePermissionsInfo(): PermissionsInfo {
    return { query: async () => ({ state: 'prompt', onchange: null }) };
  }

  private generatePaymentInfo(isMobile: boolean): PaymentInfo {
    return { canMakePayment: async () => isMobile, isReadyToPay: async () => isMobile };
  }

  private generateWebShareInfo(isMobile: boolean): WebShareInfo {
    return { canShare: () => isMobile, share: async () => {} };
  }

  private generateContactInfo(): ContactInfo | undefined {
    return undefined;
  }

  private generateClipboardInfo(): ClipboardInfo {
    return {
      read: async () => ({ types: [], getType: async () => new Blob([]) }),
      readText: async () => '',
      write: async () => {},
      writeText: async () => {},
    };
  }

  private generateMediaDevicesInfo(): MediaDevicesInfo {
    return {
      enumerateDevices: async () => [],
      getDisplayMedia: async () => ({ getTracks: () => [], getAudioTracks: () => [], getVideoTracks: () => [] }),
      getSupportedConstraints: () => ({
        aspectRatio: true,
        autoGainControl: true,
        brightness: true,
        channelCount: true,
        colorTemperature: true,
        contrast: true,
        deviceId: true,
        echoCancellation: true,
        exposureCompensation: true,
        exposureMode: true,
        exposureTime: true,
        facingMode: true,
        focusDistance: true,
        focusMode: true,
        frameRate: true,
        groupId: true,
        height: true,
        iso: true,
        latency: true,
        noiseSuppression: true,
        pan: true,
        pointsOfInterest: true,
        resizeMode: true,
        sampleRate: true,
        sampleSize: true,
        saturation: true,
        sharpness: true,
        tilt: true,
        torch: true,
        whiteBalanceMode: true,
        width: true,
        zoom: true,
      }),
      getUserMedia: async () => ({ getTracks: () => [], getAudioTracks: () => [], getVideoTracks: () => [] }),
      ondevicechange: null,
    };
  }

  /* =======================================================
   * VALIDATION
   * ===================================================== */

  private validateFingerprint(fingerprint: FingerprintData): void {
    if (!fingerprint.id) {
      throw new Error('Fingerprint must have an id');
    }

    if (fingerprint.type !== 'mobile' && fingerprint.type !== 'desktop') {
      throw new Error(`Invalid fingerprint type: ${fingerprint.type}`);
    }

    if (fingerprint.isMobile !== (fingerprint.type === 'mobile')) {
      throw new Error('Fingerprint mobile/type mismatch');
    }

    if (fingerprint.viewport.width <= 0 || fingerprint.viewport.height <= 0) {
      throw new Error('Invalid viewport dimensions');
    }

    if (fingerprint.screenResolution.width <= 0 || fingerprint.screenResolution.height <= 0) {
      throw new Error('Invalid screen dimensions');
    }

    if (fingerprint.hardwareConcurrency <= 0) {
      throw new Error('Invalid hardwareConcurrency');
    }

    if (fingerprint.deviceMemory <= 0) {
      throw new Error('Invalid deviceMemory');
    }

    if (fingerprint.pluginsLength !== fingerprint.plugins.length) {
      throw new Error('Plugin count mismatch');
    }

    if (fingerprint.mimeTypesLength !== fingerprint.mimeTypes.length) {
      throw new Error('MIME type count mismatch');
    }

    if (fingerprint.speechSynthesisVoices !== fingerprint.speechVoices.length) {
      throw new Error('Speech voice count mismatch');
    }

    if (fingerprint.isMobile && fingerprint.maxTouchPoints <= 0) {
      throw new Error('Mobile profile must support touch');
    }

    if (!fingerprint.isMobile && fingerprint.maxTouchPoints !== 0) {
      throw new Error('Desktop profile cannot have touch points');
    }
  }

  /* =======================================================
   * SHUFFLE / METADATA
   * ===================================================== */

  private shuffleArray<T>(array: T[]): void {
    for (let i = array.length - 1; i > 0; i--) {
      const j = this.randomInt(0, i);
      [array[i], array[j]] = [array[j], array[i]];
    }
  }

  private updateMetadata(): void {
    const fingerprints = this.fingerprints.fingerprints;
    this.fingerprints.metadata.totalCount = fingerprints.length;
    this.fingerprints.metadata.mobileCount = fingerprints.filter((f) => f.type === 'mobile').length;
    this.fingerprints.metadata.desktopCount = fingerprints.filter((f) => f.type === 'desktop').length;
  }

  /* =======================================================
   * FILE STORAGE
   * ===================================================== */

  public saveToFile(filename: string): void {
    this.validateFilename(filename);

    const filePath = path.join(this.dataDir, filename);

    try {
      fs.writeFileSync(filePath, JSON.stringify(this.fingerprints, null, 2), 'utf8');
    } catch (error) {
      this.logger?.error('Failed to save fingerprint collection', { filePath, error });
      throw error;
    }
  }

  public loadFromFile(filename: string): FingerprintCollection {
    this.validateFilename(filename);

    const filePath = path.join(this.dataDir, filename);

    if (!fs.existsSync(filePath)) {
      this.logger?.warn('Fingerprint file does not exist', { filePath });
      this.fingerprints = this.initializeCollection();
      return this.fingerprints;
    }

    try {
      const data = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(data);

      if (!this.isValidCollection(parsed)) {
        throw new Error('Invalid fingerprint collection format');
      }

      this.fingerprints = parsed;
      this.updateMetadata();
      return this.fingerprints;
    } catch (error) {
      this.logger?.error('Failed to load fingerprint collection', { filePath, error });
      throw error;
    }
  }

  private validateFilename(filename: string): void {
    if (typeof filename !== 'string' || filename.trim().length === 0) {
      throw new TypeError('filename must be a non-empty string');
    }

    const normalized = path.normalize(filename);
    if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
      throw new Error('Invalid filename');
    }
  }

  private isValidCollection(value: unknown): value is FingerprintCollection {
    if (!value || typeof value !== 'object') {
      return false;
    }
    const candidate = value as Partial<FingerprintCollection>;
    return Array.isArray(candidate.fingerprints) && !!candidate.metadata && typeof candidate.metadata === 'object';
  }

  /* =======================================================
   * PUBLIC COLLECTION API
   * ===================================================== */

  public getAllFingerprints(): FingerprintData[] {
    return [...this.fingerprints.fingerprints];
  }

  public getCount(): { total: number; mobile: number; desktop: number } {
    return {
      total: this.fingerprints.metadata.totalCount,
      mobile: this.fingerprints.metadata.mobileCount,
      desktop: this.fingerprints.metadata.desktopCount,
    };
  }

  public getStats(): FingerprintCollection['metadata'] {
    return { ...this.fingerprints.metadata };
  }
}