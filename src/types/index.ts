/**
 * SERP Click Bot - Tip Tanımlamaları
 * Tüm uygulama genelinde kullanılan TypeScript tipleri
 */

// ==========================================
// LOGGER TİPLERİ
// ==========================================

/**
 * Log seviyeleri enum'u
 * ERROR: Sadece hatalar
 * WARN: Uyarılar
 * INFO: Bilgi mesajları
 * DEBUG: Debug bilgileri
 * TRACE: Detaylı izleme
 */
export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
  TRACE = 4
}



/**
 * Log kaydı yapısı
 * Her log girişi bu formatta saklanır
 */
export interface LogEntry {
  timestamp: string;           // ISO formatında zaman damgası
  level: string;               // Log seviyesi (ERROR, WARN, vb.)
  message: string;             // Log mesajı
  context?: Record<string, unknown>; // Ekstra bağlam bilgisi
  error?: Error | null;        // Hata nesnesi (varsa)
  sessionId?: string;          // Oturum kimliği
  proxy?: string;              // Kullanılan proxy
  fingerprint?: string;        // Tarayıcı fingerprint'i
  duration?: number;          // İşlem süresi (ms)
  success?: boolean;          // Başarı durumu
  url?: string;               // İşlem yapılan URL
  keyword?: string;           // Anahtar kelime
  event?: string;             // Olay tipi
  requiresAction?: boolean;    // Aksiyon gerektiriyor mu?
  detectionType?: string;      // Tespit tipi (bot için)
  confidence?: number;         // Tespit güven skoru
  position?: number;          // SERP pozisyonu
  reason?: string;            // Başarısızlık nedeni
  pageUrl?: string;           // Sayfa URL'si
}

/**
 * Logger yapılandırma seçenekleri
 */
export interface LoggerConfig {
  level: LogLevel;            // Minimum log seviyesi
  logDir: string;             // Log dosyalarının dizini
  consoleOutput: boolean;     // Konsola yazma aktif mi?
  fileOutput: boolean;        // Dosyaya yazma aktif mi?
  maxFileSize: number;        // Maksimum dosya boyutu (MB)
  maxFiles: number;           // Tutulacak maksimum dosya sayısı
  includeTimestamp: boolean;  // Zaman damgası eklensin mi?
  includeContext: boolean;    // Bağlam bilgisi eklensin mi?
}

// ==========================================
// BROWSER TİPLERİ
// ==========================================

/**
 * Tarayıcı yapılandırma ayarları
 */
export interface BrowserConfig {
  headless: boolean;          // Görünmez mod
  viewport: {
    width: number;            // Pencere genişliği
    height: number;           // Pencere yüksekliği
  };
  locale: string;             // Dil ayarı (tr-TR)
  timezone: string;           // Zaman dilimi (Europe/Istanbul)
  userAgent?: string;         // Özel user agent
}

/**
 * Tarayıcı fingerprint bilgisi
 * Her tarayıcı oturumu için benzersiz kimlik
 */
export interface BrowserFingerprint {
  id: string;                 // Benzersiz fingerprint ID
  type: 'mobile' | 'desktop'; // Cihaz tipi
  userAgent: string;           // User agent string
  viewport: {
    width: number;
    height: number;
  };
  deviceMemory?: number;       // Cihaz belleği (GB)
  hardwareConcurrency?: number; // CPU çekirdek sayısı
  platform: string;           // İşletim sistemi platformu
  language: string;           // Tarayıcı dili
  timezone: string;           // Zaman dilimi
  webgl?: {
    vendor: string;           // WebGL vendor
    renderer: string;         // WebGL renderer
  };
  canvas?: string;            // Canvas fingerprint
  audio?: string;             // Audio context fingerprint
  fonts?: string[];           // Yüklü fontlar
  createdAt: string;         // Oluşturulma tarihi
}

// ==========================================
// DAVRANIŞ TİPLERİ
// ==========================================

/**
 * İnsansı davranış yapılandırması
 */
