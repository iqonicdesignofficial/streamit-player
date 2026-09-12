import type Hls from 'hls.js';
import type { HlsConfig, MetadataSample, LevelLoadedData as HlsLevelLoadedData } from 'hls.js';
import type * as dashjs from 'dashjs';
import type {
  MediaInfo as DashMediaInfo,
  Representation as DashRepresentation,
} from 'dashjs';
import { loadHls, loadDashjs } from './vendorLoaders';
import {
  PlayerSource,
  SourceType,
  PlayerState,
  RawLiveInfo,
  PlayerStatistics,
  DrmSystemConfig,
} from './types';
import type { PlayerController } from './PlayerController';
import { DrmManager, normalizeClearKeys } from './DrmManager';

/**
 * hls.js only exposes a subset of the "legacy" EME configuration surface
 * (`licenseServers` / `emeConfigurations`) through its public `HlsConfig`
 * type - the modern typed surface uses `drmSystems`/`drmSystemOptions`
 * instead. This mirrors the runtime shape this codebase builds and passes
 * to `new Hls(...)`.
 */
interface HlsLegacyEmeOptions {
  emeEnabled: boolean;
  licenseServers: Record<string, string>;
  emeConfigurations: Record<string, MediaKeySystemConfiguration>;
  licenseXhrSetup: (
    xhr: XMLHttpRequest,
    url: string,
    keyContext: { keySystem?: string },
    licenseChallenge: Uint8Array | ArrayBuffer
  ) => void | Uint8Array | ArrayBuffer | Promise<Uint8Array | ArrayBuffer | void>;
  licenseResponseCallback: (
    xhr: XMLHttpRequest,
    url: string,
    keyContext: { keySystem?: string }
  ) => ArrayBuffer | Promise<ArrayBuffer>;
}

/** hls.js's `Fragment`/`LevelDetails` types don't currently expose LL-HLS `parts`. */
interface HlsFragmentWithParts {
  parts?: unknown[];
}

/** hls.js's `MetadataSample` doesn't document an `info` field, but this codebase reads it defensively. */
interface HlsMetadataSampleWithInfo extends MetadataSample {
  info?: Record<string, unknown>;
}

/**
 * dash.js 5 has no setting for low-latency mode: it turns the mode on by itself
 * when the manifest signals a low-latency stream (chunked segments,
 * availabilityTimeComplete="false" or a DVB low-latency property). This reads
 * that state. dash.js throws if asked before playback is initialized.
 */
function isDashLowLatencyActive(player: dashjs.MediaPlayerClass): boolean {
  try {
    return player.getLowLatencyModeEnabled();
  } catch {
    return false;
  }
}

/** Seconds behind the live edge target that still count as "at live" for a
 * low-latency stream. Matches PlayerController's low-latency live-edge threshold. */
const LOW_LATENCY_LIVE_EDGE_SECONDS = 6;

/**
 * dash.js's published types don't cover several legacy/undocumented
 * MediaPlayer methods this codebase relies on for ABR + live-edge control.
 */
interface DashLegacyPlayerMethods {
  getDashAdapter?: () => { getMpd?: () => { timeShiftBufferDepth?: number } | undefined };
  getMpd?: () => { timeShiftBufferDepth?: number } | undefined;
  seekToOriginalLive?: () => void;
  getAverageThroughput?: (type: string) => number;
  getQualityFor?: (type: string) => number;
  getBitrateInfoListFor?: (type: string) => Array<{ bitrate: number }>;
}

/** dash.js's `MediaInfo` type doesn't document these fields this codebase reads defensively. */
type DashMediaInfoExtras = DashMediaInfo & {
  id?: string;
  label?: string;
  isDefault?: boolean;
  default?: boolean;
  channels?: string | number;
};

/**
 * dash.js's typed key/protection events document `data` as the session
 * payload, but the runtime events this codebase has observed carry the
 * session under `.session` instead.
 */
interface DashKeySessionEventLike {
  session?: MediaKeySession;
}

interface DashProtectionErrorEventLike {
  error?: { message?: string } | string;
}

/**
 * dash.js's `ProtectionData.serverCertificate` is documented as a base64
 * `string`, but this codebase passes the raw certificate bytes it already
 * fetched as a `Uint8Array` - dash.js accepts both at runtime.
 */
type DashProtectionDataEntry = Omit<dashjs.ProtectionData, 'serverCertificate'> & {
  serverCertificate?: Uint8Array | string;
};

/**
 * `persistentState`/`distinctiveIdentifier` under `streaming.protection`
 * aren't part of dash.js's published `MediaPlayerSettingClass` type.
 */
type DashProtectionSettings = NonNullable<dashjs.MediaPlayerSettingClass['streaming']>['protection'] & {
  persistentState?: string;
  distinctiveIdentifier?: string;
};

/**
 * Local shape for the objects dash.js hands to license request/response
 * filters - matches `dashjs.LicenseRequest`/`LicenseResponse` but widens
 * `data` to the union this codebase actually assigns back onto it.
 */
interface DashLicenseFilterRequest {
  url: string;
  data: ArrayBuffer | ArrayBufferView | string;
  headers?: Record<string, string>;
}

interface DashLicenseFilterResponse {
  url: string;
  data: ArrayBuffer | ArrayBufferView | string;
}

interface DashPlaybackErrorEventLike {
  error?:
    | {
        message?: string;
        status?: number;
        data?: { response?: { status?: number }; status?: number };
      }
    | string;
}

function getLanguageName(langCode: string): string {
  if (!langCode) return '';
  const cleanCode = langCode.trim().toLowerCase();

  try {
    const displayNames = new Intl.DisplayNames(['en'], { type: 'language' });
    const name = displayNames.of(cleanCode);
    if (name && name !== cleanCode) {
      return name.charAt(0).toUpperCase() + name.slice(1);
    }
  } catch (e) {
    // Ignore and fallback
  }

  const commonLanguages: Record<string, string> = {
    en: 'English',
    eng: 'English',
    hi: 'Hindi',
    hin: 'Hindi',
    fr: 'French',
    fre: 'French',
    fra: 'French',
    nl: 'Dutch',
    dut: 'Dutch',
    nld: 'Dutch',
    es: 'Spanish',
    spa: 'Spanish',
    de: 'German',
    ger: 'German',
    deu: 'German',
    it: 'Italian',
    ita: 'Italian',
    ja: 'Japanese',
    jpn: 'Japanese',
    zh: 'Chinese',
    zho: 'Chinese',
    chi: 'Chinese',
    pt: 'Portuguese',
    por: 'Portuguese',
    ru: 'Russian',
    rus: 'Russian',
    ar: 'Arabic',
    ara: 'Arabic',
    ko: 'Korean',
    kor: 'Korean',
    sv: 'Swedish',
    swe: 'Swedish',
    no: 'Norwegian',
    nor: 'Norwegian',
    fi: 'Finnish',
    fin: 'Finnish',
    da: 'Danish',
    dan: 'Danish',
    pl: 'Polish',
    pol: 'Polish',
    tr: 'Turkish',
    tur: 'Turkish',
    vi: 'Vietnamese',
    vie: 'Vietnamese',
  };

  const codeKey = cleanCode.split('-')[0];
  return commonLanguages[codeKey] || commonLanguages[cleanCode] || langCode.toUpperCase();
}

export function normalizeAudioLabel(label?: string, lang?: string): string {
  if (label && label.trim().length > 0) {
    const trimmed = label.trim();
    const isGeneric =
      /^stream(_\d+)?$/i.test(trimmed) || /^audio(_\d+)?$/i.test(trimmed) || /^\d+$/.test(trimmed);
    if (!isGeneric) {
      const isLangCode = /^[a-zA-Z]{2,3}(-[a-zA-Z]{2,4})?$/.test(trimmed);
      if (!isLangCode) {
        return trimmed;
      }
      const translated = getLanguageName(trimmed);
      if (translated) return translated;
    }
  }

  if (lang && lang.trim().length > 0) {
    return getLanguageName(lang.trim());
  }

  return 'Unknown';
}

interface AudioTrack {
  enabled: boolean;
  id: string;
  kind: string;
  label: string;
  language: string;
}

interface AudioTrackList {
  readonly length: number;
  [index: number]: AudioTrack;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

interface HTMLVideoElementWithTracks extends HTMLVideoElement {
  audioTracks?: AudioTrackList;
}

export interface SourceHandler {
  load(source: PlayerSource, video: HTMLVideoElement, controller: PlayerController): void;
  destroy(): void;
  setQuality?(index: number): void;
  setAudioTrack?(index: number): void;
  setSubtitleTrack?(index: number): void;
  seekToLiveEdge?(): void;
  getRawLiveInfo?(): RawLiveInfo | null;
  managesSubtitles?: boolean;
  getStats?(): Partial<PlayerStatistics>;
  /** Exposes this handler's DRM manager (if any) for diagnostics tooling
   * such as DrmValidator, which otherwise has no typed way to reach a
   * handler's private DRM state. */
  getDrmManager?(): DrmManager | null;
}

export class Mp4Handler implements SourceHandler {
  private source: PlayerSource | null = null;
  private video: HTMLVideoElement | null = null;
  private controller: PlayerController | null = null;
  private syncTracksListener: (() => void) | null = null;
  private uniqueAudioTracks: Array<{ label: string; rawIndices: number[] }> = [];
  private qualityRestoreListener: (() => void) | null = null;
  private drmManager: DrmManager | null = null;

  getDrmManager(): DrmManager | null {
    return this.drmManager;
  }

  load(source: PlayerSource, video: HTMLVideoElement, controller: PlayerController) {
    this.source = source;
    this.video = video;
    this.controller = controller;

    video.srcObject = null;

    // Bootstrap DRM for encrypted progressive MP4
    const mergedDrm = {
      ...(controller.config?.drm || {}),
      ...(source.drm || {}),
    };
    const hasDrm = Object.keys(mergedDrm).length > 0;
    if (hasDrm) {
      this.drmManager = new DrmManager();
      this.drmManager.load(video, mergedDrm, controller, false);
    }

    const hasMultiple = !!(source.variants && source.variants.length > 1);
    const qualities = hasMultiple ? source.variants!.map((v) => v.label) : [];

    let initialSrc = source.src || '';
    let initialLabel = '';
    if (hasMultiple) {
      const foundIdx = source.variants!.findIndex((v) => v.src === source.src);
      const activeIdx = foundIdx !== -1 ? foundIdx : 0;
      initialSrc = source.variants![activeIdx].src;
      initialLabel = source.variants![activeIdx].label;
    }

    if (initialSrc) {
      video.src = initialSrc;
      video.load();
    }

    controller.updateStatePublic({
      qualities,
      activeQuality: initialLabel,
      audioTracks: [],
      activeAudioTrack: -1,
      error: null,
    });

    // Scan for native audio tracks if supported by browser/media
    this.uniqueAudioTracks = [];
    const videoEl = video as HTMLVideoElementWithTracks;
    if (videoEl.audioTracks) {
      const syncTracks = () => {
        this.syncAndDeduplicateTracks();
      };

      this.syncTracksListener = syncTracks;
      videoEl.audioTracks.addEventListener('change', syncTracks);
      videoEl.audioTracks.addEventListener('addtrack', syncTracks);
      videoEl.audioTracks.addEventListener('removetrack', syncTracks);

      // Initial scan
      this.syncAndDeduplicateTracks();
    }
  }

