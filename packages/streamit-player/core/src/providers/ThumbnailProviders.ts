import {
  ThumbnailProvider,
  ThumbnailInfo,
  PlayerSource,
  SmartSeekConfig,
  SpriteInfo,
  PlayerConfiguration,
} from '../types';
import { loadHls, loadDashjs } from '../vendorLoaders';

/**
 * Minimal structural typings for the parts of hls.js and dash.js actually
 * touched here (both lazy-imported at runtime). Both packages ship their own
 * types, but importing them statically would pull the packages into every
 * consumer's type-check regardless of whether they're installed - these are
 * verified directly against the calls made below.
 */
interface HlsErrorData {
  type: string;
  details: string;
  fatal: boolean;
}
interface HlsInstance {
  attachMedia(video: HTMLVideoElement): void;
  on(event: string, cb: (event: string, data: HlsErrorData) => void): void;
  loadSource(src: string): void;
  startLoad(): void;
  destroy(): void;
  currentLevel: number;
  loadLevel: number;
}
interface HlsStatic {
  new (config: { enableWorker: boolean; lowLatencyMode: boolean }): HlsInstance;
  isSupported(): boolean;
  Events: {
    MEDIA_ATTACHED: string;
    ERROR: string;
    MANIFEST_PARSED: string;
  };
}

interface DashRepresentation {
  id: string;
}
interface DashInstance {
  updateSettings(settings: unknown): void;
  initialize(video: HTMLVideoElement, src: string, autoPlay: boolean): void;
  on(event: string, cb: (e?: unknown) => void): void;
  destroy(): void;
  getRepresentationsByType?(type: string): DashRepresentation[];
  setRepresentationForTypeById?(type: string, id: string): void;
  setQualityFor?(type: string, quality: number, force: boolean): void;
}
interface DashMediaPlayerFactory {
  MediaPlayer(): { create(): DashInstance };
}

/**
 * Debug/test hook: the sandbox app exposes the player element under this id
 * for smoke tests, with `playerState` mirroring the subset of `PlayerState`
 * these providers need (live/DVR awareness) - not part of the public
 * `PlayerState` contract these thumbnail providers otherwise depend on.
 */
interface DebugPlayerElement extends HTMLElement {
  playerState?: {
    isLive?: boolean;
    canSeekInDvr?: boolean;
  };
}

/** True if `err` looks like a canvas/CORS SecurityError - either a real
 * `DOMException` (code 18 === SECURITY_ERR) or a same-shaped duck-typed
 * error, matching what browsers actually throw from a tainted-canvas read. */
function isSecurityError(err: unknown): boolean {
  if (err instanceof DOMException) {
    return err.name === 'SecurityError' || err.code === 18;
  }
  if (err && typeof err === 'object') {
    const e = err as { name?: unknown; code?: unknown };
    return e.name === 'SecurityError' || e.code === 18;
  }
  return false;
}

export class VideoFrameThumbnailProvider implements ThumbnailProvider {
  readonly type = 'frame-capture';
  private video: HTMLVideoElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private cache = new Map<number, ThumbnailInfo>();
  private currentSrc = '';
  private pendingSrc = '';
  private isSeeking = false;
  private seekQueue: {
    time: number;
    priority: 'high' | 'low';
    resolve: (val: ThumbnailInfo | null) => void;
    reject: (err: unknown) => void;
  }[] = [];
  private isMetadataLoaded = false;
  private hasError = false;
  private consecutiveFailures = 0;
  private metadataPromise: Promise<void> | null = null;
  private resolveMetadata: (() => void) | null = null;
  private hlsInstance: HlsInstance | null = null;
  private dashInstance: DashInstance | null = null;
  private isDestroyed = false;

  private lastSeekTime = 0;
  private lastHighPriorityTime = 0;
  private throttleMs = 150;
  private seekTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private readonly MAX_CACHE_SIZE = 250;
  public isPreciseSeeking = false;
  private activeSeekCleanup: (() => void) | null = null;
  private pendingRequests = new Map<number, Promise<ThumbnailInfo | null>>();
  private config?: SmartSeekConfig;

  constructor(config?: SmartSeekConfig) {
    this.config = config;
    this.initVideoAndCanvas();
  }

  public updateConfig(config?: SmartSeekConfig) {
    this.config = config;
  }

  private handleLoadedMetadata = () => {
    const urlPart = (this.currentSrc || '').split('?')[0].toLowerCase();
    const isDash = urlPart.endsWith('.mpd');
    if (!isDash) {
      this.isMetadataLoaded = true;
      if (this.resolveMetadata) {
        this.resolveMetadata();
      }
    }
  };

  private handleVideoError = (e: Event) => {
    const err = this.video?.error;
    console.debug(
      '[VideoFrameThumbnailProvider] Global error event fired on hidden video:',
      err ? `Code: ${err.code}, Message: ${err.message}` : e
    );
    this.hasError = true;
    this.destroyStreamingInstances();
    if (this.video) {
      try {
        this.video.pause();
      } catch (err) {}
      this.video.removeAttribute('src');
      try {
        this.video.load();
      } catch (err) {}
    }
    if (this.resolveMetadata) {
      this.resolveMetadata();
    }
  };