export interface BehaviorConfig {
  typingSpeed: {
    min: number;              // Minimum yazma hızı (ms/karakter)
    max: number;              // Maksimum yazma hızı (ms/karakter)
  };
  mouseSpeed: {
    min: number;              // Minimum fare hızı (ms)
    max: number;              // Maksimum fare hızı (ms)
  };
  dwellTime: {
    min: number;              // Minimum sayfada kalma (ms)
    max: number;              // Maksimum sayfada kalma (ms)
  };
  scrollBehavior: 'smooth' | 'natural' | 'aggressive'; // Scroll davranışı
}

/**
 * Fare hareketi koordinatları
 */
export interface MouseMovement {
  x: number;                  // X koordinatı
  y: number;                  // Y koordinatı
  duration: number;           // Hareket süresi (ms)
  easing: 'ease-in' | 'ease-out' | 'ease-in-out' | 'linear'; // Easing fonksiyonu
}

// ==========================================
// SERP CLICK TİPLERİ
// ==========================================

/**
 * Anahtar kelime yapılandırması
 */
export interface KeywordConfig {
  keyword: string;            // Aranacak anahtar kelime
  targetUrl: string;          // Hedef web sitesi
  targetPosition?: number;    // Hedef SERP pozisyonu (opsiyonel)
  dailyClicks: number;        // Günlük hedef tıklama sayısı
  currentClicks?: number;     // Bugünkü tıklama sayısı
}

/**
 * Tıklama denemesi bilgisi
 */
export interface ClickAttempt {
  keyword: string;            // Anahtar kelime
  targetUrl: string;          // Hedef URL
  proxy: string;              // Kullanılan proxy
  fingerprint: string;        // Kullanılan fingerprint
  sessionId: string;          // Oturum ID
  timestamp: string;          // Zaman damgası
}

/**
 * Başarılı tıklama bilgisi
 */
export interface ClickSuccess extends ClickAttempt {
  position: number;           // Tıklanan pozisyon
  duration: number;           // Sayfada kalma süresi (ms)
}

/**
 * Başarısız tıklama bilgisi
 */
export interface ClickFailure extends ClickAttempt {
  reason: string;             // Başarısızlık nedeni
  error?: Error | null;         // Hata nesnesi (varsa)
}

/**
 * Bot tespiti olayı
 */
export interface BotDetectionEvent {
  detectionType: string;      // Tespit tipi (mouse_pattern, vb.)
  confidence: number;         // Tespit güven skoru (0-1)
  proxy: string;              // Kullanılan proxy
  fingerprint: string;        // Kullanılan fingerprint
  sessionId: string;          // Oturum ID
  pageUrl: string;            // Tespit edilen sayfa
  timestamp: string;          // Zaman damgası
}

// ==========================================
// METRİK TİPLERİ
// ==========================================

/**
 * Günlük performans metrikleri
 */
export interface DailyMetrics {
  totalClicks: number;        // Toplam tıklama
  successfulClicks: number;   // Başarılı tıklama
  failedClicks: number;       // Başarısız tıklama
  successRate: number;        // Başarı oranı (%)
  avgDuration: number;        // Ortalama süre (ms)
  activeProxies: number;      // Aktif proxy sayısı
  activeFingerprints: number; // Aktif fingerprint sayısı
  timestamp: string;          // Metrik zamanı
}

// ==========================================
// CONFIG TİPLERİ (YENİ)
// ==========================================

/**
 * URL ve Anahtar Kelime yapılandırması
 */
export interface UrlKeywordConfig {
  keyword: string;        // Aranacak anahtar kelime
  targetUrl: string;      // Hedef web sitesi
  dailyClicks: number;    // Günlük hedef tıklama sayısı
  maxPage: number;        // Kaç sayfa kontrol edilecek
  startPage: number;      // Hangi sayfadan başlanacak
  isMobil:number
}

/**
 * Proxy item (basitleştirilmiş)
 */
export interface ProxyItem {
  name: string;   // Proxy sağlayıcı adı
  url: string;    // Proxy URL'si
}

/**
 * Proxy yapılandırması (basitleştirilmiş)
 */