  private syncAndDeduplicateTracks() {
    if (!this.video || !this.controller) return;
    const videoEl = this.video as HTMLVideoElementWithTracks;
    if (!videoEl.audioTracks) return;

    const rawTracks = videoEl.audioTracks;
    const groups: Record<string, { label: string; rawIndices: number[] }> = {};
    const groupKeysOrder: string[] = [];

    for (let i = 0; i < rawTracks.length; i++) {
      const track = rawTracks[i];
      const lang = track.language || '';
      const label = track.label || '';
      const kind = track.kind || '';

      const normLang = lang.toLowerCase();
      const normLabel = label.toLowerCase();
      const normKind = kind.toLowerCase();

      const key = `${normLang}|${normLabel}|${normKind}`;

      if (!groups[key]) {
        groups[key] = {
          label: '',
          rawIndices: [],
        };
        groupKeysOrder.push(key);
      }
      groups[key].rawIndices.push(i);
    }

    this.uniqueAudioTracks = groupKeysOrder.map((key) => {
      const group = groups[key];
      const sampleTrack = rawTracks[group.rawIndices[0]];

      const langName = getLanguageName(sampleTrack.language);
      let labelText = '';

      if (sampleTrack.label) {
        const isLangCode = /^[a-zA-Z]{2,3}(-[a-zA-Z]{2,4})?$/.test(sampleTrack.label.trim());
        if (!isLangCode) {
          labelText = sampleTrack.label.trim();
        }
      }

      if (!labelText) {
        labelText = langName || 'Unknown';
      }

      const parts = [labelText];
      const kind = sampleTrack.kind || '';
      if (kind && kind !== 'main' && kind !== 'alternative') {
        parts.push(kind.charAt(0).toUpperCase() + kind.slice(1));
      }

      return {
        label: parts.join(' '),
        rawIndices: group.rawIndices,
      };
    });

    const labels = this.uniqueAudioTracks.map((t) => t.label);

    // Find active unique track index
    let activeUniqueIndex = -1;
    for (let i = 0; i < this.uniqueAudioTracks.length; i++) {
      const ut = this.uniqueAudioTracks[i];
      const hasActive = ut.rawIndices.some((idx) => rawTracks[idx].enabled);
      if (hasActive) {
        activeUniqueIndex = i;
        break;
      }
    }

    this.controller.updateStatePublic({
      audioTracks: labels,
      activeAudioTrack: activeUniqueIndex,
    });
  }

  destroy() {
    if (this.video) {
      if (this.syncTracksListener) {
        const videoEl = this.video as HTMLVideoElementWithTracks;
        if (videoEl.audioTracks) {
          videoEl.audioTracks.removeEventListener('change', this.syncTracksListener);
          videoEl.audioTracks.removeEventListener('addtrack', this.syncTracksListener);
          videoEl.audioTracks.removeEventListener('removetrack', this.syncTracksListener);
        }
      }
      if (this.qualityRestoreListener) {
        this.video.removeEventListener('loadedmetadata', this.qualityRestoreListener);
      }
    }
    if (this.drmManager) {
      this.drmManager.destroy();
      this.drmManager = null;
    }
    this.syncTracksListener = null;
    this.qualityRestoreListener = null;
    this.source = null;
    this.video = null;
    this.controller = null;
    this.uniqueAudioTracks = [];
  }

  setQuality(index: number) {
    if (this.source && this.source.variants && this.video && this.controller) {
      if (index >= 0 && index < this.source.variants.length) {
        const targetVariant = this.source.variants[index];
        const wasPlaying = !this.video.paused;
        const time = this.video.currentTime;

        if (this.qualityRestoreListener) {
          this.video.removeEventListener('loadedmetadata', this.qualityRestoreListener);
        }

        const restore = () => {
          this.qualityRestoreListener = null;
          if (this.video) {
            this.video.currentTime = time;
            if (wasPlaying) {
              this.video.play().catch((e) => console.warn('Restore play failed:', e));
            }
          }
        };

        this.qualityRestoreListener = restore;
        this.video.addEventListener('loadedmetadata', restore, { once: true });

        this.video.src = targetVariant.src;
        this.video.load();

        this.controller.updateStatePublic({
          activeQuality: targetVariant.label,
        });
      }
    }
  }

  setAudioTrack(index: number) {
    if (this.video && index >= 0 && index < this.uniqueAudioTracks.length) {
      const videoEl = this.video as HTMLVideoElementWithTracks;
      if (videoEl.audioTracks) {
        const targetUnique = this.uniqueAudioTracks[index];
        const rawTargetIdx = targetUnique.rawIndices[0];
        for (let i = 0; i < videoEl.audioTracks.length; i++) {
          videoEl.audioTracks[i].enabled = i === rawTargetIdx;
        }
        if (this.controller) {
          this.controller.updateStatePublic({
            activeAudioTrack: index,
          });
        }
      }
    }
  }
}

export class HlsHandler implements SourceHandler {
  private hls: Hls | null = null;
  private hlsRetryCount = 0;
  private mediaRecoveryCount = 0;
  private controller: PlayerController | null = null;
  private video: HTMLVideoElement | null = null;
  private lastLevelIndex = -1;
  private isAutoMode = true;
  private uniqueAudioTracks: Array<{ label: string; rawIndices: number[] }> = [];
  private livePollInterval: ReturnType<typeof setInterval> | null = null;
  private _isLive = false;
  private _isLowLatency = false;
  private _dvrWindow = 0;
  private _hasDvr = false;
  readonly managesSubtitles = true;
  private drmManager: DrmManager | null = null;

  getDrmManager(): DrmManager | null {
    return this.drmManager;
  }

  private startLivePolling() {
    this.stopLivePolling();
    this.livePollInterval = setInterval(() => {
      this.pollLiveStats();
    }, 500);
  }

  private stopLivePolling() {
    if (this.livePollInterval) {
      clearInterval(this.livePollInterval);
      this.livePollInterval = null;
    }
  }

  public getLiveSyncPosition(): number | null {
    return this.hls ? this.hls.liveSyncPosition : null;
  }

  private pollLiveStats() {
    if (!this.hls || !this.controller || !this.video) return;
    const state = this.controller.getState();
    if (!state.isLive) return;

    this.controller.updateLiveState();

    const updatedState = this.controller.getState();
    this.controller.dispatchEvent('live-sync-update', {
      latency: updatedState.liveLatency || 0,
      isAtLiveEdge: updatedState.isAtLiveEdge,
      playbackRate: this.video.playbackRate,
    });
  }

  public getRawLiveInfo(): RawLiveInfo | null {
    if (!this._isLive) return null;

    return {
      isLive: this._isLive,
      isLowLatency: this._isLowLatency,
      hasDvr: this._hasDvr,
      dvrWindow: this._dvrWindow,
      liveEdgeTarget: this.hls?.liveSyncPosition ?? null,
    };
  }

  seekToLiveEdge() {
    if (this.hls && this.hls.liveSyncPosition !== null) {
      if (this.video) {
        this.video.currentTime = this.hls.liveSyncPosition;
      }
    }
  }

