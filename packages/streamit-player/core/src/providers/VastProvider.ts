import {
  AdProvider,
  ProviderContext,
  ProviderResult,
  CapabilityInfo,
  Advertisement,
  AdBreak,
  AdError,
  AdErrorType,
  AdMedia,
  TrackingUrl,
  AdState,
  AdSkipMode,
  AdsTrackingConfig,
  AdVerification,
  AdsRequestConfig,
  PlayerSource,
} from '../types';
import { AdsManager } from '../AdsManager';
import { SimidRuntime } from '../simid/SimidRuntime';
import type { SimidConfig } from '../simid/types';
import { fetchXmlWithPolicy } from './fetchXmlWithPolicy';

// --- Hardened Diagnostic Stats ---
export interface VastDiagnostics {
  fetchDurationMs: number;
  parseDurationMs: number;
  validationDurationMs: number;
  wrapperCount: number;
  selectedMedia: AdMedia | null;
  rejectedMedia: AdMedia[];
  validationWarnings: string[];
  parserVersion: string;
  creativeCount: number;
  podCount: number;
  mediaCandidatesCount: number;
  rejectedCreativesCount: number;
  namespaceUsageDetected: boolean;
  cacheHits: number;
  cacheMisses: number;
  tracking?: TrackingDiagnostics;
}

// --- Extended VAST Metadata Advertisement Contract ---
export interface VastAdvertisement extends Advertisement {
  readonly mediaUrl?: string;
  readonly impressionUrls?: string[];
  readonly clickTrackingUrls?: string[];
  readonly errorUrls?: string[];
  readonly universalAdId?: { idRegistry: string; value: string } | null;
  readonly extensions?: string[];
  readonly adVerifications?: AdVerification[];
  readonly interactiveCreativeFile?: string | null;
  readonly mezzanine?: string | null;
  readonly sequence?: number;
  readonly podPosition?: number;
  readonly podSize?: number;
  readonly companions?: VastAdvertisement[];
  /**
   * NonLinear overlay ads declared inside the SAME <Ad> as this Linear
   * creative (i.e. meant to display concurrently, as an overlay ON TOP of
   * this video ad while it plays) - distinct from `companions`, which are
   * out-of-stream ads for external page slots, and distinct from a NonLinear
   * ad that is its own separate, standalone <Ad> pod entry with no Linear
   * creative at all.
   */
  readonly nonLinearAds?: VastAdvertisement[];
}

export interface CacheEntry {
  xmlText: string;
  timestamp: number;
}

// --- Optional Fetch Cache ---
export class VastCache {
  private cache = new Map<string, CacheEntry>();
  private maxAgeMs = 300000; // 5 minutes

  public get(url: string): string | null {
    const entry = this.cache.get(url);
    if (entry) {
      if (Date.now() - entry.timestamp < this.maxAgeMs) {
        return entry.xmlText;
      }
      this.cache.delete(url);
    }
    return null;
  }

  public set(url: string, xmlText: string) {
    this.cache.set(url, {
      xmlText,
      timestamp: Date.now(),
    });
  }

  public clear() {
    this.cache.clear();
  }
}

// --- XML Safety Limits ---
export interface ParserLimits {
  maxXmlSize: number;
  maxWrapperDepth: number;
  maxCreatives: number;
  maxMediaEntries: number;
  maxTrackingEntries: number;
  maxExtensions: number;
}

// --- Internal Tracking Manager ---
export interface TrackingDiagnostics {
  requestsCount: number;
  successesCount: number;
  failuresCount: number;
  retriesCount: number;
  duplicateSuppressions: number;
  averageLatencyMs: number;
  lastTransportUsed: 'beacon' | 'fetch' | 'image' | null;
  errorCodesTracked: Record<string, number>;
}

export class TrackingManager {
  private executedUrls = new Set<string>();
  private activeControllers = new Set<AbortController>();
  private retryTimers = new Set<ReturnType<typeof setTimeout>>();
  private totalLatency = 0;
  private latencyCount = 0;

  private diagnostics: TrackingDiagnostics = {
    requestsCount: 0,
    successesCount: 0,
    failuresCount: 0,
    retriesCount: 0,
    duplicateSuppressions: 0,
    averageLatencyMs: 0,
    lastTransportUsed: null,
    errorCodesTracked: {},
  };

  private replaceMacros(url: string, errorCode?: number): string {
    if (!url) return '';
    const nowTs = Date.now();
    const random = Math.floor(Math.random() * 100000000);
    return url
      .replace(/\[CACHEBUSTING\]/gi, String(random))
      .replace(/\[CACHEBUSTER\]/gi, String(random))
      .replace(/\[TIMESTAMP\]/gi, String(nowTs))
      .replace(/\[ERRORCODE\]/gi, String(errorCode ?? 0));
  }

  public trackUrl(url: string, errorCode?: number, retryCount = 3) {
    if (!url) return;
    const processedUrl = this.replaceMacros(url, errorCode);
    if (this.executedUrls.has(processedUrl)) {
      this.diagnostics.duplicateSuppressions++;
      return;
    }
    this.executedUrls.add(processedUrl);
    this.sendBeacon(processedUrl, retryCount);
  }

  private async sendBeacon(url: string, retryCount: number, attempt = 0) {
    this.diagnostics.requestsCount++;
    const startTime = now();

    // 1. Primary Transport: HTTP GET via fetch with keepalive & no-cors (VAST spec requirement)
    // VAST tracking URLs require HTTP GET requests. keepalive ensures delivery on page unload.
    if (typeof fetch === 'function') {
      const abortCtrl = new AbortController();
      this.activeControllers.add(abortCtrl);
      
      try {
        await fetch(url, {
          method: 'GET',
          mode: 'no-cors',
          keepalive: true,
          signal: abortCtrl.signal,
        });
        
        this.activeControllers.delete(abortCtrl);
        this.recordSuccess(startTime, 'fetch');
        return;
      } catch (err) {
        this.activeControllers.delete(abortCtrl);
        if (err instanceof Error && err.name === 'AbortError') return;
        // Fall through to Image tag beacon fallback
      }
    }

    // 2. Fallback Transport: Standard Image tag GET pixel beacon
    if (typeof Image !== 'undefined') {
      try {
        const img = new Image();
        img.src = url;
        this.recordSuccess(startTime, 'image');
        return;
      } catch (e) {
        this.handleFailure(url, 500, startTime, retryCount, attempt);
        return;
      }
    }

    this.diagnostics.failuresCount++;
  }

  private recordSuccess(startTime: number, transport: 'beacon' | 'fetch' | 'image') {
    this.diagnostics.successesCount++;
    this.diagnostics.lastTransportUsed = transport;
    this.totalLatency += (now() - startTime);
    this.latencyCount++;
    this.diagnostics.averageLatencyMs = this.totalLatency / this.latencyCount;
  }

  private handleFailure(url: string, status: number, startTime: number, retryCount: number, attempt: number) {
    this.diagnostics.failuresCount++;
    const statusStr = String(status);
    this.diagnostics.errorCodesTracked[statusStr] = (this.diagnostics.errorCodesTracked[statusStr] || 0) + 1;

    if (status === 404 || status === 400) return;

    if (attempt < retryCount) {
      this.diagnostics.retriesCount++;
      const delay = Math.pow(2, attempt + 1) * 100;
      const timer = setTimeout(() => {
        this.retryTimers.delete(timer);
        this.sendBeacon(url, retryCount, attempt + 1);
      }, delay);
      this.retryTimers.add(timer);
    }
  }

  public getDiagnostics(): TrackingDiagnostics {
    return this.diagnostics;
  }

  public clearRegistry() {
    this.executedUrls.clear();
  }

  public destroy() {
    this.activeControllers.forEach(c => c.abort());
    this.activeControllers.clear();
    this.retryTimers.forEach(t => clearTimeout(t));
    this.retryTimers.clear();
    this.executedUrls.clear();
  }
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
  const targetName = localName.toLowerCase();
  for (let i = 0; i < tags.length; i++) {
    const item = tags[i];
    const local = item.localName || item.nodeName.split(':').pop() || '';
    if (local.toLowerCase() === targetName) {
      result.push(item);
    }
  }
  return result;
}