export interface ProxyConfig {
  enabled: boolean;
  rotationInterval: number;  // saniye
  list: ProxyItem[];         // ProxyItem = { name, url }
}

/**
 * Ana uygulama yapılandırması (güncellenmiş)
 */
export interface AppConfig {
  appStart: boolean;          // Uygulama çalışsın mı?
  browser: BrowserConfig;
  behavior: BehaviorConfig;
  logging: LoggerConfig;
  proxy: ProxyConfig;
}

// ==========================================
// FINGERPRINT GELİŞMİŞ TİPLERİ (YENİ)
// ==========================================

/**
 * Fingerprint tipi enum'u
 */
export enum FingerprintType {
  CHROME_WIN = 'chrome_win',
  CHROME_MAC = 'chrome_mac',
  CHROME_LINUX = 'chrome_linux',
  FIREFOX_WIN = 'firefox_win',
  FIREFOX_MAC = 'firefox_mac',
  FIREFOX_LINUX = 'firefox_linux',
  SAFARI_MAC = 'safari_mac',
  EDGE_WIN = 'edge_win',
  EDGE_MAC = 'edge_mac',
  MOBILE_CHROME_ANDROID = 'mobile_chrome_android',
  MOBILE_CHROME_IOS = 'mobile_chrome_ios',
  MOBILE_SAFARI_IOS = 'mobile_safari_ios',
  MOBILE_FIREFOX_ANDROID = 'mobile_firefox_android',
  MOBILE_SAMSUNG_ANDROID = 'mobile_samsung_android'
}

/**
 * WebGL bilgi yapısı (fingerprint-generator.ts için)
 */
export interface WebGLInfo {
  vendor: string;
  renderer: string;
  unmaskedVendor?: string;
  unmaskedRenderer?: string;
  aliasedLineWidthRange: [number, number];
  aliasedPointSizeRange: [number, number];
  alphaBits: number;
  blueBits: number;
  depthBits: number;
  greenBits: number;
  redBits: number;
  maxCombinedTextureImageUnits: number;
  maxCubeMapTextureSize: number;
  maxFragmentUniformVectors: number;
  maxRenderbufferSize: number;
  maxTextureImageUnits: number;
  maxTextureSize: number;
  maxVaryingVectors: number;
  maxVertexAttribs: number;
  maxVertexTextureImageUnits: number;
  maxVertexUniformVectors: number;
  precisionFormats: Record<string, any>;
  extensions: string[];
}

/**
 * Tarayıcı eklentisi bilgisi
 */
export interface BrowserPlugin {
  name: string;
  filename: string;
  description: string;
  version?: string;
  itemTypes?: string[];
}

/**
 * MIME tipi bilgisi
 */
export interface MimeType {
  type: string;
  suffixes: string;
  description: string;
  enabledPlugin: string;
}

/**
 * Fingerprint koleksiyonu
 */
export interface FingerprintCollection {
  fingerprints: FingerprintData[];
  metadata: {
    createdAt: Date;
    totalCount: number;
    mobileCount: number;
    desktopCount: number;
    version: string;
  };
}



/**
 * TLS/JA3 Fingerprint bilgisi
 */
export interface TLSFingerprint {
  ja3Hash: string;           // JA3 hash (MD5)
  ja3Full: string;           // JA3 full string (SSLVersion,Cipher,Extension,EllipticCurve,EllipticCurvePointFormat)
  version: string;           // TLS versiyon (TLSv1.2, TLSv1.3)
  ciphers: string[];         // Cipher suite'ler
  extensions: string[];      // TLS extensions
  curves?: string[];         // Elliptic curves (TLS 1.2)
  pointFormats?: string[];   // EC point formats
}

/**
 * HTTP/2 Fingerprint bilgisi
 */
export interface HTTP2Fingerprint {
  akamaiFingerprint?: string;  // Akamai hash (HTTP2)
  settings: {
    headerTableSize: number;
    enablePush: boolean;
    maxConcurrentStreams: number;
    initialWindowSize: number;
    maxFrameSize: number;
    maxHeaderListSize: number;
  };
  windowUpdate: number;
  priority?: {
    exclusive: boolean;
    dependency: number;
    weight: number;
  };
}