  load(source: PlayerSource, video: HTMLVideoElement, controller: PlayerController) {
    if (!source.src) return;
    this.destroy();
    this.controller = controller;
    this.video = video;
    this.lastLevelIndex = -1;
    this.isAutoMode = true;
    this.uniqueAudioTracks = [];
    this.hlsRetryCount = 0;
    this.mediaRecoveryCount = 0;

    loadHls()
      .then((HlsLib) => {
        if (this.controller !== controller) {
          return;
        }

        const HlsClass = HlsLib as typeof Hls;
        if (HlsClass.isSupported()) {
          const state = controller.getState();
          const isLiveOnly = state.liveMode === 'live-only';

          const mergedDrm = {
            ...(controller.config?.drm || {}),
            ...(source.drm || {}),
          };
          const hasDrm = Object.keys(mergedDrm).length > 0;

          if (hasDrm) {
            this.drmManager = new DrmManager();
            this.drmManager.load(video, mergedDrm, controller, true);
          }

          const loadDrmSetup = async () => {
            if (!hasDrm) return {};

            const emeConfigurations: Record<string, MediaKeySystemConfiguration> = {};
            const licenseServers: Record<string, string> = {};

            if (mergedDrm.widevine) {
              const sysConfig = mergedDrm.widevine;
              const cert = this.drmManager ? await this.drmManager.loadCertificate(sysConfig) : null;
              licenseServers['com.widevine.alpha'] = sysConfig.licenseUrl || '';
              emeConfigurations['com.widevine.alpha'] = {
                videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.640028"' }],
                audioCapabilities: [{ contentType: 'audio/mp4; codecs="mp4a.40.2"' }],
                ...(cert ? { serverCertificate: cert } : {}),
                ...(mergedDrm.robustness?.video ? { videoRobustness: mergedDrm.robustness.video } : {}),
                ...(mergedDrm.robustness?.audio ? { audioRobustness: mergedDrm.robustness.audio } : {}),
                persistentState: mergedDrm.persistentState || 'optional',
                distinctiveIdentifier: mergedDrm.distinctiveIdentifier || 'optional',
                sessionTypes: ['temporary'],
              };
            }

            if (mergedDrm.playready) {
              const sysConfig = mergedDrm.playready;
              const cert = this.drmManager ? await this.drmManager.loadCertificate(sysConfig) : null;
              licenseServers['com.microsoft.playready'] = sysConfig.licenseUrl || '';
              emeConfigurations['com.microsoft.playready'] = {
                videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.640028"' }],
                audioCapabilities: [{ contentType: 'audio/mp4; codecs="mp4a.40.2"' }],
                ...(cert ? { serverCertificate: cert } : {}),
                ...(mergedDrm.robustness?.video ? { videoRobustness: mergedDrm.robustness.video } : {}),
                ...(mergedDrm.robustness?.audio ? { audioRobustness: mergedDrm.robustness.audio } : {}),
                persistentState: mergedDrm.persistentState || 'optional',
                distinctiveIdentifier: mergedDrm.distinctiveIdentifier || 'optional',
                sessionTypes: ['temporary'],
              };
            }

            if (mergedDrm.clearkey) {
              const sysConfig = mergedDrm.clearkey;
              licenseServers['org.w3.clearkey'] = sysConfig.licenseUrl || '';
              emeConfigurations['org.w3.clearkey'] = {
                sessionTypes: ['temporary'],
              };
            }

            return {
              emeEnabled: true,
              licenseServers,
              emeConfigurations,
              licenseXhrSetup: (
                xhr: XMLHttpRequest,
                url: string,
                keyContext: { keySystem?: string },
                licenseChallenge: Uint8Array | ArrayBuffer
              ) => {
                let sysConfig: DrmSystemConfig | null | undefined = null;
                let systemName = '';
                if (keyContext && keyContext.keySystem) {
                  if (keyContext.keySystem.includes('widevine')) {
                    sysConfig = mergedDrm.widevine;
                    systemName = 'widevine';
                  } else if (keyContext.keySystem.includes('playready')) {
                    sysConfig = mergedDrm.playready;
                    systemName = 'playready';
                  } else if (keyContext.keySystem.includes('clearkey')) {
                    sysConfig = mergedDrm.clearkey;
                    systemName = 'clearkey';
                  }
                }

                this.controller?.dispatchEvent('drmlicenserequest', {
                  url,
                  challengeSize: licenseChallenge ? licenseChallenge.byteLength || 0 : 0,
                  system: systemName || 'hls'
                });
                this.drmManager?.noteLicenseRequest(systemName || 'hls', url);

                if (sysConfig) {
                  if (sysConfig.headers) {
                    Object.entries(sysConfig.headers).forEach(([k, v]) => {
                      xhr.setRequestHeader(k, v);
                    });
                  }
                  if (sysConfig.withCredentials) {
                    xhr.withCredentials = true;
                  }
                }

                if (sysConfig && sysConfig.licenseRequestInterceptor) {
                  const challengeBuffer = licenseChallenge instanceof Uint8Array
                    ? licenseChallenge.buffer
                    : licenseChallenge;

                  return Promise.resolve(
                    sysConfig.licenseRequestInterceptor(challengeBuffer as ArrayBuffer, systemName)
                  ).then((intercepted) => {
                    let finalBody: Uint8Array | ArrayBuffer | ArrayBufferView | string = licenseChallenge;
                    if (intercepted instanceof ArrayBuffer) {
                      finalBody = new Uint8Array(intercepted);
                    } else if (intercepted && typeof intercepted === 'object') {
                      if (intercepted.body instanceof ArrayBuffer) {
                        finalBody = new Uint8Array(intercepted.body);
                      } else if (intercepted.body) {
                        finalBody = intercepted.body;
                      }
                      if (intercepted.headers) {
                        Object.entries(intercepted.headers).forEach(([k, v]) => {
                          xhr.setRequestHeader(k, v as string);
                        });
                      }
                    }
                    return finalBody;
                  });
                }
              },
              licenseResponseCallback: (
                xhr: XMLHttpRequest,
                url: string,
                keyContext: { keySystem?: string }
              ) => {
                let sysConfig: DrmSystemConfig | null | undefined = null;
                let systemName = '';
                if (keyContext && keyContext.keySystem) {
                  if (keyContext.keySystem.includes('widevine')) {
                    sysConfig = mergedDrm.widevine;
                    systemName = 'widevine';
                  } else if (keyContext.keySystem.includes('playready')) {
                    sysConfig = mergedDrm.playready;
                    systemName = 'playready';
                  } else if (keyContext.keySystem.includes('clearkey')) {
                    sysConfig = mergedDrm.clearkey;
                    systemName = 'clearkey';
                  }
                }
                const response = xhr.response;

                const responseSize = response ? (response.byteLength || response.size || 0) : 0;
                this.controller?.dispatchEvent('drmlicenseresponse', {
                  url,
                  responseSize,
                  system: systemName || 'hls'
                });
                this.drmManager?.noteLicenseResponse(systemName || 'hls', url);

                if (sysConfig && sysConfig.licenseResponseInterceptor) {
                  const responseBuffer = response instanceof ArrayBuffer ? response : (response ? response.buffer : new ArrayBuffer(0));
                  return Promise.resolve(
                    sysConfig.licenseResponseInterceptor(responseBuffer, systemName)
                  );
                }
                return response;
              }
            };
          };

          loadDrmSetup()
            .then((emeOptions) => {
              if (this.controller !== controller) return;

              const hls = new HlsClass({
                enableWorker: true,
                lowLatencyMode: true,
                liveSyncDurationCount: 3,
                liveMaxLatencyDurationCount: isLiveOnly ? 10 : undefined,
                ...emeOptions,
              } as Partial<HlsConfig> & Partial<HlsLegacyEmeOptions>);

              this.hls = hls;

              hls.attachMedia(video);
              hls.on(HlsClass.Events.MEDIA_ATTACHED, () => {
                hls.loadSource(source.src!);
              });

          hls.on(HlsClass.Events.LEVEL_LOADED, (_: string, data: HlsLevelLoadedData) => {
            if (this.controller !== controller || this.hls !== hls) return;
            this.hlsRetryCount = 0;
            this.mediaRecoveryCount = 0;
            const details = data.details;
            if (details) {
              const isLive = details.live;

              const hasPartTarget = details.partTarget !== undefined && details.partTarget > 0;
              const hasPartHoldBack =
                details.partHoldBack !== undefined && details.partHoldBack > 0;
              const hasFragmentParts =
                details.fragments &&
                details.fragments.some(
                  (f) => (f as HlsFragmentWithParts).parts && (f as HlsFragmentWithParts).parts!.length > 0
                );

              const isLowLatency = isLive && (hasPartTarget || hasPartHoldBack || hasFragmentParts);

              const dvrWindow = isLive ? details.totalduration : 0;
              // Detect DVR capabilities more reliably (EVENT type implies DVR, or total duration is significantly larger than typical live edge)
              const hasDvr = isLive && (details.type === 'EVENT' || dvrWindow > 30);
              this._isLive = isLive;
              this._isLowLatency = isLowLatency;
              this._dvrWindow = dvrWindow;
              this._hasDvr = hasDvr;

              const state = controller.getState();
              const changes: Partial<PlayerState> = {};
              if (state.isLive !== isLive) {
                changes.isLive = isLive;
                if (isLive) {
                  changes.isAtLiveEdge = true;
                }
              }
              if (state.isLowLatency !== isLowLatency) changes.isLowLatency = isLowLatency;
              if (Object.keys(changes).length > 0) {
                controller.updateStatePublic(changes);
              }

              controller.dispatchEvent('live-status-change', { isLive, isLowLatency });

              if (isLive) {
                controller.updateLiveState();
                this.startLivePolling();
              } else {
                this.stopLivePolling();
              }
            }
          });

          hls.on(HlsClass.Events.MANIFEST_PARSED, () => {
            controller.dispatchEvent('manifestloaded', { system: 'hls', levels: hls.levels.length });
            this.hlsRetryCount = 0;
            this.mediaRecoveryCount = 0;
            const hasMultiple = hls.levels.length > 1;
            const qualities: string[] = [];
            if (hasMultiple) {
              qualities.push('Auto');
              const labelCounts: Record<string, number> = {};
              hls.levels.forEach((l) => {
                const base = l.height ? `${l.height}p` : 'Unknown';
                labelCounts[base] = (labelCounts[base] || 0) + 1;
              });
              hls.levels.forEach((l) => {
                const base = l.height ? `${l.height}p` : 'Unknown';
                if (labelCounts[base] > 1 && l.bitrate) {
                  qualities.push(`${base} (${Math.round(l.bitrate / 1000)}k)`);
                } else {
                  qualities.push(base);
                }
              });
            }

            const hlsSubTracks = hls.subtitleTracks.map((t) => ({
              label: t.name || t.lang || 'Unknown',
              language: t.lang || '',
              default: !!t.default,
              forced: !!t.forced,
              kind: t.type === 'CLOSED-CAPTIONS' ? ('captions' as const) : ('subtitles' as const),
            }));

            controller.setManagedSubtitleTracks('hls', hlsSubTracks, hls.subtitleTrack);

            controller.updateStatePublic({
              qualities,
              activeQuality: hasMultiple ? 'Auto' : '',
              error: null,
            });

            this.syncAndDeduplicateTracks();

            if (hasMultiple) {
              this.syncQualityState();
            }
          });

          hls.on(HlsClass.Events.SUBTITLE_TRACK_SWITCH, (_: string, data: { id: number }) => {
            const hlsSubTracks = hls.subtitleTracks.map((t) => ({
              label: t.name || t.lang || 'Unknown',
              language: t.lang || '',
              default: !!t.default,
              forced: !!t.forced,
              kind: t.type === 'CLOSED-CAPTIONS' ? ('captions' as const) : ('subtitles' as const),
            }));
            controller.setManagedSubtitleTracks('hls', hlsSubTracks, data.id);
          });

          hls.on(HlsClass.Events.SUBTITLE_TRACKS_UPDATED, () => {
            const hlsSubTracks = hls.subtitleTracks.map((t) => ({
              label: t.name || t.lang || 'Unknown',
              language: t.lang || '',
              default: !!t.default,
              forced: !!t.forced,
              kind: t.type === 'CLOSED-CAPTIONS' ? ('captions' as const) : ('subtitles' as const),
            }));
            controller.setManagedSubtitleTracks('hls', hlsSubTracks, hls.subtitleTrack);
          });

          hls.on(HlsClass.Events.LEVEL_SWITCHED, (_: string, data: { level: number }) => {
            this.lastLevelIndex = data.level;
            this.syncQualityState();
          });

          hls.on(HlsClass.Events.AUDIO_TRACKS_UPDATED, () => {
            this.syncAndDeduplicateTracks();
          });

          hls.on(HlsClass.Events.AUDIO_TRACK_SWITCHED, (_: string, data: { id: number }) => {
            const activeIdx =
              typeof data.id === 'number' && data.id >= 0 && data.id < hls.audioTracks.length
                ? data.id
                : hls.audioTrack;

            let activeUniqueIndex = -1;
            for (let i = 0; i < this.uniqueAudioTracks.length; i++) {
              if (this.uniqueAudioTracks[i].rawIndices.includes(activeIdx)) {
                activeUniqueIndex = i;
                break;
              }
            }
            if (activeUniqueIndex !== -1) {
              controller.updateStatePublic({ activeAudioTrack: activeUniqueIndex });
            }
          });

          hls.on(HlsClass.Events.FRAG_PARSING_METADATA, (_: string, data: { samples?: HlsMetadataSampleWithInfo[] }) => {
            if (!this.controller) return;
            const samples = data.samples || [];
            for (const sample of samples) {
              const pts = sample.pts;
              const type = sample.type || 'ID3';
              this.controller.emit('metadata', {
                timestamp: pts,
                type,
                sourceProtocol: 'hls',
                rawData: sample.data,
                parsedData: sample.info || {},
              });
            }
          });

          hls.on(
            HlsClass.Events.ERROR,
            (
              _: string,
              data: {
                fatal: boolean;
                type: string;
                details?: string;
                response?: { code?: number };
              }
            ) => {
              if (data.fatal) {
                const httpCode = data.response?.code;
                switch (data.type) {
                  case HlsClass.ErrorTypes.KEY_SYSTEM_ERROR:
                    console.error('Fatal HLS DRM key system error:', data);
                    controller.updateStatePublic({
                      error: `DRM: Key system decryption error: ${data.details || 'unknown'}`,
                    });
                    this.drmManager?.triggerDrmError(
                      data.details || 'Key system decryption error',
                      'key-system',
                      data
                    );
                    this.destroy();
                    break;
                  case HlsClass.ErrorTypes.NETWORK_ERROR:
                    if (data.details === 'keyLoadError') {
                      if (httpCode === 401 || httpCode === 403) {
                        console.error(`[HlsHandler] Non-recoverable DRM key load error (HTTP ${httpCode})`);
                        const friendlyMsg = 'Media license acquisition request was denied.';
                        controller.updateStatePublic({ error: friendlyMsg });
                        this.drmManager?.triggerDrmError(friendlyMsg, 'license', data);
                        this.destroy();
                        return;
                      }
                    }
                    if (this.hlsRetryCount < 3) {
                      this.hlsRetryCount++;
                      const delay = Math.pow(2, this.hlsRetryCount) * 1000;
                      console.warn(
                        `HLS Network error encountered (detail: ${data.details}, HTTP: ${httpCode ?? 'N/A'}). Retrying in ${delay}ms (${this.hlsRetryCount}/3)...`
                      );
                      setTimeout(() => {
                        if (!this.hls || this.hls !== hls) return;
                        if (
                          data.details === 'manifestLoadError' ||
                          data.details === 'manifestLoadTimeOut' ||
                          data.details === 'manifestParsingError'
                        ) {
                          hls.loadSource(source.src!);
                        } else {
                          hls.startLoad();
                        }
                      }, delay);
                    } else {
                      console.error(
                        `Fatal HLS Network error. Retries exhausted. Detail: ${data.details}, HTTP: ${httpCode ?? 'N/A'}`
                      );
                      let errorMsg: string;
                      if (data.details === 'manifestLoadError') {
                        if (httpCode === 404) {
                          errorMsg =
                            'Stream not found (404). The URL may be expired, moved, or invalid.';
                        } else if (httpCode === 403) {
                          errorMsg =
                            'Access denied (403). The stream may be geo-restricted or require authentication.';
                        } else if (httpCode !== undefined && httpCode >= 500) {
                          errorMsg = `Stream server error (${httpCode}). The server is temporarily unavailable.`;
                        } else {
                          errorMsg = `Failed to load stream manifest${httpCode ? ` (HTTP ${httpCode})` : ''}. Check the URL and try again.`;
                        }
                      } else if (data.details === 'manifestLoadTimeOut') {
                        errorMsg =
                          'Stream connection timed out. The server may be slow or unreachable.';
                      } else if (data.details === 'manifestParsingError') {
                        errorMsg =
                          'Invalid stream format. The URL does not point to a valid HLS stream.';
                      } else {
                        errorMsg =
                          'Fatal streaming connection failure. Check the URL and try again.';
                      }
                      controller.updateStatePublic({ error: errorMsg });
                      this.destroy();
                    }
                    break;
                  case HlsClass.ErrorTypes.MEDIA_ERROR:
                    this.mediaRecoveryCount++;
                    if (this.mediaRecoveryCount === 1) {
                      console.warn(
                        `HLS Media error. Stage 1 Recovery: recoverMediaError() (${this.mediaRecoveryCount}/3)`
                      );
                      hls.recoverMediaError();
                    } else if (this.mediaRecoveryCount === 2) {
                      console.warn(
                        `HLS Media error. Stage 2 Recovery: swapAudioCodec() + recoverMediaError() (${this.mediaRecoveryCount}/3)`
                      );
                      hls.swapAudioCodec();
                      hls.recoverMediaError();
                    } else if (this.mediaRecoveryCount === 3) {
                      console.warn(
                        `HLS Media error. Stage 3 Recovery: detachMedia() + attachMedia() (${this.mediaRecoveryCount}/3)`
                      );
                      hls.detachMedia();
                      hls.attachMedia(this.video!);
                    } else {
                      console.error('Fatal HLS Media decode error. Stage 3 Recovery exhausted.');
                      controller.updateStatePublic({ error: 'Fatal media decoding failure.' });
                      this.destroy();
                    }
                    break;
                  default:
                    console.error('Fatal HLS error, destroying streaming instance:', data);
                    controller.updateStatePublic({
                      error: 'Fatal video stream initialization crash.',
                    });
                    this.destroy();
                    break;
                }
              }
            }
          );
        })
        .catch((err) => {
              console.error('[HlsHandler] DRM setup failed:', err);
              controller.updateStatePublic({
                error: 'Fatal DRM initialization failure.',
              });
            });
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
          const mergedDrm = {
            ...(controller.config?.drm || {}),
            ...(source.drm || {}),
          };
          const hasDrm = Object.keys(mergedDrm).length > 0;
          if (hasDrm) {
            this.drmManager = new DrmManager();
            this.drmManager.load(video, mergedDrm, controller, false);
          }
          video.src = source.src!;
          video.load();
        } else {
          controller.updateStatePublic({
            error: 'HLS streaming is not supported by your browser.',
          });
        }
      })
      .catch((err) => {
        console.error('Failed to load hls.js:', err);
        controller.updateStatePublic({ error: 'Failed to load HLS library.' });
      });
  }

