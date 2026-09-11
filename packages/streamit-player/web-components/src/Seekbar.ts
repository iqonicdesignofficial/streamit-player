import { LitElement, html } from 'lit';
import { styles } from './Seekbar.styles';
import { property, state } from 'lit/decorators.js';
import { renderIcon } from './icons/IconRegistry';
import {
  ThumbnailInfo,
  ThumbnailProvider,
  TimelineMarker,
  Chapter,
  formatTime,
  TimelineMath,
} from '../../core/src/index';
import type { PlayerPlayer } from './Player';

export class PlayerSeekbar extends LitElement {
  @property({ type: Number }) currentTime = 0;
  @property({ type: Number }) duration = 0;
  @property({ type: Array }) bufferedRanges: Array<{ start: number; end: number }> = [];
  @property({ type: Boolean }) isSeeking = false;
  @property({ type: Boolean }) isLive: boolean | null = null;
  @property({ type: Object }) seekableRange?: { start: number; end: number };
  @property({ attribute: false }) thumbnailProvider?: ThumbnailProvider;
  @property({ attribute: false }) player?: PlayerPlayer;
  @property({ type: String }) currentSource = '';
  @property({ type: String, reflect: true }) variant: 'standard' | 'vertical' = 'standard';
  @property({ type: Array }) markers: TimelineMarker[] = [];
  @property({ type: Array }) visibleMarkerTypes: string[] | null = null;
  @property({ type: Array }) chapters: Chapter[] = [];
  @property({ type: Boolean }) canSeekInDvr = false;
  @property({ type: Boolean }) isAtLiveEdge = false;
  @property({ type: Boolean }) paused = false;
  @property({ type: Boolean }) hideCurrentTime = false;
  @property({ type: Boolean }) hideDuration = false;
  @property({ type: Boolean }) isAdPlaying = false;
  @property({ type: Object }) activeFilmstripThumbnail: ThumbnailInfo | null = null;

  @state() private frozenPercent: number | null = null;
  @state() private isDragging = false;
  @state() private dragTime = 0;
  @state() private isHovered = false;
  @state() private hoverTime = 0;
  @state() private isPreciseSeeking = false;
  @state() private tooltipLeft = 0;
  @state() private showRemaining = false;
  @state() private activeThumbnail: ThumbnailInfo | null = null;
  @state() private isThumbnailLoading = false;
  @state() private caretOffset = 0;
  @state() private activeMarker: TimelineMarker | null = null;
  @state() private activeMarkerLabel = '';
  @state() private frozenTimelineRange: {
    start: number;
    end: number;
    range: number;
    isInteractive: boolean;
  } | null = null;

  private latestThumbnailRequestId = 0;
  private lastSuccessfulThumbnail: ThumbnailInfo | null = null;
  private hoverThrottleTimer?: number;
  private pendingHoverClientX: number | null = null;
  private isPointerInside = false;
  private dragStartTrackTop = 0;
  private dragStartX = 0;
  private dragStartY = 0;
  private hasMoved = false;

  static styles = styles;

  private cachedHostRect: DOMRect | null = null;
  private cachedTrackRect: DOMRect | null = null;

  private getInteractiveRects() {
    if (!this.cachedHostRect || !this.cachedTrackRect) {
      this.cachedHostRect = this.getBoundingClientRect();
      const track = this.renderRoot?.querySelector('.track');
      if (track) {
        this.cachedTrackRect = track.getBoundingClientRect();
      }
    }
    return {
      hostRect: this.cachedHostRect,
      trackRect: this.cachedTrackRect,
    };
  }

  // Get active range of the timeline (VoD vs Live DVR)
  private getTimelineRange() {
    if (this.isAdPlaying) {
      return { start: 0, end: 0, range: 0, isInteractive: false };
    }
    if (this.isDragging && this.frozenTimelineRange) {
      return this.frozenTimelineRange;
    }
    if (this.isLive === null) {
      return { start: 0, end: 0, range: 0, isInteractive: false };
    }
    const isLive = this.isLive === true;
    if (isLive && !this.canSeekInDvr) {
      return { start: 0, end: 0, range: 0, isInteractive: false };
    }
    const start = isLive && this.seekableRange ? this.seekableRange.start : 0;
    const end = isLive && this.seekableRange ? this.seekableRange.end : this.duration;
    const range = end - start;
    const isInteractive = isLive
      ? Number.isFinite(range) && range >= 5.0
      : Number.isFinite(range) && range > 0;
    return { start, end, range: Number.isFinite(range) ? range : 0, isInteractive };
  }

  // Calculate percentage of buffer
  private getBufferedPercent(): number {
    if (this.isLive && (!this.canSeekInDvr || this.isAtLiveEdge)) return 100;
    const { start, end, range } = this.getTimelineRange();
    if (range <= 0 || !this.bufferedRanges.length) return 0;

    const current = this.isDragging ? this.dragTime : this.currentTime;
    let activeBufferedEnd = start;

    for (const r of this.bufferedRanges) {
      if (r.start <= current && r.end >= current) {
        activeBufferedEnd = r.end;
        break;
      }
    }

    if (activeBufferedEnd === start && this.bufferedRanges.length > 0) {
      activeBufferedEnd = this.bufferedRanges[0].end;
    }

    const clampedEnd = TimelineMath.clampToSeekable(activeBufferedEnd, start, end);
    return TimelineMath.timeToPercent(clampedEnd, start, end);
  }