/**
 * Gerçek Canvas Render bilgisi
 * Base64 encoded PNG veya hash
 */
export interface CanvasRender {
  type: '2d' | 'webgl';
  width: number;
  height: number;
  data: string;              // Base64 encoded image veya hash
  noise?: number;            // Rastgelelik seviyesi (0-1)
  features?: string[];       // Çizilen şekiller (emoji, text, gradient)
}

/**
 * Gerçek WebGL Render bilgisi
 */
export interface WebGLRender {
  vendor: string;
  renderer: string;
  version: string;           // WebGL 1.0 veya 2.0
  shadingLanguageVersion: string;
  extensions: string[];      // Desteklenen extension'lar
  parameters: Record<string, any>; // WebGL context parameter'leri
  maxTextureSize: number;
  maxViewportDims: number[];
  antialias: boolean;
  redBits: number;
  greenBits: number;
  blueBits: number;
  alphaBits: number;
  depthBits: number;
  stencilBits: number;
}

export interface WebGLInfo {
  vendor: string;
  renderer: string;
  unmaskedVendor?: string;
  unmaskedRenderer?: string;
  aliasedLineWidthRange: [number, number];
  aliasedPointSizeRange: [number, number];
  alphaBits: number;
  blueBits: number;
  depthBits: number;
  greenBits: number;
  redBits: number;
  maxCombinedTextureImageUnits: number;
  maxCubeMapTextureSize: number;
  maxFragmentUniformVectors: number;
  maxRenderbufferSize: number;
  maxTextureImageUnits: number;
  maxTextureSize: number;
  maxVaryingVectors: number;
  maxVertexAttribs: number;
  maxVertexTextureImageUnits: number;
  maxVertexUniformVectors: number;
  precisionFormats: Record<string, any>;
  extensions: string[];
}

export interface CanvasRender {
  type: '2d' | 'webgl';
  width: number;
  height: number;
  data: string;
  noise?: number;
  features?: string[];
  pixelData?: number[];
  isPointInPath?: boolean;
}

export interface BrowserPlugin {
  name: string;
  filename: string;
  description: string;
  version?: string;
  itemTypes?: string[];
}

export interface MimeType {
  type: string;
  suffixes: string;
  description: string;
  enabledPlugin: string;
}

export interface TLSFingerprint {
  ja3Hash: string;
  ja3Full: string;
  version: string;
  ciphers: string[];
  extensions: string[];
  curves?: string[];
  pointFormats?: string[];
}

export interface HTTP2Fingerprint {
  akamaiFingerprint?: string;
  settings: {
    headerTableSize: number;
    enablePush: boolean;
    maxConcurrentStreams: number;
    initialWindowSize: number;
    maxFrameSize: number;
    maxHeaderListSize: number;
  };
  windowUpdate: number;
  priority?: {
    exclusive: boolean;
    dependency: number;
    weight: number;
  };
}

export interface BatteryInfo {
  charging: boolean;
  chargingTime: number;
  dischargingTime: number;
  level: number;
}

export interface NetworkInfo {
  effectiveType: '4g' | '3g' | 'wifi' | 'ethernet';
  downlink: number;
  rtt: number;
  saveData: boolean;
}

export interface SpeechVoice {
  voiceURI: string;
  name: string;
  lang: string;
  localService: boolean;
  default: boolean;
}

export interface ScreenInfo {
  width: number;
  height: number;
  availWidth: number;
  availHeight: number;
  availLeft: number;
  availTop: number;
  colorDepth: number;
  pixelDepth: number;
  orientation: ScreenOrientation;
}

export interface ScreenOrientation {
  angle: number;
  type: 'portrait-primary' | 'portrait-secondary' | 'landscape-primary' | 'landscape-secondary';
}