  private initVideoAndCanvas() {
    if (this.video) return;

    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.crossOrigin = 'anonymous';
    this.video.preload = 'auto';
    this.video.style.cssText =
      'position:fixed;width:320px;height:180px;pointer-events:none;opacity:0.001;z-index:-1000;top:0;left:0;';
    document.body.appendChild(this.video);

    this.video.addEventListener('loadedmetadata', this.handleLoadedMetadata);
    this.video.addEventListener('error', this.handleVideoError);

    this.canvas = document.createElement('canvas');
    this.canvas.width = 320;
    this.canvas.height = 180;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
  }

  public setSource(src: string) {
    if (
      !src ||
      src.includes('Embed') ||
      src.includes('youtube.com') ||
      src.includes('youtu.be') ||
      src.includes('vimeo.com')
    ) {
      this.currentSrc = '';
      this.pendingSrc = '';
      this.cache.clear();
      this.pendingRequests.clear();
      for (const task of this.seekQueue) {
        task.resolve(null);
      }
      this.seekQueue = [];
      this.isSeeking = false;
      this.isMetadataLoaded = false;
      this.hasError = false;
      this.consecutiveFailures = 0;
      this.metadataPromise = null;
      this.resolveMetadata = null;
      this.destroyStreamingInstances();
      return;
    }

    if (this.pendingSrc === src) {
      return;
    }

    this.pendingSrc = src;
    this.cache.clear();
    this.pendingRequests.clear();
    for (const task of this.seekQueue) {
      task.resolve(null);
    }
    this.seekQueue = [];
    this.isSeeking = false;
    this.isMetadataLoaded = false;
    this.hasError = false;
    this.consecutiveFailures = 0;
    this.metadataPromise = null;
    this.resolveMetadata = null;

    this.destroyStreamingInstances();
  }

  private loadPendingSource() {
    const src = this.pendingSrc;
    if (!src) return;
    this.currentSrc = src;

    this.isMetadataLoaded = false;
    this.hasError = false;
    this.metadataPromise = new Promise<void>((resolve) => {
      this.resolveMetadata = resolve;
    });

    this.initVideoAndCanvas();

    if (this.video) {
      let detectedType = 'mp4';
      const urlPart = src.split('?')[0].toLowerCase();
      if (urlPart.endsWith('.m3u8')) detectedType = 'hls';
      else if (urlPart.endsWith('.mpd')) detectedType = 'dash';
      else if (urlPart.endsWith('.webm')) detectedType = 'webm';

      if (detectedType === 'hls') {
        loadHls()
          .then((HlsLib) => {
            if (this.currentSrc !== src || !this.video) return;
            const HlsClass = HlsLib as HlsStatic;
            if (HlsClass.isSupported()) {
              const hls = new HlsClass({
                enableWorker: true,
                lowLatencyMode: true,
              });
              this.hlsInstance = hls;
              hls.attachMedia(this.video);
              hls.on(HlsClass.Events.MEDIA_ATTACHED, () => {
                if (this.currentSrc !== src || this.hlsInstance !== hls) return;
                hls.loadSource(src);
              });
              hls.on(
                HlsClass.Events.ERROR,
                (event: string, data: { type: string; details: string; fatal: boolean }) => {
                  console.error(
                    '[VideoFrameThumbnailProvider HLS Error]:',
                    data.type,
                    data.details,
                    'fatal:',
                    data.fatal
                  );
                }
              );
              hls.on(HlsClass.Events.MANIFEST_PARSED, () => {
                if (this.currentSrc !== src || this.hlsInstance !== hls) return;
                hls.currentLevel = 0;
                hls.loadLevel = 0;
              });
            } else if (this.video.canPlayType('application/vnd.apple.mpegurl')) {
              this.video.src = src;
              this.video.load();
            }
          })
          .catch((err) => {
            console.debug('[VideoFrameThumbnailProvider] Failed to load hls.js:', err);
            this.hasError = true;
            if (this.resolveMetadata) this.resolveMetadata();
          });
      } else if (detectedType === 'dash') {
        loadDashjs()
          .then((dashjsModule) => {
            if (this.currentSrc !== src || !this.video) return;
            const dashjsLib = dashjsModule as DashMediaPlayerFactory;
            const player = dashjsLib.MediaPlayer().create();
            this.dashInstance = player;
            player.updateSettings({
              streaming: {
                abr: {
                  autoSwitchBitrate: { video: false },
                },
              },
            });
            player.initialize(this.video, src, false);
            player.on('streamInitialized', () => {
              if (this.currentSrc !== src || this.dashInstance !== player) return;
              try {
                const representations = player.getRepresentationsByType
                  ? player.getRepresentationsByType('video')
                  : [];
                if (representations.length > 0) {
                  if (typeof player.setRepresentationForTypeById === 'function') {
                    player.setRepresentationForTypeById('video', representations[0].id);
                  } else if (typeof player.setQualityFor === 'function') {
                    player.setQualityFor('video', 0, true);
                  }
                }
              } catch (e) {
                console.debug(
                  '[VideoFrameThumbnailProvider] Failed to set quality on DASH instance:',
                  e
                );
              }
              this.isMetadataLoaded = true;
              if (this.resolveMetadata) {
                this.resolveMetadata();
              }
            });
            player.on('error', (e: unknown) => {
              if (this.currentSrc !== src || this.dashInstance !== player) return;
              console.debug('[VideoFrameThumbnailProvider] DASH player error:', e);
              this.hasError = true;
              if (this.resolveMetadata) {
                this.resolveMetadata();
              }
            });
          })
          .catch((err) => {
            console.debug('[VideoFrameThumbnailProvider] Failed to load dashjs:', err);
            this.hasError = true;
            if (this.resolveMetadata) this.resolveMetadata();
          });
      } else {
        this.video.src = src;
        this.video.load();
      }
    }
  }

