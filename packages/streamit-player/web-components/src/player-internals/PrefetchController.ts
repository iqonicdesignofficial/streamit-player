import type { PlayerState, SourceType } from '../../../core/src/index';

/**
 * The narrow slice of the `<player-player>` element the prefetcher reads: the
 * current player state (playlist, active index, status, current source) and
 * whether a vertical-feed transition is animating.
 */
export interface PrefetchHost {
  readonly playerState: PlayerState;
  readonly isVisualTransitioning: boolean;
}

/**
 * Idle-callback-scheduled prefetching of the next (or previous) playlist
 * source, so switching items in a vertical feed starts from a warm cache.
 *
 * Only one prefetch is in flight at a time; it is aborted whenever the target
 * changes, and deliberately *not* aborted when the target is the source that
 * just became active (aborting then would cancel a request the media element
 * is about to reuse).
 */
export class PrefetchController {
  private readonly host: PrefetchHost;
  private direction: 'next' | 'prev' = 'next';
  private abortController: AbortController | null = null;
  private activeUrl = '';

  constructor(host: PrefetchHost) {
    this.host = host;
  }

  /** Which neighbour to warm next; set by navigation and drag commits. */
  setDirection(direction: 'next' | 'prev'): void {
    this.direction = direction;
  }

  getDirection(): 'next' | 'prev' {
    return this.direction;
  }

  cancel(keepUrl?: string): void {
    if (this.abortController) {
      if (keepUrl && this.activeUrl === keepUrl) {
        return;
      }
      const currentSrc = this.host.playerState?.currentSource;
      if (currentSrc && this.activeUrl === currentSrc) {
        this.abortController = null;
        this.activeUrl = '';
        return;
      }
      try {
        this.abortController.abort();
      } catch (err) {
        // Silence
      }
      this.abortController = null;
    }
    this.activeUrl = '';
  }

  trigger(): void {
    const playerState = this.host.playerState;

    if (!playerState.playlist || playerState.playlist.length <= 1) {
      this.cancel();
      return;
    }

    // Suspend source prefetching during visual transition animation
    if (this.host.isVisualTransitioning) {
      const targetIndex =
        this.direction === 'next'
          ? (playerState.activePlaylistIndex + 1) % playerState.playlist.length
          : (playerState.activePlaylistIndex - 1 + playerState.playlist.length) %
            playerState.playlist.length;
      const targetSource = playerState.playlist[targetIndex];
      const targetUrl = targetSource?.src || '';
      this.cancel(targetUrl);
      return;
    }

    // Do not run prefetch during active loading/playback startup
    if (!playerState || playerState.status === 'idle' || playerState.status === 'loading') {
      this.cancel(playerState?.currentSource || undefined);
      return;
    }

    const targetIndex =
      this.direction === 'next'
        ? (playerState.activePlaylistIndex + 1) % playerState.playlist.length
        : (playerState.activePlaylistIndex - 1 + playerState.playlist.length) %
          playerState.playlist.length;

    if (targetIndex === playerState.activePlaylistIndex) {
      this.cancel();
      return;
    }

    const targetSource = playerState.playlist[targetIndex];
    const targetUrl = targetSource?.src || '';
    if (!targetUrl) {
      this.cancel();
      return;
    }

    if (this.activeUrl === targetUrl) {
      return;
    }

    this.cancel();

    this.activeUrl = targetUrl;
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    // Detect type
    let detectedType: SourceType = targetSource.type || 'unknown';
    if (detectedType === 'unknown') {
      const url = targetUrl.split('?')[0].toLowerCase();
      if (url.endsWith('.m3u8')) detectedType = 'hls';
      else if (url.endsWith('.mpd')) detectedType = 'dash';
      else if (url.endsWith('.webm')) detectedType = 'webm';
      else if (url.endsWith('.mov')) detectedType = 'mov';
      else detectedType = 'mp4';
    }

    const scheduleCallback: (cb: () => void) => number =
      typeof window.requestIdleCallback === 'function'
        ? (cb) => window.requestIdleCallback(cb)
        : (cb) => window.setTimeout(cb, 50);

    scheduleCallback(() => {
      if (signal.aborted) return;
      this.execute(targetUrl, detectedType, signal).catch((err) => {
        if (err && err.name === 'AbortError') {
          // Silence AbortError warnings
        } else {
          console.warn(`[Player] Prefetch uncaught rejection for ${targetUrl}:`, err);
        }
      });
    });
  }

  private async execute(url: string, type: SourceType, signal: AbortSignal): Promise<void> {
    try {
      if (type === 'hls' || type === 'dash') {
        const response = await fetch(url, { signal, headers: { Accept: '*/*' } }).catch((err) => {
          if (err && err.name === 'AbortError') {
            return null;
          }
          throw err;
        });
        if (!response) return; // Aborted gracefully

        if (!response.ok) {
          console.warn(
            `[Player] Manifest prefetch failed for ${type}: "${url}" (status ${response.status})`
          );
        }
      } else if (type === 'mp4' || type === 'webm' || type === 'mov' || type === 'file') {
        try {
          const response = await fetch(url, { signal }).catch((err) => {
            if (err && err.name === 'AbortError') {
              return null;
            }
            throw err;
          });
          if (!response) return; // Aborted gracefully

          if (response.ok && response.body) {
            const reader = response.body.getReader();
            await reader.read().catch((err) => {
              if (err && err.name === 'AbortError') {
                return { done: true, value: undefined };
              }
              throw err;
            });
            // Value read successfully, continue
            await reader.cancel().catch(() => {});
          } else if (!response.body) {
            console.warn(
              `[Player] Cache warming skipped for media: "${url}" (readable body not supported)`
            );
          } else {
            console.warn(
              `[Player] Cache warming failed for media: "${url}" (status ${response.status})`
            );
          }
        } catch (corsErr: unknown) {
          if (corsErr instanceof Error && corsErr.name === 'AbortError') {
            return; // Already handled, return gracefully
          }
          const noCorsResponse = await fetch(url, { signal, mode: 'no-cors' }).catch((err) => {
            if (err && err.name === 'AbortError') {
              return null;
            }
            throw err;
          });
          if (!noCorsResponse) return; // Aborted gracefully
        }
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') {
        // Silence AbortError warnings
      } else {
        console.warn(`[Player] Error during source prefetch for "${url}":`, e);
      }
    } finally {
      if (this.activeUrl === url) {
        this.activeUrl = '';
        this.abortController = null;
      }
    }
  }
}