  // Calculate value based on interaction coordinate
  private getTimeFromEvent(e: PointerEvent): number {
    const { start, end } = this.getTimelineRange();
    if (this.isLive && this.player?.controllerInstance?.isLiveDraggingEnabled() === false) {
      return end;
    }
    const { trackRect } = this.getInteractiveRects();
    if (!trackRect) return 0;
    const rect = trackRect;
    const percentage = (e.clientX - rect.left) / rect.width;
    const clampedPercentage = Math.max(0, Math.min(percentage, 1));
    if (clampedPercentage <= 0.005) {
      return start;
    }
    if (clampedPercentage >= 0.995) {
      return end;
    }

    return TimelineMath.percentToTime(clampedPercentage * 100, start, end);
  }

  private computeActiveMarker(time: number) {
    if (this.isLive && !this.canSeekInDvr) {
      this.activeMarker = null;
      this.activeMarkerLabel = '';
      return;
    }
    const { start, end, range } = this.getTimelineRange();
    const hoverThreshold = Math.max(1.5, range * 0.015);

    const isChaptersEnabled = this.player?.controllerInstance?.shouldSnapToChapters() !== false;
    const isMarkersEnabled = this.player?.controllerInstance?.shouldSnapToMarkers() !== false;

    const visibleMarkers = isMarkersEnabled && this.markers
      ? this.markers.filter((m) => TimelineMath.isMarkerVisible(m.time, start, end))
      : [];

    const nearestMarker = isMarkersEnabled
      ? TimelineMath.findNearestMarker(
        time,
        visibleMarkers,
        this.visibleMarkerTypes,
        hoverThreshold
      )
      : null;

    const nearestChapter = isChaptersEnabled
      ? TimelineMath.findNearestChapterBoundary(
        time,
        this.chapters || [],
        hoverThreshold
      )
      : null;

    let finalNearest: TimelineMarker | null = null;
    let minDiff = Infinity;

    if (nearestMarker) {
      minDiff = Math.abs(nearestMarker.time - time);
      finalNearest = nearestMarker;
    }

    if (nearestChapter) {
      const chDiff = Math.abs(nearestChapter.startTime - time);
      if (chDiff < minDiff) {
        minDiff = chDiff;
        finalNearest = {
          id: `chapter-${nearestChapter.id ?? nearestChapter.startTime}`,
          time: nearestChapter.startTime,
          label: nearestChapter.title || '',
          type: 'chapter',
        };
      }
    }

    const previousActive = this.activeMarker;
    this.activeMarker = finalNearest;
    this.activeMarkerLabel = finalNearest ? finalNearest.label : '';

    if (
      this.activeMarker !== previousActive &&
      this.activeMarker &&
      this.activeMarker.type !== 'chapter'
    ) {
      this.dispatchEvent(
        new CustomEvent('player-marker-hover', {
          detail: {
            marker: this.activeMarker,
            type: this.activeMarker.type,
            time: this.activeMarker.time,
            label: this.activeMarker.label,
          },
          bubbles: true,
          composed: true,
        })
      );
    }
  }

  // Unified Pointer Drag Handlers
  private handlePointerDown(e: PointerEvent) {
    const { isInteractive } = this.getTimelineRange();
    if (!isInteractive) return;

    e.preventDefault();
    try {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } catch (err) {
      /* ignore */
    }
    this.isDragging = true;
    this.frozenTimelineRange = this.getTimelineRange();
    this.dragTime = this.getTimeFromEvent(e);
    this.hoverTime = this.dragTime;

    this.dragStartX = e.clientX;
    this.dragStartY = e.clientY;
    this.hasMoved = false;

    this.computeTooltipPosition(e.clientX);
    this.computeActiveMarker(this.dragTime);
    this.updateTooltipPosition(e.clientX);

    const { trackRect } = this.getInteractiveRects();
    if (trackRect) {
      this.dragStartTrackTop = trackRect.top;
    }

    window.addEventListener('pointermove', this.handlePointerMove);
    window.addEventListener('pointerup', this.handlePointerUp);
    window.addEventListener('pointercancel', this.handlePointerUp);
  }

  private handlePointerMove = (e: PointerEvent) => {
    if (!this.isDragging) return;

    if (!this.hasMoved) {
      const moveThreshold = 5;
      if (
        Math.abs(e.clientX - this.dragStartX) > moveThreshold ||
        Math.abs(e.clientY - this.dragStartY) > moveThreshold
      ) {
        this.hasMoved = true;
        this.dispatchSeek(this.dragTime, false);
      }
    }

    // Smoothly update visual tooltip position on every frame
    this.lastClientX = e.clientX;
    this.computeTooltipPosition(e.clientX);

    const time = this.getTimeFromEvent(e);
    this.dragTime = time;
    this.hoverTime = time;
    this.computeActiveMarker(time);

    this.pendingHoverClientX = e.clientX;
    if (!this.hoverThrottleTimer) {
      this.hoverThrottleTimer = window.setTimeout(() => {
        this.hoverThrottleTimer = undefined;
        if (this.pendingHoverClientX !== null) {
          this.updateTooltipPosition(this.pendingHoverClientX);
          this.pendingHoverClientX = null;
        }
      }, 60);
    }

    if (
      this.player?.controllerInstance?.isPreciseSeekEnabled() !== false &&
      this.variant !== 'vertical' &&
      (!this.isLive || (this.isLive && this.canSeekInDvr))
    ) {
      const verticalDistance = this.dragStartTrackTop - e.clientY;
      const isUpward = verticalDistance > 40;

      if (isUpward && !this.isPreciseSeeking) {
        this.isPreciseSeeking = true;
        this.dispatchEvent(
          new CustomEvent('player-precise-seek-change', {
            detail: { isPreciseSeeking: true },
            bubbles: true,
            composed: true,
          })
        );
      } else if (!isUpward && this.isPreciseSeeking && verticalDistance < 20) {
        this.isPreciseSeeking = false;
        this.dispatchEvent(
          new CustomEvent('player-precise-seek-change', {
            detail: { isPreciseSeeking: false },
            bubbles: true,
            composed: true,
          })
        );
      }
    }

    if (this.hasMoved) {
      this.dispatchSeek(time, false);
    }
  };