export interface NavigatorInfo {
  appCodeName: string;
  appName: string;
  appVersion: string;
  buildID?: string;
  cookieEnabled: boolean;
  deviceMemory: number;
  doNotTrack: boolean | null;
  hardwareConcurrency: number;
  language: string;
  languages: string[];
  maxTouchPoints: number;
  onLine: boolean;
  platform: string;
  product: string;
  productSub: string;
  userAgent: string;
  vendor: string;
  vendorSub: string;
  webdriver: boolean;
  pdfViewerEnabled: boolean;
  bluetooth?: any;
  clipboard: any;
  credentials: any;
  keyboard: any;
  mediaCapabilities: any;
  mediaDevices: any;
  permissions: any;
  presentation?: any;
  scheduling?: any;
  storage?: any;
  wakeLock?: any;
  webkitTemporaryStorage?: any;
}

export interface WindowInfo {
  innerWidth: number;
  innerHeight: number;
  outerWidth: number;
  outerHeight: number;
  screenX: number;
  screenY: number;
  screenLeft: number;
  screenTop: number;
  devicePixelRatio: number;
  visualViewport: {
    width: number;
    height: number;
    scale: number;
    offsetLeft: number;
    offsetTop: number;
    pageLeft: number;
    pageTop: number;
  };
}

export interface DocumentInfo {
  charset: string;
  characterSet: string;
  compatMode: string;
  contentType: string;
  cookie: string;
  documentElement: {
    clientWidth: number;
    clientHeight: number;
    scrollWidth: number;
    scrollHeight: number;
  };
  domain: string;
  fullscreen: boolean;
  hidden: boolean;
  lastModified: string;
  location: {
    href: string;
    protocol: string;
    host: string;
    hostname: string;
    port: string;
    pathname: string;
    search: string;
    hash: string;
  };
  readyState: string;
  referrer: string;
  title: string;
  visibilityState: string;
  webkitVisibilityState: string;
}

export interface LocationInfo {
  href: string;
  protocol: string;
  host: string;
  hostname: string;
  port: string;
  pathname: string;
  search: string;
  hash: string;
}

export interface HistoryInfo {
  length: number;
}

export interface MediaCapabilities {
  decodingInfo: {
    supported: boolean;
    smooth: boolean;
    powerEfficient: boolean;
  };
  encodingInfo: {
    supported: boolean;
    smooth: boolean;
    powerEfficient: boolean;
  };
}

export interface DeviceMemoryInfo {
  deviceMemory: number;
}

export interface HardwareConcurrencyInfo {
  hardwareConcurrency: number;
}

export interface TouchSupportInfo {
  maxTouchPoints: number;
  touchEvent: boolean;
  touchStart: boolean;
}

export interface KeyboardInfo {
  getLayoutMap: () => any;
}

export interface PointerInfo {
  maxTouchPoints: number;
  pointerEnabled: boolean;
}

export interface GamepadInfo {
  gamepads: any[];
}

export interface VRInfo {
  vrDisplays?: any;
  xr?: any;
}

export interface MediaSessionInfo {
  metadata: any;
  playbackState: string;
}

export interface WakeLockInfo {
  request: () => Promise<{ release: () => Promise<void> }>;
}

export interface DeviceOrientationInfo {
  absolute: boolean;
  alpha: number;
  beta: number;
  gamma: number;
}

export interface DeviceMotionInfo {
  acceleration: { x: number; y: number; z: number };
  accelerationIncludingGravity: { x: number; y: number; z: number };
  rotationRate: { alpha: number; beta: number; gamma: number };
  interval: number;
}

export interface ProximityInfo {
  value?: number;
  min?: number;
  max?: number;
  near?: boolean;
}

export interface AmbientLightInfo {
  value?: number;
}

export interface NetworkConnectionInfo {
  effectiveType: string;
  downlink: number;
  downlinkMax?: number;
  rtt: number;
  saveData: boolean;
  type: string;
}

export interface CredentialInfo {
  get: () => Promise<any>;
  create: () => Promise<any>;
  preventSilentAccess: () => Promise<void>;
  store: () => Promise<void>;
}

