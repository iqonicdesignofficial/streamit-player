import { DrmConfig, DrmSystemConfig, FairPlayConfig } from './types';
import type { PlayerController } from './PlayerController';

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function getErrorName(err: unknown): string | undefined {
  return err instanceof Error ? err.name : undefined;
}

let isCreateSessionPatched = false;
const mediaKeysToDrmManager = new WeakMap<MediaKeys, DrmManager>();
const videoToDrmManager = new WeakMap<HTMLVideoElement, DrmManager>();
const mediaKeysToKeySystem = new WeakMap<MediaKeys, string>();
const sessionToDrmManager = new WeakMap<object, DrmManager>();
const closedSessionsTracked = new WeakSet<object>();

export type EmeDiagnostics = {
  requestMediaKeySystemAccess: boolean;
  mediaKeysCreated: boolean;
  mediaKeysAttached: boolean;
  encryptedEventsCount: number;
  challengesGenerated: number;
  licenseRequestsSent: number;
  licenseResponsesReceived: number;
  sessionsUpdated: number;
  keyStatusesChanges: number;
  usableKeysCount: number;
  expiredKeysCount: number;
  outputRestrictedCount: number;
  internalErrorsCount: number;
  closedSessionsCount: number;
  lastInternalError: string | null;
  certificatesLoaded: number;
  certificateLoadLatenciesMs: number[];
  licenseRequestLatenciesMs: number[];
  retryCount: number;
};

function createEmptyEmeDiagnostics(): EmeDiagnostics {
  return {
    requestMediaKeySystemAccess: false,
    mediaKeysCreated: false,
    mediaKeysAttached: false,
    encryptedEventsCount: 0,
    challengesGenerated: 0,
    licenseRequestsSent: 0,
    licenseResponsesReceived: 0,
    sessionsUpdated: 0,
    keyStatusesChanges: 0,
    usableKeysCount: 0,
    expiredKeysCount: 0,
    outputRestrictedCount: 0,
    internalErrorsCount: 0,
    closedSessionsCount: 0,
    lastInternalError: null,
    certificatesLoaded: 0,
    certificateLoadLatenciesMs: [],
    licenseRequestLatenciesMs: [],
    retryCount: 0,
  };
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }

  const base64 =
    typeof window !== 'undefined' && typeof window.btoa === 'function'
      ? window.btoa(binary)
      : Buffer.from(bytes).toString('base64');

  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function isLikelyHex(value: string): boolean {
  const normalized = value.replace(/[\s:-]/g, '');
  return normalized.length > 0 && normalized.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(normalized);
}