  private handlePointerUp = (e: PointerEvent) => {
    if (!this.isDragging) return;
    this.isDragging = false;
    this.frozenTimelineRange = null;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch (err) {
      /* ignore */
    }
    let finalTime = this.getTimeFromEvent(e);
    const { trackRect } = this.getInteractiveRects();
    let isExtremeBoundary = false;
    if (trackRect) {
      const percentage = (e.clientX - trackRect.left) / trackRect.width;
      isExtremeBoundary = percentage <= 0.005 || percentage >= 0.995;
    }
    const shouldSnap = (marker: TimelineMarker) => {
      if (this.player?.controllerInstance?.isPreciseSeekEnabled() === false) return false;
      if (marker.type === 'chapter') {
        return this.player?.controllerInstance?.shouldSnapToChapters() !== false;
      }
      return this.player?.controllerInstance?.shouldSnapToMarkers() !== false;
    };
    if (!isExtremeBoundary && this.activeMarker && shouldSnap(this.activeMarker)) {
      finalTime = this.activeMarker.time;
    }
    this.dispatchSeek(finalTime, true);
    this.cleanupDrag();
    this.hasMoved = false;

    if (this.isPreciseSeeking) {
      this.isPreciseSeeking = false;
      this.dispatchEvent(
        new CustomEvent('player-precise-seek-change', {
          detail: { isPreciseSeeking: false },
          bubbles: true,
          composed: true,
        })
      );
    }

    if (!this.isPointerInside || e.pointerType === 'touch') {
      this.isHovered = false;
      this.activeThumbnail = null;
      this.lastSuccessfulThumbnail = null;
      this.activeMarkerLabel = '';
      this.isThumbnailLoading = false;
      if (this.hoverThrottleTimer) {
        clearTimeout(this.hoverThrottleTimer);
        this.hoverThrottleTimer = undefined;
      }
      this.pendingHoverClientX = null;
      this.isPointerInside = false;
    }
  };

  private cleanupDrag() {
    this.cachedHostRect = null;
    this.cachedTrackRect = null;
    if (typeof window !== 'undefined') {
      window.removeEventListener('pointermove', this.handlePointerMove);
      window.removeEventListener('pointerup', this.handlePointerUp);
      window.removeEventListener('pointercancel', this.handlePointerUp);
    }
  }

  private dispatchSeek(time: number, isFinal: boolean) {
    this.dispatchEvent(
      new CustomEvent('player-seek', {
        detail: { time, isFinal },
        bubbles: true,
        composed: true,
      })
    );
  }

  private handlePointerEnter() {
    const { isInteractive } = this.getTimelineRange();
    if (!isInteractive) return;
    this.isHovered = true;
    this.isPointerInside = true;
  }

  private handlePointerLeave() {
    this.isPointerInside = false;
    this.cachedHostRect = null;
    this.cachedTrackRect = null;
    if (this.isDragging) return;
    this.isHovered = false;
    this.clearThumbnailHoverState();
  }

  /**
   * Resets thumbnail/tooltip hover state. Must run any time isHovered
   * transitions to false - not just from handlePointerLeave, but also from
   * the .time-display's own mouseenter handler below, which sets isHovered
   * false directly without going through a real pointerleave. Without this
   * shared cleanup, a thumbnail request already in flight when that happens
   * has nothing left to reset isThumbnailLoading - its own resolution guard
   * requires isHovered, which is now false - so it would otherwise get
   * stuck true forever with no further hover event left to fix it.
   */
  private clearThumbnailHoverState() {
    this.activeThumbnail = null;
    this.lastSuccessfulThumbnail = null;
    this.activeMarkerLabel = '';
    this.isThumbnailLoading = false;
    if (this.hoverThrottleTimer) {
      clearTimeout(this.hoverThrottleTimer);
      this.hoverThrottleTimer = undefined;
    }
    this.pendingHoverClientX = null;
  }

  private handleHoverPointerMove(e: PointerEvent) {
    if (this.isDragging) return;

    // Smoothly update visual tooltip position on every frame
    this.lastClientX = e.clientX;
    this.computeTooltipPosition(e.clientX);

    const { isInteractive } = this.getTimelineRange();
    if (isInteractive) {
      // Only update hoverTime when the timeline is interactive.
      // Prevents DASH live race conditions where canSeekInDvr briefly
      // flickers false during DVR window updates, resetting hoverTime to 0.
      const time = this.getTimeFromEvent(e);
      this.hoverTime = time;
      this.computeActiveMarker(time);
    }

    this.pendingHoverClientX = e.clientX;
    if (!this.hoverThrottleTimer) {
      this.hoverThrottleTimer = window.setTimeout(() => {
        this.hoverThrottleTimer = undefined;
        if (this.pendingHoverClientX !== null) {
          this.updateTooltipPosition(this.pendingHoverClientX);
          this.pendingHoverClientX = null;
        }
      }, 60);
    }
  }

  private lastClientX = 0;

