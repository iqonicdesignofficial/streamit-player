import {
  AdProvider,
  ProviderContext,
  ProviderResult,
  CapabilityInfo,
  AdBreak,
  AdError,
  AdErrorType,
  AdState,
  AdsRequestConfig,
  PlayerSource,
  Advertisement,
} from '../types';
import { AdsManager } from '../AdsManager';
import { VastProvider, TrackingManager } from './VastProvider';
import { fetchXmlWithPolicy } from './fetchXmlWithPolicy';

export interface FrequencyCapConfig {
  minTimeBetweenBreaks?: number; // seconds
  minContentWatched?: number;    // seconds
  maxAdsSession?: number;
  maxAdsPerHour?: number;
}

export interface VmapDiagnostics {
  parsedBreaksCount: number;
  registeredBreaksCount: number;
  playedBreaksCount: number;
  cancelledBreaksCount: number;
  dynamicInsertions: number;
  repeatSchedulingCount: number;
  playlistResets: number;
  liveScheduleUpdates: number;
  frequencyCapSuppressions: number;
}

/** Shape accepted by registerBreak()/replaceBreak() for dynamically-inserted
 * VMAP breaks - timeOffset may be a raw numeric second offset or a VMAP-style
 * string ('start' | 'end' | '<seconds>' | '<pct>%'). */
export interface VmapDynamicAdBreak {
  id: string;
  timeOffset: string | number;
  breakType?: string;
  adTagUrl: string;
}

export interface ScheduledBreak {
  id: string;
  timeOffset: string;
  breakType: string;
  repeatAfter?: string;
  adTagUrl: string;
  resolvedTime: number;
  isPlayed: boolean;
  isRepeat?: boolean;
  trackingUrls?: { event: string; url: string }[];
}

interface ParsedVmapAdBreak {
  id: string;
  timeOffset: string;
  breakType: string;
  repeatAfter?: string;
  adTagUrl: string;
  trackingUrls: { event: string; url: string }[];
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function parseDuration(durationStr: string | null | undefined): number {
  if (!durationStr) return 0;
  const parts = durationStr.trim().split(':');
  if (parts.length === 3) {
    const hours = parseInt(parts[0], 10) || 0;
    const minutes = parseInt(parts[1], 10) || 0;
    const seconds = parseFloat(parts[2]) || 0;
    return hours * 3600 + minutes * 60 + seconds;
  }
  const parsed = parseFloat(durationStr);
  return isNaN(parsed) ? 0 : parsed;
}

function parseInitialTimeOffset(timeOffset: string | null | undefined): number {
  if (!timeOffset || timeOffset === 'start') return 0;
  if (timeOffset === 'end' || timeOffset.endsWith('%')) return -1;
  return parseDuration(timeOffset);
}

function parseXml(xmlString: string): Document | null {
  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') {
    return null;
  }
  try {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlString, 'text/xml');
    const parserError = xmlDoc.getElementsByTagName('parsererror');
    if (parserError.length > 0) {
      return null;
    }
    return xmlDoc;
  } catch (e) {
    return null;
  }
}

// --- Namespace Helper Functions ---
function getElementsByLocalName(element: Element | Document, localName: string): Element[] {
  const result: Element[] = [];
  const tags = element.getElementsByTagName('*');
  for (let i = 0; i < tags.length; i++) {
    const item = tags[i];
    const nodeName = item.nodeName;
    const parts = nodeName.split(':');
    const name = parts[parts.length - 1];
    if (name === localName) {
      result.push(item);
    }
  }
  return result;
}

function getFirstElementByLocalName(element: Element | Document, localName: string): Element | null {
  const list = getElementsByLocalName(element, localName);
  return list.length > 0 ? list[0] : null;
}

const VMAP_BREAK_TRACKING_EVENTS = ['breakStart', 'breakEnd', 'error'];

export function parseBreakTrackingEvents(breakNode: Element): { event: string; url: string }[] {
  const trackingEventsNode = getFirstElementByLocalName(breakNode, 'TrackingEvents');
  if (!trackingEventsNode) return [];

  const trackingNodes = getElementsByLocalName(trackingEventsNode, 'Tracking');
  const result: { event: string; url: string }[] = [];
  for (let i = 0; i < trackingNodes.length; i++) {
    const node = trackingNodes[i];
    const event = node.getAttribute('event') || '';
    const url = node.textContent?.trim() || '';
    if (VMAP_BREAK_TRACKING_EVENTS.includes(event) && url) {
      result.push({ event, url });
    }
  }
  return result;
}

