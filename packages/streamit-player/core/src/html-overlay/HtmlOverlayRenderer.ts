import { Advertisement, HtmlOverlayConfig } from '../types';
import { TrackingManager, TrackingDiagnostics, parseNonLinearVastXml } from '../providers/VastProvider';
import { resolveSafeSandbox } from '../utils';
import type { PlayerController } from '../PlayerController';

/** `Advertisement`'s fields are `readonly` (it's the public contract type),
 * but this renderer legitimately mutates its own private working copy
 * (`this.currentAd = { ...ad }` in loadAd()) in place after VAST resolution
 * / image-load measurement - this narrows just enough to allow that. */
type MutableAdvertisement = { -readonly [K in keyof Advertisement]: Advertisement[K] };

export type HtmlOverlayState =
  | 'idle'
  | 'loading'
  | 'rendered'
  | 'visible'
  | 'hidden'
  | 'destroyed';

export interface HtmlOverlayDiagnostics {
  readonly overlayActive: boolean;
  readonly overlayVisible: boolean;
  readonly renderMode: 'iframe' | 'string' | 'template' | 'image' | 'dom' | 'unknown';
  readonly renderDurationMs: number;
  readonly overlayLifetimeMs: number;
  readonly clickCount: number;
  readonly interactionCount: number;
  readonly trackingStatus: TrackingDiagnostics;
  readonly errors: string[];
}

/**
 * HtmlOverlayRenderer - Coordinates rendering of non-linear HTML overlay ads
 * above the playing video without interrupting content playback.
 */
export class HtmlOverlayRenderer {
  private state: HtmlOverlayState = 'idle';
  private trackingManager: TrackingManager;
  private containerElement: HTMLElement | null = null;
  private contentWrapper: HTMLDivElement | null = null;
  private iframeElement: HTMLIFrameElement | null = null;
  private currentAd: Advertisement | null = null;
  private destroyController = new AbortController();
  private resizeObserver: ResizeObserver | null = null;
  private firedEvents = new Set<string>();
  private durationTimer: ReturnType<typeof setTimeout> | null = null;
  private closeDelayTimer: ReturnType<typeof setTimeout> | null = null;

  // Layout Engine state
  private intrinsicWidth = 480;
  private intrinsicHeight = 70;

  // Diagnostics metrics
  private renderStartTime = 0;
  private renderDuration = 0;
  private creationTime = 0;
  private clickCount = 0;
  private interactionCount = 0;
  private errors: string[] = [];

  constructor(
    private readonly controller: PlayerController,
    private readonly adContainer: HTMLElement,
    trackingManager?: TrackingManager,
    private readonly isExternalSlot: boolean = false
  ) {
    this.trackingManager = trackingManager || new TrackingManager();
    this.creationTime = Date.now();
  }

  public getLifecycleState(): HtmlOverlayState {
    return this.state;
  }

  public getDiagnostics(): HtmlOverlayDiagnostics {
    return {
      overlayActive: this.state !== 'idle' && this.state !== 'destroyed',
      overlayVisible: this.state === 'visible',
      renderMode: this.getRenderMode(),
      renderDurationMs: this.renderDuration,
      overlayLifetimeMs: this.state !== 'destroyed' ? Date.now() - this.creationTime : 0,
      clickCount: this.clickCount,
      interactionCount: this.interactionCount,
      trackingStatus: this.trackingManager.getDiagnostics(),
      errors: [...this.errors],
    };
  }

  private getRenderMode(): 'iframe' | 'string' | 'template' | 'image' | 'dom' | 'unknown' {
    if (!this.currentAd) return 'unknown';
    if (this.currentAd.imageUrl) return 'image';
    if (this.currentAd.useIframe || this.currentAd.htmlUrl) return 'iframe';
    if (this.currentAd.htmlTemplateId) return 'template';
    if (this.currentAd.htmlContent) return 'string';
    return 'dom';
  }

  /**
   * Loads the HTML overlay ad, resolves VAST XML tags if provided as URL,
   * configures dynamic layout & sizing, but does not display it yet.
   */
  public async loadAd(ad: Advertisement): Promise<boolean> {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return false;
    }

    this.state = 'loading';
    this.currentAd = { ...ad };
    this.renderStartTime = Date.now();