  private syncAndDeduplicateTracks() {
    if (!this.hls || !this.controller) return;
    const rawTracks = this.hls.audioTracks || [];
    const groups: Record<string, { label: string; rawIndices: number[] }> = {};
    const groupKeysOrder: string[] = [];

    for (let i = 0; i < rawTracks.length; i++) {
      const track = rawTracks[i];
      const label = normalizeAudioLabel(track.name, track.lang);

      if (!groups[label]) {
        groups[label] = {
          label,
          rawIndices: [],
        };
        groupKeysOrder.push(label);
      }
      groups[label].rawIndices.push(i);
    }

    this.uniqueAudioTracks = groupKeysOrder.map((label) => ({
      label,
      rawIndices: groups[label].rawIndices,
    }));

    const labels = this.uniqueAudioTracks.map((t) => t.label);

    const activeRawIdx = this.hls.audioTrack;
    let activeUniqueIndex = -1;
    for (let i = 0; i < this.uniqueAudioTracks.length; i++) {
      if (this.uniqueAudioTracks[i].rawIndices.includes(activeRawIdx)) {
        activeUniqueIndex = i;
        break;
      }
    }

    this.controller.updateStatePublic({
      audioTracks: labels,
      activeAudioTrack: activeUniqueIndex >= 0 ? activeUniqueIndex : 0,
    });
  }

  private syncQualityState() {
    if (!this.hls || !this.controller) return;
    const qualities = this.controller.getState().qualities;
    if (qualities.length === 0) return;

    const isAuto = this.isAutoMode;

    let levelName = 'Auto';
    let activeIndex = -1;
    if (this.lastLevelIndex >= 0 && this.lastLevelIndex < this.hls.levels.length) {
      activeIndex = this.lastLevelIndex;
    } else if (this.hls.currentLevel >= 0 && this.hls.currentLevel < this.hls.levels.length) {
      activeIndex = this.hls.currentLevel;
    }

    if (activeIndex >= 0 && activeIndex < this.hls.levels.length) {
      levelName = qualities[activeIndex + 1] || 'Unknown';
    }

    const activeQuality = isAuto
      ? levelName !== 'Auto'
        ? `Auto (${levelName})`
        : 'Auto'
      : levelName;

    this.controller.updateStatePublic({ activeQuality });
  }

  destroy() {
    this.stopLivePolling();
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
    if (this.drmManager) {
      this.drmManager.destroy();
      this.drmManager = null;
    }
    this.controller = null;
    this.video = null;
    this.lastLevelIndex = -1;
    this.isAutoMode = true;
    this.uniqueAudioTracks = [];
  }

  setQuality(index: number) {
    if (this.hls) {
      this.isAutoMode = index === 0;
      const levelIndex = index - 1;
      this.hls.nextLevel = levelIndex;
      if (levelIndex === -1) {
        this.lastLevelIndex = -1;
      } else {
        this.lastLevelIndex = levelIndex;
      }
      this.syncQualityState();
    }
  }

  setAudioTrack(index: number) {
    if (this.hls && this.uniqueAudioTracks && index >= 0 && index < this.uniqueAudioTracks.length) {
      const targetUnique = this.uniqueAudioTracks[index];
      const rawTargetIdx = targetUnique.rawIndices[0];
      this.hls.audioTrack = rawTargetIdx;
    }
  }

  setSubtitleTrack(index: number) {
    if (this.hls) {
      this.hls.subtitleTrack = index;
    }
  }

  getStats(): Partial<PlayerStatistics> {
    if (!this.hls) return {};
    const stats: Partial<PlayerStatistics> = {};
    if (this.hls.bandwidthEstimate !== undefined) {
      stats.bandwidthEstimate = this.hls.bandwidthEstimate;
    }
    const currentLevel = this.hls.currentLevel;
    if (currentLevel >= 0 && this.hls.levels && this.hls.levels[currentLevel]) {
      stats.bitrate = this.hls.levels[currentLevel].bitrate;
    }
    return stats;
  }
}

export class DashHandler implements SourceHandler {
  private player: dashjs.MediaPlayerClass | null = null;
  private controller: PlayerController | null = null;
  private video: HTMLVideoElement | null = null;
  private lastQualityIndex = -1;
  private isAutoMode = true;
  private videoRepresentations: Array<{ id: string }> = [];
  private uniqueAudioTracks: Array<{ label: string; rawTracks: DashMediaInfoExtras[] }> = [];
  readonly managesSubtitles = true;
  private dashRetryCount = 0;
  private eventNames: Record<string, string> = {};
  private drmManager: DrmManager | null = null;
  /** False once the viewer seeks back into the DVR window or resumes behind live. */
  private followingLive = true;
  /** Last live catch-up value pushed to dash.js, so settings only change on transitions. */
  private catchupEnabled: boolean | null = null;