export class VmapProvider implements AdProvider {
  public readonly name = 'VMAP';
  public readonly capabilities: CapabilityInfo = {
    supportsLinear: true,
    supportsNonLinear: true,
    supportsCompanion: true,
    supportsSkippable: true,
    supportsVMAP: true,
    supportsVAST: true,
    supportsSSAI: false,
    supportsIMA: false,
  };

  private context: ProviderContext | null = null;
  private manager: AdsManager | null = null;
  private vmapTagUrl = '';

  // Internal Schedules
  private scheduledBreaks: ScheduledBreak[] = [];
  private hasDurationResolved = false;
  private lastBreakTime = -1;
  private sessionAdCount = 0;
  private hourlyAdTimestamps: number[] = [];

  // Configurations
  private frequencyCap: FrequencyCapConfig = {};
  private limits = { maxXmlSize: 2097152 }; // 2MB
  private trackingManager = new TrackingManager();

  // Cleanup Listeners
  private timeUpdateListener: (() => void) | null = null;
  private durationChangeListener: (() => void) | null = null;
  private loadedMetadataListener: (() => void) | null = null;
  private endedListener: (() => void) | null = null;
  private seekedListener: (() => void) | null = null;

  // Diagnostics
  private diagnostics: VmapDiagnostics = {
    parsedBreaksCount: 0,
    registeredBreaksCount: 0,
    playedBreaksCount: 0,
    cancelledBreaksCount: 0,
    dynamicInsertions: 0,
    repeatSchedulingCount: 0,
    playlistResets: 0,
    liveScheduleUpdates: 0,
    frequencyCapSuppressions: 0,
  };

  public init(context: ProviderContext): ProviderResult {
    this.context = context;
    if (context.controller && context.controller.ads) {
      this.manager = context.controller.ads.manager;
    }

    const providerOptions = context.config?.providerOptions;
    if (providerOptions) {
      this.frequencyCap = providerOptions.frequencyCap || {};
      if (typeof providerOptions.maxXmlSize === 'number') {
        this.limits.maxXmlSize = providerOptions.maxXmlSize;
      }
    }

    this.setupTimelineListeners();
    return { success: true };
  }

  public async requestAds(vmapUrl: string, config?: Record<string, unknown>): Promise<ProviderResult> {
    const providedContext = config?.context as ProviderContext | undefined;
    if ((!this.manager || !this.context) && providedContext) {
      this.init(providedContext);
    }
    if (!this.manager || !this.context) {
      return {
        success: false,
        error: {
          type: AdErrorType.CONFIGURATION,
          code: 100,
          message: 'VmapProvider not initialized.',
        },
      };
    }

    // Same restriction VastProvider/ImaProvider enforce - embed sources
    // (YouTube/Vimeo iframes) don't expose a real, controllable <video>
    // element for ad breaks to pause/overlay/intercept.
    if (this.context.controller.getState().sourceType === 'embed') {
      const error = {
        type: AdErrorType.CONFIGURATION,
        code: 900,
        message: 'VMAP ads are not supported for embed (YouTube/Vimeo) sources.',
      };
      this.manager.triggerAdError(error);
      return { success: false, error };
    }

    this.vmapTagUrl = vmapUrl;
    this.resetSchedule();

    const localSignal = new AbortController().signal;

    try {
      const xmlText = await this.fetchVmapXml(vmapUrl, localSignal, this.context.config?.request);

      if (xmlText.length > this.limits.maxXmlSize) {
        throw new Error(`Oversized VMAP XML: ${xmlText.length} bytes exceeds limits`);
      }

      const xmlDoc = parseXml(xmlText);
      if (!xmlDoc) {
        throw new Error('Malformed VMAP XML or parsing error');
      }

      const vmapNode = getFirstElementByLocalName(xmlDoc, 'VMAP');
      if (!vmapNode) {
        throw new Error('Missing VMAP root node');
      }

      const parsed = this.parseVmapAdBreaks(xmlDoc);
      this.diagnostics.parsedBreaksCount = parsed.length;

      // Map parsed breaks to scheduled elements
      this.scheduledBreaks = parsed.map(b => ({
        ...b,
        resolvedTime: parseInitialTimeOffset(b.timeOffset),
        isPlayed: false,
      }));

      if (this.context.controller.ads?.hasActiveManualSchedule?.()) {
        console.warn(
          '[VmapProvider] requestAds() called while an AdScheduler manual schedule has active breaks - ' +
          'AdScheduler and VmapProvider independently watch the same video timeline and are not supported ' +
          'together on one player instance; this can result in duplicate/overlapping ad breaks.'
        );
        this.context.controller.emit('adschedulerconflict', {
          source: 'vmap',
          reason: 'VmapProvider.requestAds() called while AdScheduler has active breaks',
        });
      }

      // Resolve cue points immediately if duration already exists
      const duration = this.context.controller.getState().duration;
      if (duration && duration > 0) {
        this.resolveCuePoints(duration);
      }

      return { success: true };
    } catch (e) {
      const message = e instanceof Error ? e.message : 'VMAP parsing failed';
      const err: AdError = {
        type: message.includes('Malformed') ? AdErrorType.PARSING : AdErrorType.UNKNOWN,
        code: 300,
        message,
        originalError: e,
      };
      this.context?.controller.emit('vmapparseerror', { message: err.message });
      return { success: false, error: err };
    }
  }