  private computeTooltipPosition(clientX: number) {
    const { hostRect, trackRect } = this.getInteractiveRects();
    if (!trackRect || !hostRect) return;

    const percentage = (clientX - trackRect.left) / trackRect.width;
    const clampedPercentage = Math.max(0, Math.min(percentage, 1));

    const { isInteractive } = this.getTimelineRange();
    if (!isInteractive) {
      return;
    }

    // Calculate tooltip center position in host coordinates
    const tooltipCenterInHost =
      trackRect.left - hostRect.left + clampedPercentage * trackRect.width;

    // Measure tooltip width dynamically 
    const tooltipEl = this.renderRoot?.querySelector('.hover-tooltip') as HTMLElement;
    let tooltipWidth = 0;
    if (tooltipEl) {
      if (tooltipEl.offsetWidth > 0) {
        tooltipWidth = tooltipEl.offsetWidth;
      } else {
        const rect = tooltipEl.getBoundingClientRect();
        if (rect.width > 0) {
          tooltipWidth = rect.width;
        }
      }
    }
    const hasThumb = !!this.activeThumbnail || this.isThumbnailLoading;
    if (tooltipWidth === 0) {
      const baseWidth = hasThumb ? (this.variant === 'vertical' ? 94 : 204) : 50;
      tooltipWidth = window.innerWidth <= 480 ? baseWidth * 0.85 : baseWidth;
    }
    const halfTooltipWidth = tooltipWidth / 2;

    // Find the enclosing player or root container to allow the tooltip to extend
    // up to the edge of the player container rather than being restricted by the inner seekbar host wrapper.
    let containerEl: HTMLElement | null = (this.player as unknown as HTMLElement) || null;
    if (!containerEl) {
      const rootNode = this.getRootNode();
      if (rootNode instanceof ShadowRoot && rootNode.host) {
        containerEl = rootNode.host as HTMLElement;
      }
    }
    if (!containerEl) {
      containerEl = (this.parentElement || this.offsetParent) as HTMLElement | null;
    }

    let minHostX = 0;
    let maxHostX = hostRect.width;

    if (containerEl) {
      const containerRect = containerEl.getBoundingClientRect();
      if (containerRect.width > 0) {
        minHostX = Math.min(0, containerRect.left - hostRect.left);
        maxHostX = Math.max(hostRect.width, containerRect.right - hostRect.left);
      }
    }

    // Keep within window viewport boundaries
    if (typeof window !== 'undefined') {
      const viewportMinX = -hostRect.left;
      const viewportMaxX = window.innerWidth - hostRect.left;
      minHostX = Math.max(minHostX, viewportMinX);
      maxHostX = Math.min(maxHostX, viewportMaxX);
    }

    const edgePadding = 3;
    const minTooltipLeft = minHostX + halfTooltipWidth + edgePadding;
    const maxTooltipLeft = maxHostX - halfTooltipWidth - edgePadding;

    // Clamp tooltip position to container bounds
    this.tooltipLeft = Math.max(
      minTooltipLeft,
      Math.min(tooltipCenterInHost, maxTooltipLeft)
    );

    // Calculate caret offset relative to tooltip center:
    // Caret offset is the offset from the tooltip box center (this.tooltipLeft) to the seek target position (tooltipCenterInHost).
    // Clamp offset to ensure the caret arrow stays attached to the flat bottom edge of the tooltip container
    // and doesn't drift into the rounded corner air gaps (border-radius: 12px for thumbnails, 4px for plain text).
    const offset = tooltipCenterInHost - this.tooltipLeft;
    const borderRadius = hasThumb ? 12 : 4;
    const arrowSize = 6;
    const minCaretMargin = borderRadius + Math.ceil(arrowSize / 2);
    const maxOffset = Math.max(0, halfTooltipWidth - minCaretMargin);
    this.caretOffset = Math.max(-maxOffset, Math.min(offset, maxOffset));
  }

  updated(changedProperties: Map<string | number | symbol, unknown>) {
    super.updated(changedProperties);
    if (changedProperties.has('activeFilmstripThumbnail')) {
      if (this.isPreciseSeeking && this.activeFilmstripThumbnail !== undefined) {
        if (this.activeFilmstripThumbnail) {
          this.activeThumbnail = this.activeFilmstripThumbnail;
          this.lastSuccessfulThumbnail = this.activeFilmstripThumbnail;
          this.isThumbnailLoading = false;
        } else {
          this.activeThumbnail = this.lastSuccessfulThumbnail || null;
          this.isThumbnailLoading = !this.lastSuccessfulThumbnail;
        }
      }
    }

    if (
      changedProperties.has('activeThumbnail') ||
      changedProperties.has('isHovered') ||
      changedProperties.has('isThumbnailLoading')
    ) {
      if (this.isHovered || this.isDragging) {
        this.computeTooltipPosition(this.lastClientX);
      }
    }

    if (changedProperties.has('seekableRange') || changedProperties.has('duration')) {
      if (this.isHovered || this.isDragging) {
        const { trackRect } = this.getInteractiveRects();
        if (trackRect) {
          const percentage = (this.lastClientX - trackRect.left) / trackRect.width;
          const clampedPercentage = Math.max(0, Math.min(percentage, 1));
          const { start, end, isInteractive } = this.getTimelineRange();
          if (isInteractive) {
            const time = TimelineMath.percentToTime(clampedPercentage * 100, start, end);
            this.hoverTime = time;
            if (this.isDragging) {
              this.dragTime = time;
              this.dispatchSeek(time, false);
            }
            this.computeActiveMarker(time);
            this.updateTooltipPosition(this.lastClientX);
          }
        }
      }
    }

    if (changedProperties.has('thumbnailProvider') || changedProperties.has('currentSource')) {
      const hasThumbnails =
        this.thumbnailProvider &&
        !(
          typeof this.thumbnailProvider.isUnavailable === 'function' &&
          this.thumbnailProvider.isUnavailable()
        );
      if (!hasThumbnails && this.isPreciseSeeking) {
        this.isPreciseSeeking = false;
        this.dispatchEvent(
          new CustomEvent('player-precise-seek-change', {
            detail: { isPreciseSeeking: false },
            bubbles: true,
            composed: true,
          })
        );
      }
    }

    const { start, end } = this.getTimelineRange();
    const displayTime = this.isDragging ? this.dragTime : this.currentTime;
    const forceHours = this.isLive ? (end - start) >= 3600 : end >= 3600;

    this.setAttribute('role', 'slider');
    this.setAttribute('aria-valuemin', Math.round(start).toString());
    this.setAttribute('aria-valuemax', Math.round(end).toString());
    this.setAttribute('aria-valuenow', Math.round(displayTime).toString());
    this.setAttribute('aria-valuetext', formatTime(displayTime, forceHours));
  }