  private destroyStreamingInstances() {
    if (this.activeSeekCleanup) {
      this.activeSeekCleanup();
    }
    this.isSeeking = false;

    if (this.seekTimeoutId !== null) {
      clearTimeout(this.seekTimeoutId);
      this.seekTimeoutId = null;
    }
    if (this.hlsInstance) {
      try {
        this.hlsInstance.destroy();
      } catch (e) {}
      this.hlsInstance = null;
    }
    if (this.dashInstance) {
      try {
        this.dashInstance.destroy();
      } catch (e) {}
      this.dashInstance = null;
    }
  }

  public isUnavailable(): boolean {
    const player = document.getElementById('test-player') as DebugPlayerElement | null;
    if (player && player.playerState) {
      const state = player.playerState;
      if (state.isLive && !state.canSeekInDvr) {
        return true;
      }
    }
    return !this.pendingSrc || this.hasError;
  }

  public getNearestCachedThumbnail(time: number): ThumbnailInfo | null {
    if (this.config?.cache === false) return null;
    if (this.cache.size === 0) return null;
    let nearest: ThumbnailInfo | null = null;
    let minDiff = Infinity;
    for (const [key, value] of this.cache.entries()) {
      const diff = Math.abs(key - time);
      if (diff < minDiff) {
        minDiff = diff;
        nearest = value;
      }
    }
    return nearest;
  }

  getThumbnail(
    time: number,
    priority: 'high' | 'low' = 'high'
  ): Promise<ThumbnailInfo | null> | ThumbnailInfo | null {
    if (!this.pendingSrc) {
      return null;
    }

    const player = document.getElementById('test-player') as DebugPlayerElement | null;
    const isLive = !!(player && player.playerState && player.playerState.isLive);

    if (isLive && this.video) {
      try {
        const seekable = this.video.seekable;
        if (seekable && seekable.length > 0) {
          const start = seekable.start(0);
          for (const key of this.cache.keys()) {
            if (key < start - 10) {
              this.cache.delete(key);
            }
          }
          for (const key of this.pendingRequests.keys()) {
            if (key < start - 10) {
              this.pendingRequests.delete(key);
            }
          }
        }
      } catch (e) {}
    }

    if (isLive) {
      const now = Date.now();
      const idleTime = now - this.lastSeekTime;
      let needsRefresh = false;
      if (idleTime > 30000) {
        needsRefresh = true;
      } else if (this.video) {
        const seekable = this.video.seekable;
        if (seekable && seekable.length > 0) {
          const end = seekable.end(seekable.length - 1);
          if (time > end + 10) {
            needsRefresh = true;
          }
        } else {
          needsRefresh = true;
        }
      }

      if (needsRefresh) {
        this.cache.clear();
        this.pendingRequests.clear();
        this.destroyStreamingInstances();
        this.currentSrc = '';
      }
    }

    if (this.currentSrc !== this.pendingSrc) {
      this.loadPendingSource();
    }

    if (!this.video) {
      return null;
    }

    const bucket = Math.round(time * 10) / 10;

    const existingPromise = this.pendingRequests.get(bucket);
    if (existingPromise) {
      return existingPromise;
    }

    if (this.config?.cache !== false) {
      const cached = this.cache.get(bucket);
      if (cached) {
        return cached;
      }
    }

    const nearest = this.getNearestCachedThumbnail(time);
    if (nearest && nearest.time !== undefined) {
      const distance = Math.abs(nearest.time - time);
      if (distance <= 0.2) {
        return nearest;
      }
    }

    if (priority === 'high') {
      this.lastHighPriorityTime = Date.now();
    }

    const promise = new Promise<ThumbnailInfo | null>((resolve, reject) => {
      if (priority === 'high') {
        const samePriorityIndex = this.seekQueue.findIndex((t) => t.priority === 'high');
        if (samePriorityIndex !== -1) {
          const removed = this.seekQueue.splice(samePriorityIndex, 1)[0];
          removed.resolve(null);
          const removedBucket = Math.round(removed.time * 10) / 10;
          this.pendingRequests.delete(removedBucket);
        }
      }

      this.seekQueue.push({
        time,
        priority,
        resolve: (val) => {
          this.pendingRequests.delete(bucket);
          resolve(val);
        },
        reject: (err) => {
          this.pendingRequests.delete(bucket);
          reject(err);
        },
      });

      if (priority === 'low') {
        const lowPriorityIndices: number[] = [];
        this.seekQueue.forEach((t, idx) => {
          if (t.priority === 'low') {
            lowPriorityIndices.push(idx);
          }
        });

        if (lowPriorityIndices.length > 9) {
          const toRemoveCount = lowPriorityIndices.length - 9;
          const indicesToRemove = new Set(lowPriorityIndices.slice(0, toRemoveCount));

          const newQueue: typeof this.seekQueue = [];
          this.seekQueue.forEach((t, idx) => {
            if (indicesToRemove.has(idx)) {
              t.resolve(null);
              const removedBucket = Math.round(t.time * 10) / 10;
              this.pendingRequests.delete(removedBucket);
            } else {
              newQueue.push(t);
            }
          });
          this.seekQueue = newQueue;
        }
      }

      this.processQueue();
    });

    this.pendingRequests.set(bucket, promise);
    return promise;
  }