function getFirstElementByLocalName(element: Element | Document, localName: string): Element | null {
  const list = getElementsByLocalName(element, localName);
  return list.length > 0 ? list[0] : null;
}

function nodeToString(node: Node): string {
  if (typeof XMLSerializer !== 'undefined') {
    return new XMLSerializer().serializeToString(node);
  }
  return node.textContent || '';
}

/**
 * Parses a standalone VAST XML document (fetched or inline text) and extracts
 * the first NonLinear creative it finds, for callers (e.g. HtmlOverlayRenderer)
 * that need to render a NonLinear overlay from a raw VAST tag/XML without going
 * through the full VastProvider ad-break pipeline. Namespace/prefix-safe, unlike
 * a plain CSS `querySelector` walk, since it reuses the same local-name matching
 * VastProvider itself relies on for real ad requests.
 */
export function parseNonLinearVastXml(xmlText: string): Partial<Advertisement> | null {
  if (typeof DOMParser === 'undefined') return null;
  const xmlDoc = new DOMParser().parseFromString(xmlText, 'text/xml');
  if (xmlDoc.getElementsByTagName('parsererror').length > 0) return null;

  const adNode = getFirstElementByLocalName(xmlDoc, 'Ad');
  const inlineNode = (adNode && getFirstElementByLocalName(adNode, 'InLine')) || getFirstElementByLocalName(xmlDoc, 'InLine');
  if (!inlineNode) return null;

  const adTitleNode = getFirstElementByLocalName(inlineNode, 'AdTitle');
  const adTitle = adTitleNode?.textContent?.trim();

  const creativeNodes = getElementsByLocalName(inlineNode, 'Creative');
  let nonLinearNode: Element | null = null;
  for (let i = 0; i < creativeNodes.length; i++) {
    const nl = getFirstElementByLocalName(creativeNodes[i], 'NonLinear');
    if (nl) {
      nonLinearNode = nl;
      break;
    }
  }
  if (!nonLinearNode) return null;

  const resource = extractOverlayResource(nonLinearNode);
  if (!resource) return null;

  const width = parseInt(nonLinearNode.getAttribute('width') || '0', 10) || undefined;
  const height = parseInt(nonLinearNode.getAttribute('height') || '0', 10) || undefined;

  const clickThroughNode = getFirstElementByLocalName(nonLinearNode, 'NonLinearClickThrough');
  const clickThroughUrl = clickThroughNode?.textContent?.trim() || undefined;

  const trackingNodes = getElementsByLocalName(nonLinearNode, 'Tracking');
  const trackingUrls: TrackingUrl[] = [];
  for (let i = 0; i < trackingNodes.length; i++) {
    const node = trackingNodes[i];
    const event = node.getAttribute('event') || '';
    const url = node.textContent?.trim();
    if (url && event) trackingUrls.push({ url, event });
  }

  return {
    title: adTitle,
    width,
    height,
    clickThroughUrl,
    trackingUrls: trackingUrls.length > 0 ? trackingUrls : undefined,
    ...resource,
  };
}

function extractOverlayResource(
  el: Element
): { imageUrl?: string; htmlUrl?: string; useIframe?: boolean; htmlContent?: string } | null {
  const staticNode = getFirstElementByLocalName(el, 'StaticResource');
  const staticUrl = staticNode?.textContent?.trim();
  if (staticUrl) {
    return { imageUrl: staticUrl };
  }

  const iframeNode = getFirstElementByLocalName(el, 'IFrameResource');
  const iframeUrl = iframeNode?.textContent?.trim();
  if (iframeUrl) {
    return { htmlUrl: iframeUrl, useIframe: true };
  }

  const htmlNode = getFirstElementByLocalName(el, 'HTMLResource');
  const htmlContent = htmlNode?.textContent?.trim();
  if (htmlContent) {
    return { htmlContent };
  }

  return null;
}

export function resolveSkipState(params: {
  mode: AdSkipMode;
  configSkipOffset?: number;
  xmlSkippable?: boolean;
  xmlSkipOffset?: number;
  currentTime: number;
}): { canSkip: boolean; skipAvailableAt: number | null } {
  const { mode, configSkipOffset, xmlSkippable, xmlSkipOffset, currentTime } = params;

  if (mode === AdSkipMode.DISABLED) {
    return { canSkip: false, skipAvailableAt: null };
  }

  if (mode === AdSkipMode.USER) {
    const offset = configSkipOffset ?? 5;
    const canSkip = currentTime >= offset;
    return { canSkip, skipAvailableAt: canSkip ? null : Math.max(0, offset - currentTime) };
  }

  // AUTO - defer entirely to VAST XML
  if (!xmlSkippable || xmlSkipOffset === undefined) {
    return { canSkip: false, skipAvailableAt: null };
  }
  const canSkip = currentTime >= xmlSkipOffset;
  return { canSkip, skipAvailableAt: canSkip ? null : Math.max(0, xmlSkipOffset - currentTime) };
}

export function shouldFireBeacon(
  category: 'impression' | 'quartile' | 'other',
  config?: { trackImpression?: boolean; trackQuartiles?: boolean }
): boolean {
  if (category === 'impression' && config?.trackImpression === false) return false;
  if (category === 'quartile' && config?.trackQuartiles === false) return false;
  return true;
}

export function mapVastErrorReason(message: string): { type: AdErrorType; code: number } {
  const msg = message || '';
  const rules: Array<[RegExp, AdErrorType, number]> = [
    [/timeout/i, AdErrorType.NETWORK, 301],
    [/version|unsupported/i, AdErrorType.CONFIGURATION, 101],
    [/loop/i, AdErrorType.PARSING, 302],
    [/depth|limit|oversized/i, AdErrorType.CONFIGURATION, 302],
    [/xml|malformed|parse/i, AdErrorType.PARSING, 100],
    [/media/i, AdErrorType.CONFIGURATION, 403],
    [/creative/i, AdErrorType.CONFIGURATION, 200],
    [/http|fetch|status|server/i, AdErrorType.NETWORK, 300],
  ];
  for (const [pattern, type, code] of rules) {
    if (pattern.test(msg)) return { type, code };
  }
  return { type: AdErrorType.UNKNOWN, code: 900 };
}

export class VastProvider implements AdProvider {
  public readonly name = 'VAST';
  public readonly capabilities: CapabilityInfo = {
    supportsLinear: true,
    supportsNonLinear: true,
    supportsCompanion: true,
    supportsSkippable: true,
    supportsVMAP: false,
    supportsVAST: true,
    supportsSSAI: false,
    supportsIMA: false,
  };

  private context: ProviderContext | null = null;
  private manager: AdsManager | null = null;
  private cache = new VastCache();
  private trackingManager = new TrackingManager();
  
  // Hardened options
  private isCacheEnabled = false;
  private renderingStrategy: 'dedicated' | 'swapped' = 'dedicated';
  private originalSource = '';
  private skipModeConfig: AdSkipMode = AdSkipMode.AUTO;
  private skipOffsetConfig?: number;
  private trackingConfig?: AdsTrackingConfig;

  // Playback states
  private currentAd: VastAdvertisement | null = null;
  private currentAdBreak: AdBreak | null = null;
  private currentAdIndex = 0;
  private adVideoElement: HTMLVideoElement | null = null;
  private canSkipAd = false;
  private impressionFired = false;
  private milestones = {
    start: false,
    firstQuartile: false,
    midpoint: false,
    thirdQuartile: false,
    complete: false,
  };

  // Listeners cleanups
  private cleanupListeners: (() => void) | null = null;
  private cleanupClick: (() => void) | null = null;
  private bufferingTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private simidRuntime: SimidRuntime | null = null;

  private limits: ParserLimits = {
    maxXmlSize: 2097152, // 2MB
    maxWrapperDepth: 5,
    maxCreatives: 20,
    maxMediaEntries: 50,
    maxTrackingEntries: 100,
    maxExtensions: 20,
  };

  private diagnostics: VastDiagnostics = {
    fetchDurationMs: 0,
    parseDurationMs: 0,
    validationDurationMs: 0,
    wrapperCount: 0,
    selectedMedia: null,
    rejectedMedia: [],
    validationWarnings: [],
    parserVersion: 'Unknown',
    creativeCount: 0,
    podCount: 0,
    mediaCandidatesCount: 0,
    rejectedCreativesCount: 0,
    namespaceUsageDetected: false,
    cacheHits: 0,
    cacheMisses: 0,
  };