  getDrmManager(): DrmManager | null {
    return this.drmManager;
  }

  public getRawLiveInfo(): RawLiveInfo | null {
    if (!this.player || !this.player.isDynamic()) return null;

    const settings = this.player.getSettings();
    const isLowLatency = isDashLowLatencyActive(this.player);
    const liveDelay = settings?.streaming?.delay?.liveDelay || 3;
    let liveEdgeTarget = null;
    let dvrWindow = 0;

    if (this.video && this.video.seekable.length > 0) {
      const start = this.video.seekable.start(0);
      const end = this.video.seekable.end(this.video.seekable.length - 1);
      liveEdgeTarget = Math.max(0, end - liveDelay);
      dvrWindow = end - start;
    }

    let hasDvr = true;
    try {
      if (dvrWindow <= 15) {
        hasDvr = false; // Missing depth + small window = no meaningful DVR
      }

      const adapter = this.player.getDashAdapter?.();
      const mpd = adapter?.getMpd?.() || (this.player as DashLegacyPlayerMethods).getMpd?.();
      if (mpd && mpd.timeShiftBufferDepth !== undefined) {
        hasDvr = mpd.timeShiftBufferDepth > 10;
      }
    } catch (e) {
      hasDvr = dvrWindow > 10;
    }

    return {
      isLive: true,
      isLowLatency,
      hasDvr,
      dvrWindow,
      liveEdgeTarget,
    };
  }

  seekToLiveEdge() {
    if (this.player && typeof this.player.seekToOriginalLive === 'function') {
      this.player.seekToOriginalLive();
    } else if (this.player && this.player.isDynamic()) {
      if (this.video && this.video.seekable.length > 0) {
        const end = this.video.seekable.end(this.video.seekable.length - 1);
        const settings = this.player.getSettings();
        const liveDelay = settings?.streaming?.delay?.liveDelay || 3;
        this.player.seek(Math.max(0, end - liveDelay));
      } else if (Number.isFinite(this.player.duration())) {
        this.player.seek(this.player.duration());
      }
    }
  }

  /**
   * Live catch-up (small playback-rate changes that hold latency near the target) is
   * always on in live-only mode. In live-dvr mode it's on for low-latency streams while
   * the viewer follows the live edge, and off once they seek back into the DVR window or
   * resume from a pause behind it, so dash.js doesn't pull a time-shifted viewer forward.
   * It follows viewer actions rather than the current latency, so a stall at the live
   * edge doesn't switch catch-up off just when it's needed to recover.
   */
  private syncLiveCatchup = () => {
    if (!this.player || !this.controller) return;
    try {
      if (!this.player.isDynamic()) return;
      const enabled =
        this.controller.getState().liveMode === 'live-only' ||
        (this.followingLive && isDashLowLatencyActive(this.player));
      if (enabled === this.catchupEnabled) return;
      this.catchupEnabled = enabled;
      this.player.updateSettings({ streaming: { liveCatchup: { enabled } } });
    } catch {
      // dash.js throws before playback is initialized; the next timeupdate retries.
    }
  };

  /**
   * Records whether the viewer is following the live edge, given a position they chose.
   * Only viewer actions call this: seeks made by dash.js itself must not count.
   */
  private recordViewerPosition(position: number) {
    if (!this.player) return;
    try {
      if (!this.player.isDynamic()) return;
      const target = this.getRawLiveInfo()?.liveEdgeTarget;
      // Before the first frame the position is still 0, so keep the current intent.
      if (target == null || position <= 0) return;
      this.followingLive = target - position <= LOW_LATENCY_LIVE_EDGE_SECONDS;
      this.syncLiveCatchup();
    } catch {
      // dash.js throws before playback is initialized.
    }
  }

  /** Resuming playback: the viewer carries on from wherever the playhead is now. */
  private handleResume = () => {
    if (this.video) this.recordViewerPosition(this.video.currentTime);
  };

  /** "Go to live" always means the viewer is following the live edge again. */
  private handleLiveEdgeSync = () => {
    this.followingLive = true;
    this.syncLiveCatchup();
  };

  private normalizeQualityIndex(value: unknown): number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : -1;
  }

  private resolveCurrentRepresentationIndex(): number {
    if (!this.player || this.videoRepresentations.length === 0) return -1;
    const currentRep = this.player.getCurrentRepresentationForType('video');
    if (!currentRep) return -1;
    return this.videoRepresentations.findIndex((r) => r.id === currentRep.id);
  }

  private handleTrackChangeRendered = (e: { mediaType?: string }) => {
    if (!this.player || !this.controller) return;
    if (e.mediaType === 'audio') {
      const currentTrack = this.player.getCurrentTrackFor('audio');
      if (currentTrack) {
        let activeUniqueIndex = -1;
        for (let i = 0; i < this.uniqueAudioTracks.length; i++) {
          const hasTrack = this.uniqueAudioTracks[i].rawTracks.some(
            (t) =>
              t === currentTrack ||
              t.id === currentTrack.id ||
              (t.lang === currentTrack.lang && t.index === currentTrack.index)
          );
          if (hasTrack) {
            activeUniqueIndex = i;
            break;
          }
        }
        if (activeUniqueIndex !== -1) {
          this.controller.updateStatePublic({ activeAudioTrack: activeUniqueIndex });
        }
      }
    }
  };

  private handleStreamInitialized = () => {
    if (!this.player || !this.controller) return;
    this.dashRetryCount = 0;
    const representations = this.player.getRepresentationsByType
      ? this.player.getRepresentationsByType('video')
      : [];
    this.videoRepresentations = representations;
    const hasMultiple = representations.length > 1;
    const qualities: string[] = [];
    if (hasMultiple) {
      qualities.push('Auto');
      const labelCounts: Record<string, number> = {};
      representations.forEach((r) => {
        const rate = r.bandwidth || (r as DashRepresentation & { bitrate?: number }).bitrate || 0;
        const base = r.height ? `${r.height}p` : `${Math.round(rate / 1000)}kbps`;
        labelCounts[base] = (labelCounts[base] || 0) + 1;
      });
      representations.forEach((r) => {
        const rate = r.bandwidth || (r as DashRepresentation & { bitrate?: number }).bitrate || 0;
        const base = r.height ? `${r.height}p` : `${Math.round(rate / 1000)}kbps`;
        if (labelCounts[base] > 1 && rate) {
          qualities.push(`${base} (${Math.round(rate / 1000)}k)`);
        } else {
          qualities.push(base);
        }
      });
    }
    const dashTextTracks = this.player.getTracksFor('text');
    const dashSubTracks = dashTextTracks.map((t) => {
      const track = t as DashMediaInfoExtras;
      const roles: string[] = track.roles
        ? track.roles
            .map((r) => (typeof r === 'string' ? r : r.value || ''))
            .filter(Boolean)
        : [];
      return {
        label: track.label || track.lang || 'Unknown',
        language: track.lang || '',
        default: !!track.isDefault || !!track.default,
        forced: false,
        kind: roles.includes('caption') ? ('captions' as const) : ('subtitles' as const),
      };
    });

    const activeTextTrack = this.player.getCurrentTrackFor('text');
    this.controller.setManagedSubtitleTracks(
      'dash',
      dashSubTracks,
      activeTextTrack && activeTextTrack.index !== null ? activeTextTrack.index : -1
    );

    const isLive = this.player.isDynamic();
    const isLowLatency = isLive && isDashLowLatencyActive(this.player);

    this.controller.updateStatePublic({
      qualities,
      activeQuality: hasMultiple ? 'Auto' : '',
      error: null,
      isLive,
      isLowLatency,
      ...(isLive ? { isAtLiveEdge: true } : {}),
    });

    this.controller.dispatchEvent('live-status-change', { isLive, isLowLatency });

    if (isLive) {
      this.controller.updateLiveState();
    }

    this.syncAndDeduplicateTracks();

    if (hasMultiple) {
      this.syncQualityState();
    }
  };

  private handleQualityChangeRendered = (e: { mediaType?: string; newQuality?: number }) => {
    if (!this.player) return;
    if (e.mediaType === 'video') {
      if (this.isAutoMode) {
        this.lastQualityIndex = -1;
      } else {
        const repIndex = this.resolveCurrentRepresentationIndex();
        if (repIndex >= 0) {
          this.lastQualityIndex = repIndex;
        } else {
          const renderedIndex = this.normalizeQualityIndex(e?.newQuality);
          if (renderedIndex >= 0) {
            this.lastQualityIndex = renderedIndex;
          }
        }
      }
      this.syncQualityState();
    }
  };

  private handleTextTrackChanged = () => {
    if (!this.player || !this.controller) return;
    const currentTextTracks = this.player.getTracksFor('text');
    const currentSubTracks = currentTextTracks.map((t) => {
      const track = t as DashMediaInfoExtras;
      const roles: string[] = track.roles
        ? track.roles
            .map((r) => (typeof r === 'string' ? r : r.value || ''))
            .filter(Boolean)
        : [];
      return {
        label: track.label || track.lang || 'Unknown',
        language: track.lang || '',
        default: !!track.isDefault || !!track.default,
        forced: false,
        kind: roles.includes('caption') ? ('captions' as const) : ('subtitles' as const),
      };
    });
    const activeTextTrack = this.player.getCurrentTrackFor('text');
    this.controller.setManagedSubtitleTracks(
      'dash',
      currentSubTracks,
      activeTextTrack && activeTextTrack.index !== null ? activeTextTrack.index : -1
    );
  };

  private handleKeySystemSelected = (_e: { keySystem?: string }) => {
    // console.log('Key system selected:', e.keySystem);
  };

  private handleKeySessionCreated = (e: DashKeySessionEventLike) => {
    const session = e.session;
    if (session && this.drmManager) {
      this.drmManager.registerSession(session);
    }
  };

  private handleKeySessionClosed = (e: DashKeySessionEventLike) => {
    const session = e.session;
    if (session && this.drmManager) {
      this.drmManager.unregisterSession(session);
    }
    if (this.controller && session) {
      this.controller.dispatchEvent('drmsessionclosed', { session, system: 'unknown' });
    }
  };

  private handleKeySessionRemoved = (e: DashKeySessionEventLike) => {
    const session = e.session;
    if (session && this.drmManager) {
      this.drmManager.unregisterSession(session);
    }
    if (this.controller && session) {
      this.controller.dispatchEvent('drmsessionclosed', { session, system: 'unknown' });
    }
  };