  private async processQueue() {
    if (this.isSeeking || this.seekQueue.length === 0 || !this.video) {
      return;
    }

    const now = Date.now();
    const timeSinceLastSeek = now - this.lastSeekTime;
    if (timeSinceLastSeek < this.throttleMs) {
      if (this.seekTimeoutId !== null) {
        clearTimeout(this.seekTimeoutId);
      }
      this.seekTimeoutId = setTimeout(() => {
        this.seekTimeoutId = null;
        this.processQueue();
      }, this.throttleMs - timeSinceLastSeek);
      return;
    }

    if (this.seekTimeoutId !== null) {
      clearTimeout(this.seekTimeoutId);
      this.seekTimeoutId = null;
    }

    const isUserActive = now - this.lastHighPriorityTime < 2000;
    const hasHighPriorityTask = this.seekQueue.some((t) => t.priority === 'high');

    if (isUserActive && !hasHighPriorityTask && !this.isPreciseSeeking) {
      const delay = 2000 - (now - this.lastHighPriorityTime);
      if (this.seekTimeoutId !== null) {
        clearTimeout(this.seekTimeoutId);
      }
      this.seekTimeoutId = setTimeout(() => {
        this.seekTimeoutId = null;
        this.processQueue();
      }, delay);
      return;
    }

    let taskIndex = this.seekQueue.findIndex((t) => t.priority === 'high');
    if (taskIndex === -1) {
      taskIndex = 0;
    }

    this.lastSeekTime = now;
    this.isSeeking = true;
    const task = this.seekQueue.splice(taskIndex, 1)[0];
    let seekTarget = task.time;
    if (this.video && this.video.seekable && this.video.seekable.length > 0) {
      const start = this.video.seekable.start(0);
      const end = this.video.seekable.end(this.video.seekable.length - 1);
      seekTarget = Math.max(start, Math.min(seekTarget, end));
    }
    const bucket = Math.round(seekTarget * 10) / 10;

    const cached = this.config?.cache !== false ? this.cache.get(bucket) : null;
    if (cached) {
      this.isSeeking = false;
      task.resolve(cached);
      this.processQueue();
      return;
    }

    if (!this.isMetadataLoaded && !this.hasError) {
      if (this.metadataPromise) {
        await this.metadataPromise;
      }
    }

    if (this.hasError) {
      task.resolve(null);
      this.isSeeking = false;
      this.processQueue();
      return;
    }

    const isAlreadyAtTime = Math.abs(this.video.currentTime - seekTarget) < 0.01;
    if (isAlreadyAtTime && this.video.readyState >= 2) {
      try {
        let thumb = null;
        let retries = 0;
        const maxRetries = 3;
        while (retries <= maxRetries) {
          thumb = this.captureFrame(bucket);
          if (thumb && !this.isCanvasBlank()) {
            break;
          }
          if (retries < maxRetries) {
            retries++;
            await new Promise((resolve) => setTimeout(resolve, 40));
          } else {
            break;
          }
        }

        if (thumb) {
          if (this.config?.cache !== false) {
            if (this.cache.size >= this.MAX_CACHE_SIZE) {
              const firstKey = this.cache.keys().next().value;
              if (firstKey !== undefined) this.cache.delete(firstKey);
            }
            this.cache.set(bucket, thumb);
          }
          this.consecutiveFailures = 0;
          task.resolve(thumb);
        } else {
          this.handleFailure(task);
        }
      } catch (err) {
        if (isSecurityError(err)) {
          console.debug(
            '[VideoFrameThumbnailProvider] CORS security error. Disabling seeks for this source immediately.'
          );
          this.hasError = true;
          task.resolve(null);
        } else {
          this.handleFailure(task);
        }
      }
      this.isSeeking = false;
      this.processQueue();
      return;
    }

    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const onSeeked = async () => {
      if (this.video && this.video.readyState < 2) {
        return;
      }
      cleanup();
      try {
        if (this.video && this.video.readyState >= 2) {
          let thumb = null;
          let retries = 0;
          const maxRetries = 3;

          while (retries <= maxRetries) {
            thumb = this.captureFrame(bucket);
            if (thumb && !this.isCanvasBlank()) {
              break;
            }
            if (retries < maxRetries) {
              retries++;
              await new Promise((resolve) => setTimeout(resolve, 40));
            } else {
              break;
            }
          }

          if (thumb) {
            if (this.config?.cache !== false) {
              if (this.cache.size >= this.MAX_CACHE_SIZE) {
                const firstKey = this.cache.keys().next().value;
                if (firstKey !== undefined) this.cache.delete(firstKey);
              }
              this.cache.set(bucket, thumb);
            }
            this.consecutiveFailures = 0;
            task.resolve(thumb);
          } else {
            this.handleFailure(task);
          }
        } else {
          console.warn('[VideoFrameThumbnailProvider] seeked fired but video readyState < 2.');
          this.handleFailure(task);
        }
      } catch (err) {
        console.debug(
          '[VideoFrameThumbnailProvider] Canvas snapshot capture failed (CORS/tainted canvas or exception):',
          err
        );
        if (isSecurityError(err)) {
          console.debug(
            '[VideoFrameThumbnailProvider] CORS security error. Disabling seeks for this source immediately.'
          );
          this.hasError = true;
          task.resolve(null);
        } else {
          this.handleFailure(task);
        }
      }
      this.isSeeking = false;
      this.processQueue();
    };

    const onError = (e: Event) => {
      cleanup();
      console.debug('[VideoFrameThumbnailProvider] Error event fired during video seek:', e);
      this.handleFailure(task);
      this.isSeeking = false;
      this.processQueue();
    };

    const cleanup = () => {
      if (this.video) {
        this.video.removeEventListener('seeked', onSeeked);
        this.video.removeEventListener('loadeddata', onSeeked);
        this.video.removeEventListener('canplay', onSeeked);
        this.video.removeEventListener('error', onError);
      }
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      this.activeSeekCleanup = null;
    };

    this.activeSeekCleanup = cleanup;

    this.video.addEventListener('seeked', onSeeked);
    this.video.addEventListener('loadeddata', onSeeked);
    this.video.addEventListener('canplay', onSeeked);
    this.video.addEventListener('error', onError);

    timeoutId = setTimeout(async () => {
      console.warn(
        `[VideoFrameThumbnailProvider] Seek timeout reached for time ${seekTarget}s. Recovering...`
      );
      cleanup();
      try {
        if (this.video && this.video.readyState >= 2) {
          let thumb = null;
          let retries = 0;
          const maxRetries = 3;

          while (retries <= maxRetries) {
            thumb = this.captureFrame(bucket);
            if (thumb && !this.isCanvasBlank()) {
              break;
            }
            if (retries < maxRetries) {
              retries++;
              await new Promise((resolve) => setTimeout(resolve, 40));
            } else {
              break;
            }
          }

          if (thumb) {
            if (this.cache.size >= this.MAX_CACHE_SIZE) {
              const firstKey = this.cache.keys().next().value;
              if (firstKey !== undefined) this.cache.delete(firstKey);
            }
            this.cache.set(bucket, thumb);
            this.consecutiveFailures = 0;
            task.resolve(thumb);
          } else {
            this.handleFailure(task);
          }
        } else {
          this.handleFailure(task);
        }
      } catch (e) {
        if (isSecurityError(e)) {
          console.debug(
            '[VideoFrameThumbnailProvider] CORS security error on seek timeout. Disabling seeks for this source immediately.'
          );
          this.hasError = true;
          task.resolve(null);
        } else {
          this.handleFailure(task);
        }
      }
      this.isSeeking = false;
      this.processQueue();
    }, 2000);

    if (this.hlsInstance) {
      this.hlsInstance.startLoad();
    }
    this.video.currentTime = seekTarget;
  }