  private async updateTooltipPosition(clientX: number) {
    this.lastClientX = clientX;
    const { trackRect } = this.getInteractiveRects();
    if (!trackRect) return;

    // Percentage relative to track
    const percentage = (clientX - trackRect.left) / trackRect.width;
    const clampedPercentage = Math.max(0, Math.min(percentage, 1));

    const { start, end, range, isInteractive } = this.getTimelineRange();
    if (!isInteractive) {
      this.activeThumbnail = null;
      return;
    }

    let calculatedTime = TimelineMath.percentToTime(clampedPercentage * 100, start, end);
    this.hoverTime = calculatedTime;

    if (this.isDragging) {
      this.dragTime = calculatedTime;
    }

    // Run first layout calculation
    this.computeTooltipPosition(clientX);

    // Find nearest marker for label tooltip and snapping
    this.computeActiveMarker(calculatedTime);
    const isExtremeBoundary = clampedPercentage <= 0.005 || clampedPercentage >= 0.995;
    const shouldSnap = (marker: TimelineMarker) => {
      if (this.player?.controllerInstance?.isPreciseSeekEnabled() === false) return false;
      if (marker.type === 'chapter') {
        return this.player?.controllerInstance?.shouldSnapToChapters() !== false;
      }
      return this.player?.controllerInstance?.shouldSnapToMarkers() !== false;
    };
    if (!isExtremeBoundary && this.activeMarker && shouldSnap(this.activeMarker)) {
      calculatedTime = this.activeMarker.time;
      this.hoverTime = calculatedTime; // visually snap to marker time
    }

    // Resolve thumbnail info if provider is present and available
    const isSmartSeekDisabled = this.player?.controllerInstance?.isSmartSeekEnabled() === false;
    const smartSeekConf = this.player?.config?.smartSeek;
    const isThumbnailsDisabled = isSmartSeekDisabled || (smartSeekConf && typeof smartSeekConf === 'object' && smartSeekConf.thumbnails === false);
    const isStoryboardDisabled = isSmartSeekDisabled || (smartSeekConf && typeof smartSeekConf === 'object' && smartSeekConf.storyboard === false);

    const isProviderUnavailable =
      isThumbnailsDisabled ||
      isStoryboardDisabled ||
      (this.thumbnailProvider &&
        typeof this.thumbnailProvider.isUnavailable === 'function' &&
        this.thumbnailProvider.isUnavailable());

    // Bail out without touching thumbnail state if we're no longer actually
    // hovering/dragging by the time this (possibly throttled/queued) call
    // runs - e.g. a pointermove that was in flight when a pointerleave fired
    // during fast pointer movement across the thin seekbar track. Without
    // this guard, setting isThumbnailLoading below could get stuck true
    // forever: the async resolution below only clears it when this same
    // (isHovered || isDragging) condition holds, and once the pointer has
    // genuinely left, nothing else will ever re-trigger a fresh check.
    if (!this.isHovered && !this.isDragging) {
      return;
    }

    if (this.thumbnailProvider && !isProviderUnavailable) {
      if (this.isPreciseSeeking) {
        const roundedTime = Math.round(calculatedTime);
        let thumb = this.activeFilmstripThumbnail || null;
        if (!thumb && typeof this.thumbnailProvider.getNearestCachedThumbnail === 'function') {
          const nearest = this.thumbnailProvider.getNearestCachedThumbnail(roundedTime);
          if (nearest && nearest.time !== undefined && Math.abs(nearest.time - roundedTime) <= 5) {
            thumb = nearest;
          }
        }
        if (thumb) {
          this.activeThumbnail = thumb;
          this.lastSuccessfulThumbnail = thumb;
          this.isThumbnailLoading = false;
        } else {
          this.activeThumbnail = null;
          this.isThumbnailLoading = true;
        }
        return;
      }
      const requestId = ++this.latestThumbnailRequestId;
      try {
        const syncResult = this.thumbnailProvider.getThumbnail(calculatedTime);
        if (syncResult instanceof Promise) {
          // Cache miss: fetch asynchronously. Try to find a nearby cached thumbnail first.
          let nearbyThumb: ThumbnailInfo | null = null;
          if (typeof this.thumbnailProvider.getNearestCachedThumbnail === 'function') {
            const nearest = this.thumbnailProvider.getNearestCachedThumbnail(calculatedTime);
            if (nearest && nearest.time !== undefined) {
              const distance = Math.abs(nearest.time - calculatedTime);
              const threshold = Math.max(15, range * 0.05); // 15 seconds or 5% of duration
              if (distance <= threshold) {
                nearbyThumb = nearest;
              }
            }
          }

          // Show nearby thumbnail instantly, or keep showing active to prevent flickering.
          if (nearbyThumb) {
            this.activeThumbnail = nearbyThumb;
          } else if (this.activeThumbnail && this.activeThumbnail.time !== undefined) {
            const dist = Math.abs(this.activeThumbnail.time - calculatedTime);
            const maxDiff = Math.max(15, range * 0.05);
            if (dist > maxDiff) {
              this.activeThumbnail = null;
            }
          } else {
            this.activeThumbnail = this.lastSuccessfulThumbnail || null;
            if (this.activeThumbnail && this.activeThumbnail.time !== undefined) {
              const dist = Math.abs(this.activeThumbnail.time - calculatedTime);
              const maxDiff = Math.max(15, range * 0.05);
              if (dist > maxDiff) {
                this.activeThumbnail = null;
              }
            }
          }

          this.isThumbnailLoading = true;

          const thumb = await syncResult.catch((err) => {
            console.debug('[Seekbar] Exception caught during thumbnail fetch (async):', err);
            return null;
          });
          // Guard against out-of-order resolution
          if (requestId === this.latestThumbnailRequestId && (this.isHovered || this.isDragging)) {
            if (thumb) {
              this.activeThumbnail = thumb;
              this.lastSuccessfulThumbnail = thumb;
            } else {
              // Keep showing the last successful thumbnail to prevent visual collapse on slow seeks
              this.activeThumbnail = this.lastSuccessfulThumbnail || null;
            }
            this.isThumbnailLoading = false;
          }
        } else {
          // Cache hit! Update instantly.
          if (requestId === this.latestThumbnailRequestId) {
            this.activeThumbnail = syncResult;
            if (syncResult) {
              this.lastSuccessfulThumbnail = syncResult;
            }
            this.isThumbnailLoading = false;
          }
        }
      } catch (err) {
        console.debug('[Seekbar] Exception caught during thumbnail fetch:', err);
        if (requestId === this.latestThumbnailRequestId) {
          this.activeThumbnail = null;
          this.isThumbnailLoading = false;
        }
      }
    } else {
      this.activeThumbnail = null;
      this.isThumbnailLoading = false;
    }
  }