  private handleKeyStatusesChanged = (e: DashKeySessionEventLike) => {
    const session = e.session;
    if (this.controller && session) {
      session.keyStatuses.forEach((status, _keyId) => {
        if (status === 'output-restricted') {
          this.drmManager?.triggerDrmError('Playback restricted by HDCP output requirements.', 'certificate');
        } else if (status === 'expired') {
          this.drmManager?.triggerDrmError('Playback key has expired.', 'certificate');
        }
      });
    }
  };

  private handleKeyMessage = (_e: unknown) => {
    // Event is dispatched by EME global monkey patch to avoid duplicate dispatches
  };

  private handleProtectionError = (e: DashProtectionErrorEventLike) => {
    console.error('[DashHandler] Protection Error:', e);
    const errorField = e.error;
    const message =
      (typeof errorField === 'object' ? errorField?.message : undefined) ||
      (typeof errorField === 'string' ? errorField : undefined) ||
      'Unknown protection error';

    let errorType: 'key-system' | 'session' | 'license' | 'certificate' = 'session';
    if (message.toLowerCase().includes('key system') || message.toLowerCase().includes('keysystem')) {
      errorType = 'key-system';
    } else if (message.toLowerCase().includes('license') || message.toLowerCase().includes('request')) {
      errorType = 'license';
    } else if (message.toLowerCase().includes('certificate')) {
      errorType = 'certificate';
    }

    if (this.drmManager) {
      this.drmManager.triggerDrmError(message, errorType, e);
    } else if (this.controller) {
      this.controller.updateStatePublic({ error: `DRM: ${message}` });
      this.controller.dispatchEvent('error', { message: `DRM: ${message}` });
      this.controller.dispatchEvent('drmerror', {
        message: `DRM: ${message}`,
        errorType,
        originalError: e,
      });
    }
  };

  private bufferToHex(buffer: ArrayBuffer): string {
    const view = new DataView(buffer);
    let hex = '';
    for (let i = 0; i < view.byteLength; i++) {
      const value = view.getUint8(i);
      hex += value.toString(16).padStart(2, '0');
    }
    return hex;
  }

  private handleError = (e: DashPlaybackErrorEventLike) => {
    if (!this.player || !this.controller || !this.video) return;
    console.error('Dash.js error:', e);

    const errorField = e.error;
    const errorObj = typeof errorField === 'object' ? errorField : undefined;
    const errorMsg = errorObj?.message || (typeof errorField === 'string' ? errorField : '') || '';
    const errorStatus =
      errorObj?.data?.response?.status ?? errorObj?.data?.status ?? errorObj?.status ?? undefined;

    const isFatalAuth = errorStatus === 401 || errorStatus === 403;
    const isUnsupportedKeySystem =
      errorMsg.toLowerCase().includes('key system') || errorMsg.toLowerCase().includes('keysystem');

    if (isFatalAuth || isUnsupportedKeySystem) {
      console.error(`[DashHandler] Non-recoverable DASH DRM error: ${errorMsg} (HTTP: ${errorStatus ?? 'N/A'})`);
      const friendlyMsg = isFatalAuth
        ? 'Media license acquisition request was denied.'
        : 'DRM key system is not supported by your browser.';

      this.controller.updateStatePublic({ error: friendlyMsg });
      this.controller.dispatchEvent('error', { message: friendlyMsg });
      return;
    }

    if (this.dashRetryCount < 3) {
      this.dashRetryCount++;
      const time = this.video.currentTime;
      const wasPlaying = !this.video.paused;
      const sourceSrc = this.player.getSource();

      const delay = Math.pow(2, this.dashRetryCount) * 1000;
      console.warn(
        `DASH error encountered. Retrying in ${delay}ms (${this.dashRetryCount}/3) by re-attaching source...`
      );

      setTimeout(() => {
        if (!this.player || !this.video) return;
        try {
          this.player.attachSource(sourceSrc);

          const restorePlayhead = () => {
            if (!this.player) return;
            this.player.off(
              this.eventNames.streamInitialized || 'streamInitialized',
              restorePlayhead
            );
            if (this.video) {
              this.video.currentTime = time;
              if (wasPlaying) {
                this.video.play().catch((err) => console.warn('Restore play failed:', err));
              }
            }
          };
          this.player.on(this.eventNames.streamInitialized || 'streamInitialized', restorePlayhead);
        } catch (err) {
          console.error('Failed to attach source for recovery:', err);
        }
      }, delay);
    } else {
      this.controller.updateStatePublic({
        error: `DASH streaming error: ${errorObj?.message || errorField || 'unknown'}`,
      });
    }
  };