export interface PermissionsInfo {
  query: () => Promise<{ state: string; onchange: any }>;
}

export interface PaymentInfo {
  canMakePayment: () => Promise<boolean>;
  isReadyToPay: () => Promise<boolean>;
}

export interface WebShareInfo {
  canShare: () => boolean;
  share: () => Promise<void>;
}

export interface ContactInfo {
  select?: () => Promise<any[]>;
}

export interface ClipboardInfo {
  read: () => Promise<any>;
  readText: () => Promise<string>;
  write: () => Promise<void>;
  writeText: () => Promise<void>;
}

export interface MediaDevicesInfo {
  enumerateDevices: () => Promise<any[]>;
  getDisplayMedia: () => Promise<any>;
  getSupportedConstraints: () => any;
  getUserMedia: () => Promise<any>;
  ondevicechange: any;
}

export interface PluginArray {
  length: number;
  item: (index: number) => any;
  namedItem: (name: string) => any;
  refresh: () => void;
}

export interface MimeTypeArray {
  length: number;
  item: (index: number) => any;
  namedItem: (name: string) => any;
}

// ==========================================
// ANA FINGERPRINT DATA TİPİ
// ==========================================

export interface FingerprintData {
  id: string;
  type: 'mobile' | 'desktop';
  userAgent: string;
  viewport: { width: number; height: number };
  screenResolution: { width: number; height: number };
  colorDepth: number;
  pixelRatio: number;
  timezone: string;
  language: string;
  languages: string[];
  platform: string;
  cpuCores: number;
  memory: number;
  doNotTrack: boolean | null;
  cookiesEnabled: boolean;
  localStorage: boolean;
  sessionStorage: boolean;
  indexedDB: boolean;
  webGL: WebGLInfo;
  canvas: CanvasRender;
  fonts: string[];
  plugins: BrowserPlugin[];
  mimeTypes: MimeType[];
  webdriver: boolean;
  chrome: boolean;
  isMobile: boolean;
  touchSupport: boolean;
  deviceMemory: number;
  hardwareConcurrency: number;
  maxTouchPoints: number;
  vendor: string;
  product: string;
  productSub: string;
  oscpu?: string;
  buildID?: string;
  tlsFingerprint?: TLSFingerprint;
  http2Fingerprint?: HTTP2Fingerprint;
  ja3Hash?: string;
  akamaiFingerprint?: string;
  battery?: BatteryInfo;
  network: NetworkInfo;
  speechVoices: SpeechVoice[];
  speechSynthesisVoices?: number; // ✅ Eklendi (test için)
  screen: ScreenInfo;
  navigator: NavigatorInfo;
  window: WindowInfo;
  document: DocumentInfo;
  location: LocationInfo;
  history: HistoryInfo;
  mediaCapabilities: MediaCapabilities;
  touchSupportInfo: TouchSupportInfo;
  keyboard: KeyboardInfo;
  pointer: PointerInfo;
  gamepad: GamepadInfo;
  vr: VRInfo;
  mediaSession: MediaSessionInfo;
  wakeLock?: WakeLockInfo;
  deviceOrientation?: DeviceOrientationInfo;
  deviceMotion?: DeviceMotionInfo;
  proximity?: ProximityInfo;
  ambientLight?: AmbientLightInfo;
  connection: NetworkConnectionInfo;
  credentials: CredentialInfo;
  permissions: PermissionsInfo;
  payment: PaymentInfo;
  webShare: WebShareInfo;
  contacts?: ContactInfo;
  clipboard: ClipboardInfo;
  mediaDevices: MediaDevicesInfo;
  pdfViewerEnabled?: boolean; // ✅ Eklendi (test için)
  pluginsLength?: number; // ✅ Eklendi (test için)
  mimeTypesLength?: number; // ✅ Eklendi (test için)
}

export interface FingerprintCollection {
  fingerprints: FingerprintData[];
  metadata: {
    createdAt: Date;
    totalCount: number;
    mobileCount: number;
    desktopCount: number;
    version: string;
  };
}


