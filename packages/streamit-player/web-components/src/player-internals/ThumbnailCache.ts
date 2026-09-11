import type { PlayerController, PlayerSource, PlayerState, ThumbnailProvider } from '../../../core/src/index';

/**
 * The narrow slice of the `<player-player>` element that the thumbnail cache
 * reads. Deliberately not the whole element: the cache only needs the current
 * player state, the headless controller (to reach the active thumbnail
 * provider), and whether a vertical-feed transition is currently animating.
 */
export interface ThumbnailCacheHost {
  readonly playerState: PlayerState;
  readonly controller: PlayerController | undefined;
  readonly isVisualTransitioning: boolean;
}

/**
 * The public `ThumbnailProvider` contract from `@player/core`, plus the
 * implementation-detail members every concrete provider happens to expose
 * (the hidden `<video>` element used for frame capture, and a one-time flag
 * marking that this cache has already expanded its preload schedule) but
 * which aren't part of the public interface.
 */
interface CachedThumbnailProvider extends ThumbnailProvider {
  video?: HTMLVideoElement | null;
  _preloadedIntervalsAdded?: boolean;
}

interface PreloadTask {
  provider: CachedThumbnailProvider;
  time: number;
  source: PlayerSource;
  isInitial: boolean;
}

/**
 * Thumbnail provider cache + idle-callback-scheduled preloading for the
 * playlist neighbours of the active item.
 *
 * Eviction policy (unchanged from the original inline implementation):
 *  - With no playlist (or a single item), every cached provider except the one
 *    for the active source is destroyed and dropped.
 *  - With a playlist, only the active / next / previous sources are kept; every
 *    other provider is destroyed and dropped.
 *  - The controller's own "main" provider is never destroyed by an eviction,
 *    only removed from the map.
 */
export class ThumbnailCache {
  private readonly host: ThumbnailCacheHost;
  private providers = new Map<string, CachedThumbnailProvider>();
  private mainProvider: CachedThumbnailProvider | null = null;
  private pendingTasks: PreloadTask[] = [];
  private activeIdleCallbackId: number | null = null;

  constructor(host: ThumbnailCacheHost) {
    this.host = host;
  }

  getProvider(url: string): CachedThumbnailProvider | undefined {
    return this.providers.get(url);
  }

  setProviderForSource(url: string, provider: CachedThumbnailProvider): void {
    this.providers.set(url, provider);
  }

  getMainProvider(): CachedThumbnailProvider | null {
    return this.mainProvider;
  }

  setMainProvider(provider: CachedThumbnailProvider): void {
    this.mainProvider = provider;
  }