    this.controller.emit('htmloverlayavailable', { adId: ad.id });

    try {
      // 1. Check if the ad URL points to a VAST XML response and resolve it first
      await this.resolveVastTagIfNecessary(this.currentAd);

      // 2. Determine intrinsic dimensions
      this.intrinsicWidth = this.currentAd.width || 480;
      this.intrinsicHeight = this.currentAd.height || 70;

      // 3. Create main container wrapper
      this.containerElement = document.createElement('div');
      this.containerElement.className = 'html-overlay-container';

      // Create content wrapper to catch clicks for click-through
      this.contentWrapper = document.createElement('div');
      this.contentWrapper.className = 'html-overlay-content';
      this.contentWrapper.style.width = '100%';
      this.contentWrapper.style.height = '100%';
      this.contentWrapper.style.position = 'relative';
      this.contentWrapper.style.overflow = 'hidden';
      this.contentWrapper.style.borderRadius = '4px';
      this.contentWrapper.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.4)';
      this.containerElement.appendChild(this.contentWrapper);

      // Append wrapper to ad container
      let targetSlot: HTMLElement | null = null;
      if (this.currentAd.externalSlot) {
        targetSlot = this.resolveTargetSlot(this.currentAd);
        if (!targetSlot) {
          throw new Error(`Target external slot "${this.currentAd.externalSlot}" not found in DOM.`);
        }
      } else {
        targetSlot = this.adContainer;
      }
      targetSlot.appendChild(this.containerElement);

      // 4. Setup rendering modes
      if (this.currentAd.imageUrl) {
        await this.renderImage(this.currentAd, this.contentWrapper);
      } else if (this.currentAd.useIframe || this.currentAd.htmlUrl) {
        await this.renderIframe(this.currentAd, this.contentWrapper);
      } else if (this.currentAd.htmlTemplateId) {
        this.renderTemplate(this.currentAd, this.contentWrapper);
      } else if (this.currentAd.htmlContent) {
        this.renderHtmlString(this.currentAd, this.contentWrapper);
      } else {
        throw new Error('Unsupported HTML overlay content type: missing content, template, url, or image');
      }

      // 5. Apply layout & position engine
      this.applyStylesAndPositioning(this.currentAd, this.containerElement);
      this.recalculateLayout();

      // 6. Setup Close Button
      this.setupCloseButton();

      // 7. Setup Click-Through and tracking
      this.setupInteractionHandlers();

      // 8. Setup Keyboard accessibility (Escape key to close)
      this.setupKeyboardAccessibility();

      // 9. Attach ResizeObserver for responsive adaptation
      if (typeof ResizeObserver !== 'undefined') {
        this.resizeObserver = new ResizeObserver(() => {
          this.recalculateLayout();
        });
        this.resizeObserver.observe(targetSlot);
      }