  private async fetchVmapXml(url: string, signal: AbortSignal, options?: AdsRequestConfig): Promise<string> {
    return fetchXmlWithPolicy(url, signal, options);
  }

  private parseVmapAdBreaks(xmlDoc: Document): ParsedVmapAdBreak[] {
    const adBreaks: ParsedVmapAdBreak[] = [];
    const breakNodes = getElementsByLocalName(xmlDoc, 'AdBreak');

    for (let i = 0; i < breakNodes.length; i++) {
      const node = breakNodes[i];
      const timeOffset = node.getAttribute('timeOffset') || '';
      const breakId = node.getAttribute('breakId') || `vmap-break-${Date.now()}-${i}`;
      const breakType = node.getAttribute('breakType') || 'linear';
      const repeatAfter = node.getAttribute('repeatAfter') || undefined;

      const adSourceNode = getFirstElementByLocalName(node, 'AdSource');
      const adTagUriNode = adSourceNode ? getFirstElementByLocalName(adSourceNode, 'AdTagURI') : null;
      const adTagUrl = adTagUriNode?.textContent?.trim() || '';
      const trackingUrls = parseBreakTrackingEvents(node);

      adBreaks.push({
        id: breakId,
        timeOffset,
        breakType,
        repeatAfter,
        adTagUrl,
        trackingUrls,
      });
    }
    return adBreaks;
  }

  // --- Cue Points Resolver ---
  private resolveCuePoints(duration: number) {
    if (!isFinite(duration) || duration <= 0) return;
    this.hasDurationResolved = true;

    const baseScheduled = [...this.scheduledBreaks];
    this.scheduledBreaks = [];

    baseScheduled.forEach(b => {
      let time = b.resolvedTime;
      if (b.timeOffset === 'start') {
        time = 0;
      } else if (b.timeOffset === 'end') {
        time = duration;
      } else if (b.timeOffset.endsWith('%')) {
        const pct = parseFloat(b.timeOffset.slice(0, -1)) / 100;
        time = isNaN(pct) ? 0 : pct * duration;
      } else if (time < 0) {
        time = parseDuration(b.timeOffset);
      }

      const scheduled: ScheduledBreak = {
        ...b,
        resolvedTime: time,
        isPlayed: b.isPlayed,
      };

      this.scheduledBreaks.push(scheduled);
      this.diagnostics.registeredBreaksCount++;

      // Register repeat schedules if repeatAfter configured
      if (b.repeatAfter && !b.isRepeat) {
        this.generateRepeatSchedules(scheduled, duration);
      }
    });

    // Sort chronologically by resolvedTime
    this.scheduledBreaks.sort((a, b) => a.resolvedTime - b.resolvedTime);
  }

  private generateRepeatSchedules(base: ScheduledBreak, duration: number) {
    const interval = parseDuration(base.repeatAfter);
    if (interval <= 0) return;

    let nextTime = base.resolvedTime + interval;
    while (nextTime < duration) {
      this.scheduledBreaks.push({
        ...base,
        id: `${base.id}-repeat-${nextTime}`,
        timeOffset: String(nextTime),
        resolvedTime: nextTime,
        isPlayed: false,
        isRepeat: true,
      });
      this.diagnostics.repeatSchedulingCount++;
      this.diagnostics.registeredBreaksCount++;
      nextTime += interval;
    }
  }