  /**
   * Best-effort poster frame for a playlist source that has already been
   * preloaded, used to paint the incoming half of the transition canvas.
   */
  getCachedPosterForSource(url: string): string | null {
    if (!url) return null;
    const provider = this.providers.get(url);
    if (!provider) return null;

    // 1. Try to get cached thumbnail from nearest time (0)
    if (typeof provider.getNearestCachedThumbnail === 'function') {
      const cached = provider.getNearestCachedThumbnail(0);
      if (cached && cached.url && Math.abs((cached.time || 0) - 0) < 1.0) {
        return cached.url;
      }
    }

    // 2. Try calling getThumbnail synchronously (it should return synchronously if cached)
    if (typeof provider.getThumbnail === 'function') {
      const syncResult = provider.getThumbnail(0, 'low');
      if (syncResult && !(syncResult instanceof Promise) && syncResult.url) {
        return syncResult.url;
      }
    }

    // 3. Fallback: check if the provider's hidden video has readyState >= 2 and draw its frame
    if (provider.video instanceof HTMLVideoElement && provider.video.readyState >= 2) {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = provider.video.videoWidth || 320;
        canvas.height = provider.video.videoHeight || 180;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(provider.video, 0, 0, canvas.width, canvas.height);
          return canvas.toDataURL('image/jpeg', 0.8);
        }
      } catch (e) {
        console.warn('Failed to draw hidden video frame for fallback poster:', e);
      }
    }

    return null;
  }

  cancelPendingPreloads(): void {
    if (this.activeIdleCallbackId !== null) {
      if (typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(this.activeIdleCallbackId);
      } else {
        window.clearTimeout(this.activeIdleCallbackId);
      }
      this.activeIdleCallbackId = null;
    }
    this.pendingTasks = [];
  }

  /** Re-evaluates the cache against the current playlist and queues preloads. */
  trigger(): void {
    this.cancelPendingPreloads();

    const playerState = this.host.playerState;

    // Suspend preloads during visual transition animation
    if (this.host.isVisualTransitioning) {
      return;
    }

    // Do not run preloading during playback startup (loading status)
    if (!playerState || playerState.status === 'idle' || playerState.status === 'loading') {
      return;
    }

    const controller = this.host.controller;
    if (!controller) {
      return;
    }

    const mainProvider = controller.getThumbnailProvider();
    if (!mainProvider) {
      return;
    }
    this.mainProvider = mainProvider;

    if (!playerState.playlist || playerState.playlist.length <= 1) {
      // Clean up all cached providers since we only need the active one
      const currentSource = playerState.currentSource;
      for (const [url, provider] of this.providers.entries()) {
        if (url !== currentSource) {
          this.destroyProvider(provider, mainProvider, 'unused provider');
          this.providers.delete(url);
        }
      }
      return;
    }

    const nextIndex = (playerState.activePlaylistIndex + 1) % playerState.playlist.length;
    const prevIndex =
      (playerState.activePlaylistIndex - 1 + playerState.playlist.length) %
      playerState.playlist.length;

    const nextSource = playerState.playlist[nextIndex];
    const prevSource = playerState.playlist[prevIndex];

    const currentSource = playerState.currentSource;
    const nextUrl = nextSource?.src || '';
    const prevUrl = prevSource?.src || '';

    // Collect URLs to keep in cache: active, next, and previous
    const keepUrls = new Set<string>();
    if (currentSource) keepUrls.add(currentSource);
    if (nextUrl) keepUrls.add(nextUrl);
    if (prevUrl) keepUrls.add(prevUrl);

    // Evict unused providers to satisfy memory safety
    for (const [url, provider] of this.providers.entries()) {
      if (!keepUrls.has(url)) {
        this.destroyProvider(provider, mainProvider, 'evicted provider');
        this.providers.delete(url);
      }
    }

    // Ensure main provider for currentSource is stored in cache
    if (currentSource && !this.providers.has(currentSource)) {
      this.providers.set(currentSource, mainProvider);
    }

    const sourcesToPreload: Array<{ source: PlayerSource; url: string }> = [];
    if (nextUrl && nextUrl !== currentSource) {
      sourcesToPreload.push({ source: nextSource, url: nextUrl });
    }
    if (prevUrl && prevUrl !== currentSource && prevUrl !== nextUrl) {
      sourcesToPreload.push({ source: prevSource, url: prevUrl });
    }

    for (const item of sourcesToPreload) {
      let provider = this.providers.get(item.url);
      if (!provider) {
        try {
          const PrimaryProviderClass = mainProvider.constructor as new () => CachedThumbnailProvider;
          provider = new PrimaryProviderClass();
          if (typeof provider.setSource === 'function') {
            provider.setSource(item.url);
          }
          this.providers.set(item.url, provider);
        } catch (e) {
          console.debug('[Player] Failed to instantiate thumbnail provider for preload:', e);
          continue;
        }
      }

      // Add initial tasks:
      // 1. Chapters if they exist
      if (item.source.chapters && item.source.chapters.length > 0) {
        for (const ch of item.source.chapters) {
          this.pendingTasks.push({
            provider,
            time: ch.startTime,
            source: item.source,
            isInitial: false,
          });
        }
      }

      // 2. Request initial time (0) to force load the source/metadata in the hidden video
      this.pendingTasks.push({
        provider,
        time: 0,
        source: item.source,
        isInitial: true,
      });
    }

    if (this.pendingTasks.length > 0) {
      this.scheduleNextPreloadTask();
    }
  }

  /** Destroys every cached provider except the controller's own main one. */
  destroy(): void {
    this.cancelPendingPreloads();
    for (const provider of this.providers.values()) {
      this.destroyProvider(provider, this.mainProvider, 'provider on disconnect');
    }
    this.providers.clear();
    this.mainProvider = null;
  }

  private destroyProvider(
    provider: CachedThumbnailProvider,
    keep: CachedThumbnailProvider | null,
    reason: string
  ): void {
    if (provider !== keep && provider && typeof provider.destroy === 'function') {
      try {
        provider.destroy();
      } catch (e) {
        console.debug(`[Player] Error destroying ${reason}:`, e);
      }
    }
  }

  private scheduleNextPreloadTask(): void {
    if (this.activeIdleCallbackId !== null) {
      return;
    }
    if (this.pendingTasks.length === 0) {
      return;
    }

    const scheduleCallback: (cb: (deadline?: IdleDeadline) => void) => number =
      typeof window.requestIdleCallback === 'function'
        ? (cb) => window.requestIdleCallback(cb)
        : (cb) => window.setTimeout(() => cb(undefined), 50);

    this.activeIdleCallbackId = scheduleCallback((deadline) => {
      this.activeIdleCallbackId = null;
      this.runPreloadTask(deadline);
    });
  }

  private async runPreloadTask(deadline?: IdleDeadline): Promise<void> {
    const timeRemaining = () =>
      typeof deadline?.timeRemaining === 'function' ? deadline.timeRemaining() : 10;

    while (this.pendingTasks.length > 0 && (timeRemaining() > 0 || deadline?.didTimeout)) {
      const task = this.pendingTasks.shift();
      if (!task) break;

      const { provider, time, source, isInitial } = task;

      // Check if provider is still in cache (has not been evicted/destroyed)
      const cached = Array.from(this.providers.values()).includes(provider);
      if (!cached) {
        continue;
      }

      try {
        const result = provider.getThumbnail(time, 'low');
        if (result instanceof Promise) {
          await result;
        }

        if (isInitial) {
          this.expandPreloadTasksForProvider(provider, source);
        }
      } catch (err) {
        console.warn('[Player] Error preloading thumbnail:', err);
      }
    }

    if (this.pendingTasks.length > 0) {
      this.scheduleNextPreloadTask();
    }
  }

  private expandPreloadTasksForProvider(provider: CachedThumbnailProvider, source: PlayerSource): void {
    const url = source.src;
    if (!url) return;

    if (provider._preloadedIntervalsAdded) {
      return;
    }
    provider._preloadedIntervalsAdded = true;

    const times = new Set<number>();
    const video = provider.video;

    if (video && video instanceof HTMLVideoElement && !isNaN(video.duration) && video.duration > 0) {
      const duration = video.duration;
      const steps = 10;
      for (let i = 1; i < steps; i++) {
        times.add(Math.round((i / steps) * duration));
      }
    } else {
      const fallbackTimes = [10, 20, 30, 45, 60, 90, 120, 180, 240, 300];
      for (const t of fallbackTimes) {
        times.add(t);
      }
    }

    const currentTasks = this.pendingTasks
      .filter((t) => t.provider === provider)
      .map((t) => t.time);

    for (const t of times) {
      const cachedForTime =
        typeof provider.getNearestCachedThumbnail === 'function'
          ? provider.getNearestCachedThumbnail(t)
          : null;
      const isCached = !!cachedForTime && Math.abs((cachedForTime.time || 0) - t) < 1.0;

      if (!isCached && !currentTasks.includes(t)) {
        this.pendingTasks.push({
          provider,
          time: t,
          source,
          isInitial: false,
        });
      }
    }
  }
}
