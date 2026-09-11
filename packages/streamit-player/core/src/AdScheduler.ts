import { PlayerController } from './PlayerController';
import { AdProvider, AdErrorType, Advertisement, HtmlOverlayConfig } from './types';

export interface ScheduledAdRequest {
  /** Required for provider 'VAST' | 'IMA'. Ignored for 'HTML_OVERLAY'. */
  tagUrl?: string;
  type: 'preroll' | 'midroll' | 'postroll';
  /** Seconds (number), or a percentage of content duration, e.g. '50%'. Only used for 'midroll'. */
  timeOffset?: number | string;
  /** Which registered provider to trigger. Defaults to 'VAST'. */
  provider?: 'VAST' | 'IMA' | 'HTML_OVERLAY';
  /** Required for provider 'HTML_OVERLAY' - the overlay creative to show when this break hits. */
  overlay?: Advertisement | HtmlOverlayConfig;
}

interface ScheduledBreak extends ScheduledAdRequest {
  id: string;
  isPlayed: boolean;
  resolvedTimeOffset?: number;
}

/**
 * Resolves a midroll timeOffset to absolute seconds. Numbers pass through
 * unchanged. Percentage strings (e.g. '50%') resolve against duration once
 * it's known; returns null if not yet resolvable (duration unknown) or the
 * format is invalid - callers should treat null as "try again later".
 */
export function resolveScheduledTimeOffset(
  timeOffset: number | string | undefined,
  duration: number
): number | null {
  if (timeOffset === undefined) return null;
  if (typeof timeOffset === 'number') return timeOffset;
  const trimmed = timeOffset.trim();
  if (!trimmed.endsWith('%')) {
    const seconds = Number(trimmed);
    return isNaN(seconds) ? null : seconds;
  }
  const pct = parseFloat(trimmed);
  if (isNaN(pct)) return null;
  if (!isFinite(duration) || duration <= 0) return null;
  return (pct / 100) * duration;
}

export function evaluateScheduledHits(
  breaks: Array<{ id: string; type: 'preroll' | 'midroll' | 'postroll'; timeOffset?: number; isPlayed: boolean }>,
  currentTime: number,
  duration: number,
  isEnded: boolean
): string[] {
  const hits: string[] = [];
  for (const b of breaks) {
    if (b.isPlayed) continue;
    let isHit = false;
    if (b.type === 'preroll') {
      isHit = currentTime <= 3.0;
    } else if (b.type === 'postroll') {
      isHit = isEnded || (duration > 0 && currentTime >= duration - 0.5);
    } else {
      const offset = b.timeOffset ?? 0;
      isHit = currentTime >= offset && currentTime - offset <= 2.5;
    }
    if (isHit) hits.push(b.id);
  }
  return hits;
}

/**
 * NOTE: AdScheduler and VmapProvider both independently watch the video
 * element's timeupdate/ended events with no shared coordination or
 * frequency-cap state between them. Using player.ads.schedule() alongside
 * a VMAP playlist on the same player instance is unsupported - pick one
 * scheduling mechanism per player instance.
 */
export class AdScheduler {
  private breaks: ScheduledBreak[] = [];
  private timeUpdateListener: (() => void) | null = null;
  private endedListener: (() => void) | null = null;
  private nextId = 0;

  constructor(
    private controller: PlayerController,
    private getProviderByName: (name: 'VAST' | 'IMA') => AdProvider | undefined,
    private showOverlay: (config: Advertisement | HtmlOverlayConfig) => Promise<boolean>
  ) {
    this.attach();
  }

  public schedule(request: ScheduledAdRequest): string {
    const id = `sched-${++this.nextId}`;
    this.breaks.push({ ...request, id, isPlayed: false });
    return id;
  }

  /** True if there are unplayed manually-scheduled breaks - used to detect
   * the unsupported combination with an active VmapProvider playlist (see
   * class-level note above). */
  public hasActiveBreaks(): boolean {
    return this.breaks.some(b => !b.isPlayed);
  }

  public unschedule(id: string): void {
    this.breaks = this.breaks.filter(b => b.id !== id);
  }

  public clear(): void {
    this.breaks = [];
  }

  public destroy(): void {
    const video = this.controller.getVideoElement();
    if (this.timeUpdateListener) video.removeEventListener('timeupdate', this.timeUpdateListener);
    if (this.endedListener) video.removeEventListener('ended', this.endedListener);
    this.breaks = [];
  }

  private attach() {
    const video = this.controller.getVideoElement();
    const onTimeUpdate = () => this.evaluate(video.currentTime, video.duration || 0, false);
    const onEnded = () => this.evaluate(video.duration || 0, video.duration || 0, true);
    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('ended', onEnded);
    this.timeUpdateListener = onTimeUpdate;
    this.endedListener = onEnded;
  }

  private evaluate(currentTime: number, duration: number, isEnded: boolean) {
    if (this.breaks.length === 0) return;

    const candidates: Array<{ id: string; type: 'preroll' | 'midroll' | 'postroll'; timeOffset?: number; isPlayed: boolean }> = [];
    for (const b of this.breaks) {
      if (b.isPlayed) {
        candidates.push({ id: b.id, type: b.type, timeOffset: b.resolvedTimeOffset, isPlayed: true });
        continue;
      }
      if (b.type === 'midroll') {
        if (b.resolvedTimeOffset === undefined) {
          const resolved = resolveScheduledTimeOffset(b.timeOffset, duration);
          if (resolved === null) continue; // not yet resolvable - try again next tick
          b.resolvedTimeOffset = resolved;
        }
        candidates.push({ id: b.id, type: b.type, timeOffset: b.resolvedTimeOffset, isPlayed: false });
      } else {
        candidates.push({ id: b.id, type: b.type, timeOffset: undefined, isPlayed: false });
      }
    }

    const hitIds = evaluateScheduledHits(candidates, currentTime, duration, isEnded);
    if (hitIds.length === 0) return;

    for (const id of hitIds) {
      const b = this.breaks.find(x => x.id === id);
      if (!b) continue;
      b.isPlayed = true;
      this.trigger(b);
    }
  }

  private async trigger(b: ScheduledBreak) {
    if (this.controller.getState().sourceType === 'embed') {
      this.controller.emit('aderror', {
        error: {
          type: AdErrorType.CONFIGURATION,
          code: 900,
          message: 'VAST ads are not supported for embed (YouTube/Vimeo) sources.',
        },
      });
      return;
    }

    if (b.provider === 'HTML_OVERLAY') {
      if (!b.overlay) return;
      await this.showOverlay(b.overlay);
      return;
    }

    if (!b.tagUrl) return;
    const provider = this.getProviderByName((b.provider as 'VAST' | 'IMA') ?? 'VAST');
    if (!provider) return;
    const result = await provider.requestAds(b.tagUrl);
    if (result.success) {
      await provider.playAdBreak(b.type);
    }
  }
}