  private handleTimeClick(e: MouseEvent) {
    e.stopPropagation();
    if (this.hideCurrentTime || this.hideDuration) return;
    this.showRemaining = !this.showRemaining;
  }

  // Keyboard accessibility handler
  private handleKeyDown = (e: KeyboardEvent) => {
    const { start, end, isInteractive } = this.getTimelineRange();
    if (!isInteractive) return;

    const step = 5;
    const bigStep = 30;

    let targetTime = this.isDragging ? this.dragTime : this.currentTime;
    let handled = false;

    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        targetTime = Math.min(end, targetTime + step);
        handled = true;
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
        targetTime = Math.max(start, targetTime - step);
        handled = true;
        break;
      case 'PageUp':
        targetTime = Math.min(end, targetTime + bigStep);
        handled = true;
        break;
      case 'PageDown':
        targetTime = Math.max(start, targetTime - bigStep);
        handled = true;
        break;
      case 'Home':
        targetTime = start;
        handled = true;
        break;
      case 'End':
        targetTime = end;
        handled = true;
        break;
    }

    if (handled) {
      e.preventDefault();
      e.stopPropagation();

      if (this.isDragging) {
        this.dragTime = targetTime;
        this.dispatchSeek(targetTime, false);
      } else {
        this.dispatchSeek(targetTime, true);
      }
    }
  };

  private handleWindowResize = () => {
    this.cachedHostRect = null;
    this.cachedTrackRect = null;
  };

  connectedCallback() {
    super.connectedCallback();
    this.setAttribute('tabindex', '0');
    this.setAttribute('role', 'slider');
    this.setAttribute('aria-label', 'Seek timeline progress');
    this.addEventListener('keydown', this.handleKeyDown);
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', this.handleWindowResize);
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener('keydown', this.handleKeyDown);
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', this.handleWindowResize);
    }
    this.cleanupDrag();
    if (this.hoverThrottleTimer) {
      clearTimeout(this.hoverThrottleTimer);
      this.hoverThrottleTimer = undefined;
    }
    this.cachedHostRect = null;
    this.cachedTrackRect = null;
  }

  willUpdate(changedProperties: Map<string | number | symbol, unknown>) {
    super.willUpdate(changedProperties);

    if (changedProperties.has('paused')) {
      if (this.paused) {
        const { start, range } = this.getTimelineRange();
        if (range > 0) {
          this.frozenPercent = ((this.currentTime - start) / range) * 100;
        } else {
          // range isn't resolvable yet - either a genuinely live stream with
          // no seekable window (paused at the live edge, so "full" is the
          // right default), or a VOD source whose duration just hasn't
          // loaded yet. Only the former should default to 100; defaulting a
          // still-loading VOD video to 100 here made the seekbar render as
          // fully played on a fresh load until duration/currentTime updates
          // arrived and overwrote it - visually "stuck at the end" instead
          // of showing the actual (near-zero) position.
          this.frozenPercent = this.isLive ? 100 : 0;
        }
      } else {
        this.frozenPercent = null;
      }
    }

    if (
      this.paused &&
      (changedProperties.has('currentTime') || changedProperties.has('seekableRange'))
    ) {
      const { start, range } = this.getTimelineRange();
      if (this.currentTime < start) {
        this.frozenPercent = 0;
      } else if (changedProperties.has('currentTime') && range > 0) {
        this.frozenPercent = ((this.currentTime - start) / range) * 100;
      }
    }

    if (changedProperties.has('thumbnailProvider') || changedProperties.has('currentSource')) {
      this.lastSuccessfulThumbnail = null;
      this.activeThumbnail = null;
      this.isThumbnailLoading = false;
    }

    const { start, end, isInteractive } = this.getTimelineRange();
    this.setAttribute('aria-valuemin', Math.round(start).toString());
    this.setAttribute('aria-valuemax', Math.round(end).toString());

    const displayTime = this.isDragging ? this.dragTime : this.currentTime;
    this.setAttribute('aria-valuenow', Math.round(displayTime).toString());
    this.setAttribute('aria-valuetext', formatTime(displayTime, end >= 3600));

    if (isInteractive) {
      this.removeAttribute('aria-disabled');
    } else {
      this.setAttribute('aria-disabled', 'true');
    }
  }

  private handleMarkerClick(e: MouseEvent, marker: TimelineMarker) {
    if (this.isLive && !this.canSeekInDvr) {
      return;
    }
    e.stopPropagation();
    e.preventDefault();
    this.dispatchSeek(marker.time, true);
    this.dispatchEvent(
      new CustomEvent('player-marker-click', {
        detail: {
          marker,
          type: marker.type,
          time: marker.time,
          label: marker.label,
          originalEvent: e,
        },
        bubbles: true,
        composed: true,
      })
    );
  }

  render() {
    const { start, end, range, isInteractive } = this.getTimelineRange();
    const liveText = this.player ? this.player.localize('live', 'LIVE') : 'LIVE';
    const preciseSeekingText = this.player ? this.player.localize('preciseSeeking', 'Precise seeking') : 'Precise seeking';
    const pullUpText = this.player ? this.player.localize('pullUpForPreciseSeeking', 'Pull up for precise seeking') : 'Pull up for precise seeking';
    const isMarkersEnabled = this.player?.controllerInstance?.isMarkersEnabled() !== false;
    const smartSeekConf = this.player?.config?.smartSeek;
    const isHoverTimeEnabled =
      this.player?.controllerInstance?.isSmartSeekEnabled() !== false &&
      (smartSeekConf === undefined || typeof smartSeekConf !== 'object' || smartSeekConf.hoverTime !== false);
    const visibleMarkers =
      isMarkersEnabled && !(this.isLive && !this.canSeekInDvr) && this.markers
        ? this.markers.filter((m) => {
          const isTypeVisible =
            !this.visibleMarkerTypes || this.visibleMarkerTypes.includes(m.type);
          const isWithinRange = m.time >= start && m.time <= end;
          return isTypeVisible && isWithinRange;
        })
        : [];

    const isInterpolate = this.player?.controllerInstance?.isSmoothDraggingEnabled() !== false;
    const dragTransitionStyle = isInterpolate ? 'transition: width 0.05s ease-out;' : '';
    const handleTransitionStyle = isInterpolate ? 'transition: left 0.05s ease-out;' : '';

    const displayTime = this.isDragging ? this.dragTime : this.currentTime;

    const progressPercent =
      this.isLive && (!this.canSeekInDvr || this.isAtLiveEdge)
        ? 100
        : this.paused && this.frozenPercent !== null && !this.isDragging
          ? this.frozenPercent
          : range > 0
            ? TimelineMath.timeToPercent(displayTime, start, end)
            : 0;
    const bufferPercent = this.getBufferedPercent();

    const isInteractiveState =
      isInteractive && (this.isDragging || this.isHovered || this.isSeeking);
    // For live streams, the tooltip shows a relative offset (e.g. "-30s"), so forceHours
    // should be based on the DVR window (range), not the absolute `end` which can be an
    // epoch-based Unix timestamp in DASH live streams (making end >> 3600 always).
    const forceHours = this.isLive ? range >= 3600 : end >= 3600;

    let inlineTimeText = '';
    const targetTime = this.isDragging
      ? this.dragTime
      : this.isHovered
        ? this.hoverTime
        : this.currentTime;

    if (this.hideCurrentTime && this.hideDuration) {
      inlineTimeText = '';
    } else if (this.hideCurrentTime) {
      inlineTimeText = formatTime(end, forceHours);
    } else if (this.hideDuration) {
      inlineTimeText = formatTime(targetTime, forceHours);
    } else if (this.showRemaining) {
      const remainingTime = targetTime - end;
      inlineTimeText = formatTime(remainingTime, forceHours);
    } else {
      inlineTimeText = formatTime(targetTime, forceHours);
    }

    let thumbnailStyle = '';
    if (this.activeThumbnail) {
      if (this.variant === 'vertical') {
        if (this.activeThumbnail.x !== undefined) {
          // Sprite sheet scaling/centering to fit inside 90x160 box
          const w = this.activeThumbnail.width || 200;
          const h = this.activeThumbnail.height || 112;
          const scale = Math.min(90 / w, 160 / h);
          thumbnailStyle = `
            background-image: url('${this.activeThumbnail.url}');
            background-position: -${this.activeThumbnail.x || 0}px -${this.activeThumbnail.y || 0}px;
            width: ${w}px;
            height: ${h}px;
            background-size: auto;
            transform: translate(-50%, -50%) scale(${scale});
            position: absolute;
            left: 50%;
            top: 50%;
            transform-origin: center;
          `;
        } else {
          // Single image contain/center (frame capture)
          thumbnailStyle = `
            background-image: url('${this.activeThumbnail.url}');
            background-position: center;
            width: 100%;
            height: 100%;
            background-size: contain;
          `;
        }
      } else {
        // Standard layout logic (unchanged)
        thumbnailStyle = `
          background-image: url('${this.activeThumbnail.url}');
          background-position: -${this.activeThumbnail.x || 0}px -${this.activeThumbnail.y || 0}px;
          width: ${this.activeThumbnail.x !== undefined ? `${this.activeThumbnail.width || 200}px` : '100%'};
          height: ${this.activeThumbnail.y !== undefined ? `${this.activeThumbnail.height || 112}px` : '100%'};
          background-size: ${this.activeThumbnail.x !== undefined ? 'auto' : 'cover'};
        `;
      }
    }

    const configControls = this.player?.config?.controls || {};
    const isTooltipVisible =
      isInteractive &&
      (this.isHovered || this.isDragging) &&
      range > 0 &&
      configControls.timelinePreview !== false &&
      configControls.hoverTooltip !== false &&
      configControls.tooltip !== false &&
      this.player?.controllerInstance?.isSmartSeekEnabled() !== false;

    return html`
      <div
        part="seekbar-container"
        class="seekbar-container ${this.variant} ${isInteractiveState ? 'interactive' : ''}"
        @pointerdown=${this.handlePointerDown}
        @pointerenter=${this.handlePointerEnter}
        @pointerleave=${this.handlePointerLeave}
        @pointermove=${this.handleHoverPointerMove}
      >
        <div
          part="hover-tooltip"
          class="hover-tooltip ${isTooltipVisible ? 'visible' : ''} ${this.activeThumbnail ||
        this.isThumbnailLoading
        ? 'has-thumbnail'
        : ''}"
          style="left: ${this.tooltipLeft}px; --caret-left: calc(50% + ${this.caretOffset}px);"
        >
          ${this.isDragging &&
        this.variant !== 'vertical' &&
        !this.isLive &&
        this.thumbnailProvider &&
        !(
          typeof this.thumbnailProvider.isUnavailable === 'function' &&
          this.thumbnailProvider.isUnavailable()
        )
        ? html`<div class="precise-seek-label">
                ${this.isPreciseSeeking ? preciseSeekingText : pullUpText}
              </div>`
        : ''}
          ${this.activeMarkerLabel
        ? html`<div part="tooltip-marker-label" class="tooltip-marker-label">
                ${this.activeMarkerLabel}
              </div>`
        : ''}
          ${this.activeThumbnail || this.isThumbnailLoading
        ? html`
                <div
                  part="thumbnail-container"
                  class="thumbnail-container ${this.isThumbnailLoading ? 'loading' : ''}"
                >
                  ${this.isThumbnailLoading && !this.activeThumbnail
            ? html`
                        <div class="thumbnail-placeholder-shimmer"></div>
                        <div class="thumbnail-spinner"></div>
                      `
            : ''}
                  ${this.activeThumbnail
            ? html`
                        <div
                          part="thumbnail-preview"
                          class="thumbnail-preview"
                          style="${thumbnailStyle}"
                        ></div>
                      `
            : ''}
                  ${isHoverTimeEnabled
            ? html`<div part="tooltip-time-text" class="tooltip-time-text">
                        ${this.isLive
                ? this.hoverTime >= end
                  ? liveText
                  : formatTime(this.hoverTime - end, forceHours)
                : formatTime(this.hoverTime, forceHours)}
                      </div>`
            : ''}
                </div>
              `
        : (isHoverTimeEnabled
          ? html`
                  <div part="tooltip-time-text" class="tooltip-time-text">
                    ${this.isLive
              ? this.hoverTime >= end
                ? liveText
                : formatTime(this.hoverTime - end, forceHours)
              : formatTime(this.hoverTime, forceHours)}
                  </div>
                `
          : '')}
        </div>

        <div part="track" class="track">
          <div part="buffer-bar" class="buffer-bar" style="width: ${bufferPercent}%"></div>
          <div part="progress-bar" class="progress-bar" style="width: ${progressPercent}%; ${dragTransitionStyle}"></div>
          ${visibleMarkers.map((marker) => {
            const markerPos = TimelineMath.timeToPercent(marker.time, start, end);
            const colorStyle = marker.color ? `background-color: ${marker.color};` : '';
            return html`
              <div
                part="marker marker-${marker.type || 'default'}"
                class="marker ${marker.type || ''}"
                style="left: ${markerPos}%; ${colorStyle}"
                @click=${(ev: MouseEvent) => this.handleMarkerClick(ev, marker)}
                @pointerdown=${(ev: Event) => ev.stopPropagation()}
              >
                ${this.player &&
                typeof this.player.getIcon === 'function' &&
                this.player.getIcon('markers', { marker })
                ? renderIcon(this.player.getIcon('markers', { marker }))
                : ''}
              </div>
            `;
          })}
          <div
            part="handle"
            class="handle ${this.isDragging ? 'active' : ''}"
            style="left: ${progressPercent}%; ${handleTransitionStyle}"
          ></div>
        </div>

        ${this.variant === 'vertical' || this.isLive === true || this.isLive === null || (this.hideCurrentTime && this.hideDuration)
        ? ''
        : html`
              <div
                part="time-display"
                class="time-display"
                style="min-width: ${forceHours ? '75px' : '48px'}"
                @click=${this.handleTimeClick}
                @mousedown=${(e: Event) => e.stopPropagation()}
                @touchstart=${(e: Event) => e.stopPropagation()}
                @pointerdown=${(e: Event) => e.stopPropagation()}
                @pointermove=${(e: Event) => e.stopPropagation()}
                @mouseenter=${(e: Event) => {
            this.isHovered = false;
            this.clearThumbnailHoverState();
            e.stopPropagation();
          }}
              >
                ${inlineTimeText}
              </div>
            `}
      </div>
    `;
  }
}

if (typeof window !== 'undefined' && typeof customElements !== 'undefined') {
  if (!customElements.get('streamit-seekbar')) {
    customElements.define('streamit-seekbar', PlayerSeekbar);
  }
  if (!customElements.get('player-seekbar')) {
    class PlayerSeekbarLegacyAlias extends PlayerSeekbar {}
    customElements.define('player-seekbar', PlayerSeekbarLegacyAlias);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'streamit-seekbar': PlayerSeekbar;
    'player-seekbar': PlayerSeekbar;
  }
}