      this.renderDuration = Date.now() - this.renderStartTime;
      this.state = 'rendered';
      this.controller.emit('htmloverlayloaded', { adId: ad.id });
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Rendering overlay failed';
      this.handleError(message);
      return false;
    }
  }

  private resolveTargetSlot(ad: Advertisement): HTMLElement | null {
    if (!ad.externalSlot) return null;
    if (typeof ad.externalSlot !== 'string') return ad.externalSlot;
    if (typeof document === 'undefined') return null;
    return (document.querySelector(ad.externalSlot) as HTMLElement | null) ||
      (this.adContainer.shadowRoot?.querySelector(ad.externalSlot) as HTMLElement | null);
  }

  /**
   * Pre-resolves VAST XML if a VAST Tag URL - or raw inline VAST XML text -
   * was supplied in htmlUrl. Delegates the actual element extraction to
   * VastProvider's namespace/prefix-safe parser (parseNonLinearVastXml)
   * rather than a plain CSS querySelector walk, since ad-server VAST often
   * uses namespaced/prefixed tags (e.g. <vast:NonLinear>) that querySelector
   * on an XML document does not reliably match.
   */
  private async resolveVastTagIfNecessary(ad: Advertisement): Promise<void> {
    if (!ad.htmlUrl) return;

    const raw = ad.htmlUrl.trim();
    const isInlineXml = raw.startsWith('<');
    const isVastUrl = !isInlineXml && (raw.includes('output=vast') || raw.includes('gampad/ads') || raw.endsWith('.xml'));

    if (!isInlineXml && !isVastUrl) return;

    try {
      let xmlText: string;
      if (isInlineXml) {
        xmlText = raw;
      } else {
        const resp = await fetch(raw, { credentials: 'same-origin' });
        if (!resp.ok) return;
        xmlText = await resp.text();
      }
      if (!xmlText || !xmlText.includes('<VAST')) return;

      const parsed = parseNonLinearVastXml(xmlText);
      if (!parsed) return;

      const mutableAd = ad as MutableAdvertisement;
      if (parsed.imageUrl) {
        mutableAd.imageUrl = parsed.imageUrl;
        mutableAd.htmlUrl = undefined;
        mutableAd.useIframe = false;
      } else if (parsed.htmlUrl) {
        mutableAd.htmlUrl = parsed.htmlUrl;
        mutableAd.useIframe = true;
      } else if (parsed.htmlContent) {
        mutableAd.htmlContent = parsed.htmlContent;
        mutableAd.htmlUrl = undefined;
        mutableAd.useIframe = false;
      }

      if (parsed.width) mutableAd.width = parsed.width;
      if (parsed.height) mutableAd.height = parsed.height;
      if (parsed.clickThroughUrl && !mutableAd.clickThroughUrl) {
        mutableAd.clickThroughUrl = parsed.clickThroughUrl;
      }
      if (parsed.trackingUrls && parsed.trackingUrls.length > 0) {
        mutableAd.trackingUrls = [...(mutableAd.trackingUrls || []), ...parsed.trackingUrls];
      }
    } catch (e) {
      // If VAST parsing fails, fallback to original URL iframe rendering
    }
  }

  /**
   * Layout Engine: Recalculates exact bounding dimensions and safe offsets
   * relative to the player stage.
   */
  private recalculateLayout() {
    if (!this.containerElement || !this.adContainer || this.isExternalSlot) return;

    const stageWidth = this.adContainer.clientWidth || 640;
    const stageHeight = this.adContainer.clientHeight || 360;

    // Default canvas: generous on width (most overlay creatives - banners,
    // notification bars - span most of the player width), but modest on
    // height, and never edge-to-edge on either axis. 90% width read as a
    // full-bleed banner touching both edges of the frame with no visible
    // margin - 80% leaves a clear ~10% gutter on each side once centered.
    // 35% of stage height was the old default; since the canvas is now used
    // as the creative's actual box (not just a shrink-to-fit cap - see
    // below), that produced a large invisible-but-clickable dead zone below
    // typical banner-height content. 18% matches standard IAB banner
    // proportions far better. Developers with genuinely taller/wider
    // creatives (product cards, quizzes) opt in explicitly via
    // maxWidth/maxHeight or width/height.
    const customMaxW = this.currentAd?.maxWidth ? Math.min(stageWidth, this.currentAd.maxWidth) : stageWidth * 0.8;
    const customMaxH = this.currentAd?.maxHeight ? Math.min(stageHeight, this.currentAd.maxHeight) : stageHeight * 0.18;

    // HTML string/template creatives have no declared "intrinsic size" the
    // way an image does, but most of them (plain in-flow markup - divs,
    // text, buttons with no `position: absolute` on the root) CAN be
    // measured by the browser directly: CSS shrink-to-fit ('auto' width/
    // height) hugs real in-flow content exactly, in real px, with zero
    // guesswork - which is what "make it accurate, not a % guess" means in
    // practice. That only breaks for creatives whose *root* element is
    // itself `position: absolute` (out of flow), where shrink-to-fit
    // legitimately can't measure anything and collapses to 0x0. So: try
    // auto-fit first, capped to the max-bounds box; if the result actually
    // rendered (non-zero), keep it - that's the tight, content-accurate fit.
    // If it collapsed to ~0 (the absolute-positioning case), fall back to a
    // real, *stable* canvas sized to the max-bounds box and never resized
    // afterward (resizing after the fact was tried and rejected - it
    // invalidates any `bottom:20px`/`right:10px`/% positioning inside,
    // since those recompute against the new box size). iframe creatives
    // always use that same canvas fallback directly, since cross-origin/
    // sandboxed content can't be measured from outside at all (see
    // resolveSafeSandbox, which deliberately strips allow-same-origin for
    // same-origin URLs). Explicit width+height (e.g. a VAST NonLinear
    // creative with width/height attributes) always gets exact sizing via
    // the intrinsic-size path below instead.
    const mode = this.getRenderMode();
    const hasExplicitSize = !!this.currentAd?.width && !!this.currentAd?.height;

    const applyStableCanvas = () => {
      this.containerElement!.style.maxWidth = '';
      this.containerElement!.style.maxHeight = '';
      this.containerElement!.style.width = `${Math.round(customMaxW)}px`;
      this.containerElement!.style.height = `${Math.round(customMaxH)}px`;
    };

    if (mode === 'iframe' && !hasExplicitSize) {
      applyStableCanvas();
      return;
    }

    if ((mode === 'string' || mode === 'template') && !hasExplicitSize) {
      this.containerElement.style.width = 'auto';
      this.containerElement.style.height = 'auto';
      this.containerElement.style.maxWidth = `${Math.round(customMaxW)}px`;
      this.containerElement.style.maxHeight = `${Math.round(customMaxH)}px`;

      const rect = this.containerElement.getBoundingClientRect();
      if (rect.width < 4 || rect.height < 4) {
        // Shrink-to-fit collapsed - the creative's root is out-of-flow.
        applyStableCanvas();
      }
      return;
    }
    this.containerElement.style.maxWidth = '';
    this.containerElement.style.maxHeight = '';

    const intrinsicW = this.intrinsicWidth || 480;
    const intrinsicH = this.intrinsicHeight || 70;

    // Constrain max bounds
    const maxW = Math.min(customMaxW, intrinsicW);
    const maxH = Math.min(customMaxH, intrinsicH);

    // Compute uniform scale factor if responsive is enabled (default true)
    const isResponsive = this.currentAd?.responsive !== false;
    const scale = isResponsive ? Math.min(1, maxW / intrinsicW, maxH / intrinsicH) : 1;

    const finalW = Math.round(intrinsicW * scale);
    const finalH = Math.round(intrinsicH * scale);

    this.containerElement.style.width = `${finalW}px`;
    this.containerElement.style.height = `${finalH}px`;
  }

  /**
   * Displays the HTML overlay ad and fires impressions.
   */
  public show() {
    if (this.state === 'destroyed') return;
    if (this.containerElement) {
      this.containerElement.style.display = 'block';
      this.recalculateLayout();
    }
    this.state = 'visible';

    this.controller.emit('htmloverlayshown', { adId: this.currentAd?.id });

    // Fire impression & creativeView trackers exactly ONCE
    if (this.currentAd) {
      this.fireTrackingEvents('impression');
      this.fireTrackingEvents('creativeView');
      this.scheduleDurationTimer();
    }
  }

  /**
   * Hides the HTML overlay ad.
   */
  public hide() {
    if (this.state === 'destroyed') return;
    this.clearDurationTimer();
    if (this.containerElement) {
      this.containerElement.style.display = 'none';
    }
    this.state = 'hidden';
    this.controller.emit('htmloverlayhidden', { adId: this.currentAd?.id });
  }

  /**
   * Closes the HTML overlay ad.
   */
  public close() {
    if (this.state === 'destroyed') return;
    const adId = this.currentAd?.id;
    this.fireTrackingEvents('close');
    this.destroy();
    this.controller.emit('htmloverlayclosed', { adId });
  }

  /**
   * Dynamically updates positioning, sizing, or content of active overlay.
   */
  public updateOverlay(patch: Partial<HtmlOverlayConfig>): void {
    if (!this.currentAd || this.state === 'destroyed') return;
    this.currentAd = { ...this.currentAd, ...patch };

    if (patch.width !== undefined) this.intrinsicWidth = patch.width;
    if (patch.height !== undefined) this.intrinsicHeight = patch.height;

    if (this.containerElement) {
      this.applyStylesAndPositioning(this.currentAd, this.containerElement);
      this.recalculateLayout();
    }
    this.controller.emit('htmloverlayupdated', { adId: this.currentAd.id });
  }

  /**
   * Destroy and clean up DOM nodes, listeners, timers, and references.
   */
  public destroy() {
    if (this.state === 'destroyed') return;

    this.state = 'destroyed';
    this.clearDurationTimer();
    this.clearCloseDelayTimer();
    this.destroyController.abort();

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    if (this.iframeElement) {
      this.iframeElement.src = 'about:blank';
      this.iframeElement = null;
    }

    if (this.containerElement) {
      if (this.containerElement.parentNode) {
        this.containerElement.parentNode.removeChild(this.containerElement);
      }
      this.containerElement = null;
    }

    this.contentWrapper = null;
    this.currentAd = null;
    this.firedEvents.clear();
  }

  // --- Internal Helpers ---

  private scheduleDurationTimer() {
    this.clearDurationTimer();
    if (this.currentAd && this.currentAd.duration > 0) {
      this.durationTimer = setTimeout(() => {
        this.handleDurationComplete();
      }, this.currentAd.duration * 1000);
    }
  }

  private handleDurationComplete() {
    if (this.state === 'destroyed') return;
    this.fireTrackingEvents('complete');
    this.controller.emit('htmloverlaycompleted', { adId: this.currentAd?.id });
    this.close();
  }

  private clearDurationTimer() {
    if (this.durationTimer) {
      clearTimeout(this.durationTimer);
      this.durationTimer = null;
    }
  }

  private clearCloseDelayTimer() {
    if (this.closeDelayTimer) {
      clearTimeout(this.closeDelayTimer);
      this.closeDelayTimer = null;
    }
  }

  private renderImage(ad: Advertisement, wrapper: HTMLElement): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (!ad.imageUrl) {
        reject(new Error('Missing image URL for image rendering'));
        return;
      }

      const img = document.createElement('img');
      img.alt = ad.title || 'Advertisement';
      img.style.width = '100%';
      img.style.height = '100%';
      img.style.objectFit = 'contain';
      img.style.display = 'block';

      const loadTimeout = setTimeout(() => {
        reject(new Error('HTML overlay image creative load timeout'));
      }, 5000);

      img.onload = () => {
        clearTimeout(loadTimeout);
        const mutableAd = ad as MutableAdvertisement;
        if (!mutableAd.width && img.naturalWidth) mutableAd.width = img.naturalWidth;
        if (!mutableAd.height && img.naturalHeight) mutableAd.height = img.naturalHeight;
        this.intrinsicWidth = ad.width || img.naturalWidth || 480;
        this.intrinsicHeight = ad.height || img.naturalHeight || 70;
        resolve();
      };

      img.onerror = () => {
        clearTimeout(loadTimeout);
        reject(new Error('HTML overlay image creative failed to load'));
      };

      img.src = ad.imageUrl;
      wrapper.appendChild(img);
    });
  }

  private renderIframe(ad: Advertisement, wrapper: HTMLElement): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.iframeElement = document.createElement('iframe');
      const defaultSandbox = 'allow-scripts allow-popups allow-same-origin allow-forms';
      // allow-same-origin is dropped when it would resolve to the host page's own origin - always
      // true for srcdoc content, and possible for src-based creatives that are same-origin with the host.
      const requestedSandbox = ad.iframeSandbox || defaultSandbox;
      const safeSandbox = resolveSafeSandbox(requestedSandbox, {
        srcUrl: ad.htmlUrl || null,
        isSrcDoc: !ad.htmlUrl && !!ad.htmlContent,
      });
      this.iframeElement.setAttribute('sandbox', safeSandbox);
      this.iframeElement.setAttribute('referrerpolicy', 'no-referrer');
      this.iframeElement.setAttribute('scrolling', 'no');
      this.iframeElement.style.width = '100%';
      this.iframeElement.style.height = '100%';
      this.iframeElement.style.border = 'none';
      this.iframeElement.style.overflow = 'hidden';
      this.iframeElement.style.backgroundColor = 'transparent';

      if (ad.htmlUrl && ad.trustedOrigins && ad.trustedOrigins.length > 0) {
        try {
          const origin = new URL(ad.htmlUrl, window.location.href).origin;
          const hostname = new URL(origin).hostname;
          // Exact match only - a prior endsWith()/includes() check allowed
          // "evil-example.com" to satisfy a trusted "example.com" entry.
          // Bare hostnames (no scheme) are accepted for convenience and
          // compared against the hostname; full origins are compared as-is.
          const isTrusted = ad.trustedOrigins.some(t => t === '*' || t === origin || t === hostname);
          if (!isTrusted) {
            reject(new Error(`HTML overlay URL origin "${origin}" is not in trusted origins.`));
            return;
          }
        } catch (e) {
          // ignore parsing error
        }
      }

      const loadTimeout = setTimeout(() => {
        reject(new Error('HTML overlay iframe load timeout'));
      }, 8000);

      this.iframeElement.addEventListener('load', () => {
        clearTimeout(loadTimeout);
        resolve();
      }, { once: true });

      this.iframeElement.addEventListener('error', () => {
        clearTimeout(loadTimeout);
        reject(new Error('HTML overlay iframe load failed'));
      }, { once: true });

      if (ad.htmlUrl) {
        this.iframeElement.src = ad.htmlUrl;
      } else if (ad.htmlContent) {
        this.iframeElement.srcdoc = ad.htmlContent;
      } else {
        clearTimeout(loadTimeout);
        reject(new Error('HTML url or content is required for iframe rendering'));
        return;
      }

      wrapper.appendChild(this.iframeElement);
    });
  }

  private renderTemplate(ad: Advertisement, wrapper: HTMLElement) {
    if (!ad.htmlTemplateId) return;
    const template = document.getElementById(ad.htmlTemplateId) as HTMLTemplateElement | null;
    if (!template) {
      throw new Error(`Template element not found with ID: ${ad.htmlTemplateId}`);
    }
    const clone = document.importNode(template.content, true);
    wrapper.appendChild(clone);
  }

  private renderHtmlString(ad: Advertisement, wrapper: HTMLElement) {
    if (!ad.htmlContent) return;
    const container = document.createElement('div');
    container.style.width = '100%';
    container.style.height = '100%';
    if (ad.sanitizeHtml) {
      container.innerHTML = ad.sanitizeHtml(ad.htmlContent);
    } else {
      container.innerHTML = ad.htmlContent;
    }
    wrapper.appendChild(container);
  }

  private setupCloseButton() {
    if (!this.containerElement || !this.currentAd) return;

    const closeConfig = this.currentAd.closeButton;
    if (closeConfig === false) return; // Explicitly disabled close button

    const closeBtn = document.createElement('button');
    closeBtn.className = (typeof closeConfig === 'object' && closeConfig.className)
      ? `html-overlay-close-btn ${closeConfig.className}`
      : 'html-overlay-close-btn';

    const label = (typeof closeConfig === 'object' && closeConfig.label) ? closeConfig.label : 'Close Advertisement';
    closeBtn.setAttribute('aria-label', label);
    closeBtn.innerText = (typeof closeConfig === 'object' && closeConfig.label) ? closeConfig.label : '×';

    closeBtn.style.position = 'absolute';
    closeBtn.style.top = '-10px';
    closeBtn.style.right = '-10px';
    closeBtn.style.zIndex = '1006';
    closeBtn.style.cursor = 'pointer';
    closeBtn.style.background = 'rgba(0, 0, 0, 0.85)';
    closeBtn.style.color = '#ffffff';
    closeBtn.style.border = '2px solid rgba(255, 255, 255, 0.8)';
    closeBtn.style.borderRadius = '50%';
    closeBtn.style.width = '24px';
    closeBtn.style.height = '24px';
    closeBtn.style.fontSize = '14px';
    closeBtn.style.lineHeight = '20px';
    closeBtn.style.textAlign = 'center';
    closeBtn.style.padding = '0';
    closeBtn.style.boxShadow = '0 2px 6px rgba(0,0,0,0.5)';
    closeBtn.style.pointerEvents = 'auto';

    if (typeof closeConfig === 'object' && closeConfig.styleOverrides) {
      Object.entries(closeConfig.styleOverrides).forEach(([k, v]) => {
        (closeBtn.style as unknown as Record<string, string>)[k] = String(v);
      });
    }

    const delay = this.currentAd.closeDelay ?? (typeof closeConfig === 'object' ? closeConfig.delaySeconds : 0) ?? 0;
    if (delay > 0) {
      closeBtn.style.display = 'none';
      this.closeDelayTimer = setTimeout(() => {
        if (closeBtn && this.state !== 'destroyed') {
          closeBtn.style.display = 'block';
        }
      }, delay * 1000);
    }

    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.close();
    }, { signal: this.destroyController.signal });

    this.containerElement.appendChild(closeBtn);
  }

  private setupKeyboardAccessibility() {
    window.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Escape' && this.state === 'visible') {
        this.close();
      }
    }, { signal: this.destroyController.signal });
  }

  private setupInteractionHandlers() {
    if (!this.contentWrapper) return;

    // Hover detection tracking
    this.contentWrapper.addEventListener('mouseenter', () => {
      this.interactionCount++;
      this.fireTrackingEvents('creativeView');
    }, { signal: this.destroyController.signal });

    // Focus detection tracking
    this.contentWrapper.addEventListener('focusin', () => {
      this.interactionCount++;
    }, { signal: this.destroyController.signal });

    // Click-Through handling
    this.contentWrapper.addEventListener('click', () => {
      this.clickCount++;
      this.controller.emit('htmloverlayclick', { adId: this.currentAd?.id });
      this.fireTrackingEvents('click');

      if (this.currentAd?.clickThroughUrl) {
        try {
          window.open(this.currentAd.clickThroughUrl, '_blank', 'noopener,noreferrer');
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.errors.push(`Click-through navigation failed: ${message}`);
        }
      }
    }, { signal: this.destroyController.signal });
  }

  private applyStylesAndPositioning(ad: Advertisement, el: HTMLElement) {
    const isExternal = this.isExternalSlot || !!ad.externalSlot;
    if (isExternal) {
      el.style.position = 'relative';
      el.style.margin = '0 auto';
      if (!el.style.display) el.style.display = 'none';
      el.style.pointerEvents = ad.pointerEvents || 'auto';
      return;
    }

    // Reset previous position styles so switching position (e.g. bottom -> top) works cleanly
    el.style.top = '';
    el.style.bottom = '';
    el.style.left = '';
    el.style.right = '';
    el.style.transform = '';

    el.style.position = 'absolute';
    el.style.zIndex = String(ad.overlayStyle?.zIndex || ad.zIndex || '1002');
    el.style.overflow = 'visible'; // Allows close button at top-right (-10px) to render clearly
    el.style.opacity = String(ad.opacity !== undefined ? ad.opacity : 1);
    el.style.pointerEvents = ad.pointerEvents || 'auto';

    // Preserve existing display style if already visible ('block')
    if (!el.style.display) {
      el.style.display = 'none';
    }

    if (ad.margin) el.style.margin = ad.margin;
    if (ad.padding) el.style.padding = ad.padding;

    // Standard positions map
    const pos = ad.position || 'bottom';
    switch (pos) {
      case 'top':
        el.style.top = '10px';
        el.style.left = '50%';
        el.style.transform = 'translateX(-50%)';
        break;
      case 'left':
        el.style.left = '10px';
        el.style.top = '50%';
        el.style.transform = 'translateY(-50%)';
        break;
      case 'right':
        el.style.right = '10px';
        el.style.top = '50%';
        el.style.transform = 'translateY(-50%)';
        break;
      case 'center':
        el.style.top = '50%';
        el.style.left = '50%';
        el.style.transform = 'translate(-50%, -50%)';
        break;
      case 'bottom':
      default:
        el.style.bottom = 'var(--player-overlay-safe-bottom, calc(20px + 64px + 12px))';
        el.style.left = '50%';
        el.style.transform = 'translateX(-50%)';
        break;
    }

    // Custom inline styles mapping overrides
    if (ad.overlayStyle) {
      Object.entries(ad.overlayStyle).forEach(([k, v]) => {
        (el.style as unknown as Record<string, string>)[k] = String(v);
      });
    }
  }

  private fireTrackingEvents(eventName: string) {
    const normalized = eventName.toLowerCase();
    const singleEmitEvents = ['impression', 'creativeview', 'close', 'complete'];
    if (singleEmitEvents.includes(normalized)) {
      if (this.firedEvents.has(normalized)) return;
      this.firedEvents.add(normalized);
    }

    if (!this.currentAd || !this.currentAd.trackingUrls) return;
    const targets = this.currentAd.trackingUrls.filter(
      (t) => t.event && t.event.toLowerCase() === normalized
    );
    targets.forEach((t) => this.trackingManager.trackUrl(t.url));
  }

  private handleError(message: string) {
    this.errors.push(message);
    this.controller.emit('htmloverlayerror', { message });
    this.destroy();
  }
}