  // --- Timeline monitoring loop ---
  private setupTimelineListeners() {
    if (!this.context) return;
    const video = this.context.videoElement;

    const onLoadedMetadata = () => {
      if (!this.context || !this.manager) return;
      const duration = video.duration || 0;
      if (isFinite(duration) && duration > 0) {
        this.hasDurationResolved = false;
        this.resolveCuePoints(duration);
      }
    };

    const onTimeUpdate = () => {
      if (!this.context || !this.manager) return;
      const currentTime = video.currentTime;
      const duration = video.duration || 0;

      // Handle live dynamic schedules. There's no total duration to resolve
      // '%'/'end' offsets against for a live stream, so those stay unresolved
      // (resolvedTime < 0) and are correctly skipped by evaluateCueHits below
      // - no timeline is fabricated. 'start' and absolute-time offsets are
      // already resolved at parse time (parseInitialTimeOffset), including
      // breaks registered dynamically via registerBreak() mid-stream, so
      // simply evaluating hits against the live currentTime is sufficient.
      if (this.context.controller.getState().isLive) {
        this.diagnostics.liveScheduleUpdates++;
        this.evaluateCueHits(currentTime);
        return;
      }

      if (isFinite(duration) && duration > 0 && (!this.hasDurationResolved || this.scheduledBreaks.some(b => b.timeOffset.endsWith('%') || b.timeOffset === 'end'))) {
        this.resolveCuePoints(duration);
      }

      this.evaluateCueHits(currentTime);
    };

    const onDurationChange = () => {
      const duration = video.duration || 0;
      if (isFinite(duration) && duration > 0) {
        this.hasDurationResolved = false;
        this.resolveCuePoints(duration);
      }
    };

    const onEnded = () => {
      if (!this.context || !this.manager) return;
      const duration = video.duration || 0;
      this.evaluateCueHits(duration, true);
    };

    const onSeeked = () => {
      if (!this.context || !this.manager) return;
      const currentTime = video.currentTime;
      this.evaluateCueHits(currentTime, false, true);
    };

    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('durationchange', onDurationChange);
    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('ended', onEnded);
    video.addEventListener('seeked', onSeeked);

    this.timeUpdateListener = onTimeUpdate;
    this.durationChangeListener = onDurationChange;
    this.loadedMetadataListener = onLoadedMetadata;
    this.endedListener = onEnded;
    this.seekedListener = onSeeked;
  }

  private evaluateCueHits(currentTime: number, isEnded = false, isSeeked = false) {
    const duration = this.context?.videoElement.duration || 0;
    const hits: ScheduledBreak[] = [];

    for (let i = 0; i < this.scheduledBreaks.length; i++) {
      const b = this.scheduledBreaks[i];
      if (!b.isPlayed) {
        // Skip unresolved breaks until duration resolves them
        if (b.resolvedTime < 0) continue;

        const isPreroll = b.timeOffset === 'start' || b.resolvedTime === 0;
        const isPostroll = b.timeOffset === 'end';

        let isHit = false;
        if (isPreroll) {
          isHit = currentTime <= 3.0;
        } else if (isPostroll) {
          isHit = isEnded || (duration > 0 && currentTime >= duration - 0.5);
        } else {
          // Mid-roll: trigger when playback reaches or passes resolvedTime
          if (isSeeked) {
            isHit = b.resolvedTime <= currentTime;
          } else {
            isHit = currentTime >= b.resolvedTime && (currentTime - b.resolvedTime) <= 2.5;
          }
        }

        if (isHit) {
          hits.push(b);
        }
      }
    }

    if (hits.length > 0) {
      let activeHits = hits;
      if (isSeeked && hits.length > 1) {
        // When seeking past multiple midroll breaks, only execute the latest/last missed break
        // and mark earlier missed breaks as played to avoid back-to-back midroll playback.
        hits.sort((a, b) => a.resolvedTime - b.resolvedTime);
        const lastMissedBreak = hits[hits.length - 1];
        hits.forEach(b => { b.isPlayed = true; });
        activeHits = [lastMissedBreak];
      } else {
        hits.forEach(b => { b.isPlayed = true; });
      }

      const validHits = activeHits.filter(b => this.checkFrequencyCappingRules(currentTime));
      if (validHits.length > 0) {
        this.executeAdBreaksSequence(validHits);
      } else {
        this.diagnostics.frequencyCapSuppressions += activeHits.length;
      }
    }
  }

