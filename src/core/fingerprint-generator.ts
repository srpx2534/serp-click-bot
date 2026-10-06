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

// Logger interface
interface Logger {
  debug: (message: string, context?: any) => void;
  info: (message: string, context?: any) => void;
  warn: (message: string, context?: any) => void;
  error: (message: string, context?: any) => void;
}

// Singleton instance
let instance: FingerprintGenerator | null = null;

/**
 * FingerprintGenerator singleton getter
 */
export function getFingerprintGenerator(dataDir?: string, logger?: Logger): FingerprintGenerator {
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

export class FingerprintGenerator {
  private fingerprints: FingerprintCollection;
  private readonly version = '1.0.0';
  private dataDir: string;
  private logger?: Logger;

  constructor(dataDir: string = './data/fingerprints', logger?: Logger) {
    this.dataDir = dataDir;
    this.logger = logger;
    this.fingerprints = this.initializeCollection();
    this.ensureDirectoryExists();
  }

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
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  /**
   * 2000 fingerprint oluşturur (1000 mobil, 1000 desktop)
   * Testlerin beklediği: döndürülen obje metadata, mobile, desktop içermeli
   */
  public generate(mobileCount: number = 1000, desktopCount: number = 1000): { 
    metadata: FingerprintCollection['metadata']; 
    mobile: FingerprintData[]; 
    desktop: FingerprintData[] 
  } {
    this.logger?.info(`Generating ${mobileCount} mobile and ${desktopCount} desktop fingerprints`);
    
    const mobile: FingerprintData[] = [];
    const desktop: FingerprintData[] = [];

    // Mobil fingerprint'ler
    for (let i = 0; i < mobileCount; i++) {
      const fp = this.createMobileFingerprint();
      mobile.push(fp);
      this.fingerprints.fingerprints.push(fp);
    }

    // Desktop fingerprint'ler
    for (let i = 0; i < desktopCount; i++) {
      const fp = this.createDesktopFingerprint();
      desktop.push(fp);
      this.fingerprints.fingerprints.push(fp);
    }

    // Karıştır
    this.shuffleArray(this.fingerprints.fingerprints);
    this.updateMetadata();
    
    this.logger?.info(`Generated ${this.fingerprints.metadata.totalCount} fingerprints`);
    
    // Testlerin beklediği format
    return {
      metadata: this.fingerprints.metadata,
      mobile,
      desktop,
    };
  }

  /**
   * ID'ye göre fingerprint bulur
   */
  public getById(id: string): FingerprintData | undefined {
    return this.fingerprints.fingerprints.find(f => f.id === id);
  }

  /**
   * Rastgele fingerprint döndürür
   */
  public getRandom(type?: 'mobile' | 'desktop'): FingerprintData | null {
    let pool = this.fingerprints.fingerprints;
    
    if (type === 'mobile') {
      pool = pool.filter(f => f.type === 'mobile');
    } else if (type === 'desktop') {
      pool = pool.filter(f => f.type === 'desktop');
    }
    
    if (pool.length === 0) return null;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  /**
   * Anahtar kelime için uygun fingerprint döndürür
   * Testte: getForKeyword({ isMobile: 1 }) şeklinde kullanılmış
   */
  public getForKeyword(config: { isMobile?: number; keyword?: string }): FingerprintData | null {
    const isMobile = config.isMobile === 1;
    
    const pool = isMobile 
      ? this.fingerprints.fingerprints.filter(f => f.type === 'mobile')
      : this.fingerprints.fingerprints.filter(f => f.type === 'desktop');
    
    if (pool.length === 0) return null;
    
    // Eğer keyword varsa hash'e göre seç, yoksa random
    if (config.keyword) {
      const hash = createHash('md5').update(config.keyword).digest('hex');
      const index = parseInt(hash.substring(0, 8), 16);
      return pool[index % pool.length];
    }
    
    return pool[Math.floor(Math.random() * pool.length)];
  }

  /**
   * Birden fazla rastgele fingerprint döndürür
   */
  public getMultiple(count: number): FingerprintData[] {
    const result: FingerprintData[] = [];
    const pool = [...this.fingerprints.fingerprints];
    
    for (let i = 0; i < Math.min(count, pool.length); i++) {
      const index = Math.floor(Math.random() * pool.length);
      result.push(pool[index]);
      pool.splice(index, 1);
    }
    
    return result;
  }

  /**
   * Fingerprint sayılarını döndürür
   */
  public getCount(): { total: number; mobile: number; desktop: number } {
    return {
      total: this.fingerprints.metadata.totalCount,
      mobile: this.fingerprints.metadata.mobileCount,
      desktop: this.fingerprints.metadata.desktopCount,
    };
  }

  /**
   * Mobil cihaz fingerprint'i oluşturur
   */
  private createMobileFingerprint(): FingerprintData {
    const type = this.getRandomMobileType();
    const id = `fp-mobile-${createHash('md5').update(Math.random().toString()).digest('hex').substring(0, 16)}`;
    
    const plugins = this.generateMobilePlugins();
    const mimeTypes = this.generateMobileMimeTypes();
    const speechVoices = this.generateSpeechVoices(true);
    
    return {
      id,
      type: 'mobile',
      userAgent: this.getMobileUserAgent(type),
      viewport: this.getMobileViewport(type),
      screenResolution: this.getMobileScreenResolution(type),
      colorDepth: 24,
      pixelRatio: 3,
      timezone: 'Europe/Istanbul',
      language: 'tr-TR',
      languages: ['tr-TR', 'tr', 'en-US', 'en'],
      platform: this.getMobilePlatform(type),
      cpuCores: 8,
      memory: 8,
      doNotTrack: null,
      cookiesEnabled: true,
      localStorage: true,
      sessionStorage: true,
      indexedDB: true,
      webGL: this.generateWebGLInfo(true),
      canvas: this.generateCanvasRender(true),
      fonts: this.generateMobileFonts(),
      plugins,
      mimeTypes,
      pluginsLength: plugins.length,
      mimeTypesLength: mimeTypes.length,
      webdriver: false,
      chrome: true,
      isMobile: true,
      touchSupport: true,
      deviceMemory: 8,
      hardwareConcurrency: 8,
      maxTouchPoints: 5,
      vendor: this.getMobileVendor(type),
      product: 'Gecko',
      productSub: '20030107',
      tlsFingerprint: this.generateTLSFingerprint(),
      http2Fingerprint: this.generateHTTP2Fingerprint(),
      ja3Hash: this.generateJA3Hash(),
      akamaiFingerprint: this.generateAkamaiFingerprint(),
      battery: this.generateBatteryInfo(true),
      network: this.generateNetworkInfo(true),
      speechVoices,
      speechSynthesisVoices: speechVoices.length,
      screen: this.generateScreenInfo(true),
      navigator: this.generateNavigatorInfo(true),
      window: this.generateWindowInfo(true),
      document: this.generateDocumentInfo(true),
      location: this.generateLocationInfo(),
      history: this.generateHistoryInfo(),
      mediaCapabilities: this.generateMediaCapabilities(true),
      touchSupportInfo: this.generateTouchSupportInfo(true),
      keyboard: this.generateKeyboardInfo(true),
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
      mediaDevices: this.generateMediaDevicesInfo(true),
      pdfViewerEnabled: true,
    };
  }

  /**
   * Desktop fingerprint oluşturur
   */
  private createDesktopFingerprint(): FingerprintData {
    const type = this.getRandomDesktopType();
    const id = `fp-desktop-${createHash('md5').update(Math.random().toString()).digest('hex').substring(0, 16)}`;
    
    const plugins = this.generateDesktopPlugins();
    const mimeTypes = this.generateDesktopMimeTypes();
    const speechVoices = this.generateSpeechVoices(false);
    
    return {
      id,
      type: 'desktop',
      userAgent: this.getDesktopUserAgent(type),
      viewport: this.getDesktopViewport(type),
      screenResolution: this.getDesktopScreenResolution(type),
      colorDepth: 24,
      pixelRatio: 1,
      timezone: 'Europe/Istanbul',
      language: 'tr-TR',
      languages: ['tr-TR', 'tr', 'en-US', 'en'],
      platform: this.getDesktopPlatform(type),
      cpuCores: 8,
      memory: 16,
      doNotTrack: null,
      cookiesEnabled: true,
      localStorage: true,
      sessionStorage: true,
      indexedDB: true,
      webGL: this.generateWebGLInfo(false),
      canvas: this.generateCanvasRender(false),
      fonts: this.generateDesktopFonts(),
      plugins,
      mimeTypes,
      pluginsLength: plugins.length,
      mimeTypesLength: mimeTypes.length,
      webdriver: false,
      chrome: true,
      isMobile: false,
      touchSupport: false,
      deviceMemory: 16,
      hardwareConcurrency: 8,
      maxTouchPoints: 0,
      vendor: this.getDesktopVendor(type),
      product: 'Gecko',
      productSub: '20030107',
      tlsFingerprint: this.generateTLSFingerprint(),
      http2Fingerprint: this.generateHTTP2Fingerprint(),
      ja3Hash: this.generateJA3Hash(),
      akamaiFingerprint: this.generateAkamaiFingerprint(),
      battery: undefined,
      network: this.generateNetworkInfo(false),
      speechVoices,
      speechSynthesisVoices: speechVoices.length,
      screen: this.generateScreenInfo(false),
      navigator: this.generateNavigatorInfo(false),
      window: this.generateWindowInfo(false),
      document: this.generateDocumentInfo(false),
      location: this.generateLocationInfo(),
      history: this.generateHistoryInfo(),
      mediaCapabilities: this.generateMediaCapabilities(false),
      touchSupportInfo: this.generateTouchSupportInfo(false),
      keyboard: this.generateKeyboardInfo(false),
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
      mediaDevices: this.generateMediaDevicesInfo(false),
      pdfViewerEnabled: true,
    };
  }

  // ==========================================
  // TİP & USER AGENT YARDIMCILARI
  // ==========================================

  private getRandomMobileType(): FingerprintType {
    const types = [
      FingerprintType.MOBILE_CHROME_ANDROID,
      FingerprintType.MOBILE_CHROME_IOS,
      FingerprintType.MOBILE_SAFARI_IOS,
      FingerprintType.MOBILE_FIREFOX_ANDROID,
      FingerprintType.MOBILE_SAMSUNG_ANDROID,
    ];
    return types[Math.floor(Math.random() * types.length)];
  }

  private getRandomDesktopType(): FingerprintType {
    const types = [
      FingerprintType.CHROME_WIN,
      FingerprintType.CHROME_MAC,
      FingerprintType.CHROME_LINUX,
      FingerprintType.FIREFOX_WIN,
      FingerprintType.FIREFOX_MAC,
      FingerprintType.FIREFOX_LINUX,
      FingerprintType.SAFARI_MAC,
      FingerprintType.EDGE_WIN,
      FingerprintType.EDGE_MAC,
    ];
    return types[Math.floor(Math.random() * types.length)];
  }

  private getMobileUserAgent(type: FingerprintType): string {
    const agents: Record<FingerprintType, string> = {
      [FingerprintType.MOBILE_CHROME_ANDROID]: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      [FingerprintType.MOBILE_CHROME_IOS]: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1',
      [FingerprintType.MOBILE_SAFARI_IOS]: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1',
      [FingerprintType.MOBILE_FIREFOX_ANDROID]: 'Mozilla/5.0 (Android 14; Mobile; rv:120.0) Gecko/120.0 Firefox/120.0',
      [FingerprintType.MOBILE_SAMSUNG_ANDROID]: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36',
      [FingerprintType.CHROME_WIN]: '',
      [FingerprintType.CHROME_MAC]: '',
      [FingerprintType.CHROME_LINUX]: '',
      [FingerprintType.FIREFOX_WIN]: '',
      [FingerprintType.FIREFOX_MAC]: '',
      [FingerprintType.FIREFOX_LINUX]: '',
      [FingerprintType.SAFARI_MAC]: '',
      [FingerprintType.EDGE_WIN]: '',
      [FingerprintType.EDGE_MAC]: '',
    };
    return agents[type] || agents[FingerprintType.MOBILE_CHROME_ANDROID];
  }

  private getDesktopUserAgent(type: FingerprintType): string {
    const agents: Record<FingerprintType, string> = {
      [FingerprintType.CHROME_WIN]: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      [FingerprintType.CHROME_MAC]: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      [FingerprintType.CHROME_LINUX]: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      [FingerprintType.FIREFOX_WIN]: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0',
      [FingerprintType.FIREFOX_MAC]: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:120.0) Gecko/20100101 Firefox/120.0',
      [FingerprintType.FIREFOX_LINUX]: 'Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0',
      [FingerprintType.SAFARI_MAC]: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
      [FingerprintType.EDGE_WIN]: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
      [FingerprintType.EDGE_MAC]: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
      [FingerprintType.MOBILE_CHROME_ANDROID]: '',
      [FingerprintType.MOBILE_CHROME_IOS]: '',
      [FingerprintType.MOBILE_SAFARI_IOS]: '',
      [FingerprintType.MOBILE_FIREFOX_ANDROID]: '',
      [FingerprintType.MOBILE_SAMSUNG_ANDROID]: '',
    };
    return agents[type] || agents[FingerprintType.CHROME_WIN];
  }

  private getMobileViewport(type: FingerprintType): { width: number; height: number } {
    const viewports: Record<FingerprintType, { width: number; height: number }> = {
      [FingerprintType.MOBILE_CHROME_ANDROID]: { width: 384, height: 824 },
      [FingerprintType.MOBILE_CHROME_IOS]: { width: 390, height: 844 },
      [FingerprintType.MOBILE_SAFARI_IOS]: { width: 390, height: 844 },
      [FingerprintType.MOBILE_FIREFOX_ANDROID]: { width: 384, height: 824 },
      [FingerprintType.MOBILE_SAMSUNG_ANDROID]: { width: 384, height: 824 },
      [FingerprintType.CHROME_WIN]: { width: 0, height: 0 },
      [FingerprintType.CHROME_MAC]: { width: 0, height: 0 },
      [FingerprintType.CHROME_LINUX]: { width: 0, height: 0 },
      [FingerprintType.FIREFOX_WIN]: { width: 0, height: 0 },
      [FingerprintType.FIREFOX_MAC]: { width: 0, height: 0 },
      [FingerprintType.FIREFOX_LINUX]: { width: 0, height: 0 },
      [FingerprintType.SAFARI_MAC]: { width: 0, height: 0 },
      [FingerprintType.EDGE_WIN]: { width: 0, height: 0 },
      [FingerprintType.EDGE_MAC]: { width: 0, height: 0 },
    };
    return viewports[type] || { width: 390, height: 844 };
  }

  private getDesktopViewport(type: FingerprintType): { width: number; height: number } {
    const viewports: Record<FingerprintType, { width: number; height: number }> = {
      [FingerprintType.CHROME_WIN]: { width: 1366, height: 768 },
      [FingerprintType.CHROME_MAC]: { width: 1440, height: 900 },
      [FingerprintType.CHROME_LINUX]: { width: 1920, height: 1080 },
      [FingerprintType.FIREFOX_WIN]: { width: 1366, height: 768 },
      [FingerprintType.FIREFOX_MAC]: { width: 1440, height: 900 },
      [FingerprintType.FIREFOX_LINUX]: { width: 1920, height: 1080 },
      [FingerprintType.SAFARI_MAC]: { width: 1440, height: 900 },
      [FingerprintType.EDGE_WIN]: { width: 1366, height: 768 },
      [FingerprintType.EDGE_MAC]: { width: 1440, height: 900 },
      [FingerprintType.MOBILE_CHROME_ANDROID]: { width: 0, height: 0 },
      [FingerprintType.MOBILE_CHROME_IOS]: { width: 0, height: 0 },
      [FingerprintType.MOBILE_SAFARI_IOS]: { width: 0, height: 0 },
      [FingerprintType.MOBILE_FIREFOX_ANDROID]: { width: 0, height: 0 },
      [FingerprintType.MOBILE_SAMSUNG_ANDROID]: { width: 0, height: 0 },
    };
    return viewports[type] || { width: 1920, height: 1080 };
  }

  private getMobileScreenResolution(type: FingerprintType): { width: number; height: number } {
    const resolutions: Record<FingerprintType, { width: number; height: number }> = {
      [FingerprintType.MOBILE_CHROME_ANDROID]: { width: 1080, height: 2340 },
      [FingerprintType.MOBILE_CHROME_IOS]: { width: 1179, height: 2556 },
      [FingerprintType.MOBILE_SAFARI_IOS]: { width: 1179, height: 2556 },
      [FingerprintType.MOBILE_FIREFOX_ANDROID]: { width: 1080, height: 2340 },
      [FingerprintType.MOBILE_SAMSUNG_ANDROID]: { width: 1080, height: 2340 },
      [FingerprintType.CHROME_WIN]: { width: 0, height: 0 },
      [FingerprintType.CHROME_MAC]: { width: 0, height: 0 },
      [FingerprintType.CHROME_LINUX]: { width: 0, height: 0 },
      [FingerprintType.FIREFOX_WIN]: { width: 0, height: 0 },
      [FingerprintType.FIREFOX_MAC]: { width: 0, height: 0 },
      [FingerprintType.FIREFOX_LINUX]: { width: 0, height: 0 },
      [FingerprintType.SAFARI_MAC]: { width: 0, height: 0 },
      [FingerprintType.EDGE_WIN]: { width: 0, height: 0 },
      [FingerprintType.EDGE_MAC]: { width: 0, height: 0 },
    };
    return resolutions[type] || { width: 1179, height: 2556 };
  }

  private getDesktopScreenResolution(type: FingerprintType): { width: number; height: number } {
    const resolutions: Record<FingerprintType, { width: number; height: number }> = {
      [FingerprintType.CHROME_WIN]: { width: 1920, height: 1080 },
      [FingerprintType.CHROME_MAC]: { width: 2560, height: 1440 },
      [FingerprintType.CHROME_LINUX]: { width: 1920, height: 1080 },
      [FingerprintType.FIREFOX_WIN]: { width: 1920, height: 1080 },
      [FingerprintType.FIREFOX_MAC]: { width: 2560, height: 1440 },
      [FingerprintType.FIREFOX_LINUX]: { width: 1920, height: 1080 },
      [FingerprintType.SAFARI_MAC]: { width: 2560, height: 1440 },
      [FingerprintType.EDGE_WIN]: { width: 1920, height: 1080 },
      [FingerprintType.EDGE_MAC]: { width: 2560, height: 1440 },
      [FingerprintType.MOBILE_CHROME_ANDROID]: { width: 0, height: 0 },
      [FingerprintType.MOBILE_CHROME_IOS]: { width: 0, height: 0 },
      [FingerprintType.MOBILE_SAFARI_IOS]: { width: 0, height: 0 },
      [FingerprintType.MOBILE_FIREFOX_ANDROID]: { width: 0, height: 0 },
      [FingerprintType.MOBILE_SAMSUNG_ANDROID]: { width: 0, height: 0 },
    };
    return resolutions[type] || { width: 1920, height: 1080 };
  }

  private getMobilePlatform(type: FingerprintType): string {
    const platforms: Record<FingerprintType, string> = {
      [FingerprintType.MOBILE_CHROME_ANDROID]: 'Linux armv8l',
      [FingerprintType.MOBILE_CHROME_IOS]: 'iPhone',
      [FingerprintType.MOBILE_SAFARI_IOS]: 'iPhone',
      [FingerprintType.MOBILE_FIREFOX_ANDROID]: 'Android',
      [FingerprintType.MOBILE_SAMSUNG_ANDROID]: 'Linux armv8l',
      [FingerprintType.CHROME_WIN]: '',
      [FingerprintType.CHROME_MAC]: '',
      [FingerprintType.CHROME_LINUX]: '',
      [FingerprintType.FIREFOX_WIN]: '',
      [FingerprintType.FIREFOX_MAC]: '',
      [FingerprintType.FIREFOX_LINUX]: '',
      [FingerprintType.SAFARI_MAC]: '',
      [FingerprintType.EDGE_WIN]: '',
      [FingerprintType.EDGE_MAC]: '',
    };
    return platforms[type] || 'iPhone';
  }

  private getDesktopPlatform(type: FingerprintType): string {
    const platforms: Record<FingerprintType, string> = {
      [FingerprintType.CHROME_WIN]: 'Win32',
      [FingerprintType.CHROME_MAC]: 'MacIntel',
      [FingerprintType.CHROME_LINUX]: 'Linux x86_64',
      [FingerprintType.FIREFOX_WIN]: 'Win32',
      [FingerprintType.FIREFOX_MAC]: 'MacIntel',
      [FingerprintType.FIREFOX_LINUX]: 'Linux x86_64',
      [FingerprintType.SAFARI_MAC]: 'MacIntel',
      [FingerprintType.EDGE_WIN]: 'Win32',
      [FingerprintType.EDGE_MAC]: 'MacIntel',
      [FingerprintType.MOBILE_CHROME_ANDROID]: '',
      [FingerprintType.MOBILE_CHROME_IOS]: '',
      [FingerprintType.MOBILE_SAFARI_IOS]: '',
      [FingerprintType.MOBILE_FIREFOX_ANDROID]: '',
      [FingerprintType.MOBILE_SAMSUNG_ANDROID]: '',
    };
    return platforms[type] || 'Win32';
  }

  private getMobileVendor(type: FingerprintType): string {
    const vendors: Record<FingerprintType, string> = {
      [FingerprintType.MOBILE_CHROME_ANDROID]: 'Google Inc.',
      [FingerprintType.MOBILE_CHROME_IOS]: 'Apple Computer, Inc.',
      [FingerprintType.MOBILE_SAFARI_IOS]: 'Apple Computer, Inc.',
      [FingerprintType.MOBILE_FIREFOX_ANDROID]: '',
      [FingerprintType.MOBILE_SAMSUNG_ANDROID]: 'Samsung',
      [FingerprintType.CHROME_WIN]: '',
      [FingerprintType.CHROME_MAC]: '',
      [FingerprintType.CHROME_LINUX]: '',
      [FingerprintType.FIREFOX_WIN]: '',
      [FingerprintType.FIREFOX_MAC]: '',
      [FingerprintType.FIREFOX_LINUX]: '',
      [FingerprintType.SAFARI_MAC]: '',
      [FingerprintType.EDGE_WIN]: '',
      [FingerprintType.EDGE_MAC]: '',
    };
    return vendors[type] || 'Google Inc.';
  }

  private getDesktopVendor(type: FingerprintType): string {
    const vendors: Record<FingerprintType, string> = {
      [FingerprintType.CHROME_WIN]: 'Google Inc.',
      [FingerprintType.CHROME_MAC]: 'Google Inc.',
      [FingerprintType.CHROME_LINUX]: 'Google Inc.',
      [FingerprintType.FIREFOX_WIN]: '',
      [FingerprintType.FIREFOX_MAC]: '',
      [FingerprintType.FIREFOX_LINUX]: '',
      [FingerprintType.SAFARI_MAC]: 'Apple Computer, Inc.',
      [FingerprintType.EDGE_WIN]: 'Microsoft Corporation',
      [FingerprintType.EDGE_MAC]: 'Microsoft Corporation',
      [FingerprintType.MOBILE_CHROME_ANDROID]: '',
      [FingerprintType.MOBILE_CHROME_IOS]: '',
      [FingerprintType.MOBILE_SAFARI_IOS]: '',
      [FingerprintType.MOBILE_FIREFOX_ANDROID]: '',
      [FingerprintType.MOBILE_SAMSUNG_ANDROID]: '',
    };
    return vendors[type] || 'Google Inc.';
  }

  // ==========================================
  // WEBGL & CANVAS
  // ==========================================

  private generateWebGLInfo(isMobile: boolean): WebGLInfo {
    const vendors = isMobile 
      ? ['ARM', 'Qualcomm', 'Imagination Technologies', 'NVIDIA Corporation']
      : ['NVIDIA Corporation', 'Intel Inc.', 'AMD', 'Apple Inc.'];
    
    const renderers = isMobile
      ? ['Mali-G78', 'Adreno 660', 'PowerVR Rogue', 'Apple GPU']
      : ['NVIDIA GeForce RTX 3080', 'Intel Iris Xe Graphics', 'AMD Radeon RX 6800', 'Apple M1'];

    const vendor = vendors[Math.floor(Math.random() * vendors.length)];
    const renderer = renderers[Math.floor(Math.random() * renderers.length)];

    return {
      vendor: 'WebKit',
      renderer: 'WebKit WebGL',
      unmaskedVendor: vendor,
      unmaskedRenderer: renderer,
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
      extensions: [
        'WEBGL_debug_renderer_info',
        'EXT_texture_filter_anisotropic',
        'WEBGL_compressed_texture_s3tc',
        'WEBGL_compressed_texture_astc',
      ],
    };
  }

  private generateCanvasRender(isMobile: boolean): CanvasRender {
    return {
      type: '2d',
      width: isMobile ? 390 : 1920,
      height: isMobile ? 844 : 1080,
      data: `data:image/png;base64,${createHash('md5').update(Math.random().toString()).digest('base64')}`,
      noise: Math.random() * 0.1,
      features: ['text', 'emoji', 'gradient'],
    };
  }

  // ==========================================
  // PLUGINS & MIMETYPES
  // ==========================================

  private generateMobilePlugins(): BrowserPlugin[] {
    return [];
  }

  private generateDesktopPlugins(): BrowserPlugin[] {
    return [
      {
        name: 'Chrome PDF Viewer',
        filename: 'internal-pdf-viewer',
        description: 'Portable Document Format',
        version: 'undefined',
        itemTypes: ['application/pdf', 'text/pdf'],
      },
      {
        name: 'Widevine Content Decryption Module',
        filename: 'widevinecdmadapter.dll',
        description: 'Widevine Content Decryption Module',
        version: '4.10.2710.0',
      },
      {
        name: 'Native Client',
        filename: 'internal-nacl-plugin',
        description: 'Native Client module',
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
      { type: 'application/x-google-chrome-pdf', suffixes: 'pdf', description: 'Portable Document Format', enabledPlugin: 'Chrome PDF Viewer' },
      { type: 'text/html', suffixes: 'html', description: 'HTML document', enabledPlugin: 'HTML' },
      { type: 'text/plain', suffixes: 'txt', description: 'Plain text document', enabledPlugin: 'TXT' },
    ];
  }

  // ==========================================
  // FONTS
  // ==========================================

  private generateMobileFonts(): string[] {
    return [
      'Arial', 'Helvetica', 'Times New Roman', 'Courier New',
      'Georgia', 'Verdana', 'Trebuchet MS', 'Arial Black',
      'Impact', 'Comic Sans MS', '-apple-system', 'BlinkMacSystemFont',
    ];
  }

  private generateDesktopFonts(): string[] {
    return [
      'Arial', 'Helvetica', 'Times New Roman', 'Courier New',
      'Georgia', 'Verdana', 'Trebuchet MS', 'Arial Black',
      'Impact', 'Comic Sans MS', 'Palatino Linotype', 'Book Antiqua',
      'Lucida Console', 'Symbol', 'Webdings', 'Wingdings',
      'MS Serif', 'MS Sans Serif', 'Franklin Gothic Medium',
      'Century Gothic', 'Garamond', 'Bookman Old Style',
    ];
  }

  // ==========================================
  // TLS & HTTP2
  // ==========================================

  private generateTLSFingerprint(): TLSFingerprint {
    return {
      ja3Hash: this.generateJA3Hash(),
      ja3Full: '769,47-53-5-10-61-38-63-49195-49199-49196-49200-49171-49172-156-157-47-53,0-23-65281-10-11-16-5-13-18-51-45-43-21,29-23-24-25-26-256-257-258-259-260,0',
      version: 'TLSv1.3',
      ciphers: [
        'TLS_AES_256_GCM_SHA384',
        'TLS_CHACHA20_POLY1305_SHA256',
        'TLS_AES_128_GCM_SHA256',
        'ECDHE-ECDSA-AES256-GCM-SHA384',
      ],
      extensions: [
        'server_name',
        'extended_master_secret',
        'renegotiation_info',
        'supported_groups',
        'ec_point_formats',
        'session_ticket',
        'application_layer_protocol_negotiation',
      ],
      curves: ['X25519', 'secp256r1', 'secp384r1'],
      pointFormats: ['uncompressed'],
    };
  }

  private generateHTTP2Fingerprint(): HTTP2Fingerprint {
    return {
      akamaiFingerprint: this.generateAkamaiFingerprint(),
      settings: {
        headerTableSize: 65536,
        enablePush: true,
        maxConcurrentStreams: 1000,
        initialWindowSize: 6291456,
        maxFrameSize: 16384,
        maxHeaderListSize: 262144,
      },
      windowUpdate: 6291456,
      priority: {
        exclusive: false,
        dependency: 0,
        weight: 256,
      },
    };
  }

  private generateJA3Hash(): string {
    return createHash('md5').update(Math.random().toString()).digest('hex');
  }

  private generateAkamaiFingerprint(): string {
    return `2;${Math.random().toString(36).substring(7)};${Math.random().toString(36).substring(7)}`;
  }

  // ==========================================
  // BATTERY API
  // ==========================================

  private generateBatteryInfo(isMobile: boolean): BatteryInfo | undefined {
    if (!isMobile) return undefined;
    
    return {
      charging: Math.random() > 0.3,
      chargingTime: Math.random() > 0.5 ? 7200 : Infinity,
      dischargingTime: Math.random() > 0.5 ? 14400 : Infinity,
      level: 0.2 + Math.random() * 0.7,
    };
  }

  // ==========================================
  // NETWORK INFO
  // ==========================================

  private generateNetworkInfo(isMobile: boolean): NetworkInfo {
    const types = isMobile 
      ? ['4g', '3g', 'wifi'] 
      : ['wifi', 'ethernet'];
    
    return {
      effectiveType: types[Math.floor(Math.random() * types.length)] as '4g' | '3g' | 'wifi' | 'ethernet',
      downlink: 1.5 + Math.random() * 8,
      rtt: isMobile ? 50 + Math.floor(Math.random() * 150) : 10 + Math.floor(Math.random() * 40),
      saveData: false,
    };
  }

  // ==========================================
  // SPEECH VOICES
  // ==========================================

  private generateSpeechVoices(isMobile: boolean): SpeechVoice[] {
    const count = isMobile ? 21 + Math.floor(Math.random() * 20) : 40 + Math.floor(Math.random() * 26);
    const voices: SpeechVoice[] = [];
    const locales = ['tr-TR', 'en-US', 'en-GB', 'de-DE', 'fr-FR', 'es-ES', 'it-IT', 'ru-RU', 'ja-JP', 'ko-KR'];
    
    for (let i = 0; i < count; i++) {
      const locale = locales[Math.floor(Math.random() * locales.length)];
      voices.push({
        voiceURI: `voice-${i}`,
        name: `${locale} Voice ${i}`,
        lang: locale,
        localService: Math.random() > 0.5,
        default: i === 0,
      });
    }
    
    return voices;
  }

  // ==========================================
  // SCREEN INFO (availTop için)
  // ==========================================

  private generateScreenInfo(isMobile: boolean): ScreenInfo {
    const isMac = !isMobile && Math.random() > 0.7;
    
    return {
      width: isMobile ? 1179 : 1920,
      height: isMobile ? 2556 : 1080,
      availWidth: isMobile ? 1179 : 1920,
      availHeight: isMobile ? 2556 : (isMac ? 1050 : 1080),
      availLeft: 0,
      availTop: isMac ? 25 : 0,
      colorDepth: 24,
      pixelDepth: 24,
      orientation: {
        angle: isMobile ? 0 : 0,
        type: isMobile ? 'portrait-primary' : 'landscape-primary',
      },
    };
  }

  // ==========================================
  // NAVIGATOR INFO (20+ alan)
  // ==========================================

  private generateNavigatorInfo(isMobile: boolean): NavigatorInfo {
    return {
      appCodeName: 'Mozilla',
      appName: 'Netscape',
      appVersion: isMobile ? '5.0 (iPhone; CPU iPhone OS 17_1_1 like Mac OS X) AppleWebKit/605.1.15' : '5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      buildID: undefined,
      cookieEnabled: true,
      deviceMemory: isMobile ? 8 : 16,
      doNotTrack: null,
      hardwareConcurrency: isMobile ? 8 : 8,
      language: 'tr-TR',
      languages: ['tr-TR', 'tr', 'en-US', 'en'],
      maxTouchPoints: isMobile ? 5 : 0,
      onLine: true,
      platform: isMobile ? 'iPhone' : 'Win32',
      product: 'Gecko',
      productSub: '20030107',
      userAgent: isMobile 
        ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1'
        : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      vendor: isMobile ? 'Apple Computer, Inc.' : 'Google Inc.',
      vendorSub: '',
      webdriver: false,
      pdfViewerEnabled: true,
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

  // ==========================================
  // WINDOW INFO
  // ==========================================

  private generateWindowInfo(isMobile: boolean): WindowInfo {
    return {
      innerWidth: isMobile ? 390 : 1366,
      innerHeight: isMobile ? 844 : 768,
      outerWidth: isMobile ? 390 : 1920,
      outerHeight: isMobile ? 844 : 1080,
      screenX: 0,
      screenY: 0,
      screenLeft: 0,
      screenTop: 0,
      devicePixelRatio: isMobile ? 3 : 1,
      visualViewport: {
        width: isMobile ? 390 : 1366,
        height: isMobile ? 844 : 768,
        scale: 1,
        offsetLeft: 0,
        offsetTop: 0,
        pageLeft: 0,
        pageTop: 0,
      },
    };
  }

  // ==========================================
  // DOCUMENT INFO
  // ==========================================

  private generateDocumentInfo(isMobile: boolean): DocumentInfo {
    return {
      charset: 'UTF-8',
      characterSet: 'UTF-8',
      compatMode: 'CSS1Compat',
      contentType: 'text/html',
      cookie: '',
      documentElement: {
        clientWidth: isMobile ? 390 : 1366,
        clientHeight: isMobile ? 844 : 768,
        scrollWidth: isMobile ? 390 : 1366,
        scrollHeight: isMobile ? 844 : 768,
      },
      domain: 'www.google.com',
      fullscreen: false,
      hidden: false,
      lastModified: new Date().toString(),
      location: {
        href: 'https://www.google.com/search',
        protocol: 'https:',
        host: 'www.google.com',
        hostname: 'www.google.com',
        port: '',
        pathname: '/search',
        search: '',
        hash: '',
      },
      readyState: 'complete',
      referrer: '',
      title: 'Google',
      visibilityState: 'visible',
      webkitVisibilityState: 'visible',
    };
  }

  // ==========================================
  // LOCATION & HISTORY
  // ==========================================

  private generateLocationInfo(): LocationInfo {
    return {
      href: 'https://www.google.com/search',
      protocol: 'https:',
      host: 'www.google.com',
      hostname: 'www.google.com',
      port: '',
      pathname: '/search',
      search: '',
      hash: '',
    };
  }

  private generateHistoryInfo(): HistoryInfo {
    return {
      length: 2,
    };
  }

  // ==========================================
  // MEDIA CAPABILITIES
  // ==========================================

  private generateMediaCapabilities(isMobile: boolean): MediaCapabilities {
    return {
      decodingInfo: {
        supported: true,
        smooth: true,
        powerEfficient: isMobile ? false : true,
      },
      encodingInfo: {
        supported: true,
        smooth: true,
        powerEfficient: isMobile ? false : true,
      },
    };
  }

  // ==========================================
  // TOUCH & INPUT
  // ==========================================

  private generateTouchSupportInfo(isMobile: boolean): TouchSupportInfo {
    return {
      maxTouchPoints: isMobile ? 5 : 0,
      touchEvent: isMobile,
      touchStart: isMobile,
    };
  }

  private generateKeyboardInfo(_isMobile: boolean): KeyboardInfo {
    return {
      getLayoutMap: () => ({}),
    };
  }


  private generatePointerInfo(isMobile: boolean): PointerInfo {
    return {
      maxTouchPoints: isMobile ? 5 : 0,
      pointerEnabled: true,
    };
  }

  private generateGamepadInfo(): GamepadInfo {
    return {
      gamepads: [],
    };
  }

  // ==========================================
  // VR & MEDIA SESSION
  // ==========================================

  private generateVRInfo(): VRInfo {
    return {
      vrDisplays: undefined,
      xr: undefined,
    };
  }

  private generateMediaSessionInfo(): MediaSessionInfo {
    return {
      metadata: null,
      playbackState: 'none',
    };
  }

  // ==========================================
  // WAKE LOCK
  // ==========================================

  private generateWakeLockInfo(isMobile: boolean): WakeLockInfo | undefined {
    if (!isMobile) return undefined;
    
    return {
      request: async () => ({ release: async () => {} }),
    };
  }

  // ==========================================
  // SENSORS
  // ==========================================

  private generateDeviceOrientationInfo(isMobile: boolean): DeviceOrientationInfo | undefined {
    if (!isMobile) return undefined;
    
    return {
      absolute: false,
      alpha: Math.random() * 360,
      beta: -90 + Math.random() * 180,
      gamma: -180 + Math.random() * 360,
    };
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

  // ==========================================
  // NETWORK CONNECTION
  // ==========================================

  private generateNetworkConnectionInfo(isMobile: boolean): NetworkConnectionInfo {
    const connectionTypes = isMobile 
      ? ['4g', '3g', 'wifi'] 
      : ['wifi', 'ethernet'];
    
    return {
      effectiveType: connectionTypes[Math.floor(Math.random() * connectionTypes.length)],
      downlink: 1.5 + Math.random() * 8,
      downlinkMax: 10,
      rtt: isMobile ? 50 + Math.floor(Math.random() * 150) : 10 + Math.floor(Math.random() * 40),
      saveData: false,
      type: connectionTypes[Math.floor(Math.random() * connectionTypes.length)],
    };
  }

  // ==========================================
  // CREDENTIALS & PERMISSIONS
  // ==========================================

  private generateCredentialInfo(): CredentialInfo {
    return {
      get: async () => null,
      create: async () => null,
      preventSilentAccess: async () => {},
      store: async () => {},
    };
  }

  private generatePermissionsInfo(): PermissionsInfo {
    return {
      query: async () => ({ state: 'prompt', onchange: null }),
    };
  }

  // ==========================================
  // PAYMENT
  // ==========================================

  private generatePaymentInfo(isMobile: boolean): PaymentInfo {
    return {
      canMakePayment: async () => isMobile,
      isReadyToPay: async () => isMobile,
    };
  }

  // ==========================================
  // WEB SHARE
  // ==========================================

  private generateWebShareInfo(isMobile: boolean): WebShareInfo {
    return {
      canShare: () => isMobile,
      share: async () => {},
    };
  }

  // ==========================================
  // CONTACTS
  // ==========================================

  private generateContactInfo(): ContactInfo | undefined {
    return undefined;
  }

  // ==========================================
  // CLIPBOARD
  // ==========================================

  private generateClipboardInfo(): ClipboardInfo {
    return {
      read: async () => ({ 
        types: [], 
        getType: async () => new Blob([]) // Boş array ekle
      }),
      readText: async () => '',
      write: async () => {},
      writeText: async () => {},
    };
  }

  // ==========================================
  // MEDIA DEVICES
  // ==========================================

  private generateMediaDevicesInfo(_isMobile: boolean): MediaDevicesInfo {
    return {
      enumerateDevices: async () => [],
      getDisplayMedia: async () => ({ 
        getTracks: () => [], 
        getAudioTracks: () => [], 
        getVideoTracks: () => [] 
      }),
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
      getUserMedia: async () => ({ 
        getTracks: () => [], 
        getAudioTracks: () => [], 
        getVideoTracks: () => [] 
      }),
      ondevicechange: null,
    };
  }

  // ==========================================
  // YARDIMCI METODLAR
  // ==========================================

  private shuffleArray<T>(array: T[]): void {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  }

  private updateMetadata(): void {
    this.fingerprints.metadata.totalCount = this.fingerprints.fingerprints.length;
    this.fingerprints.metadata.mobileCount = this.fingerprints.fingerprints.filter(f => f.type === 'mobile').length;
    this.fingerprints.metadata.desktopCount = this.fingerprints.fingerprints.filter(f => f.type === 'desktop').length;
  }

  /**
   * Fingerprint koleksiyonunu dosyaya kaydeder
   */
  public saveToFile(filename: string): void {
    const filePath = path.join(this.dataDir, filename);
    fs.writeFileSync(filePath, JSON.stringify(this.fingerprints, null, 2));
  }

  /**
   * Fingerprint koleksiyonunu dosyadan yükler
   */
  public loadFromFile(filename: string): FingerprintCollection {
    const filePath = path.join(this.dataDir, filename);
    if (!fs.existsSync(filePath)) {
      return this.initializeCollection();
    }
    
    const data = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(data) as FingerprintCollection;
    
    if (!parsed || !Array.isArray(parsed.fingerprints)) {
      return this.initializeCollection();
    }
    
    this.fingerprints = parsed;
    return this.fingerprints;
  }

  /**
   * Tüm fingerprint'leri döndürür
   */
  public getAllFingerprints(): FingerprintData[] {
    return [...this.fingerprints.fingerprints];
  }

  /**
   * Koleksiyon istatistiklerini döndürür
   */
  public getStats(): FingerprintCollection['metadata'] {
    return { ...this.fingerprints.metadata };
  }
}