  load(source: PlayerSource, video: HTMLVideoElement, controller: PlayerController) {
    if (!source.src) return;
    this.destroy();
    this.controller = controller;
    this.video = video;
    this.lastQualityIndex = -1;
    this.isAutoMode = true;
    this.videoRepresentations = [];
    this.uniqueAudioTracks = [];
    this.dashRetryCount = 0;
    this.followingLive = true;
    this.catchupEnabled = null;
    video.addEventListener('play', this.handleResume);
    video.addEventListener('timeupdate', this.syncLiveCatchup);
    controller.addEventListener('live-edge-sync', this.handleLiveEdgeSync);

    loadDashjs()
      .then((dashjsModule) => {
        if (this.controller !== controller) {
          return;
        }

        const dashjsLib = dashjsModule as typeof dashjs;
        const player = dashjsLib.MediaPlayer().create();
        this.player = player;

        player.on(dashjsLib.MediaPlayer.events.MANIFEST_LOADED, (e: dashjs.ManifestLoadedEvent) => {
          const data = e.data as { url?: string } | undefined;
          controller.dispatchEvent('manifestloaded', {
            system: 'dash',
            data: data?.url ? { url: data.url } : {},
          });
        });

        const state = controller.getState();
        const isLiveOnly = state.liveMode === 'live-only';

        const mergedDrm = {
          ...(controller.config?.drm || {}),
          ...(source.drm || {}),
        };

        const hasDrm = Object.keys(mergedDrm).length > 0;
        if (hasDrm) {
          this.drmManager = new DrmManager();
          this.drmManager.load(video, mergedDrm, controller, true);
        }

        const protectionData: Record<string, DashProtectionDataEntry> = {};
        const protectionSettings: DashProtectionSettings = {};

        if (mergedDrm.persistentState) {
          protectionSettings.persistentState = mergedDrm.persistentState;
        }
        if (mergedDrm.distinctiveIdentifier) {
          protectionSettings.distinctiveIdentifier = mergedDrm.distinctiveIdentifier;
        }

        player.updateSettings({
          streaming: {
            buffer: {
              fastSwitchEnabled: true,
            },
            liveCatchup: {
              enabled: isLiveOnly,
            },
            ...(Object.keys(protectionSettings).length > 0 ? { protection: protectionSettings } : {}),
          } as NonNullable<dashjs.MediaPlayerSettingClass['streaming']>,
        });

        const loadDrmSetup = async () => {
          if (!hasDrm) return;

          if (mergedDrm.widevine) {
            const sysConfig = mergedDrm.widevine;
            const cert = this.drmManager ? await this.drmManager.loadCertificate(sysConfig) : null;
            protectionData['com.widevine.alpha'] = {
              serverURL: sysConfig.licenseUrl,
              httpRequestHeaders: sysConfig.headers,
              withCredentials: !!sysConfig.withCredentials,
              ...(cert ? { serverCertificate: cert } : {}),
              ...(mergedDrm.robustness?.video ? { videoRobustness: mergedDrm.robustness.video } : {}),
              ...(mergedDrm.robustness?.audio ? { audioRobustness: mergedDrm.robustness.audio } : {}),
            };
          }

          if (mergedDrm.playready) {
            const sysConfig = mergedDrm.playready;
            const cert = this.drmManager ? await this.drmManager.loadCertificate(sysConfig) : null;
            protectionData['com.microsoft.playready'] = {
              serverURL: sysConfig.licenseUrl,
              httpRequestHeaders: sysConfig.headers,
              withCredentials: !!sysConfig.withCredentials,
              ...(cert ? { serverCertificate: cert } : {}),
              ...(mergedDrm.robustness?.video ? { videoRobustness: mergedDrm.robustness.video } : {}),
              ...(mergedDrm.robustness?.audio ? { audioRobustness: mergedDrm.robustness.audio } : {}),
            };
          }

          if (mergedDrm.clearkey) {
            const sysConfig = mergedDrm.clearkey;
            const clearkeys = normalizeClearKeys(sysConfig.clearkeys);
            protectionData['org.w3.clearkey'] = {
              serverURL: sysConfig.licenseUrl,
              httpRequestHeaders: sysConfig.headers,
              withCredentials: !!(sysConfig as { withCredentials?: boolean }).withCredentials,
              ...(Object.keys(clearkeys).length > 0 ? { clearkeys } : {}),
            };
          }
        };

        loadDrmSetup()
          .then(() => {
            if (this.controller !== controller || !this.player) return;

            if (Object.keys(protectionData).length > 0) {
              this.player.setProtectionData(protectionData as unknown as dashjs.ProtectionDataSet);
            }

            if (hasDrm) {
              const requestFilter = (request: DashLicenseFilterRequest) => {
                let sysConfig: DrmSystemConfig | null | undefined = null;
                let systemName = '';
                const url = request.url || '';
                const lowerUrl = url.toLowerCase();

                if (mergedDrm.widevine && mergedDrm.widevine.licenseUrl && lowerUrl.includes(mergedDrm.widevine.licenseUrl.toLowerCase())) {
                  sysConfig = mergedDrm.widevine;
                  systemName = 'widevine';
                } else if (mergedDrm.playready && mergedDrm.playready.licenseUrl && lowerUrl.includes(mergedDrm.playready.licenseUrl.toLowerCase())) {
                  sysConfig = mergedDrm.playready;
                  systemName = 'playready';
                } else if (mergedDrm.clearkey && mergedDrm.clearkey.licenseUrl && lowerUrl.includes(mergedDrm.clearkey.licenseUrl.toLowerCase())) {
                  sysConfig = mergedDrm.clearkey;
                  systemName = 'clearkey';
                }

                const challengeLen = request.data
                  ? (request.data as ArrayBuffer | ArrayBufferView).byteLength ||
                    (request.data as string).length ||
                    0
                  : 0;
                this.controller?.dispatchEvent('drmlicenserequest', {
                  url,
                  challengeSize: challengeLen,
                  system: systemName || 'dash'
                });
                this.drmManager?.noteLicenseRequest(systemName || 'dash', url);

                if (!sysConfig || !sysConfig.licenseRequestInterceptor) {
                  return Promise.resolve();
                }

                const challenge = request.data;
                const challengeBuffer = challenge instanceof Uint8Array ? challenge.buffer : challenge;

                return Promise.resolve(
                  sysConfig.licenseRequestInterceptor(challengeBuffer as ArrayBuffer, systemName)
                ).then((intercepted) => {
                  if (intercepted instanceof ArrayBuffer) {
                    request.data = intercepted;
                  } else if (intercepted && typeof intercepted === 'object') {
                    if (intercepted.body) {
                      request.data = intercepted.body;
                    }
                    if (intercepted.headers) {
                      request.headers = {
                        ...request.headers,
                        ...intercepted.headers,
                      };
                    }
                  }
                });
              };

              const responseFilter = (response: DashLicenseFilterResponse) => {
                let sysConfig: DrmSystemConfig | null | undefined = null;
                let systemName = '';
                const url = response.url || '';
                const lowerUrl = url.toLowerCase();

                if (mergedDrm.widevine && mergedDrm.widevine.licenseUrl && lowerUrl.includes(mergedDrm.widevine.licenseUrl.toLowerCase())) {
                  sysConfig = mergedDrm.widevine;
                  systemName = 'widevine';
                } else if (mergedDrm.playready && mergedDrm.playready.licenseUrl && lowerUrl.includes(mergedDrm.playready.licenseUrl.toLowerCase())) {
                  sysConfig = mergedDrm.playready;
                  systemName = 'playready';
                } else if (mergedDrm.clearkey && mergedDrm.clearkey.licenseUrl && lowerUrl.includes(mergedDrm.clearkey.licenseUrl.toLowerCase())) {
                  sysConfig = mergedDrm.clearkey;
                  systemName = 'clearkey';
                }

                const responseLen = response.data
                  ? (response.data as ArrayBuffer | ArrayBufferView).byteLength ||
                    (response.data as string).length ||
                    0
                  : 0;
                this.controller?.dispatchEvent('drmlicenseresponse', {
                  url,
                  responseSize: responseLen,
                  system: systemName || 'dash'
                });
                this.drmManager?.noteLicenseResponse(systemName || 'dash', url);

                if (!sysConfig || !sysConfig.licenseResponseInterceptor) {
                  return Promise.resolve();
                }

                const responseData = response.data;
                const responseBuffer = responseData instanceof Uint8Array ? responseData.buffer : responseData;

                return Promise.resolve(
                  sysConfig.licenseResponseInterceptor(responseBuffer as ArrayBuffer, systemName)
                ).then((intercepted) => {
                  if (intercepted instanceof ArrayBuffer) {
                    response.data = intercepted;
                  }
                });
              };

              this.player.registerLicenseRequestFilter(requestFilter);
              this.player.registerLicenseResponseFilter(responseFilter);
            }

            this.player.initialize(video, source.src!, video.autoplay);

            const eventsObj = ((dashjsLib.MediaPlayer && dashjsLib.MediaPlayer.events) || {}) as Partial<
              dashjs.MediaPlayerEvents
            > &
              Record<string, string | undefined>;
            const evStreamInitialized = eventsObj.STREAM_INITIALIZED || 'streamInitialized';
            const evQualityChangeRendered =
              eventsObj.QUALITY_CHANGE_RENDERED || 'qualityChangeRendered';
            const evTextTrackChanged = eventsObj.TEXT_TRACK_CHANGED || 'textTrackChanged';
            const evError = eventsObj.ERROR || 'error';
            const evTrackChangeRendered = eventsObj.TRACK_CHANGE_RENDERED || 'trackChangeRendered';
            const evEventModeOnReceive = eventsObj.EVENT_MODE_ON_RECEIVE || 'eventModeOnReceive';

            const evKeySystemSelected = eventsObj.KEY_SYSTEM_SELECTED || 'keySystemSelected';
            const evKeySessionCreated = eventsObj.KEY_SESSION_CREATED || 'keySessionCreated';
            const evKeySessionClosed = eventsObj.KEY_SESSION_CLOSED || 'keySessionClosed';
            const evKeySessionRemoved = eventsObj.KEY_SESSION_REMOVED || 'keySessionRemoved';
            const evKeyStatusesChanged = eventsObj.KEY_STATUSES_CHANGED || 'keyStatusesChanged';
            const evKeyMessage = eventsObj.KEY_MESSAGE || 'keyMessage';
            const evProtectionError = eventsObj.PROTECTION_ERROR || 'protectionError';

            this.eventNames = {
              streamInitialized: evStreamInitialized,
              qualityChangeRendered: evQualityChangeRendered,
              textTrackChanged: evTextTrackChanged,
              error: evError,
              trackChangeRendered: evTrackChangeRendered,
              eventModeOnReceive: evEventModeOnReceive,
              keySystemSelected: evKeySystemSelected,
              keySessionCreated: evKeySessionCreated,
              keySessionClosed: evKeySessionClosed,
              keySessionRemoved: evKeySessionRemoved,
              keyStatusesChanged: evKeyStatusesChanged,
              keyMessage: evKeyMessage,
              protectionError: evProtectionError,
            };

            player.on(evTrackChangeRendered, this.handleTrackChangeRendered);
            player.on(evStreamInitialized, this.handleStreamInitialized);
            player.on(evQualityChangeRendered, this.handleQualityChangeRendered);
            player.on(evTextTrackChanged, this.handleTextTrackChanged);
            player.on(evError, this.handleError);

            player.on(evKeySystemSelected, this.handleKeySystemSelected);
            player.on(evKeySessionCreated, this.handleKeySessionCreated);
            player.on(evKeySessionClosed, this.handleKeySessionClosed);
            player.on(evKeySessionRemoved, this.handleKeySessionRemoved);
            player.on(evKeyStatusesChanged, this.handleKeyStatusesChanged);
            player.on(evKeyMessage, this.handleKeyMessage);
            player.on(evProtectionError, this.handleProtectionError);

            player.on(
              evEventModeOnReceive,
              (e: {
                event?: {
                  presentationTime?: number;
                  schemeIdUri?: string;
                  messageData?: Uint8Array;
                  value?: unknown;
                  timescale?: number;
                  duration?: number;
                  id?: unknown;
                };
              }) => {
                if (!controller) return;
                const eventBox = e.event;
                if (eventBox) {
                  controller.emit('metadata', {
                    timestamp: eventBox.presentationTime || 0,
                    type: eventBox.schemeIdUri || 'emsg',
                    sourceProtocol: 'dash',
                    rawData: eventBox.messageData || new Uint8Array(),
                    parsedData: {
                      schemeIdUri: eventBox.schemeIdUri,
                      value: eventBox.value,
                      timescale: eventBox.timescale,
                      presentationTime: eventBox.presentationTime,
                      duration: eventBox.duration,
                      id: eventBox.id,
                    },
                  });
                }
              }
            );
          })
          .catch((err) => {
            console.error('[DashHandler] Dynamic DRM setup failed:', err);
            this.handleProtectionError(err as DashProtectionErrorEventLike);
          });
      })
      .catch((err) => {
        console.error('Failed to load dashjs:', err);
        controller.updateStatePublic({ error: 'Failed to load DASH library.' });
      });
  }

  private syncAndDeduplicateTracks() {
    if (!this.player || !this.controller) return;

    const rawTracks = this.player.getTracksFor('audio') || [];
    const groups: Record<
      string,
      {
        lang: string;
        label?: string;
        roles: string[];
        channels?: string | number;
        rawTracks: DashMediaInfoExtras[];
      }
    > = {};
    const groupKeysOrder: string[] = [];

    for (let i = 0; i < rawTracks.length; i++) {
      const track = rawTracks[i] as DashMediaInfoExtras;
      const lang = track.lang || '';

      let label = '';
      if (
        track.labels &&
        Array.isArray(track.labels) &&
        track.labels.length > 0 &&
        track.labels[0]?.text
      ) {
        label = track.labels[0].text;
      } else if ('label' in track && typeof track.label === 'string') {
        label = track.label;
      }

      const roles: string[] = track.roles
        ? track.roles
            .map((r: string | { value: string }) => (typeof r === 'string' ? r : r.value || ''))
            .filter(Boolean)
        : [];
      const cleanRolesForKey = roles
        .map((r) => r.trim().toLowerCase())
        .filter((r) => r !== 'main' && r !== 'alternate' && r !== '');
      const channels =
        track.audioChannelConfiguration?.[0]?.value ||
        (track as { channels?: string | number }).channels ||
        '';

      const normLang = lang.toLowerCase();
      const normLabel = label.toLowerCase();
      const roleStr = cleanRolesForKey.sort().join(',');
      const channelStr = channels ? String(channels) : '';

      const key = `${normLang}|${normLabel}|${roleStr}|${channelStr}`;

      if (!groups[key]) {
        groups[key] = {
          lang,
          label: label || undefined,
          roles,
          channels: channels || undefined,
          rawTracks: [],
        };
        groupKeysOrder.push(key);
      }
      groups[key].rawTracks.push(track);
    }

    this.uniqueAudioTracks = groupKeysOrder.map((key) => {
      const group = groups[key];
      const langName = getLanguageName(group.lang);

      let labelText = '';
      if (group.label) {
        const isLangCode = /^[a-zA-Z]{2,3}(-[a-zA-Z]{2,4})?$/.test(group.label.trim());
        if (!isLangCode) {
          labelText = group.label.trim();
        }
      }

      const parts: string[] = [labelText || langName || 'Unknown'];

      const cleanRoles = group.roles
        .map((r) => r.trim().toLowerCase())
        .filter((r) => r !== 'main' && r !== 'alternate' && r !== '');
      if (cleanRoles.length > 0) {
        parts.push(cleanRoles.map((r) => r.charAt(0).toUpperCase() + r.slice(1)).join(', '));
      }

      if (group.channels) {
        const ch = parseInt(String(group.channels), 10);
        if (ch === 2) {
          parts.push('Stereo');
        } else if (ch === 6 || ch === 5.1) {
          parts.push('5.1');
        } else if (ch > 0) {
          parts.push(`${ch}ch`);
        }
      }

      const label = parts.join(' ');

      return {
        label,
        rawTracks: group.rawTracks,
      };
    });

    const labels = this.uniqueAudioTracks.map((t) => t.label);

    const currentTrack = this.player.getCurrentTrackFor('audio');
    let activeUniqueIndex = -1;
    if (currentTrack) {
      for (let i = 0; i < this.uniqueAudioTracks.length; i++) {
        const hasTrack = this.uniqueAudioTracks[i].rawTracks.some(
          (t) =>
            t === currentTrack ||
            t.id === currentTrack.id ||
            (t.lang === currentTrack.lang && t.index === currentTrack.index)
        );
        if (hasTrack) {
          activeUniqueIndex = i;
          break;
        }
      }
    }

    if (activeUniqueIndex === -1 && this.uniqueAudioTracks.length > 0) {
      activeUniqueIndex = 0;
    }

    this.controller.updateStatePublic({
      audioTracks: labels,
      activeAudioTrack: activeUniqueIndex,
    });
  }