  private checkFrequencyCappingRules(currentTime: number): boolean {
    // 1. Content watched checks
    if (this.frequencyCap.minContentWatched !== undefined) {
      if (currentTime < this.frequencyCap.minContentWatched) return false;
    }

    // 2. Minimum time between breaks
    if (this.frequencyCap.minTimeBetweenBreaks !== undefined && this.lastBreakTime !== -1) {
      if (currentTime - this.lastBreakTime < this.frequencyCap.minTimeBetweenBreaks) return false;
    }

    // 3. Max breaks per session
    if (this.frequencyCap.maxAdsSession !== undefined) {
      if (this.sessionAdCount >= this.frequencyCap.maxAdsSession) return false;
    }

    // 4. Max breaks per hour
    if (this.frequencyCap.maxAdsPerHour !== undefined) {
      const limitTime = Date.now() - 3600000;
      this.hourlyAdTimestamps = this.hourlyAdTimestamps.filter(t => t > limitTime);
      if (this.hourlyAdTimestamps.length >= this.frequencyCap.maxAdsPerHour) return false;
    }

    return true;
  }

  private fireBreakTracking(vmapBreak: ScheduledBreak, eventName: string) {
    if (!vmapBreak.trackingUrls) return;
    vmapBreak.trackingUrls
      .filter(t => t.event === eventName)
      .forEach(t => this.trackingManager.trackUrl(t.url));
  }

  private async executeAdBreaksSequence(breaks: ScheduledBreak[]) {
    if (!this.context || !this.manager || breaks.length === 0) return;

    const vastProvider = this.context.controller.ads.getProvider('VAST') as VastProvider;
    if (!vastProvider) {
      console.warn('[VmapProvider] Failed to locate VAST provider for executing breaks');
      this.manager.recover('VAST provider missing');
      return;
    }

    // For mid-rolls and post-rolls, immediately pause main content video
    // and capture snapshot at target resolvedTime to eliminate playback drift while VAST is fetched asynchronously
    const isMidrollOrPostroll = breaks.some(b => b.timeOffset !== 'start' && b.resolvedTime > 0);
    if (isMidrollOrPostroll && this.context.videoElement) {
      const targetTime = breaks[0].resolvedTime;
      try {
        this.context.videoElement.pause();
        if (targetTime > 0 && targetTime < (this.context.videoElement.duration || Infinity)) {
          this.context.videoElement.currentTime = targetTime;
        }
      } catch (_) { /* ignore */ }
      this.manager.getSavedContentSnapshot().capture(this.context.controller);
    }

    const allNormalizedAds: Advertisement[] = [];
    for (const b of breaks) {
      this.lastBreakTime = b.resolvedTime;
      this.sessionAdCount++;
      this.hourlyAdTimestamps.push(Date.now());
      this.diagnostics.playedBreaksCount++;
      this.fireBreakTracking(b, 'breakStart');

      const res = await vastProvider.requestAds(b.adTagUrl);
      if (res.success) {
        const activeBreak = vastProvider.getInternalAdBreak() || this.manager.getAdBreakManager().getActiveBreak();
        if (activeBreak && activeBreak.ads && activeBreak.ads.length > 0) {
          allNormalizedAds.push(...activeBreak.ads);
        }
      } else {
        console.warn('[VmapProvider] VAST request failed for break:', b.id, res.error);
        this.fireBreakTracking(b, 'error');
        this.context.controller.emit('vmapbreakerror', {
          breakId: b.id,
          tagUrl: b.adTagUrl,
          message: res.error?.message || 'VAST request failed for VMAP break',
        });
      }
    }

    if (allNormalizedAds.length > 0) {
      const unifiedBreak: AdBreak = {
        id: `vmap-unified-break-${Date.now()}`,
        timeOffset: breaks[0].resolvedTime,
        type: breaks[0].timeOffset === 'start' ? 'preroll' : breaks[0].timeOffset === 'end' ? 'postroll' : 'midroll',
        ads: allNormalizedAds,
        duration: allNormalizedAds.reduce((sum, a) => sum + (a.duration || 0), 0),
      };

      vastProvider.setInternalAdBreak(unifiedBreak);
      this.manager.getAdBreakManager().registerBreak(unifiedBreak);

      await vastProvider.playAdBreak();
      breaks.forEach(b => this.fireBreakTracking(b, 'breakEnd'));
    } else {
      this.manager.recover('No playable VAST ads returned for VMAP breaks');
    }
  }