  private handleFailure(task: { resolve: (val: ThumbnailInfo | null) => void }) {
    this.consecutiveFailures++;
    console.debug(
      `[VideoFrameThumbnailProvider] Seek failed. Consecutive failures: ${this.consecutiveFailures}`
    );
    task.resolve(null);
  }

  private captureFrame(time?: number): ThumbnailInfo | null {
    if (!this.video || !this.canvas || !this.ctx) return null;

    const videoWidth = this.video.videoWidth || 160;
    const videoHeight = this.video.videoHeight || 90;
    const aspectRatio = videoWidth / videoHeight;

    const maxW = 320;
    const maxH = 320;
    let targetWidth = maxW;
    let targetHeight = Math.round(targetWidth / aspectRatio);

    if (targetHeight > maxH) {
      targetHeight = maxH;
      targetWidth = Math.round(targetHeight * aspectRatio);
    }

    if (this.canvas.width !== targetWidth || this.canvas.height !== targetHeight) {
      this.canvas.width = targetWidth;
      this.canvas.height = targetHeight;
    }

    this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
    const dataUrl = this.canvas.toDataURL('image/jpeg', 0.8);
    return { url: dataUrl, width: this.canvas.width, height: this.canvas.height, time };
  }

  private isCanvasBlank(): boolean {
    if (!this.canvas || !this.ctx) return true;
    const w = this.canvas.width;
    const h = this.canvas.height;
    try {
      const imgData = this.ctx.getImageData(0, 0, w, h);
      const data = imgData.data;

      let nonBlackCount = 0;
      for (let i = 0; i < data.length; i += 16) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const a = data[i + 3];
        if (a > 10 && (r > 8 || g > 8 || b > 8)) {
          nonBlackCount++;
        }
      }

      const totalSamples = data.length / 16;
      return nonBlackCount / totalSamples < 0.01;
    } catch (e) {
      return false;
    }
  }

  public destroy() {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    this.cache.clear();
    this.pendingRequests.clear();
    for (const task of this.seekQueue) {
      task.resolve(null);
    }
    this.seekQueue = [];
    this.isSeeking = false;
    if (this.activeSeekCleanup) {
      this.activeSeekCleanup();
    }
    this.destroyStreamingInstances();
    if (this.video) {
      this.video.removeEventListener('loadedmetadata', this.handleLoadedMetadata);
      this.video.removeEventListener('error', this.handleVideoError);
      try {
        this.video.pause();
      } catch (err) {}
      this.video.removeAttribute('src');
      try {
        this.video.load();
      } catch (err) {}
      if (this.video.parentNode) {
        this.video.parentNode.removeChild(this.video);
      }
      this.video = null;
    }
    this.canvas = null;
    this.ctx = null;
  }
}