export function normalizeClearKeyValue(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';

  if (isLikelyHex(trimmed)) {
    const clean = trimmed.replace(/[\s:-]/g, '');
    const matched = clean.match(/.{1,2}/g);
    if (!matched) return '';
    const bytes = new Uint8Array(matched.map((byte) => parseInt(byte, 16)));
    return bytesToBase64Url(bytes);
  }

  return trimmed.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

export function normalizeClearKeys(clearkeys?: Record<string, string>): Record<string, string> {
  if (!clearkeys) return {};

  const normalized: Record<string, string> = {};
  Object.entries(clearkeys).forEach(([kid, k]) => {
    normalized[normalizeClearKeyValue(kid)] = normalizeClearKeyValue(k);
  });
  return normalized;
}

function patchCreateSession() {
  if (isCreateSessionPatched) return;
  if (
    typeof window === 'undefined' ||
    typeof MediaKeys === 'undefined' ||
    typeof MediaKeys.prototype.createSession !== 'function'
  ) {
    return;
  }

  isCreateSessionPatched = true;

  // 1. HTMLVideoElement.prototype.setMediaKeys patch to capture ownership when keys are bound to a player video
  if (typeof HTMLVideoElement !== 'undefined' && HTMLVideoElement.prototype.setMediaKeys) {
    const originalSetMediaKeys = HTMLVideoElement.prototype.setMediaKeys;
    HTMLVideoElement.prototype.setMediaKeys = function (this: HTMLVideoElement, mediaKeys: MediaKeys | null) {
      const manager = videoToDrmManager.get(this);
      if (manager && mediaKeys) {
        mediaKeysToDrmManager.set(mediaKeys, manager);
      }
      return originalSetMediaKeys.call(this, mediaKeys);
    };
  }

  // 2. MediaKeySystemAccess.prototype.createMediaKeys patch to record the key system name
  if (typeof MediaKeySystemAccess !== 'undefined' && MediaKeySystemAccess.prototype.createMediaKeys) {
    const originalCreateMediaKeys = MediaKeySystemAccess.prototype.createMediaKeys;
    MediaKeySystemAccess.prototype.createMediaKeys = function (this: MediaKeySystemAccess) {
      const keySystem = this.keySystem;
      const promise = originalCreateMediaKeys.call(this);
      promise.then((mediaKeys) => {
        mediaKeysToKeySystem.set(mediaKeys, keySystem);
      }).catch(() => {});
      return promise;
    };
  }

  // 3. MediaKeys.prototype.createSession patch to register session and dispatch events when owned
  const originalCreateSession = MediaKeys.prototype.createSession;
  MediaKeys.prototype.createSession = function (this: MediaKeys, sessionType?: MediaKeySessionType) {
    const session = originalCreateSession.call(this, sessionType);
    const manager = mediaKeysToDrmManager.get(this);
    const system = mediaKeysToKeySystem.get(this) || 'unknown';
    if (manager) {
      sessionToDrmManager.set(session, manager);
      manager.registerSession(session);

      session.addEventListener('keystatuseschange', () => {
        const keyStatuses: Record<string, string> = {};
        manager.recordKeyStatusesChange(session);
        session.keyStatuses.forEach((status, keyId) => {
          const hexKeyId = manager.bufferToHex(keyId);
          keyStatuses[hexKeyId] = status;

          if (status === 'output-restricted') {
            manager.triggerDrmError('Playback restricted by HDCP output requirements.', 'certificate');
          } else if (status === 'expired') {
            manager.triggerDrmError('Playback key has expired.', 'certificate');
          }
        });
        const controller1 = manager.getController();
        if (controller1) {
          controller1.dispatchEvent('drmkeychange', { session, keyStatuses });
        }
      });

      session.addEventListener('message', (e: MediaKeyMessageEvent) => {
        manager.recordChallengeGenerated();
        const controller2 = manager.getController();
        if (controller2) {
          controller2.dispatchEvent('drmmessage', {
            session,
            messageType: e.messageType,
            message: e.message,
          });
        }
      });

      const controller3 = manager.getController();
      if (controller3) {
        controller3.dispatchEvent('drmsessioncreated', { session, system });
      }
    }
    return session;
  };

  if (typeof MediaKeySession !== 'undefined' && typeof MediaKeySession.prototype.update === 'function') {
    const originalUpdate = MediaKeySession.prototype.update;
    MediaKeySession.prototype.update = async function (this: MediaKeySession, response: BufferSource) {
      const result = await originalUpdate.call(this, response);
      const manager = sessionToDrmManager.get(this);
      if (manager) {
        manager.recordSessionUpdated();
      }
      return result;
    };
  }

  if (typeof MediaKeySession !== 'undefined' && typeof MediaKeySession.prototype.close === 'function') {
    const originalClose = MediaKeySession.prototype.close;
    MediaKeySession.prototype.close = async function (this: MediaKeySession) {
      const result = await originalClose.call(this);
      const manager = sessionToDrmManager.get(this);
      if (manager && !closedSessionsTracked.has(this)) {
        closedSessionsTracked.add(this);
        manager.recordClosedSession(this);
      }
      return result;
    };
  }
}

/**
 * Checks if a specific key system is supported by the client browser.
 * SSR-safe, handles rejection gracefully, and never throws.
 */
export async function isKeySystemSupported(
  keySystem: string,
  contentType = 'video/mp4; codecs="avc1.640028"'
): Promise<boolean> {
  if (
    typeof window === 'undefined' ||
    typeof navigator === 'undefined' ||
    typeof navigator.requestMediaKeySystemAccess !== 'function'
  ) {
    return false;
  }
  try {
    const config: MediaKeySystemConfiguration[] = [
      {
        initDataTypes: ['cenc', 'keyids', 'webm', 'skd', 'sinf'],
        videoCapabilities: [{ contentType }],
      },
    ];
    await navigator.requestMediaKeySystemAccess(keySystem, config);
    return true;
  } catch (e) {
    return false;
  }
}

export async function isWidevineSupported(): Promise<boolean> {
  return isKeySystemSupported('com.widevine.alpha');
}

/**
 * Checks if Microsoft PlayReady DRM is supported.
 */
export async function isPlayReadySupported(): Promise<boolean> {
  const systems = [
    'com.microsoft.playready',
    'com.microsoft.playready.recommendation',
    'com.chromecast.playready',
  ];
  for (const sys of systems) {
    if (await isKeySystemSupported(sys)) return true;
  }
  return false;
}

/**
 * Checks if Apple FairPlay DRM is supported.
 * Supports standard EME and legacy WebKit prefixed checks.
 */
export async function isFairPlaySupported(): Promise<boolean> {
  if (typeof window === 'undefined') return false;

  const systems = ['com.apple.fps', 'com.apple.fps.1_0', 'com.apple.fps.2_0', 'com.apple.fps.3_0'];
  for (const sys of systems) {
    if (await isKeySystemSupported(sys)) return true;
  }

  // Legacy prefixed check for older Safari versions/webviews
  if (
    typeof window.WebKitMediaKeys === 'function' &&
    typeof window.WebKitMediaKeys.isTypeSupported === 'function'
  ) {
    try {
      return window.WebKitMediaKeys.isTypeSupported('com.apple.fps', 'video/mp4');
    } catch (e) {
      return false;
    }
  }

  return false;
}

/**
 * Checks if ClearKey decryption is supported.
 */
export async function isClearKeySupported(): Promise<boolean> {
  return isKeySystemSupported('org.w3.clearkey');
}

/**
 * Detects all supported DRM key systems dynamically.
 * SSR-safe, returns support status mapping without throwing.
 */
export async function detectSupportedKeySystems(): Promise<Record<string, boolean>> {
  const [widevine, playready, fairplay, clearkey] = await Promise.all([
    isWidevineSupported(),
    isPlayReadySupported(),
    isFairPlaySupported(),
    isClearKeySupported(),
  ]);
  return {
    widevine,
    playready,
    fairplay,
    clearkey,
  };
}

/**
 * Core DRM engine managing browser EME setups, certificates caching,
 * license request pipelines, and active sessions garbage collections.
 */
export class DrmManager {
  public static activeManagers = new Set<DrmManager>();
  public emeDiagnostics: EmeDiagnostics = createEmptyEmeDiagnostics();

  private video: HTMLVideoElement | null = null;
  private config: DrmConfig | null = null;
  private controller: PlayerController | null = null;
  private mediaKeys: MediaKeys | null = null;
  private activeSessions: Set<MediaKeySession> = new Set();

  /** Package-internal accessors used by DrmValidator's diagnostics report,
   * which otherwise has no typed way to inspect this manager's private
   * config/session state. */
  public getConfig(): DrmConfig | null {
    return this.config;
  }

  public getActiveSessions(): Set<MediaKeySession> {
    return this.activeSessions;
  }
  private isDestroyed = false;
  private destroyAbortController: AbortController = new AbortController();
  private eventListeners: Array<{
    target: EventTarget;
    type: string;
    listener: EventListenerOrEventListenerObject;
  }> = [];
  private sessionToContentId = new WeakMap<object, string>();
  private pendingLicenseRequests = new Map<string, number[]>();

  // Global static cache for fetched server certificates to avoid duplicate requests
  private static certCache = new Map<string, Uint8Array>();

  /**
   * Bind DrmManager to HTMLVideoElement with DRM configurations.
   * Does not run active browser CDM integrations until requested.
   */
  public load(video: HTMLVideoElement, config: DrmConfig, controller: PlayerController, skipVideoListeners = false) {
    this.destroy();

    this.video = video;
    this.config = config;
    this.controller = controller;
    this.isDestroyed = false;
    this.destroyAbortController = new AbortController();
    this.emeDiagnostics = createEmptyEmeDiagnostics();
    this.pendingLicenseRequests.clear();

    DrmManager.activeManagers.add(this);

    // Map HTMLVideoElement to this DrmManager instance
    videoToDrmManager.set(video, this);

    // Lazily activate EME prototype interceptor
    patchCreateSession();

    if (!skipVideoListeners) {
      const onEncrypted = (e: Event) => {
        this.handleEncryptedEvent(e as MediaEncryptedEvent);
      };

      const onWebkitNeedKey = (e: Event) => {
        const initData = (e as WebKitNeedKeyEvent).initData;
        if (initData) {
          const initDataArray = initData instanceof Uint8Array
            ? initData
            : new Uint8Array(initData);
          this.initializeLegacyWebKitSession(initDataArray);
        }
      };

      this.video.addEventListener('encrypted', onEncrypted);
      this.video.addEventListener('webkitneedkey', onWebkitNeedKey);

      this.eventListeners.push({ target: this.video, type: 'encrypted', listener: onEncrypted });
      this.eventListeners.push({ target: this.video, type: 'webkitneedkey', listener: onWebkitNeedKey });
    }
  }

  public registerSession(session: MediaKeySession) {
    this.activeSessions.add(session);
    sessionToDrmManager.set(session, this);
  }

  public unregisterSession(session: MediaKeySession) {
    this.activeSessions.delete(session);
    sessionToDrmManager.delete(session);
  }

  public triggerDrmError(
    message: string,
    errorType: 'key-system' | 'session' | 'license' | 'certificate',
    originalError?: unknown
  ) {
    this.handleDrmError(message, errorType, originalError);
  }

  /**
   * Handle video element standard encrypted event and trigger EME flow.
   */
  public async handleEncryptedEvent(event: MediaEncryptedEvent) {
    if (this.isDestroyed || !this.video || !this.config) return;

    const initDataType = event.initDataType;
    const initData = event.initData;
    if (!initData) return;

    this.emeDiagnostics.encryptedEventsCount += 1;
    await this.initializeSession(initDataType, new Uint8Array(initData));
  }

  /**
   * Auto-selects the supported key system matching the configuration.
   */
  private async selectSupportedKeySystem(): Promise<{
    keySystem: string;
    config: DrmSystemConfig;
  } | null> {
    if (!this.config) return null;

    if (this.config.widevine && (await isWidevineSupported())) {
      return { keySystem: 'com.widevine.alpha', config: this.config.widevine };
    }

    if (this.config.playready && (await isPlayReadySupported())) {
      const systems = [
        'com.microsoft.playready',
        'com.microsoft.playready.recommendation',
        'com.chromecast.playready',
      ];
      for (const sys of systems) {
        if (await isKeySystemSupported(sys)) {
          return { keySystem: sys, config: this.config.playready };
        }
      }


    }

    if (this.config.fairplay && (await isFairPlaySupported())) {
      const systems = ['com.apple.fps', 'com.apple.fps.1_0', 'com.apple.fps.2_0', 'com.apple.fps.3_0'];
      for (const sys of systems) {
        if (await isKeySystemSupported(sys)) {
          return { keySystem: sys, config: this.config.fairplay };
        }
      }
      return { keySystem: 'com.apple.fps', config: this.config.fairplay };
    }

    if (this.config.clearkey && (await isClearKeySupported())) {
      return { keySystem: 'org.w3.clearkey', config: this.config.clearkey };
    }

    return null;
  }

  /**
   * Lazily ensure MediaKeys instantiation and set them on video.
   */
  private async ensureMediaKeys(keySystem: string, systemConfig: DrmSystemConfig): Promise<MediaKeys> {
    if (this.mediaKeys) return this.mediaKeys;

    if (!this.video) {
      throw new Error('No video element attached.');
    }

    try {
      this.emeDiagnostics.requestMediaKeySystemAccess = true;
      const robustnessVideo = this.config?.robustness?.video || '';
      const robustnessAudio = this.config?.robustness?.audio || '';

      const videoCapabilities: MediaKeySystemMediaCapability[] = [
        {
          contentType: 'video/mp4; codecs="avc1.640028"',
          ...(robustnessVideo ? { robustness: robustnessVideo } : {}),
        },
        {
          contentType: 'video/mp4; codecs="avc1.4d401e"',
          ...(robustnessVideo ? { robustness: robustnessVideo } : {}),
        },
        {
          contentType: 'video/mp4',
          ...(robustnessVideo ? { robustness: robustnessVideo } : {}),
        },
        {
          contentType: 'video/webm; codecs="vp9"',
          ...(robustnessVideo ? { robustness: robustnessVideo } : {}),
        },
      ];

      const audioCapabilities: MediaKeySystemMediaCapability[] = [
        {
          contentType: 'audio/mp4; codecs="mp4a.40.2"',
          ...(robustnessAudio ? { robustness: robustnessAudio } : {}),
        },
        {
          contentType: 'audio/mp4',
          ...(robustnessAudio ? { robustness: robustnessAudio } : {}),
        },
        {
          contentType: 'audio/webm; codecs="opus"',
          ...(robustnessAudio ? { robustness: robustnessAudio } : {}),
        },
      ];

      const config: MediaKeySystemConfiguration[] = [
        // 1. Both Video and Audio capabilities (Preferred)
        {
          initDataTypes: ['cenc', 'keyids', 'webm', 'skd', 'sinf'],
          videoCapabilities,
          audioCapabilities,
          sessionTypes: ['temporary'],
          persistentState: this.config?.persistentState || 'optional',
          distinctiveIdentifier: this.config?.distinctiveIdentifier || 'optional',
        },
        // 2. Video capabilities only (Fallback if audio capabilities check fails)
        {
          initDataTypes: ['cenc', 'keyids', 'webm', 'skd', 'sinf'],
          videoCapabilities,
          sessionTypes: ['temporary'],
          persistentState: this.config?.persistentState || 'optional',
          distinctiveIdentifier: this.config?.distinctiveIdentifier || 'optional',
        },
        // 3. Audio capabilities only (Fallback if video capabilities check fails)
        {
          initDataTypes: ['cenc', 'keyids', 'webm', 'skd', 'sinf'],
          audioCapabilities,
          sessionTypes: ['temporary'],
          persistentState: this.config?.persistentState || 'optional',
          distinctiveIdentifier: this.config?.distinctiveIdentifier || 'optional',
        },
        // 4. Fallback with state and identifier disabled (For strict/private browsing/Incognito)
        {
          initDataTypes: ['cenc', 'keyids', 'webm', 'skd', 'sinf'],
          videoCapabilities,
          sessionTypes: ['temporary'],
          persistentState: 'not-allowed',
          distinctiveIdentifier: 'not-allowed',
        },
      ];

      const access = await navigator.requestMediaKeySystemAccess(keySystem, config);
      if (this.isDestroyed) {
        throw new DOMException('Aborted', 'AbortError');
      }
      const mediaKeys = await access.createMediaKeys();
      this.emeDiagnostics.mediaKeysCreated = true;
      if (this.isDestroyed) {
        throw new DOMException('Aborted', 'AbortError');
      }

      // Register MediaKeys for EME session interception mapping
      mediaKeysToDrmManager.set(mediaKeys, this);

      // Load server certificate if provided
      const cert = await this.loadCertificate(systemConfig);
      if (this.isDestroyed) {
        throw new DOMException('Aborted', 'AbortError');
      }
      if (cert) {
        await mediaKeys.setServerCertificate(cert as BufferSource);
        if (this.isDestroyed) {
          throw new DOMException('Aborted', 'AbortError');
        }
      }

      if (!this.video) {
        throw new DOMException('Aborted', 'AbortError');
      }
      await this.video.setMediaKeys(mediaKeys);
      this.mediaKeys = mediaKeys;
      this.emeDiagnostics.mediaKeysAttached = true;
      return mediaKeys;
    } catch (e: unknown) {
      if (getErrorName(e) === 'AbortError') {
        throw e;
      }
      this.handleDrmError(
        `Failed to initialize MediaKeys for ${keySystem}: ${getErrorMessage(e)}`,
        'key-system',
        e
      );
      throw e;
    }
  }

  /**
   * Helper fetch wrapper managing transient failure retries, timeouts, and destroy abort events.
   */
  private async fetchWithRetryAndTimeout(
    url: string,
    options: RequestInit,
    retryCount = 3,
    timeoutMs = 10000
  ): Promise<Response> {
    let attempt = 0;
    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    while (attempt <= retryCount) {
      if (this.isDestroyed || this.destroyAbortController.signal.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      const attemptAbortController = new AbortController();
      const signal = attemptAbortController.signal;

      const onAbort = () => attemptAbortController.abort();
      this.destroyAbortController.signal.addEventListener('abort', onAbort);

      const timeoutId = setTimeout(() => {
        attemptAbortController.abort();
      }, timeoutMs);

      try {
        const response = await fetch(url, { ...options, signal });
        clearTimeout(timeoutId);
        this.destroyAbortController.signal.removeEventListener('abort', onAbort);

        if (response.ok) {
          return response;
        }

        if (response.status >= 500 && attempt < retryCount) {
          attempt++;
          await delay(Math.pow(2, attempt) * 100);
          continue;
        }

        throw new Error(`Server returned HTTP status ${response.status}`);
      } catch (err: unknown) {
        clearTimeout(timeoutId);
        this.destroyAbortController.signal.removeEventListener('abort', onAbort);

        if (this.isDestroyed || this.destroyAbortController.signal.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }

        if (attempt < retryCount) {
          attempt++;
          await delay(Math.pow(2, attempt) * 100);
          continue;
        }
        throw err;
      }
    }
    throw new Error('Request failed after maximum retries');
  }

  /**
   * Load and cache server certificate DER binary.
   */
  public async loadCertificate(systemConfig: DrmSystemConfig): Promise<Uint8Array | null> {
    if (!systemConfig) return null;

    if (systemConfig.serverCertificate instanceof Uint8Array) {
      this.recordCertificateLoaded(0);
      return systemConfig.serverCertificate;
    }

    const certUrl = systemConfig.serverCertificateUrl || (systemConfig as FairPlayConfig).certificateUrl;
    if (!certUrl) return null;

    const cached = DrmManager.certCache.get(certUrl);
    if (cached) {
      this.recordCertificateLoaded(0);
      return cached;
    }

    const retryCount = systemConfig.retryCount ?? this.config?.retryCount ?? 3;
    const timeout = systemConfig.timeout ?? this.config?.timeout ?? 10000;
    const startedAt = this.now();

    try {
      const response = await this.fetchWithRetryAndTimeout(certUrl, { method: 'GET' }, retryCount, timeout);
      const arrayBuffer = await response.arrayBuffer();
      const certData = new Uint8Array(arrayBuffer);
      DrmManager.certCache.set(certUrl, certData);
      this.recordCertificateLoaded(this.now() - startedAt);
      return certData;
    } catch (e: unknown) {
      if (getErrorName(e) === 'AbortError') {
        throw e;
      }
      this.handleDrmError('Failed to load server certificate.', 'certificate', e);
      throw e;
    }
  }

  /**
   * EME License request acquisition pipeline.
   */
  private async fetchLicense(
    licenseUrl: string,
    challenge: ArrayBuffer,
    customHeaders?: Record<string, string>,
    withCredentials?: boolean
  ): Promise<ArrayBuffer> {
    const system = this.getConfiguredSystemName();
    const systemConfig = this.resolveSystemConfig(system);
    const retryCount = systemConfig?.retryCount ?? this.config?.retryCount ?? 3;
    const timeout = systemConfig?.timeout ?? this.config?.timeout ?? 10000;

    const requestKey = this.recordLicenseRequest(system, licenseUrl);
    const headers = {
      'Content-Type': 'application/octet-stream',
      ...customHeaders,
    };

    const options: RequestInit = {
      method: 'POST',
      headers,
      body: challenge,
    };
    if (withCredentials) {
      options.credentials = 'include';
    }

    let responseReceived = false;
    try {
      const response = await this.fetchWithRetryAndTimeout(licenseUrl, options, retryCount, timeout);
      responseReceived = true;
      return await response.arrayBuffer();
    } catch (err: unknown) {
      if (getErrorName(err) === 'AbortError') {
        throw err;
      }
      throw err;
    } finally {
      this.recordLicenseResponse(requestKey, responseReceived);
    }
  }

  /**
   * Resolve the config block for a given DRM system key name.
   */
  private resolveSystemConfig(system: string): DrmSystemConfig | undefined {
    if (!this.config) return undefined;
    switch (system) {
      case 'widevine':
        return this.config.widevine;
      case 'playready':
        return this.config.playready;
      case 'fairplay':
        return this.config.fairplay;
      case 'clearkey':
        return this.config.clearkey;
      default:
        return undefined;
    }
  }

  /**
   * Standard EME Session creation and challenge update loop.
   */
  private async initializeSession(initDataType: string, initData: Uint8Array) {
    const selected = await this.selectSupportedKeySystem();
    if (!selected) {
      this.handleDrmError('No supported key system found for DRM configuration.', 'key-system');
      return;
    }

    const { keySystem, config: systemConfig } = selected;
    let processedInitData = initData;
    let contentId = '';

    // Standard Apple FairPlay initData preparation & Content ID extraction
    if (keySystem.includes('fps') || keySystem.includes('apple')) {
      const fairplayConfig = systemConfig as FairPlayConfig;
      contentId = typeof fairplayConfig.extractContentId === 'function'
        ? fairplayConfig.extractContentId(initData)
        : this.getContentId(initData);
      processedInitData = this.prepareFairPlayInitData(initData);
    }

    try {
      const mediaKeys = await this.ensureMediaKeys(keySystem, systemConfig);
      const session = mediaKeys.createSession('temporary');
      this.activeSessions.add(session);

      if (contentId) {
        this.sessionToContentId.set(session, contentId);
      }

      const onMessage = async (e: MediaKeyMessageEvent) => {
        try {
          const challenge = e.message;
          const licenseUrl = systemConfig.licenseUrl || '';

          if (keySystem === 'org.w3.clearkey' && this.config?.clearkey?.clearkeys) {
            await this.handleClearKeyInlineUpdate(session);
          } else {
            if (!licenseUrl) {
              throw new Error('No license URL configured.');
            }
            let response: ArrayBuffer;
            if (keySystem.includes('fps') || keySystem.includes('apple')) {
              const sessionContentId = this.sessionToContentId.get(session) || '';
              response = await this.fetchFairPlayLicense(
                licenseUrl,
                challenge,
                sessionContentId,
                systemConfig.headers,
                systemConfig.withCredentials
              );
            } else {
              response = await this.fetchLicense(
                licenseUrl,
                challenge,
                systemConfig.headers,
                systemConfig.withCredentials
              );
            }
            if (this.isDestroyed) return;
            await session.update(response);
          }
        } catch (err: unknown) {
          this.handleDrmError(`License acquisition failed: ${getErrorMessage(err)}`, 'license', err);
        }
      };

      session.addEventListener('message', onMessage as unknown as EventListener);
      this.eventListeners.push({ target: session, type: 'message', listener: onMessage as unknown as EventListener });

      await session.generateRequest(initDataType, processedInitData as BufferSource);
    } catch (e: unknown) {
      this.handleDrmError(`Failed to create or run MediaKeySession: ${getErrorMessage(e)}`, 'session', e);
    }
  }

  /**
   * Legacy Safari WebKitMediaKeys implementation.
   */
  private async initializeLegacyWebKitSession(initData: Uint8Array) {
    if (!this.video || !this.config?.fairplay) return;

    const systemConfig = this.config.fairplay;
    const contentId = typeof systemConfig.extractContentId === 'function'
      ? systemConfig.extractContentId(initData)
      : this.getContentId(initData);

    try {
      const WebKitMediaKeys = window.WebKitMediaKeys;
      if (!WebKitMediaKeys) {
        throw new Error('WebKitMediaKeys is unsupported on this browser.');
      }

      const cert = await this.loadCertificate(systemConfig);
      if (!cert) {
        throw new Error('FairPlay certificate is required.');
      }

      // Legacy Safari WebKitMediaKeys requires wrapped initData to generate the challenge
      const wrappedInitData = this.concatInitData(contentId, cert);

      const keys = new WebKitMediaKeys('com.apple.fps');
      // Legacy CDM pairing: any WebKit build exposing WebKitMediaKeys also exposes this.
      this.video.webkitSetMediaKeys!(keys);

      const session = keys.createSession('video/mp4', wrappedInitData);
      if (!session) {
        throw new Error('Failed to create WebKitMediaKeySession.');
      }

      // Bridged into the standard MediaKeySession-shaped bookkeeping (activeSessions,
      // dispatched drm* events) shared with the modern EME path below.
      const sessionWrapper = session as unknown as MediaKeySession;
      if (contentId) {
        this.sessionToContentId.set(sessionWrapper, contentId);
      }

      const onKeyMessage = async (e: Event) => {
        const messageEvent = e as WebKitMediaKeyMessageEvent;
        const challenge = messageEvent.message;
        const destinationURL = messageEvent.destinationURL || systemConfig.licenseUrl;
        const sessionContentId = this.sessionToContentId.get(sessionWrapper) || '';
        this.recordChallengeGenerated();

        try {
          if (!destinationURL) {
            throw new Error('No FairPlay license URL configured.');
          }
          const response = await this.fetchFairPlayLicense(
            destinationURL,
            challenge,
            sessionContentId,
            systemConfig.headers,
            systemConfig.withCredentials
          );
          if (this.isDestroyed) return;
          session.update(new Uint8Array(response));
          this.recordSessionUpdated();
        } catch (err) {
          this.handleDrmError('Legacy FairPlay license request failed.', 'license', err);
        }
      };

      const onKeyAdded = () => {
        this.emeDiagnostics.keyStatusesChanges += 1;
        this.emeDiagnostics.usableKeysCount += 1;
        if (this.controller) {
          this.controller.dispatchEvent('drmkeychange', {
            session: sessionWrapper,
            keyStatuses: { all: 'usable' },
          });
        }
      };

      const onKeyError = (e: Event) => {
        const errorEvent = e as WebKitMediaKeyErrorEvent;
        this.handleDrmError(`Legacy FairPlay session error: ${errorEvent.code ?? 'unknown'}`, 'session', errorEvent);
      };

      session.addEventListener('webkitkeymessage', onKeyMessage);
      session.addEventListener('webkitkeyadded', onKeyAdded);
      session.addEventListener('webkitkeyerror', onKeyError);

      this.eventListeners.push({ target: session, type: 'webkitkeymessage', listener: onKeyMessage });
      this.eventListeners.push({ target: session, type: 'webkitkeyadded', listener: onKeyAdded });
      this.eventListeners.push({ target: session, type: 'webkitkeyerror', listener: onKeyError });

      this.activeSessions.add(sessionWrapper);

      if (this.controller) {
        this.controller.dispatchEvent('drmsessioncreated', {
          session: sessionWrapper,
          system: 'com.apple.fps (Legacy)',
        });
      }
    } catch (e: unknown) {
      this.handleDrmError(`Failed to initialize legacy FairPlay session: ${getErrorMessage(e)}`, 'session', e);
    }
  }

  /**
   * Helper preparing Apple FairPlay EME initialization payload.
   */
  private prepareFairPlayInitData(initData: Uint8Array): Uint8Array {
    // Return standard initData natively
    return initData;
  }

  /**
   * Handle ClearKey inline keys mapping.
   */
  private async handleClearKeyInlineUpdate(session: MediaKeySession) {
    const clearkeys = this.config?.clearkey?.clearkeys;
    if (!clearkeys) return;

    const requestKey = this.recordLicenseRequest('clearkey', 'inline://clearkey');
    try {
      const jwkKeys = Object.entries(normalizeClearKeys(clearkeys)).map(([kid, k]) => ({
        kty: 'oct',
        kid,
        k,
      }));

      const payload = JSON.stringify({
        keys: jwkKeys,
        type: 'temporary',
      });

      const responseBytes = new TextEncoder().encode(payload);
      await session.update(responseBytes);
      this.recordLicenseResponse(requestKey, true);
    } catch (err: unknown) {
      this.recordLicenseResponse(requestKey, false);
      this.handleDrmError(`Failed to load ClearKey inline values: ${getErrorMessage(err)}`, 'license', err);
    }
  }

  /**
   * Propagate DRM events and bubble errors to the player error card.
   */
  private handleDrmError(
    message: string,
    errorType: 'key-system' | 'session' | 'license' | 'certificate',
    originalError?: unknown
  ) {
    if (this.isDestroyed) return;

    const system = this.config
      ? Object.keys(this.config).find(
          (key) =>
            key !== 'robustness' &&
            key !== 'distinctiveIdentifier' &&
            key !== 'persistentState'
        )
      : undefined;

    const errorDetail = {
      message: `DRM: ${message}`,
      system,
      errorType,
      originalError,
    };

    this.emeDiagnostics.internalErrorsCount += 1;
    this.emeDiagnostics.lastInternalError = errorDetail.message;
    console.error(`[DrmManager] Mapped DRM Error:`, errorDetail);

    if (this.controller) {
      this.controller.dispatchEvent('drmerror', errorDetail);
      this.controller.updateStatePublic({ error: `DRM: ${message}` });
      this.controller.dispatchEvent('error', { message: `DRM: ${message}` });
    }
  }

  /**
   * Buffer ArrayBuffer to HEX string translation helper.
   */
  /** @internal Called from the module-level EME patch functions above. */
  public bufferToHex(buffer: BufferSource): string {
    let arrayBuffer: ArrayBuffer;
    if (buffer instanceof ArrayBuffer) {
      arrayBuffer = buffer;
    } else {
      arrayBuffer = buffer.buffer as ArrayBuffer;
    }
    const view = new DataView(arrayBuffer);
    let hex = '';
    for (let i = 0; i < view.byteLength; i++) {
      const value = view.getUint8(i);
      hex += value.toString(16).padStart(2, '0');
    }
    return hex;
  }

  /**
   * Dispose DRM Sessions, detach MediaKeys, and cleanly remove EME listeners.
   */
  public destroy() {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    this.destroyAbortController.abort();

    DrmManager.activeManagers.delete(this);

    // 1. Unbind event listeners
    for (const item of this.eventListeners) {
      try {
        item.target.removeEventListener(item.type, item.listener);
      } catch (_) {}
    }
    this.eventListeners = [];

    // 2. Close active sessions
    for (const session of this.activeSessions) {
      try {
        session
          .close()
          .then(() => {
            if (this.controller) {
              this.controller.dispatchEvent('drmsessionclosed', { session, system: 'unknown' });
            }
          })
          .catch((e) => {
            console.warn('[DrmManager] Error closing session:', e);
          });
      } catch (err) {
        console.warn('[DrmManager] Failed to close session:', err);
      }
    }
    this.activeSessions.clear();
    this.pendingLicenseRequests.clear();

    // 3. Detach MediaKeys from HTMLVideoElement
    if (this.video) {
      videoToDrmManager.delete(this.video);
      if (this.mediaKeys) {
        mediaKeysToDrmManager.delete(this.mediaKeys);
      }
      try {
        this.video.setMediaKeys(null).catch((e) => {
          console.warn('[DrmManager] Failed to setMediaKeys(null):', e);
        });
      } catch (err) {
        if (typeof this.video.webkitSetMediaKeys === 'function') {
          try {
            this.video.webkitSetMediaKeys(null);
          } catch (_) {}
        }
      }
    }

    this.video = null;
    this.config = null;
    this.controller = null;
    this.mediaKeys = null;
  }

  public getController() {
    return this.controller;
  }

  public noteLicenseRequest(system: string, url: string) {
    this.recordLicenseRequest(system, url);
  }

  public noteLicenseResponse(system: string, url: string) {
    this.recordLicenseResponse(this.createLicenseRequestKey(system, url), true);
  }

  private now(): number {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
  }

  private getConfiguredSystemName(): string {
    return this.config
      ? Object.keys(this.config).find(
          (key) =>
            key !== 'robustness' &&
            key !== 'distinctiveIdentifier' &&
            key !== 'persistentState' &&
            key !== 'retryCount' &&
            key !== 'timeout'
        ) || 'unknown'
      : 'unknown';
  }

  private createLicenseRequestKey(system: string, url: string): string {
    return `${system}::${url}`;
  }

  private recordLicenseRequest(system: string, url: string): string {
    const key = this.createLicenseRequestKey(system, url);
    const pending = this.pendingLicenseRequests.get(key) || [];
    pending.push(this.now());
    this.pendingLicenseRequests.set(key, pending);
    this.emeDiagnostics.licenseRequestsSent += 1;
    return key;
  }

  private recordLicenseResponse(requestKey: string, responseReceived: boolean) {
    const pending = this.pendingLicenseRequests.get(requestKey) || [];
    const startedAt = pending.shift();
    if (pending.length > 0) {
      this.pendingLicenseRequests.set(requestKey, pending);
    } else {
      this.pendingLicenseRequests.delete(requestKey);
    }

    if (typeof startedAt === 'number') {
      this.emeDiagnostics.licenseRequestLatenciesMs.push(this.now() - startedAt);
    }

    if (responseReceived) {
      this.emeDiagnostics.licenseResponsesReceived += 1;
    }
  }

  private recordCertificateLoaded(latencyMs: number) {
    this.emeDiagnostics.certificatesLoaded += 1;
    this.emeDiagnostics.certificateLoadLatenciesMs.push(Math.max(0, latencyMs));
  }

  /** @internal Called from the module-level EME patch functions above. */
  public recordChallengeGenerated() {
    this.emeDiagnostics.challengesGenerated += 1;
  }

  /** @internal Called from the module-level EME patch functions above. */
  public recordSessionUpdated() {
    this.emeDiagnostics.sessionsUpdated += 1;
  }

  /** @internal Called from the module-level EME patch functions above. */
  public recordClosedSession(_session: object) {
    this.emeDiagnostics.closedSessionsCount += 1;
  }

  /** @internal Called from the module-level EME patch functions above. */
  public recordKeyStatusesChange(session: MediaKeySession) {
    this.emeDiagnostics.keyStatusesChanges += 1;
    session.keyStatuses.forEach((status) => {
      if (status === 'usable') {
        this.emeDiagnostics.usableKeysCount += 1;
      } else if (status === 'expired') {
        this.emeDiagnostics.expiredKeysCount += 1;
      } else if (status === 'output-restricted') {
        this.emeDiagnostics.outputRestrictedCount += 1;
      }
    });
  }

  private getContentId(initData: Uint8Array): string {
    let str = '';
    try {
      str = new TextDecoder('utf-16').decode(initData);
      if (!str.includes('skd://')) {
        str = new TextDecoder('utf-8').decode(initData);
      }
    } catch (e) {
      str = new TextDecoder('utf-8').decode(initData);
    }

    const index = str.indexOf('skd://');
    if (index === -1) {
      return '';
    }

    let contentId = str.substring(index + 6);
    const queryIdx = contentId.indexOf('?');
    if (queryIdx !== -1) {
      contentId = contentId.substring(0, queryIdx);
    }
    const hashIdx = contentId.indexOf('#');
    if (hashIdx !== -1) {
      contentId = contentId.substring(0, hashIdx);
    }
    return contentId.replace(/\0/g, '').trim();
  }

  private concatInitData(contentId: string, cert: Uint8Array): Uint8Array {
    const contentIdBytes = new TextEncoder().encode(contentId);
    const totalLength = 4 + contentIdBytes.length + 4 + cert.length;
    const result = new Uint8Array(totalLength);
    const view = new DataView(result.buffer);

    let offset = 0;
    view.setUint32(offset, contentIdBytes.length);
    offset += 4;
    result.set(contentIdBytes, offset);
    offset += contentIdBytes.length;

    view.setUint32(offset, cert.length);
    offset += 4;
    result.set(cert, offset);

    return result;
  }

  private async fetchFairPlayLicense(
    licenseUrl: string,
    spcChallenge: ArrayBuffer,
    contentId: string,
    customHeaders?: Record<string, string>,
    withCredentials?: boolean
  ): Promise<ArrayBuffer> {
    const requestKey = this.recordLicenseRequest('fairplay', licenseUrl);
    const base64Spc = this.arrayBufferToBase64(spcChallenge);
    const isBinary = customHeaders && (
      customHeaders['Content-Type'] === 'application/octet-stream' ||
      customHeaders['content-type'] === 'application/octet-stream'
    );

    let body: BodyInit = JSON.stringify({
      spc: base64Spc,
      contentId,
      assetId: contentId,
    });
    let headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...customHeaders,
    };

    if (isBinary) {
      body = spcChallenge;
      headers = {
        'Content-Type': 'application/octet-stream',
        ...customHeaders,
      };
    }

    const options: RequestInit = {
      method: 'POST',
      headers,
      body,
    };
    if (withCredentials) {
      options.credentials = 'include';
    }

    const systemConfig = this.config?.fairplay;
    const retryCount = systemConfig?.retryCount ?? this.config?.retryCount ?? 3;
    const timeout = systemConfig?.timeout ?? this.config?.timeout ?? 10000;

    let responseReceived = false;
    try {
      const response = await this.fetchWithRetryAndTimeout(licenseUrl, options, retryCount, timeout);
      responseReceived = true;

      if (isBinary) {
        return await response.arrayBuffer();
      }

      const responseText = await response.text();
      try {
        const json = JSON.parse(responseText);
        if (json.ckc) {
          return this.base64ToArrayBuffer(json.ckc);
        }
        if (json.license) {
          return this.base64ToArrayBuffer(json.license);
        }
      } catch (e) {
        // Not JSON
      }

      const trimmed = responseText.trim();
      if (/^[A-Za-z0-9+/=]+$/.test(trimmed)) {
        return this.base64ToArrayBuffer(trimmed);
      }

      const encoder = new TextEncoder();
      return encoder.encode(responseText).buffer as ArrayBuffer;
    } catch (err: unknown) {
      if (getErrorName(err) === 'AbortError') {
        throw err;
      }
      throw err;
    } finally {
      this.recordLicenseResponse(requestKey, responseReceived);
    }
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return typeof window !== 'undefined' && typeof window.btoa === 'function'
      ? window.btoa(binary)
      : Buffer.from(bytes).toString('base64');
  }

  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const raw = typeof window !== 'undefined' && typeof window.atob === 'function'
      ? window.atob(base64)
      : Buffer.from(base64, 'base64').toString('binary');

    const buffer = new ArrayBuffer(raw.length);
    const view = new Uint8Array(buffer);
    for (let i = 0; i < raw.length; i++) {
      view[i] = raw.charCodeAt(i);
    }
    return buffer;
  }
}