  // --- Dynamic Break Registration APIs ---
  public registerBreak(adBreak: VmapDynamicAdBreak) {
    const timeOffset = String(adBreak.timeOffset || '');
    const duration = this.context?.videoElement.duration || 0;
    let resolvedTime = typeof adBreak.timeOffset === 'number' ? adBreak.timeOffset : parseInitialTimeOffset(timeOffset);
    if (resolvedTime < 0 && duration > 0) {
      if (timeOffset === 'end') resolvedTime = duration;
      else if (timeOffset.endsWith('%')) {
        const pct = parseFloat(timeOffset.slice(0, -1)) / 100;
        resolvedTime = isNaN(pct) ? 0 : pct * duration;
      }
    }
    const scheduled: ScheduledBreak = {
      id: adBreak.id,
      timeOffset,
      breakType: adBreak.breakType || 'linear',
      adTagUrl: adBreak.adTagUrl,
      resolvedTime,
      isPlayed: false,
    };
    this.scheduledBreaks.push(scheduled);
    this.diagnostics.dynamicInsertions++;
    this.diagnostics.registeredBreaksCount++;

    // Sort schedules
    this.scheduledBreaks.sort((a, b) => a.resolvedTime - b.resolvedTime);
  }

  /** True if there are unplayed VMAP-scheduled breaks - used to detect the
   * unsupported combination with an active AdScheduler manual schedule. */
  public hasScheduledBreaks(): boolean {
    return this.scheduledBreaks.some(b => !b.isPlayed);
  }

  public removeBreak(id: string) {
    const idx = this.scheduledBreaks.findIndex(b => b.id === id);
    if (idx !== -1) {
      this.scheduledBreaks.splice(idx, 1);
      this.diagnostics.cancelledBreaksCount++;
    }
  }

  public replaceBreak(id: string, adBreak: VmapDynamicAdBreak) {
    this.removeBreak(id);
    this.registerBreak(adBreak);
  }

  public clearBreaks() {
    this.scheduledBreaks = [];
    this.hasDurationResolved = false;
  }

  // --- Playlist changes resets ---
  public onSourceLoaded(_source?: PlayerSource) {
    this.diagnostics.playlistResets++;
    this.resetSchedule();
    this.vmapTagUrl = '';
  }

  // --- Web Component cue markers resolver ---
  public getCuePoints(): number[] {
    return this.scheduledBreaks.map(b => b.resolvedTime).filter(t => t >= 0);
  }

  public getVmapDiagnostics(): VmapDiagnostics {
    return this.diagnostics;
  }

  private resetSchedule() {
    this.scheduledBreaks = [];
    this.hasDurationResolved = false;
    this.lastBreakTime = -1;
    this.sessionAdCount = 0;
    this.hourlyAdTimestamps = [];
  }

  private cleanupListeners() {
    if (!this.context) return;
    const video = this.context.videoElement;

    if (this.timeUpdateListener) {
      video.removeEventListener('timeupdate', this.timeUpdateListener);
      this.timeUpdateListener = null;
    }
    if (this.durationChangeListener) {
      video.removeEventListener('durationchange', this.durationChangeListener);
      this.durationChangeListener = null;
    }
    if (this.loadedMetadataListener) {
      video.removeEventListener('loadedmetadata', this.loadedMetadataListener);
      this.loadedMetadataListener = null;
    }
    if (this.endedListener) {
      video.removeEventListener('ended', this.endedListener);
      this.endedListener = null;
    }
    if (this.seekedListener) {
      video.removeEventListener('seeked', this.seekedListener);
      this.seekedListener = null;
    }
  }

  public playAdBreak(): Promise<void> {
    return Promise.resolve();
  }

  public pauseAd(): void { }
  public resumeAd(): void { }
  public setVolume(volume: number): void { }
  public setMuted(muted: boolean): void { }

  public skipAd(): void {
    const activeProvider = this.manager?.getProviderManager().getActiveProvider();
    if (activeProvider && activeProvider !== this && typeof activeProvider.skipAd === 'function') {
      activeProvider.skipAd();
    }
  }

  public destroy(): void {
    this.cleanupListeners();
    this.resetSchedule();
    this.context = null;
    this.manager = null;
    this.vmapTagUrl = '';
  }
}