export class VTTThumbnailProvider implements ThumbnailProvider {
  readonly type = 'vtt';
  private vttUrl: string;
  private cues: Array<{
    start: number;
    end: number;
    url: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  }> = [];
  private isLoaded = false;
  private loadPromise: Promise<void> | null = null;
  private cache = new Map<string, HTMLImageElement>();

  private config?: SmartSeekConfig;

  constructor(vttUrl: string, config?: SmartSeekConfig) {
    this.vttUrl = vttUrl;
    this.config = config;
    this.loadPromise = this.loadVTT();
  }

  public updateConfig(config?: SmartSeekConfig) {
    this.config = config;
  }

  private async loadVTT(): Promise<void> {
    try {
      const response = await fetch(this.vttUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch VTT: ${response.status} ${response.statusText}`);
      }
      const text = await response.text();
      this.parseVTT(text);
      this.isLoaded = true;
    } catch (e) {
      console.debug('[VTTThumbnailProvider] Error loading VTT:', e);
    }
  }

  private parseVTT(text: string) {
    const lines = text.split(/\r?\n/);
    let currentCue: Partial<VTTThumbnailProvider['cues'][number]> | null = null;
    const baseUrl = new URL(this.vttUrl, window.location.href);

    const timestampRegex = /([\d:.]+)\s*-->\s*([\d:.]+)/;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const match = line.match(timestampRegex);
      if (match) {
        const start = this.parseTimestamp(match[1]);
        const end = this.parseTimestamp(match[2]);
        currentCue = { start, end };
      } else if (currentCue && line.indexOf('-->') === -1 && line !== 'WEBVTT') {
        const rawUrl = line;
        const hashIdx = rawUrl.indexOf('#');
        let imgUrl = rawUrl;
        let x: number | undefined;
        let y: number | undefined;
        let w: number | undefined;
        let h: number | undefined;

        if (hashIdx !== -1) {
          imgUrl = rawUrl.substring(0, hashIdx);
          const fragment = rawUrl.substring(hashIdx + 1);
          if (fragment.startsWith('xywh=')) {
            const parts = fragment.substring(5).split(',').map(Number);
            if (parts.length === 4) {
              x = parts[0];
              y = parts[1];
              w = parts[2];
              h = parts[3];
            }
          }
        }

        currentCue.url = new URL(imgUrl, baseUrl).href;
        if (x !== undefined) currentCue.x = x;
        if (y !== undefined) currentCue.y = y;
        if (w !== undefined) currentCue.width = w;
        if (h !== undefined) currentCue.height = h;

        this.cues.push(currentCue as VTTThumbnailProvider['cues'][number]);
        currentCue = null;
      }
    }
  }

  private parseTimestamp(timestamp: string): number {
    const parts = timestamp.trim().replace(',', '.').split(':');
    let seconds = 0;
    if (parts.length === 3) {
      seconds += parseFloat(parts[0]) * 3600;
      seconds += parseFloat(parts[1]) * 60;
      seconds += parseFloat(parts[2]);
    } else if (parts.length === 2) {
      seconds += parseFloat(parts[0]) * 60;
      seconds += parseFloat(parts[1]);
    }
    return seconds;
  }

  public getNearestCachedThumbnail(time: number): ThumbnailInfo | null {
    if (this.config?.cache === false) return null;
    let cue = this.cues.find((c) => time >= c.start && time <= c.end);
    if (!cue && this.cues.length > 0) {
      let minDiff = Infinity;
      for (const c of this.cues) {
        const mid = (c.start + c.end) / 2;
        const diff = Math.abs(mid - time);
        if (diff < minDiff) {
          minDiff = diff;
          cue = c;
        }
      }
    }
    if (!cue) return null;

    const cachedImg = this.cache.get(cue.url);
    if (cachedImg && cachedImg.complete) {
      return {
        url: cue.url,
        x: cue.x,
        y: cue.y,
        width: cue.width,
        height: cue.height,
        time: time,
      };
    }
    return null;
  }

  public async getThumbnail(
    time: number,
    priority: 'high' | 'low' = 'high'
  ): Promise<ThumbnailInfo | null> {
    if (this.loadPromise) {
      await this.loadPromise;
    }

    let cue = this.cues.find((c) => time >= c.start && time <= c.end);
    if (!cue && this.cues.length > 0) {
      let minDiff = Infinity;
      for (const c of this.cues) {
        const mid = (c.start + c.end) / 2;
        const diff = Math.abs(mid - time);
        if (diff < minDiff) {
          minDiff = diff;
          cue = c;
        }
      }
    }
    if (!cue) return null;

    const cacheEnabled = this.config?.cache !== false;
    if (!cacheEnabled) {
      const img = new Image();
      img.src = cue.url;
      if (!img.complete) {
        await new Promise((resolve) => {
          img.onload = resolve;
          img.onerror = resolve;
        });
      }
    } else {
      if (!this.cache.has(cue.url)) {
        const img = new Image();
        img.src = cue.url;
        this.cache.set(cue.url, img);
        if (!img.complete) {
          await new Promise((resolve) => {
            img.onload = resolve;
            img.onerror = resolve;
          });
        }
      } else {
        const img = this.cache.get(cue.url)!;
        if (!img.complete) {
          await new Promise((resolve) => {
            img.onload = resolve;
            img.onerror = resolve;
          });
        }
      }
    }

    return {
      url: cue.url,
      x: cue.x,
      y: cue.y,
      width: cue.width,
      height: cue.height,
      time: time,
    };
  }

  public destroy() {
    this.cache.clear();
    this.cues = [];
  }

  public isUnavailable(): boolean {
    return !this.vttUrl;
  }
}

export class SpriteThumbnailProvider implements ThumbnailProvider {
  readonly type = 'sprite';
  private spriteUrl: string;
  private spriteInfo: SpriteInfo;
  private cache: HTMLImageElement | null = null;
  private loadPromise: Promise<void> | null = null;

  private config?: SmartSeekConfig;

  constructor(spriteUrl: string, spriteInfo: SpriteInfo, config?: SmartSeekConfig) {
    this.spriteUrl = spriteUrl;
    this.spriteInfo = spriteInfo;
    this.config = config;
  }

  public updateConfig(config?: SmartSeekConfig) {
    this.config = config;
  }

  private preloadImage(): Promise<void> {
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        this.cache = img;
        resolve();
      };
      img.onerror = () => {
        resolve();
      };
      img.src = this.spriteUrl;
    });

    return this.loadPromise;
  }

  public getNearestCachedThumbnail(time: number): ThumbnailInfo | null {
    if (this.config?.cache === false) return null;
    if (this.cache && this.cache.complete) {
      const thumb = this.calculateThumbnail(time);
      return { ...thumb, time };
    }
    return null;
  }

  public async getThumbnail(
    time: number,
    priority: 'high' | 'low' = 'high'
  ): Promise<ThumbnailInfo | null> {
    await this.preloadImage();
    const thumb = this.calculateThumbnail(time);
    return { ...thumb, time };
  }

  private calculateThumbnail(time: number): ThumbnailInfo {
    const { tileWidth, tileHeight, totalColumns, interval } = this.spriteInfo;
    const index = Math.floor((Math.max(0, time) + 0.0001) / interval);
    const col = index % totalColumns;
    const row = Math.floor(index / totalColumns);

    return {
      url: this.spriteUrl,
      x: col * tileWidth,
      y: row * tileHeight,
      width: tileWidth,
      height: tileHeight,
      time: index * interval + interval / 2,
    };
  }

  public destroy() {
    this.cache = null;
    this.loadPromise = null;
  }

  public isUnavailable(): boolean {
    return !this.spriteUrl || !this.spriteInfo;
  }
}

/**
 * Structural extension `AutoThumbnailProvider` uses to reconfigure whatever
 * concrete `ThumbnailProvider` it's currently wrapping in place - mirrors
 * `ConfigurableThumbnailProvider` in `PlayerController.ts`, but scoped to
 * `SmartSeekConfig` since that's the shape the concrete providers here take.
 * Not part of the public `ThumbnailProvider` contract.
 */
interface ConfigurableSmartSeekProvider extends ThumbnailProvider {
  updateConfig?(config?: SmartSeekConfig): void;
  config?: SmartSeekConfig;
}

export class AutoThumbnailProvider implements ThumbnailProvider {
  readonly type = 'auto';
  private currentProvider: ThumbnailProvider | null = null;
  private currentSrc = '';
  private config?: PlayerConfiguration;

  constructor(config?: PlayerConfiguration) {
    this.config = config;
  }

  /**
   * `config?.smartSeek` may itself be a boolean flag rather than a config
   * object (`PlayerConfiguration.smartSeek: SmartSeekConfig | boolean`) -
   * when it isn't a usable object, this falls back to treating `config`
   * itself as the `SmartSeekConfig` (matches the pre-existing
   * `config?.smartSeek || config` fallback behavior).
   */
  private static resolveSmartSeek(config?: PlayerConfiguration): SmartSeekConfig | undefined {
    if (!config) return undefined;
    if (config.smartSeek && typeof config.smartSeek === 'object') {
      return config.smartSeek;
    }
    return config as unknown as SmartSeekConfig;
  }

  public updateConfig(config?: PlayerConfiguration) {
    this.config = config;
    const smartSeek = AutoThumbnailProvider.resolveSmartSeek(config);
    if (this.currentProvider) {
      const provider = this.currentProvider as ConfigurableSmartSeekProvider;
      if (typeof provider.updateConfig === 'function') {
        provider.updateConfig(smartSeek);
      } else {
        provider.config = smartSeek;
      }
    }
  }

  public setSource(src: string, sourceOptions?: PlayerSource) {
    if (this.currentSrc === src) return;
    this.currentSrc = src;

    if (this.currentProvider && typeof this.currentProvider.destroy === 'function') {
      try {
        this.currentProvider.destroy();
      } catch (e) {
        console.debug('[AutoThumbnailProvider] Error destroying provider:', e);
      }
    }
    this.currentProvider = null;

    const smartSeek: SmartSeekConfig | undefined =
      sourceOptions?.smartSeek || AutoThumbnailProvider.resolveSmartSeek(this.config);
    const type = smartSeek?.type || 'auto';

    if (smartSeek?.enabled === false || type === 'none') {
      return;
    }

    if (type === 'vtt' || (type === 'auto' && smartSeek?.vttUrl)) {
      const vttUrl =
        smartSeek?.vttUrl || (sourceOptions as unknown as { vttUrl?: string } | undefined)?.vttUrl;
      if (vttUrl) {
        this.currentProvider = new VTTThumbnailProvider(vttUrl, smartSeek);
      }
    } else if (
      type === 'sprite' ||
      (type === 'auto' && smartSeek?.spriteUrl && smartSeek.spriteInfo)
    ) {
      const spriteUrl = smartSeek?.spriteUrl;
      const spriteInfo = smartSeek?.spriteInfo;
      if (spriteUrl && spriteInfo) {
        this.currentProvider = new SpriteThumbnailProvider(spriteUrl, spriteInfo, smartSeek);
      }
    }

    const preciseSeekRaw = sourceOptions?.preciseSeek || this.config?.preciseSeek;
    const preciseSeekObj =
      typeof preciseSeekRaw === 'object' && preciseSeekRaw
        ? (preciseSeekRaw as { enabled?: boolean; frameAccurate?: boolean })
        : undefined;
    const isFrameAccurateEnabled =
      preciseSeekRaw !== false &&
      preciseSeekObj?.enabled !== false &&
      preciseSeekObj?.frameAccurate !== false;

    if (!this.currentProvider && isFrameAccurateEnabled) {
      this.currentProvider = new VideoFrameThumbnailProvider(smartSeek);
    }

    if (this.currentProvider && typeof this.currentProvider.setSource === 'function') {
      this.currentProvider.setSource(src, sourceOptions);
    }
  }

  public getNearestCachedThumbnail(time: number): ThumbnailInfo | null {
    if (
      this.currentProvider &&
      typeof this.currentProvider.getNearestCachedThumbnail === 'function'
    ) {
      return this.currentProvider.getNearestCachedThumbnail(time);
    }
    return null;
  }

  public getThumbnail(
    time: number,
    priority: 'high' | 'low' = 'high'
  ): Promise<ThumbnailInfo | null> | ThumbnailInfo | null {
    if (this.currentProvider) {
      return this.currentProvider.getThumbnail(time, priority);
    }
    return null;
  }

  public isUnavailable(): boolean {
    if (this.currentProvider && typeof this.currentProvider.isUnavailable === 'function') {
      return this.currentProvider.isUnavailable();
    }
    return !this.currentProvider;
  }

  public destroy() {
    if (this.currentProvider && typeof this.currentProvider.destroy === 'function') {
      this.currentProvider.destroy();
    }
    this.currentProvider = null;
  }
}