  public init(context: ProviderContext): ProviderResult {
    this.context = context;
    if (context.controller && context.controller.ads) {
      this.manager = context.controller.ads.manager;
    }
    
    const providerOptions = context.config?.providerOptions;
    if (providerOptions) {
      this.isCacheEnabled = !!providerOptions.enableCache;
      this.renderingStrategy = providerOptions.renderingStrategy === 'swapped' ? 'swapped' : 'dedicated';
      if (typeof providerOptions.maxXmlSize === 'number') {
        this.limits.maxXmlSize = providerOptions.maxXmlSize;
      }
      if (typeof providerOptions.maxWrapperDepth === 'number') {
        this.limits.maxWrapperDepth = providerOptions.maxWrapperDepth;
      }
    }
    this.skipModeConfig = context.config?.playback?.skipMode ?? AdSkipMode.AUTO;
    this.skipOffsetConfig = context.config?.playback?.skipOffset;
    this.trackingConfig = context.config?.tracking;
    return { success: true };
  }

  public async requestAds(adTagUrl: string, config?: Record<string, unknown>): Promise<ProviderResult> {
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
          message: 'VastProvider not initialized.',
        },
      };
    }

    // Clean up any previous SIMID runtime & reset manager state to REQUESTING
    if (this.simidRuntime) {
      this.simidRuntime.destroyRuntime();
      this.simidRuntime = null;
    }
    if (this.manager) {
      this.manager.transitionTo(AdState.REQUESTING);
    }

    const visitedUrls = new Set<string>();
    let currentUrl = adTagUrl;
    let depth = 0;
    // Impression/Error/Tracking nodes declared on <Wrapper> ads must be merged
    // into the eventually-resolved Inline ad(s) per the VAST spec - accumulated
    // here as the wrapper chain is walked below.
    const wrapperImpressionUrls: string[] = [];
    const wrapperErrorUrls: string[] = [];
    const wrapperTrackingUrls: TrackingUrl[] = [];
    
    const localSignal = new AbortController().signal;

    try {
      while (depth < this.limits.maxWrapperDepth) {
        if (visitedUrls.has(currentUrl)) {
          throw new Error('VAST wrapper loop detected');
        }
        visitedUrls.add(currentUrl);
        this.diagnostics.wrapperCount = depth;
        
        let xmlText = '';
        if (this.isCacheEnabled) {
          const cached = this.cache.get(currentUrl);
          if (cached) {
            this.diagnostics.cacheHits++;
            xmlText = cached;
          }
        }

        if (!xmlText) {
          this.diagnostics.cacheMisses++;
          const fetchStart = now();
          xmlText = await this.fetchVastXml(currentUrl, localSignal, this.context.config.request);
          this.diagnostics.fetchDurationMs += (now() - fetchStart);

          if (this.isCacheEnabled) {
            this.cache.set(currentUrl, xmlText);
          }
        }

        if (xmlText.length > this.limits.maxXmlSize) {
          throw new Error(`Oversized VAST XML payload: ${xmlText.length} bytes exceeds limits`);
        }

        const parseStart = now();
        const xmlDoc = parseXml(xmlText);
        this.diagnostics.parseDurationMs += (now() - parseStart);
        
        if (!xmlDoc) {
          throw new Error('Malformed VAST XML or parsing error');
        }
        
        const vastNode = getFirstElementByLocalName(xmlDoc, 'VAST');
        const playlistNode = getFirstElementByLocalName(xmlDoc, 'Playlist');
        
        if (!vastNode && !playlistNode) {
          throw new Error('Missing VAST or Playlist root node');
        }
        
        if (xmlText.includes(':VAST') || xmlText.includes(':Ad') || xmlText.includes(':VMAP')) {
          this.diagnostics.namespaceUsageDetected = true;
        }

        if (vastNode) {
          const version = vastNode.getAttribute('version');
          if (version) {
            this.diagnostics.parserVersion = `VAST-${version}`;
            const majorVersion = parseFloat(version);
            if (isNaN(majorVersion) || majorVersion < 2.0 || majorVersion > 4.2) {
              throw new Error(`Unsupported VAST version: ${version}`);
            }
          }
        }

        if (playlistNode) {
          const adNodes = getElementsByLocalName(playlistNode, 'Ad');
          const adUrls: string[] = [];
          for (let i = 0; i < adNodes.length; i++) {
            const txt = adNodes[i].textContent?.trim();
            if (txt && (txt.startsWith('http://') || txt.startsWith('https://'))) {
              adUrls.push(txt);
            }
          }

          if (adUrls.length > 0) {
            const normalizedAds: VastAdvertisement[] = [];
            for (let i = 0; i < adUrls.length; i++) {
              try {
                const subXmlText = await this.fetchVastXml(adUrls[i], localSignal, this.context.config?.request);
                const subXmlDoc = parseXml(subXmlText);
                if (subXmlDoc) {
                  const subInline = getFirstElementByLocalName(subXmlDoc, 'Inline');
                  const subWrapper = getFirstElementByLocalName(subXmlDoc, 'Wrapper');
                  if (subInline) {
                    const subAds = getElementsByLocalName(subXmlDoc, 'Ad');
                    for (let j = 0; j < subAds.length; j++) {
                      const ad = this.normalizeAdNode(subAds[j], normalizedAds.length + 1, adUrls.length);
                      if (ad) normalizedAds.push(ad);
                    }
                  } else if (subWrapper) {
                    const uriNode = getFirstElementByLocalName(subXmlDoc, 'VASTAdTagURI');
                    if (uriNode && uriNode.textContent) {
                      const wrapXmlText = await this.fetchVastXml(uriNode.textContent.trim(), localSignal, this.context.config?.request);
                      const wrapXmlDoc = parseXml(wrapXmlText);
                      if (wrapXmlDoc) {
                        const wrapAds = getElementsByLocalName(wrapXmlDoc, 'Ad');
                        for (let j = 0; j < wrapAds.length; j++) {
                          const ad = this.normalizeAdNode(wrapAds[j], normalizedAds.length + 1, adUrls.length);
                          if (ad) normalizedAds.push(ad);
                        }
                      }
                    }
                  }
                }
              } catch (e) {
                console.warn(`[VastProvider] Failed to fetch playlist ad #${i + 1}:`, e);
              }
            }

            if (normalizedAds.length > 0) {
              normalizedAds.sort(
                (a, b) => (a.sequence ?? Number.MAX_SAFE_INTEGER) - (b.sequence ?? Number.MAX_SAFE_INTEGER)
              );
              const firstAd = normalizedAds[0];
              this.currentAd = firstAd;
              this.currentAdIndex = 0;

              const adBreak: AdBreak = {
                id: `vast-break-${Date.now()}`,
                timeOffset: 0,
                type: 'preroll',
                ads: normalizedAds,
                duration: normalizedAds.reduce((sum, a) => sum + (a.duration || 0), 0),
              };
              this.currentAdBreak = adBreak;
              
              this.manager.getAdBreakManager().registerBreak(adBreak);
              this.manager.setCurrentAd(firstAd);
              this.manager.transitionTo(AdState.LOADED);
              
              return { success: true };
            }
          }
        }

        const validationStart = now();
        const validationError = this.validateVastStructure(xmlDoc);
        this.diagnostics.validationDurationMs += (now() - validationStart);
        
        if (validationError && !playlistNode) {
          throw new Error(`VAST Validation Failure: ${validationError}`);
        }
        
        const inlineNode = getFirstElementByLocalName(xmlDoc, 'Inline');
        if (inlineNode) {
          const normalizeStart = now();
          
          const ads = getElementsByLocalName(xmlDoc, 'Ad');
          this.diagnostics.podCount = ads.length;

          const normalizedAds: VastAdvertisement[] = [];
          for (let i = 0; i < ads.length; i++) {
            const adNode = ads[i];
            const ad = this.normalizeAdNode(adNode, i + 1, ads.length) ||
              this.normalizeNonLinearAdNode(adNode, i + 1, ads.length) ||
              this.normalizeCompanionOnlyAdNode(adNode, i + 1, ads.length);
            if (ad) normalizedAds.push(ad);
          }

          if (normalizedAds.length === 0) {
            throw new Error('No compatible ad or creative found in inline VAST.');
          }

          let finalizedAds = normalizedAds;
          if (wrapperImpressionUrls.length || wrapperErrorUrls.length || wrapperTrackingUrls.length) {
            finalizedAds = finalizedAds.map(ad => ({
              ...ad,
              impressionUrls: [...(ad.impressionUrls || []), ...wrapperImpressionUrls],
              errorUrls: [...(ad.errorUrls || []), ...wrapperErrorUrls],
              trackingUrls: [...(ad.trackingUrls || []), ...wrapperTrackingUrls],
            }));
          }

          finalizedAds = [...finalizedAds].sort(
            (a, b) => (a.sequence ?? Number.MAX_SAFE_INTEGER) - (b.sequence ?? Number.MAX_SAFE_INTEGER)
          );

          this.diagnostics.parseDurationMs += (now() - normalizeStart);

          const firstAd = finalizedAds[0];
          this.currentAd = firstAd;
          this.currentAdIndex = 0;

          const adBreak: AdBreak = {
            id: `vast-break-${Date.now()}`,
            timeOffset: 0,
            type: 'preroll',
            ads: finalizedAds,
            duration: finalizedAds.reduce((sum, a) => sum + (a.duration || 0), 0),
          };
          this.currentAdBreak = adBreak;
          
          this.manager.getAdBreakManager().registerBreak(adBreak);
          this.manager.setCurrentAd(firstAd);
          this.manager.transitionTo(AdState.LOADED);
          
          return { success: true };
        }
        
        const wrapperNode = getFirstElementByLocalName(xmlDoc, 'Wrapper');
        if (wrapperNode) {
          const uriNode = getFirstElementByLocalName(xmlDoc, 'VASTAdTagURI');
          if (!uriNode || !uriNode.textContent) {
            throw new Error('VAST wrapper is missing VASTAdTagURI node.');
          }

          const wImpressionNodes = getElementsByLocalName(wrapperNode, 'Impression');
          for (let i = 0; i < wImpressionNodes.length; i++) {
            const url = wImpressionNodes[i].textContent?.trim();
            if (url) wrapperImpressionUrls.push(url);
          }
          const wErrorNodes = getElementsByLocalName(wrapperNode, 'Error');
          for (let i = 0; i < wErrorNodes.length; i++) {
            const url = wErrorNodes[i].textContent?.trim();
            if (url) wrapperErrorUrls.push(url);
          }
          const wTrackingNodes = getElementsByLocalName(wrapperNode, 'Tracking');
          for (let i = 0; i < wTrackingNodes.length; i++) {
            const node = wTrackingNodes[i];
            const event = node.getAttribute('event') || '';
            const url = node.textContent?.trim();
            if (url && event) wrapperTrackingUrls.push({ url, event });
          }

          currentUrl = uriNode.textContent.trim();
          depth++;
          continue;
        }
        
        throw new Error('VAST XML does not contain an Inline or Wrapper node.');
      }
      
      throw new Error(`VAST wrapper depth limit reached (${this.limits.maxWrapperDepth})`);
      
    } catch (e) {
      const err = this.mapError(e);
      this.fireErrorTracking(err.type === AdErrorType.NETWORK ? 301 : 100);
      this.manager.triggerAdError(err);
      return { success: false, error: err };
    }
  }

  private async fetchVastXml(
    url: string,
    signal: AbortSignal,
    options: AdsRequestConfig = {}
  ): Promise<string> {
    return fetchXmlWithPolicy(url, signal, options);
  }

  private validateVastStructure(xmlDoc: Document): string | null {
    const ads = getElementsByLocalName(xmlDoc, 'Ad');
    if (ads.length === 0) {
      return 'VAST contains no Ad elements';
    }
    return null;
  }

  private normalizeAdNode(adNode: Element, index: number, total: number): VastAdvertisement | null {
    const inlineNode = getFirstElementByLocalName(adNode, 'Inline');
    if (!inlineNode) return null;
    
    const adTitleNode = getFirstElementByLocalName(inlineNode, 'AdTitle');
    const adTitle = adTitleNode?.textContent?.trim() || 'VAST Ad';
    
    const adSystemNode = getFirstElementByLocalName(inlineNode, 'AdSystem');
    const adSystem = adSystemNode?.textContent?.trim() || 'Unknown';
    
    const durationNode = getFirstElementByLocalName(inlineNode, 'Duration');
    const duration = parseDuration(durationNode?.textContent);
    
    const creativeNodes = getElementsByLocalName(inlineNode, 'Creative');
    this.diagnostics.creativeCount += creativeNodes.length;
    if (creativeNodes.length > this.limits.maxCreatives) {
      this.diagnostics.validationWarnings.push('Too many creatives detected in XML.');
      return null;
    }

    let linearCreativeNode: Element | null = null;
    let creativeId = '';
    
    for (let i = 0; i < creativeNodes.length; i++) {
      const creative = creativeNodes[i];
      const linear = getFirstElementByLocalName(creative, 'Linear');
      if (linear) {
        linearCreativeNode = linear;
        creativeId = creative.getAttribute('id') || '';
        break;
      } else {
        this.diagnostics.rejectedCreativesCount++;
      }
    }

    if (!linearCreativeNode) {
      this.diagnostics.validationWarnings.push('No compatible linear creative found.');
      return null;
    }
    
    const mediaNodes = getElementsByLocalName(linearCreativeNode, 'MediaFile');
    this.diagnostics.mediaCandidatesCount += mediaNodes.length;
    if (mediaNodes.length > this.limits.maxMediaEntries) {
      this.diagnostics.validationWarnings.push('Oversized media entries count.');
      return null;
    }

    const mediaFiles: AdMedia[] = [];
    for (let i = 0; i < mediaNodes.length; i++) {
      const node = mediaNodes[i];
      const url = node.textContent?.trim();
      const type = node.getAttribute('type') || '';
      const bitrate = parseInt(node.getAttribute('bitrate') || '0', 10);
      const width = parseInt(node.getAttribute('width') || '0', 10);
      const height = parseInt(node.getAttribute('height') || '0', 10);
      const delivery = (node.getAttribute('delivery') || 'progressive') as 'progressive' | 'streaming';
      
      if (url) {
        mediaFiles.push({
          url,
          bitrate,
          width,
          height,
          contentType: type,
          delivery,
        });
      }
    }
    
    const selected = this.selectMediaFile(mediaFiles);
    if (!selected) {
      this.diagnostics.validationWarnings.push('No compatible MediaFile found in creative.');
      return null;
    }
    this.diagnostics.selectedMedia = selected;
    
    const skipOffsetStr = linearCreativeNode.getAttribute('skipoffset');
    const skippable = skipOffsetStr !== null && skipOffsetStr !== undefined;
    const skipOffset = skippable ? parseDuration(skipOffsetStr) : undefined;
    
    const trackingNodes = getElementsByLocalName(linearCreativeNode, 'Tracking');
    if (trackingNodes.length > this.limits.maxTrackingEntries) {
      this.diagnostics.validationWarnings.push('Tracking events limit exceeded.');
      return null;
    }

    const trackingUrls: TrackingUrl[] = [];
    for (let i = 0; i < trackingNodes.length; i++) {
      const node = trackingNodes[i];
      const event = node.getAttribute('event') || '';
      const url = node.textContent?.trim();
      if (url && event) {
        trackingUrls.push({ url, event });
      }
    }
    
    const clickThroughNode = getFirstElementByLocalName(linearCreativeNode, 'ClickThrough');
    const clickThroughUrl = clickThroughNode?.textContent?.trim();
    
    // VAST 3/4 tracking additions: Impressions, ClickTracking, Errors
    const impressionNodes = getElementsByLocalName(inlineNode, 'Impression');
    const impressionUrls: string[] = [];
    for (let i = 0; i < impressionNodes.length; i++) {
      const url = impressionNodes[i].textContent?.trim();
      if (url) impressionUrls.push(url);
    }

    const clickTrackingNodes = getElementsByLocalName(linearCreativeNode, 'ClickTracking');
    const clickTrackingUrls: string[] = [];
    for (let i = 0; i < clickTrackingNodes.length; i++) {
      const url = clickTrackingNodes[i].textContent?.trim();
      if (url) clickTrackingUrls.push(url);
    }

    const errorNodes = getElementsByLocalName(adNode, 'Error');
    if (errorNodes.length === 0) {
      // Fallback check at root level
      const rootError = getElementsByLocalName(adNode.ownerDocument, 'Error');
      for (let i = 0; i < rootError.length; i++) {
        const url = rootError[i].textContent?.trim();
        if (url) errorNodes.push(rootError[i]);
      }
    }
    const errorUrls: string[] = [];
    for (let i = 0; i < errorNodes.length; i++) {
      const url = errorNodes[i].textContent?.trim();
      if (url) errorUrls.push(url);
    }

    let universalAdId = null;
    const uniNode = getFirstElementByLocalName(inlineNode, 'UniversalAdId');
    if (uniNode) {
      universalAdId = {
        idRegistry: uniNode.getAttribute('idRegistry') || 'unknown',
        value: uniNode.textContent?.trim() || '',
      };
    }

    const extensions: string[] = [];
    const extNodes = getElementsByLocalName(inlineNode, 'Extension');
    for (let i = 0; i < Math.min(extNodes.length, this.limits.maxExtensions); i++) {
      extensions.push(nodeToString(extNodes[i]));
    }

    const adVerifications: AdVerification[] = [];
    const verifNodes = getElementsByLocalName(inlineNode, 'Verification');
    for (let i = 0; i < verifNodes.length; i++) {
      const v = verifNodes[i];
      const vendor = v.getAttribute('vendor') || '';
      const script = getFirstElementByLocalName(v, 'JavaScriptResource')?.textContent?.trim() || '';
      if (script) {
        adVerifications.push({ vendor, script });
      }
    }

    let interactiveCreativeFile = getFirstElementByLocalName(linearCreativeNode, 'InteractiveCreativeFile')?.textContent?.trim() || null;
    if (!interactiveCreativeFile) {
      interactiveCreativeFile = getFirstElementByLocalName(inlineNode, 'InteractiveCreativeFile')?.textContent?.trim() || null;
    }
    if (!interactiveCreativeFile) {
      for (let i = 0; i < mediaNodes.length; i++) {
        const node = mediaNodes[i];
        const apiFramework = node.getAttribute('apiFramework')?.toUpperCase() || '';
        const type = node.getAttribute('type')?.toLowerCase() || '';
        if (apiFramework === 'SIMID' || type === 'text/html') {
          const txt = node.textContent?.trim();
          if (txt && (txt.startsWith('http://') || txt.startsWith('https://'))) {
            interactiveCreativeFile = txt;
            break;
          }
        }
      }
    }

    const mezzanineNode = getFirstElementByLocalName(linearCreativeNode, 'Mezzanine');
    const mezzanine = mezzanineNode?.textContent?.trim() || null;
    
    const sequenceAttr = adNode.getAttribute('sequence');
    const sequence = sequenceAttr ? parseInt(sequenceAttr, 10) : undefined;
    const adId = adNode.getAttribute('id') || `vast-${Date.now()}`;

    const companionNodes = getElementsByLocalName(inlineNode, 'Companion');
    const companions: VastAdvertisement[] = [];
    for (let i = 0; i < companionNodes.length; i++) {
      const companion = this.normalizeCompanionNode(companionNodes[i], adNode, i + 1, companionNodes.length);
      if (companion) companions.push(companion);
    }

    const nonLinearAds = this.extractConcurrentNonLinearAds(inlineNode, adNode);

    return {
      id: adId,
      title: adTitle,
      duration,
      width: selected.width,
      height: selected.height,
      linear: true,
      skippable,
      skipOffset,
      clickThroughUrl,
      trackingUrls,
      impressionUrls,
      clickTrackingUrls,
      errorUrls,
      contentType: selected.contentType,
      mediaUrl: selected.url,
      creativeId,
      adSystem,
      universalAdId,
      extensions,
      adVerifications,
      interactiveCreativeFile,
      mezzanine,
      sequence,
      podPosition: index,
      podSize: total,
      companions: companions.length > 0 ? companions : undefined,
      nonLinearAds: nonLinearAds.length > 0 ? nonLinearAds : undefined,
    };
  }

  private normalizeNonLinearAdNode(adNode: Element, index: number, total: number): VastAdvertisement | null {
    const inlineNode = getFirstElementByLocalName(adNode, 'Inline');
    if (!inlineNode) return null;

    const adTitleNode = getFirstElementByLocalName(inlineNode, 'AdTitle');
    const adTitle = adTitleNode?.textContent?.trim() || 'VAST Ad';

    const adSystemNode = getFirstElementByLocalName(inlineNode, 'AdSystem');
    const adSystem = adSystemNode?.textContent?.trim() || 'Unknown';

    const creativeNodes = getElementsByLocalName(inlineNode, 'Creative');
    let nonLinearNode: Element | null = null;
    let creativeId = '';

    for (let i = 0; i < creativeNodes.length; i++) {
      const creative = creativeNodes[i];
      const nl = getFirstElementByLocalName(creative, 'NonLinear');
      if (nl) {
        nonLinearNode = nl;
        creativeId = creative.getAttribute('id') || '';
        break;
      }
    }

    if (!nonLinearNode) {
      this.diagnostics.validationWarnings.push('No compatible NonLinear creative found.');
      return null;
    }

    const resource = extractOverlayResource(nonLinearNode);
    if (!resource) {
      this.diagnostics.validationWarnings.push(
        'NonLinear creative has no usable resource (StaticResource/IFrameResource/HTMLResource).'
      );
      return null;
    }

    const width = parseInt(nonLinearNode.getAttribute('width') || '0', 10) || undefined;
    const height = parseInt(nonLinearNode.getAttribute('height') || '0', 10) || undefined;
    const duration = parseDuration(nonLinearNode.getAttribute('minSuggestedDuration'));

    const clickThroughNode = getFirstElementByLocalName(nonLinearNode, 'NonLinearClickThrough');
    const clickThroughUrl = clickThroughNode?.textContent?.trim();

    const trackingNodes = getElementsByLocalName(nonLinearNode, 'Tracking');
    const trackingUrls: TrackingUrl[] = [];
    for (let i = 0; i < trackingNodes.length; i++) {
      const node = trackingNodes[i];
      const event = node.getAttribute('event') || '';
      const url = node.textContent?.trim();
      if (url && event) {
        trackingUrls.push({ url, event });
      }
    }

    const impressionNodes = getElementsByLocalName(inlineNode, 'Impression');
    const impressionUrls: string[] = [];
    for (let i = 0; i < impressionNodes.length; i++) {
      const url = impressionNodes[i].textContent?.trim();
      if (url) impressionUrls.push(url);
    }

    const errorNodes = getElementsByLocalName(adNode, 'Error');
    const errorUrls: string[] = [];
    for (let i = 0; i < errorNodes.length; i++) {
      const url = errorNodes[i].textContent?.trim();
      if (url) errorUrls.push(url);
    }

    const adId = adNode.getAttribute('id') || `vast-nonlinear-${Date.now()}`;

    return {
      id: adId,
      title: adTitle,
      duration,
      width,
      height,
      linear: false,
      skippable: false,
      clickThroughUrl,
      trackingUrls,
      impressionUrls,
      errorUrls,
      creativeId,
      adSystem,
      podPosition: index,
      podSize: total,
      ...resource,
    };
  }

  private normalizeCompanionNode(
    companionNode: Element,
    adNode: Element,
    index: number,
    total: number
  ): VastAdvertisement | null {
    const resource = extractOverlayResource(companionNode);
    if (!resource) {
      this.diagnostics.validationWarnings.push(
        'Companion creative has no usable resource (StaticResource/IFrameResource/HTMLResource).'
      );
      return null;
    }

    const width = parseInt(companionNode.getAttribute('width') || '0', 10) || undefined;
    const height = parseInt(companionNode.getAttribute('height') || '0', 10) || undefined;

    const clickThroughNode = getFirstElementByLocalName(companionNode, 'CompanionClickThrough');
    const clickThroughUrl = clickThroughNode?.textContent?.trim();

    const trackingNodes = getElementsByLocalName(companionNode, 'Tracking');
    const trackingUrls: TrackingUrl[] = [];
    for (let i = 0; i < trackingNodes.length; i++) {
      const node = trackingNodes[i];
      const event = node.getAttribute('event') || '';
      const url = node.textContent?.trim();
      if (url && event) {
        trackingUrls.push({ url, event });
      }
    }

    const companionId =
      companionNode.getAttribute('id') || `${adNode.getAttribute('id') || 'vast'}-companion-${index}`;

    return {
      id: companionId,
      title: 'VAST Companion Ad',
      duration: 0,
      width,
      height,
      linear: false,
      skippable: false,
      clickThroughUrl,
      trackingUrls,
      podPosition: index,
      podSize: total,
      ...resource,
    };
  }

  /**
   * Fallback for an <Ad> that contains only <CompanionAds><Companion>
   * creatives with no Linear or standalone NonLinear creative - matches
   * neither normalizeAdNode nor normalizeNonLinearAdNode, so without this
   * the whole <Ad> (and its companions) would be silently dropped.
   */
  private normalizeCompanionOnlyAdNode(adNode: Element, index: number, total: number): VastAdvertisement | null {
    const inlineNode = getFirstElementByLocalName(adNode, 'Inline');
    if (!inlineNode) return null;

    const companionNodes = getElementsByLocalName(inlineNode, 'Companion');
    if (companionNodes.length === 0) return null;

    const companions: VastAdvertisement[] = [];
    for (let i = 0; i < companionNodes.length; i++) {
      const companion = this.normalizeCompanionNode(companionNodes[i], adNode, i + 1, companionNodes.length);
      if (companion) companions.push(companion);
    }
    if (companions.length === 0) return null;

    const adTitleNode = getFirstElementByLocalName(inlineNode, 'AdTitle');
    const adTitle = adTitleNode?.textContent?.trim() || 'VAST Ad';
    const adSystemNode = getFirstElementByLocalName(inlineNode, 'AdSystem');
    const adSystem = adSystemNode?.textContent?.trim() || 'Unknown';

    const impressionNodes = getElementsByLocalName(inlineNode, 'Impression');
    const impressionUrls: string[] = [];
    for (let i = 0; i < impressionNodes.length; i++) {
      const url = impressionNodes[i].textContent?.trim();
      if (url) impressionUrls.push(url);
    }

    const errorNodes = getElementsByLocalName(adNode, 'Error');
    const errorUrls: string[] = [];
    for (let i = 0; i < errorNodes.length; i++) {
      const url = errorNodes[i].textContent?.trim();
      if (url) errorUrls.push(url);
    }

    const sequenceAttr = adNode.getAttribute('sequence');
    const sequence = sequenceAttr ? parseInt(sequenceAttr, 10) : undefined;
    const adId = adNode.getAttribute('id') || `vast-companion-only-${Date.now()}`;

    return {
      id: adId,
      title: adTitle,
      duration: 0,
      linear: false,
      skippable: false,
      impressionUrls,
      errorUrls,
      adSystem,
      sequence,
      podPosition: index,
      podSize: total,
      companions,
    };
  }

  /**
   * Extracts NonLinear overlay ads declared inside the same <Ad> as a Linear
   * creative (via a sibling <Creative><NonLinearAds><NonLinear>...) - the
   * standard VAST pattern for an overlay banner shown concurrently over a
   * playing video ad. Reuses the same per-NonLinear-element extraction as the
   * standalone-NonLinear-ad-pod path (normalizeNonLinearAdNode).
   */
  private extractConcurrentNonLinearAds(inlineNode: Element, adNode: Element): VastAdvertisement[] {
    const creativeNodes = getElementsByLocalName(inlineNode, 'Creative');
    const results: VastAdvertisement[] = [];
    let index = 0;

    for (let i = 0; i < creativeNodes.length; i++) {
      const nonLinearAdsNode = getFirstElementByLocalName(creativeNodes[i], 'NonLinearAds');
      if (!nonLinearAdsNode) continue;

      const nonLinearNodes = getElementsByLocalName(nonLinearAdsNode, 'NonLinear');
      for (let j = 0; j < nonLinearNodes.length; j++) {
        const nonLinearNode = nonLinearNodes[j];
        const resource = extractOverlayResource(nonLinearNode);
        if (!resource) continue;

        index++;
        const width = parseInt(nonLinearNode.getAttribute('width') || '0', 10) || undefined;
        const height = parseInt(nonLinearNode.getAttribute('height') || '0', 10) || undefined;
        const duration = parseDuration(nonLinearNode.getAttribute('minSuggestedDuration'));

        const clickThroughNode = getFirstElementByLocalName(nonLinearNode, 'NonLinearClickThrough');
        const clickThroughUrl = clickThroughNode?.textContent?.trim();

        const trackingNodes = getElementsByLocalName(nonLinearNode, 'Tracking');
        const trackingUrls: TrackingUrl[] = [];
        for (let k = 0; k < trackingNodes.length; k++) {
          const node = trackingNodes[k];
          const event = node.getAttribute('event') || '';
          const url = node.textContent?.trim();
          if (url && event) trackingUrls.push({ url, event });
        }

        const nonLinearId =
          nonLinearNode.getAttribute('id') || `${adNode.getAttribute('id') || 'vast'}-nonlinear-${index}`;

        results.push({
          id: nonLinearId,
          title: 'VAST NonLinear Overlay',
          duration,
          width,
          height,
          linear: false,
          skippable: false,
          clickThroughUrl,
          trackingUrls,
          ...resource,
        });
      }
    }

    return results;
  }

  private selectMediaFile(mediaFiles: AdMedia[]): AdMedia | null {
    if (mediaFiles.length === 0) return null;
    
    const compatible = mediaFiles.filter(m => {
      const type = (m.contentType || '').toLowerCase();
      const url = (m.url || '').toLowerCase();
      const isCompatible = (
        type.includes('mp4') || 
        type.includes('webm') || 
        type.includes('mpegurl') || 
        type.includes('apple') || 
        type.includes('dash') ||
        type.includes('video/') ||
        url.endsWith('.mp4') ||
        url.endsWith('.webm') ||
        url.endsWith('.m3u8') ||
        url.endsWith('.mpd') ||
        url.includes('mp4')
      );
      if (!isCompatible) {
        this.diagnostics.rejectedMedia.push(m);
      }
      return isCompatible;
    });
    
    if (compatible.length === 0) return mediaFiles[0] || null;
    
    compatible.sort((a, b) => {
      const resA = (a.width || 0) * (a.height || 0);
      const resB = (b.width || 0) * (b.height || 0);
      if (resA !== resB) return resB - resA;
      return (b.bitrate || 0) - (a.bitrate || 0);
    });
    
    return compatible[0];
  }

  private mapError(e: unknown): AdError {
    const msg = e instanceof Error ? e.message : String(e ?? '');
    const { type, code } = mapVastErrorReason(msg);
    return {
      type,
      code,
      message: msg || 'VAST request or parsing failed',
      originalError: e,
    };
  }

  /**
   * Package-internal accessor used by VmapProvider to read/replace the pod
   * this VastProvider is currently tracking when it stitches together a
   * unified break spanning multiple VMAP-scheduled VAST tag fetches.
   */
  public getInternalAdBreak(): AdBreak | null {
    return this.currentAdBreak;
  }

  /**
   * Package-internal setter used by VmapProvider (see getInternalAdBreak) to
   * install a unified, multi-tag-fetch break onto this VastProvider before
   * calling playAdBreak().
   */
  public setInternalAdBreak(adBreak: AdBreak): void {
    this.currentAdBreak = adBreak;
    this.currentAd = (adBreak.ads[0] as VastAdvertisement) ?? null;
    this.currentAdIndex = 0;
  }

  public getVastDiagnostics(): VastDiagnostics {
    return {
      ...this.diagnostics,
      tracking: this.trackingManager.getDiagnostics(),
    };
  }

  // --- Linear Ad Playback Integration ---
  public async playAdBreak(): Promise<void> {
    if (!this.context || !this.manager || !this.currentAd) return;

    // Embed sources (YouTube/Vimeo iframes) don't expose a real, controllable
    // <video> element the way MP4/HLS/DASH do - AdScheduler already blocks
    // this for its own timed schedule() path, but that check doesn't cover
    // the direct requestAds()+playAdBreak() call path (what most callers,
    // including the sandbox, actually use), so it silently attempted to run
    // against a video element that doesn't behave as expected instead of
    // failing clearly. Same restriction ImaProvider already enforces.
    if (this.context.controller.getState().sourceType === 'embed') {
      this.manager.triggerAdError({
        type: AdErrorType.CONFIGURATION,
        code: 900,
        message: 'VAST ads are not supported for embed (YouTube/Vimeo) sources.',
      });
      return;
    }

    const activeBreak = this.currentAdBreak || this.manager.getAdBreakManager().getActiveBreak() || {
      id: `vast-break-${Date.now()}`,
      timeOffset: 0,
      type: 'preroll' as const,
      ads: [this.currentAd],
      duration: this.currentAd.duration,
    };
    this.currentAdBreak = activeBreak;
    if (this.currentAdBreak.ads && this.currentAdBreak.ads.length > 0) {
      if (this.currentAdIndex >= this.currentAdBreak.ads.length) {
        this.currentAdIndex = 0;
      }
      this.currentAd = this.currentAdBreak.ads[this.currentAdIndex] as VastAdvertisement;
    }

    // Notify AdsManager to capture content snapshot and pause primary video
    // (AdsManager.startAdBreak() itself routes non-linear ads to the HTML
    // overlay pipeline and skips the pause/snapshot - see AdsManager.ts).
    this.manager.startAdBreak(activeBreak);

    if (!this.currentAd.linear) {
      // Non-linear/overlay ads are rendered by AdsManager.startAdBreak()
      // above; the linear video-playback pipeline must never run for them.
      return;
    }

    await this.playCurrentAdInPod();
  }

  private async playCurrentAdInPod(): Promise<void> {
    if (!this.context || !this.manager || !this.currentAd) return;
    if (!this.currentAd.linear) {
      if (this.manager.isHtmlOverlayCreative(this.currentAd)) {
        this.manager.playHtmlOverlay(this.currentAd);
      }
      return;
    }

    this.canSkipAd = false;
    this.impressionFired = false;
    this.milestones = {
      start: false,
      firstQuartile: false,
      midpoint: false,
      thirdQuartile: false,
      complete: false,
    };
    
    this.trackingManager.clearRegistry();

    const mediaUrl = this.currentAd.mediaUrl;
    if (!mediaUrl) {
      this.handlePlaybackError('Missing mediaUrl for current linear ad');
      return;
    }

    this.manager.setCurrentAd(this.currentAd);

    // Clear any companions/concurrent overlays left over from the PREVIOUS ad
    // in this pod before playing the next one - otherwise, if the next ad has
    // none of its own, the previous ad's overlay would be left stuck on
    // screen indefinitely since showCompanions()/showConcurrentOverlays()
    // below are only called when the new ad actually has some to show.
    this.manager.clearAuxiliaryOverlays();

    try {
      if (this.renderingStrategy === 'dedicated') {
        if (!this.adVideoElement) {
          const adVideo = document.createElement('video');
          adVideo.setAttribute('playsinline', 'true');
          adVideo.setAttribute('webkit-playsinline', 'true');
          adVideo.style.position = 'absolute';
          adVideo.style.top = '0';
          adVideo.style.left = '0';
          adVideo.style.width = '100%';
          adVideo.style.height = '100%';
          adVideo.style.zIndex = '1000';
          adVideo.style.backgroundColor = 'black';
          adVideo.style.pointerEvents = 'auto';
          this.context.adContainer.appendChild(adVideo);
          
          this.adVideoElement = adVideo;
          this.setupAdVideoListeners(adVideo);
          this.setupClickThrough(this.context.adContainer);
        }

        this.adVideoElement.src = mediaUrl;
        this.adVideoElement.load();
        
        this.manager.transitionTo(AdState.PLAYING);
        try {
          await this.adVideoElement.play();
        } catch (playErr) {
          if (!this.adVideoElement) return;
          console.warn('[VastProvider] Unmuted ad play blocked by browser policy, falling back to muted play:', playErr);
          this.adVideoElement.muted = true;
          await this.adVideoElement.play();
        }
      } else {
        const video = this.context.videoElement;
        if (!this.originalSource) {
          this.originalSource = video.src || '';
        }
        
        this.adVideoElement = video;
        this.setupAdVideoListeners(video);
        this.setupClickThrough(this.context.adContainer);

        video.src = mediaUrl;
        video.load();

        this.manager.transitionTo(AdState.PLAYING);
        try {
          await video.play();
        } catch (playErr) {
          console.warn('[VastProvider] Unmuted ad play blocked by browser policy, falling back to muted play:', playErr);
          video.muted = true;
          await video.play();
        }
      }

      if (this.currentAd?.companions && this.currentAd.companions.length > 0) {
        this.manager.showCompanions(this.currentAd.companions);
      }

      if (this.currentAd?.nonLinearAds && this.currentAd.nonLinearAds.length > 0) {
        this.manager.showConcurrentOverlays(this.currentAd.nonLinearAds);
      }

      if (this.currentAd?.interactiveCreativeFile && this.context) {
        if (this.simidRuntime) {
          this.simidRuntime.destroyRuntime();
          this.simidRuntime = null;
        }
        const simidOptions =
          this.context.config?.simid ||
          (this.context.config?.providerOptions?.simid as SimidConfig | undefined);
        this.simidRuntime = new SimidRuntime(simidOptions);
        const adContainer = this.context.adContainer;
        const controller = this.context.controller;
        this.simidRuntime.startRuntime(this.currentAd, adContainer, controller).catch((e) => {
          console.warn('[VastProvider] SIMID runtime initialization warning:', e);
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ad playback failed to initialize';
      this.handlePlaybackError(message);
    }
  }

  public pauseAd(): void {
    if (this.adVideoElement) {
      this.adVideoElement.pause();
      this.fireTrackingEvent('pause');
    }
  }

  public resumeAd(): void {
    if (this.adVideoElement) {
      this.adVideoElement.play().catch(e => {
        console.error('[VastProvider] Failed to resume ad play:', e);
      });
      this.fireTrackingEvent('resume');
    }
  }

  public setVolume(volume: number): void {
    if (this.adVideoElement) {
      this.adVideoElement.volume = volume;
    }
  }

  public setMuted(muted: boolean): void {
    if (this.adVideoElement) {
      this.adVideoElement.muted = muted;
      this.fireTrackingEvent(muted ? 'mute' : 'unmute');
    }
  }

  // --- Internal Milestone Event Trackers ---
  private fireTrackingEvent(eventName: string) {
    if (!this.currentAd || !this.currentAd.trackingUrls) return;
    const quartileEvents = ['start', 'firstQuartile', 'midpoint', 'thirdQuartile', 'complete'];
    const category: 'quartile' | 'other' = quartileEvents.includes(eventName) ? 'quartile' : 'other';
    const targets = this.currentAd.trackingUrls.filter(t => t.event && t.event.toLowerCase() === eventName.toLowerCase());
    targets.forEach(t => {
      this.trackingConfig?.customTracker?.(eventName, t.url);
      if (shouldFireBeacon(category, this.trackingConfig)) {
        this.trackingManager.trackUrl(t.url);
      }
    });
  }

  private fireErrorTracking(errorCode: number) {
    if (!this.currentAd || !this.currentAd.errorUrls) return;
    this.currentAd.errorUrls.forEach(url => {
      const replaced = url.replace(/\[ERRORCODE\]/g, String(errorCode));
      this.trackingManager.trackUrl(replaced);
    });
  }

  private setupAdVideoListeners(video: HTMLVideoElement) {
    const manager = this.manager;
    if (!manager) return;

    const onPlay = () => {
      manager.transitionTo(AdState.PLAYING);
    };

    const onPause = () => {
      manager.transitionTo(AdState.PAUSED);
    };

    const onWaiting = () => {
      manager.transitionTo(AdState.BUFFERING);
      this.bufferingTimeoutId = setTimeout(() => {
        this.handlePlaybackError('Stalled ad buffering timeout');
      }, 10000);
    };

    const onPlaying = () => {
      manager.transitionTo(AdState.PLAYING);
      if (this.bufferingTimeoutId) {
        clearTimeout(this.bufferingTimeoutId);
        this.bufferingTimeoutId = null;
      }
      
      // Fire impression tracker once on first frame play
      if (!this.impressionFired) {
        this.impressionFired = true;
        this.currentAd?.impressionUrls?.forEach(url => {
          this.trackingConfig?.customTracker?.('impression', url);
          if (shouldFireBeacon('impression', this.trackingConfig)) {
            this.trackingManager.trackUrl(url);
          }
        });
        this.fireTrackingEvent('creativeView');
        if (this.currentAd?.adVerifications && this.currentAd.adVerifications.length > 0) {
          this.context?.controller.emit('adverificationready', {
            ad: this.currentAd,
            verifications: this.currentAd.adVerifications,
          });
        }
      }
    };

    const onTimeUpdate = () => {
      const currentTime = video.currentTime;
      const duration = video.duration || this.currentAd?.duration || 0;
      const remainingTime = Math.max(0, duration - currentTime);
      
      const wasSkippable = this.canSkipAd;
      const { canSkip, skipAvailableAt } = resolveSkipState({
        mode: this.skipModeConfig,
        configSkipOffset: this.skipOffsetConfig,
        xmlSkippable: this.currentAd?.skippable,
        xmlSkipOffset: this.currentAd?.skipOffset,
        currentTime,
      });
      this.canSkipAd = canSkip;
      if (canSkip && !wasSkippable && this.currentAd) {
        this.context?.controller.emit('skipavailable', { ad: this.currentAd });
      }
      this.context?.controller.updateStatePublic({
        canSkipAd: canSkip,
        skipAvailableAt,
        adCurrentTime: currentTime,
        adRemainingTime: remainingTime,
        adDuration: duration,
      });

      this.checkMilestones(currentTime, duration);
      this.context?.controller.emit('adtimeupdate', { currentTime, duration, remainingTime });
    };

    const onEnded = () => {
      this.handleAdComplete();
    };

    const onError = () => {
      this.handlePlaybackError('Native video element playback error');
    };

    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('playing', onPlaying);
    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('ended', onEnded);
    video.addEventListener('error', onError);

    this.cleanupListeners = () => {
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('error', onError);
      if (this.bufferingTimeoutId) {
        clearTimeout(this.bufferingTimeoutId);
        this.bufferingTimeoutId = null;
      }
    };
  }

  private checkMilestones(currentTime: number, duration: number) {
    if (duration <= 0) return;
    const pct = currentTime / duration;
    
    if (pct >= 0 && !this.milestones.start) {
      this.milestones.start = true;
      this.fireTrackingEvent('start');
      this.context?.controller.emit('admilestone', { milestone: 'start' });
    }
    if (pct >= 0.25 && !this.milestones.firstQuartile) {
      this.milestones.firstQuartile = true;
      this.fireTrackingEvent('firstQuartile');
      this.context?.controller.emit('admilestone', { milestone: 'firstQuartile' });
      if (this.currentAd) this.context?.controller.emit('adfirstquartile', { ad: this.currentAd });
    }
    if (pct >= 0.50 && !this.milestones.midpoint) {
      this.milestones.midpoint = true;
      this.fireTrackingEvent('midpoint');
      this.context?.controller.emit('admilestone', { milestone: 'midpoint' });
      if (this.currentAd) this.context?.controller.emit('admidpoint', { ad: this.currentAd });
    }
    if (pct >= 0.75 && !this.milestones.thirdQuartile) {
      this.milestones.thirdQuartile = true;
      this.fireTrackingEvent('thirdQuartile');
      this.context?.controller.emit('admilestone', { milestone: 'thirdQuartile' });
      if (this.currentAd) this.context?.controller.emit('adthirdquartile', { ad: this.currentAd });
    }
    if (pct >= 0.98 && !this.milestones.complete) {
      this.milestones.complete = true;
      this.fireTrackingEvent('complete');
      this.context?.controller.emit('admilestone', { milestone: 'complete' });
    }
  }

  private setupClickThrough(container: HTMLElement) {
    const onClick = () => {
      if (this.currentAd?.clickThroughUrl) {
        // Fire click tracking beacon URLs
        this.currentAd.clickTrackingUrls?.forEach(url => this.trackingManager.trackUrl(url));
        
        this.context?.controller.emit('adclick', { clickUrl: this.currentAd.clickThroughUrl });
      }
    };
    container.addEventListener('click', onClick);
    this.cleanupClick = () => {
      container.removeEventListener('click', onClick);
    };
  }

  private handleAdComplete() {
    this.fireTrackingEvent('complete');

    if (this.currentAdBreak && this.currentAdBreak.ads && this.currentAdIndex < this.currentAdBreak.ads.length - 1) {
      this.currentAdIndex++;
      this.currentAd = this.currentAdBreak.ads[this.currentAdIndex] as VastAdvertisement;
      this.manager?.transitionTo(AdState.ENDED);
      if (!this.currentAd.linear) {
        if (this.manager && this.manager.isHtmlOverlayCreative(this.currentAd)) {
          this.manager.playHtmlOverlay(this.currentAd);
        }
      } else {
        this.playCurrentAdInPod();
      }
    } else {
      this.cleanupPlaybackResources();
      this.manager?.transitionTo(AdState.ENDED);
      this.manager?.endAdBreak();
    }
  }

  private handlePlaybackError(reason: string) {
    console.error(`[VastProvider] Playback error: ${reason}`);
    this.fireErrorTracking(400); // Playback error code VAST
    this.cleanupPlaybackResources();
    
    const err: AdError = {
      type: AdErrorType.UNKNOWN,
      code: 400,
      message: reason,
    };
    this.manager?.triggerAdError(err);
  }

  private cleanupPlaybackResources() {
    if (this.simidRuntime) {
      try {
        this.simidRuntime.destroyRuntime();
      } catch (_) { /* safety */ }
      this.simidRuntime = null;
    }

    if (this.cleanupListeners) {
      this.cleanupListeners();
      this.cleanupListeners = null;
    }
    if (this.cleanupClick) {
      this.cleanupClick();
      this.cleanupClick = null;
    }
    
    if (this.adVideoElement) {
      if (this.renderingStrategy === 'dedicated') {
        if (this.adVideoElement.parentNode) {
          this.adVideoElement.parentNode.removeChild(this.adVideoElement);
        }
      } else {
        this.adVideoElement.src = this.originalSource;
        this.adVideoElement.load();
      }
      this.adVideoElement = null;
    }
  }

  public skipAd(): void {
    this.fireTrackingEvent('skip');
    this.cleanupPlaybackResources();

    if (this.currentAdBreak && this.currentAdBreak.ads && this.currentAdIndex < this.currentAdBreak.ads.length - 1) {
      // More ads remain in this pod - advance to the next one instead of
      // ending the whole break (skipping ad 1 of 2 must not skip ad 2 too).
      this.currentAdIndex++;
      this.currentAd = this.currentAdBreak.ads[this.currentAdIndex] as VastAdvertisement;
      this.manager?.transitionTo(AdState.SKIPPING);
      if (!this.currentAd.linear) {
        if (this.manager && this.manager.isHtmlOverlayCreative(this.currentAd)) {
          this.manager.playHtmlOverlay(this.currentAd);
        }
      } else {
        this.playCurrentAdInPod();
      }
    } else {
      this.manager?.transitionTo(AdState.SKIPPING);
      this.manager?.endAdBreak();
    }
  }

  public onSourceLoaded(_source?: PlayerSource): void {
    this.reset();
  }

  public reset(): void {
    this.cleanupPlaybackResources();
    this.trackingManager.destroy();
    this.cache.clear();
    this.currentAd = null;
    this.currentAdBreak = null;
    this.currentAdIndex = 0;
    this.canSkipAd = false;
    this.impressionFired = false;
    this.milestones = {
      start: false,
      firstQuartile: false,
      midpoint: false,
      thirdQuartile: false,
      complete: false,
    };
  }

  public destroy(): void {
    this.reset();
    this.context = null;
    this.manager = null;
  }
}