  private syncQualityState() {
    if (!this.player || !this.controller) return;
    const qualities = this.controller.getState().qualities;
    if (qualities.length === 0) return;

    const isAuto = this.isAutoMode;

    let levelName = 'Auto';
    let indexToUse = this.normalizeQualityIndex(this.lastQualityIndex);

    if (indexToUse === -1) {
      indexToUse = this.resolveCurrentRepresentationIndex();
    }

    if (indexToUse >= 0 && indexToUse < qualities.length - 1) {
      levelName = qualities[indexToUse + 1] || 'Unknown';
    }

    const activeQuality = isAuto
      ? levelName !== 'Auto'
        ? `Auto (${levelName})`
        : 'Auto'
      : levelName;

    this.controller.updateStatePublic({ activeQuality });
  }

  destroy() {
    if (this.video) {
      this.video.removeEventListener('play', this.handleResume);
      this.video.removeEventListener('timeupdate', this.syncLiveCatchup);
    }
    this.controller?.removeEventListener('live-edge-sync', this.handleLiveEdgeSync);
    if (this.player) {
      try {
        if (this.eventNames.trackChangeRendered)
          this.player.off(this.eventNames.trackChangeRendered, this.handleTrackChangeRendered);
        if (this.eventNames.streamInitialized)
          this.player.off(this.eventNames.streamInitialized, this.handleStreamInitialized);
        if (this.eventNames.qualityChangeRendered)
          this.player.off(this.eventNames.qualityChangeRendered, this.handleQualityChangeRendered);
        if (this.eventNames.textTrackChanged)
          this.player.off(this.eventNames.textTrackChanged, this.handleTextTrackChanged);
        if (this.eventNames.error) this.player.off(this.eventNames.error, this.handleError);

        if (this.eventNames.keySystemSelected) this.player.off(this.eventNames.keySystemSelected, this.handleKeySystemSelected);
        if (this.eventNames.keySessionCreated) this.player.off(this.eventNames.keySessionCreated, this.handleKeySessionCreated);
        if (this.eventNames.keySessionClosed) this.player.off(this.eventNames.keySessionClosed, this.handleKeySessionClosed);
        if (this.eventNames.keySessionRemoved) this.player.off(this.eventNames.keySessionRemoved, this.handleKeySessionRemoved);
        if (this.eventNames.keyStatusesChanged) this.player.off(this.eventNames.keyStatusesChanged, this.handleKeyStatusesChanged);
        if (this.eventNames.keyMessage) this.player.off(this.eventNames.keyMessage, this.handleKeyMessage);
        if (this.eventNames.protectionError) this.player.off(this.eventNames.protectionError, this.handleProtectionError);
      } catch (err) {
        console.warn('[DashHandler] Error unbinding event listeners:', err);
      }
      this.player.destroy();
      this.player = null;
    }
    if (this.drmManager) {
      this.drmManager.destroy();
      this.drmManager = null;
    }
    this.controller = null;
    this.video = null;
    this.lastQualityIndex = -1;
    this.isAutoMode = true;
    this.videoRepresentations = [];
    this.uniqueAudioTracks = [];
  }

  seek(time: number): boolean {
    // Every seek here is a viewer action, so it decides whether live catch-up runs.
    this.recordViewerPosition(time);
    if (!this.player) return false;
    try {
      // VOD keeps the default path: PlayerController sets video.currentTime directly.
      if (!this.player.isDynamic()) return false;
      // Live DVR seeks must go through dash.js so it fetches segments at the target.
      // Setting video.currentTime directly leaves dash.js buffering near the live edge,
      // and it then moves the playhead back into that buffer. dash.js's seek() is the
      // wrong call too: it takes an offset from the DVR window start, so an absolute
      // time lands past the live edge and gets clamped to it. seekToPresentationTime()
      // takes the absolute time.
      this.player.seekToPresentationTime(time);
      return true;
    } catch {
      // dash.js throws before playback is initialized; fall back to video.currentTime.
      return false;
    }
  }

  setQuality(index: number) {
    if (this.player) {
      this.isAutoMode = index === 0;
      const levelIndex = index - 1;
      const playerWithABR = this.player as unknown as {
        setAutoSwitchQualityFor?: (type: string, value: boolean) => void;
        setRepresentationForTypeById?: (type: string, id: string) => void;
        setQualityFor?: (type: string, index: number, value: boolean) => void;
      };
      if (levelIndex === -1) {
        if (playerWithABR.setAutoSwitchQualityFor) {
          playerWithABR.setAutoSwitchQualityFor('video', true);
        } else {
          this.player.updateSettings({
            streaming: { abr: { autoSwitchBitrate: { video: true } } },
          });
        }
        this.lastQualityIndex = -1;
      } else {
        if (playerWithABR.setAutoSwitchQualityFor) {
          playerWithABR.setAutoSwitchQualityFor('video', false);
        } else {
          this.player.updateSettings({
            streaming: { abr: { autoSwitchBitrate: { video: false } } },
          });
        }
        if (levelIndex >= 0 && levelIndex < this.videoRepresentations.length) {
          const targetRep = this.videoRepresentations[levelIndex];
          if (playerWithABR.setRepresentationForTypeById) {
            playerWithABR.setRepresentationForTypeById('video', targetRep.id);
          } else if (playerWithABR.setQualityFor) {
            playerWithABR.setQualityFor('video', levelIndex, false);
          }
          this.lastQualityIndex = levelIndex;
        }
      }
      this.syncQualityState();
    }
  }

  setAudioTrack(index: number) {
    if (
      this.player &&
      this.uniqueAudioTracks &&
      index >= 0 &&
      index < this.uniqueAudioTracks.length
    ) {
      const uniqueTrack = this.uniqueAudioTracks[index];
      const currentTrack = this.player.getCurrentTrackFor('audio');
      const targetRawTrack =
        uniqueTrack.rawTracks.find(
          (rt) =>
            currentTrack &&
            (rt.mimeType === currentTrack.mimeType || rt.codec === currentTrack.codec)
        ) || uniqueTrack.rawTracks[0];

      if (targetRawTrack) {
        this.player.setCurrentTrack(targetRawTrack);
      }
    }
  }

  setSubtitleTrack(index: number) {
    if (this.player) {
      const tracks = this.player.getTracksFor('text');
      if (index === -1) {
        this.player.setTextTrack(-1);
      } else if (index >= 0 && index < tracks.length) {
        this.player.setTextTrack(index);
      }
    }
  }

  getStats(): Partial<PlayerStatistics> {
    if (!this.player) return {};
    const stats: Partial<PlayerStatistics> = {};
    try {
      const player = this.player as unknown as DashLegacyPlayerMethods;
      const throughput = player.getAverageThroughput?.('video') ?? 0;
      if (throughput > 0) {
        stats.bandwidthEstimate = throughput * 1000;
      }
      const quality = player.getQualityFor?.('video');
      const bitrates = player.getBitrateInfoListFor?.('video');
      if (bitrates && quality !== undefined && bitrates[quality]) {
        stats.bitrate = bitrates[quality].bitrate;
      }
    } catch (_) {
      /* ignore */
    }
    return stats;
  }
}
export class EmbedHandler implements SourceHandler {
  private iframe: HTMLIFrameElement | null = null;
  private video: HTMLVideoElement | null = null;
  private controller: PlayerController | null = null;

  load(source: PlayerSource, video: HTMLVideoElement, controller: PlayerController) {
    this.destroy();
    this.video = video;
    this.controller = controller;

    const src = source.src || '';
    if (!src) return;

    const embedUrl = src;

    video.style.display = 'none';
    video.pause();

    const iframe = document.createElement('iframe');
    iframe.src = embedUrl;
    iframe.style.position = 'absolute';
    iframe.style.top = '0';
    iframe.style.left = '0';
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.border = 'none';
    iframe.style.zIndex = '10';
    iframe.allow =
      'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
    iframe.allowFullscreen = true;

    this.iframe = iframe;

    if (video.parentNode) {
      video.parentNode.appendChild(iframe);
    }

    controller.updateStatePublic({
      qualities: [],
      activeQuality: '',
      audioTracks: [],
      activeAudioTrack: -1,
      error: null,
      status: 'playing',
      isPlaying: true,
    });
  }

  destroy() {
    if (this.iframe) {
      if (this.iframe.parentNode) {
        this.iframe.parentNode.removeChild(this.iframe);
      }
      this.iframe = null;
    }
    if (this.video) {
      this.video.style.display = '';
      this.video = null;
    }
    this.controller = null;
  }
}

export class SourceManager {
  private activeHandler: SourceHandler | null = null;

  public getActiveHandler(): SourceHandler | null {
    return this.activeHandler;
  }

  public getHandler(type: SourceType): SourceHandler {
    switch (type) {
      case 'hls':
        return new HlsHandler();
      case 'dash':
        return new DashHandler();
      case 'embed':
        return new EmbedHandler();
      case 'mp4':
      case 'mov':
      case 'webm':
      case 'file':
      case 'blob':
      default:
        return new Mp4Handler();
    }
  }

  public load(source: PlayerSource, video: HTMLVideoElement, controller: PlayerController) {
    this.destroy();
    const type = source.type || 'unknown';
    this.activeHandler = this.getHandler(type);
    this.activeHandler.load(source, video, controller);
  }

  public destroy() {
    if (this.activeHandler) {
      this.activeHandler.destroy();
      this.activeHandler = null;
    }
  }

  public setQuality(index: number) {
    if (this.activeHandler && this.activeHandler.setQuality) {
      this.activeHandler.setQuality(index);
    }
  }

  public setAudioTrack(index: number) {
    if (this.activeHandler && this.activeHandler.setAudioTrack) {
      this.activeHandler.setAudioTrack(index);
    }
  }

  public setSubtitleTrack(index: number) {
    if (this.activeHandler && this.activeHandler.setSubtitleTrack) {
      this.activeHandler.setSubtitleTrack(index);
    }
  }

  public seekToLiveEdge(): boolean {
    if (this.activeHandler && this.activeHandler.seekToLiveEdge) {
      this.activeHandler.seekToLiveEdge();
      return true;
    }
    return false;
  }

  public getRawLiveInfo(): RawLiveInfo | null {
    if (this.activeHandler && this.activeHandler.getRawLiveInfo) {
      return this.activeHandler.getRawLiveInfo();
    }
    return null;
  }
}
