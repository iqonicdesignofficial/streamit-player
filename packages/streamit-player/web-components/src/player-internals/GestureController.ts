import type { PlayerConfiguration, PlayerController, PlayerState } from '../../../core/src/index';
import type { PrefetchController } from './PrefetchController';
import type { SettingsMenuController } from './SettingsMenuController';
import type { ThumbnailCache } from './ThumbnailCache';

export type SpeedLockState =
  | 'IDLE'
  | 'HOLDING'
  | 'READY_TO_LOCK'
  | 'LOCKED'
  | 'LOCKED_HOLDING'
  | 'READY_TO_UNLOCK';

/**
 * The slice of the `<player-player>` element the gesture layer drives.
 *
 * It extends HTMLElement because the gestures are bound to the host itself
 * (wheel / swipe) as well as to the inner <video>. Everything reactive that a
 * gesture writes (`speedLockState`, `isVisualTransitioning`, ...) stays a Lit
 * `@state()` on the element; this controller owns the transitions between those
 * values, not their storage.
 */
export interface GestureHost extends HTMLElement {
  readonly playerState: PlayerState;
  readonly controller: PlayerController;
  config?: PlayerConfiguration;
  displayMode: 'standard' | 'vertical' | 'audio-only' | 'custom' | 'mini' | 'floating';
  readonly videoElement: HTMLVideoElement;
  readonly updateComplete: Promise<boolean>;

  isVisualTransitioning: boolean;
  transitionDirection: 'next' | 'prev';
  transitionStage: 'idle' | 'start' | 'active';
  speedLockState: SpeedLockState;
  isSpeedOverlayFadingOut: boolean;
  activeSpeedFeedback: number | null;
  speedFeedbackTimer?: number;
  suppressPlayPauseFeedback: boolean;
  shouldAutoplayAfterTransition: boolean;

  readonly thumbnailCache: ThumbnailCache;
  readonly prefetch: PrefetchController;
  readonly settingsMenu: SettingsMenuController;

  requestUpdate(): void;
  handleActivity(): void;
  handleReplay(): void;
  showFeedbackOverlay(type: 'rewind' | 'fastforward'): void;
  isOverlayEnabled(id: string): boolean;
  next(): void;
  previous(): void;
}

/**
 * Pointer/touch gestures for the player surface, plus the canvas double-buffer
 * transition that vertical-feed navigation animates through.
 *
 * Gestures owned here:
 *  - long-press-to-speed, including its IDLE -> HOLDING -> READY_TO_LOCK ->
 *    LOCKED -> LOCKED_HOLDING -> READY_TO_UNLOCK lock/unlock state machine
 *  - double-tap-to-seek (and the single-tap play toggle it defers to)
 *  - horizontal drag to scrub / vertical drag on the right half to set volume
 *  - swipe- and wheel-to-navigate between playlist items
 *
 * The transition lives here too because the swipe gesture drives it directly: a
 * drag paints the outgoing and incoming frames into one double-height canvas
 * and translates it under the finger, then either commits (switching the
 * source) or springs back.
 *
 * Every DOM listener is an arrow-function property, so attach() and detach()
 * add and remove the exact same reference.
 */
export class GestureController {
  private readonly host: GestureHost;

  // --- pointer/touch gesture state ---
  private gestureState: 'IDLE' | 'DOWN' | 'LONG_PRESS' | 'SWIPE' = 'IDLE';
  private gestureStartX = 0;
  private gestureStartY = 0;
  private gestureLastTapTime = 0;
  private gestureSingleTapTimer: number | null = null;
  private gestureLongPressTimer: number | null = null;
  private gestureIsRightSide = false;
  private gestureStartVolume = 0;
  private gestureActiveDrag: 'NONE' | 'HORIZONTAL' | 'VERTICAL' = 'NONE';
  private gestureStartTimeVal = 0;
  private gestureLastTouchType = false;
  private isLongPressSpeedActiveInternal = false;
  private preLongPressPlaybackRate = 1;

  // --- swipe-to-navigate state ---
  private touchStartY = 0;
  private touchStartX = 0;
  private touchDeltaY = 0;
  private isTouchActive = false;
  private lastFeedTransitionTime = 0;

  // --- transition / drag-preview state ---
  private isTransitionLockedInternal = false;
  private isDragPreviewActive = false;
  private dragPreviewDirection: 'next' | 'prev' | null = null;
  private dragPreviewCanvasHeight = 0;
  private dragCanvasEl: HTMLCanvasElement | null = null;
  private dragPreviewPending = false;

  constructor(host: GestureHost) {
    this.host = host;
  }

  /** True while a long-press speed change is active (suppresses tap handling). */
  get isLongPressSpeedActive(): boolean {
    return this.isLongPressSpeedActiveInternal;
  }

  /** True while a feed transition is animating; blocks concurrent navigation. */
  get isTransitionLocked(): boolean {
    return this.isTransitionLockedInternal;
  }

  /** Binds wheel + mouse + touch gestures. Mirrored exactly by detach(). */
  attach(): void {
    const host = this.host;
    host.addEventListener('wheel', this.handleWheel, { passive: false });

    const video = host.videoElement;
    if (video) {
      // Desktop mouse gestures
      video.addEventListener('mousedown', this.handleVideoMouseDown);
      video.addEventListener('mousemove', this.handleVideoMouseMove);
      video.addEventListener('mouseup', this.handleVideoMouseUp);
      video.addEventListener('mouseleave', this.handleVideoMouseLeave);

      // Mobile gestures
      video.addEventListener('touchstart', this.handleVideoTouchStart, { passive: false });
      video.addEventListener('touchmove', this.handleVideoTouchMove, { passive: false });
      video.addEventListener('touchend', this.handleVideoTouchEnd, { passive: false });
      video.addEventListener('touchcancel', this.handleVideoTouchCancel, { passive: false });
    }

    // Swipe-to-navigate is bound on the host so it also covers the overlays.
    host.addEventListener('touchstart', this.handleTouchStart, { passive: false });
    host.addEventListener('touchmove', this.handleTouchMove, { passive: false });
    host.addEventListener('touchend', this.handleTouchEnd, { passive: true });
  }

  /** Removes every listener attach() added and clears pending gesture timers. */
  detach(): void {
    const host = this.host;
    host.removeEventListener('wheel', this.handleWheel);
    host.removeEventListener('touchstart', this.handleTouchStart);
    host.removeEventListener('touchmove', this.handleTouchMove);
    host.removeEventListener('touchend', this.handleTouchEnd);

    const video = host.videoElement;
    if (video) {
      video.removeEventListener('mousedown', this.handleVideoMouseDown);
      video.removeEventListener('mousemove', this.handleVideoMouseMove);
      video.removeEventListener('mouseup', this.handleVideoMouseUp);
      video.removeEventListener('mouseleave', this.handleVideoMouseLeave);
      video.removeEventListener('touchstart', this.handleVideoTouchStart);
      video.removeEventListener('touchmove', this.handleVideoTouchMove);
      video.removeEventListener('touchend', this.handleVideoTouchEnd);
      video.removeEventListener('touchcancel', this.handleVideoTouchCancel);
    }

    if (this.gestureSingleTapTimer) {
      clearTimeout(this.gestureSingleTapTimer);
      this.gestureSingleTapTimer = null;
    }
    if (this.gestureLongPressTimer) {
      clearTimeout(this.gestureLongPressTimer);
      this.gestureLongPressTimer = null;
    }
  }

  private isTransitionAnimationFinished = false;
  private cleanupReadyListener?: () => void;

  private drawFrame(
    ctx: CanvasRenderingContext2D,
    source: HTMLVideoElement | HTMLImageElement,
    yOffset: number,
    canvasWidth: number,
    canvasHeight: number
  ) {
    let srcWidth = 0;
    let srcHeight = 0;

    if (source instanceof HTMLVideoElement) {
      srcWidth = source.videoWidth;
      srcHeight = source.videoHeight;
    } else if (source instanceof HTMLImageElement) {
      srcWidth = source.naturalWidth;
      srcHeight = source.naturalHeight;
    }

    if (srcWidth === 0 || srcHeight === 0) {
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, yOffset, canvasWidth, canvasHeight);
      return;
    }

    const srcRatio = srcWidth / srcHeight;
    const destRatio = canvasWidth / canvasHeight;

    let drawWidth = canvasWidth;
    let drawHeight = canvasHeight;
    let drawX = 0;
    let drawY = yOffset;

    if (srcRatio > destRatio) {
      drawHeight = canvasWidth / srcRatio;
      drawY = yOffset + (canvasHeight - drawHeight) / 2;
    } else {
      drawWidth = canvasHeight * srcRatio;
      drawX = (canvasWidth - drawWidth) / 2;
    }

    ctx.fillStyle = '#000000';
    ctx.fillRect(0, yOffset, canvasWidth, canvasHeight);
    ctx.drawImage(source, drawX, drawY, drawWidth, drawHeight);
  }

  private prepareTransitionFrames(
    direction: 'next' | 'prev'
  ): { domCanvas: HTMLCanvasElement; canvasHeight: number } | null {
    const video = this.host.videoElement;
    if (!video) return null;

    const domCanvas = this.host.shadowRoot?.querySelector('.transition-canvas') as HTMLCanvasElement;
    if (!domCanvas) return null;

    const containerRect =
      this.host.shadowRoot?.querySelector('.video-wrapper')?.getBoundingClientRect() ||
      video.getBoundingClientRect();
    const canvasWidth = Math.round(containerRect.width) || 360;
    const canvasHeight = Math.round(containerRect.height) || 640;

    if (domCanvas.width !== canvasWidth || domCanvas.height !== canvasHeight * 2) {
      domCanvas.width = canvasWidth;
      domCanvas.height = canvasHeight * 2;
    }
    const domCtx = domCanvas.getContext('2d');

    const outgoingY = direction === 'next' ? 0 : canvasHeight;
    const incomingY = direction === 'next' ? canvasHeight : 0;

    if (domCtx) {
      if (video.readyState >= 2) {
        this.drawFrame(domCtx, video, outgoingY, canvasWidth, canvasHeight);
      } else {
        domCtx.fillStyle = '#000000';
        domCtx.fillRect(0, outgoingY, canvasWidth, canvasHeight);
      }
    }

    let nextUrl = '';
    if (this.host.playerState.playlist && this.host.playerState.playlist.length > 1) {
      const nextIndex =
        direction === 'next'
          ? (this.host.playerState.activePlaylistIndex + 1) % this.host.playerState.playlist.length
          : (this.host.playerState.activePlaylistIndex - 1 + this.host.playerState.playlist.length) %
          this.host.playerState.playlist.length;
      const nextSource = this.host.playerState.playlist[nextIndex];
      nextUrl = nextSource?.src || '';
    }

    const provider = this.host.thumbnailCache.getProvider(nextUrl);
    const incomingVideo = provider?.video;
    const posterUrl = this.host.thumbnailCache.getCachedPosterForSource(nextUrl);

    if (posterUrl && this.host.isOverlayEnabled('poster')) {
      video.setAttribute('poster', posterUrl);
    } else {
      video.removeAttribute('poster');
    }

    if (domCtx) {
      const drawIncoming = (imgOrVideo: HTMLImageElement | HTMLVideoElement) => {
        try {
          this.drawFrame(domCtx, imgOrVideo, incomingY, canvasWidth, canvasHeight);
        } catch (e) {
          console.warn('Failed to draw incoming frame onto canvas:', e);
        }
      };

      if (incomingVideo && incomingVideo.readyState >= 2) {
        drawIncoming(incomingVideo);
      } else if (posterUrl) {
        const img = new Image();
        img.onload = () => {
          drawIncoming(img);
        };
        img.src = posterUrl;
        if (img.complete) {
          drawIncoming(img);
        } else {
          domCtx.fillStyle = '#000000';
          domCtx.fillRect(0, incomingY, canvasWidth, canvasHeight);
        }
      } else {
        domCtx.fillStyle = '#000000';
        domCtx.fillRect(0, incomingY, canvasWidth, canvasHeight);
      }
    }

    return { domCanvas, canvasHeight };
  }

  initiateVisualTransition(
    direction: 'next' | 'prev',
    loadSourceCallback: () => void
  ): void {
    if (this.host.displayMode !== 'vertical') {
      loadSourceCallback();
      return;
    }

    if (!this.host.videoElement) {
      loadSourceCallback();
      return;
    }

    const prepared = this.prepareTransitionFrames(direction);
    if (!prepared) {
      loadSourceCallback();
      return;
    }
    const { domCanvas } = prepared;

    this.isTransitionLockedInternal = true;
    const wasPlayingOrEnded = this.host.playerState.isPlaying || this.host.playerState.status === 'ended';
    this.host.shouldAutoplayAfterTransition = wasPlayingOrEnded;
    this.host.suppressPlayPauseFeedback = wasPlayingOrEnded;

    this.host.transitionDirection = direction;
    this.host.isVisualTransitioning = true;
    this.host.transitionStage = 'start';
    this.isTransitionAnimationFinished = false;

    this.host.updateComplete.then(() => {
      const handleTransitionEnd = (e: TransitionEvent) => {
        if (e.propertyName === 'transform' && e.target === domCanvas) {
          domCanvas.removeEventListener('transitionend', handleTransitionEnd);
          this.onTransitionAnimationEnd();
        }
      };
      const fallbackTimeout = setTimeout(() => {
        domCanvas.removeEventListener('transitionend', handleTransitionEnd);
        this.onTransitionAnimationEnd();
      }, 700);

      domCanvas.addEventListener('transitionend', handleTransitionEnd);

      this.cleanupTransitionListeners = () => {
        clearTimeout(fallbackTimeout);
        domCanvas.removeEventListener('transitionend', handleTransitionEnd);
      };

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          this.host.transitionStage = 'active';
          loadSourceCallback();
        });
      });
    });
  }

  private cleanupTransitionListeners?: () => void;

  private onTransitionAnimationEnd(): void {
    this.isTransitionAnimationFinished = true;
    this.checkTransitionCompletion();
  }

  checkTransitionCompletion(): void {
    if (!this.isTransitionAnimationFinished) {
      return;
    }

    const video = this.host.videoElement;
    if (!video) {
      this.endVisualTransition();
      return;
    }

    const status = this.host.playerState?.status;
    const sourceType = this.host.playerState?.sourceType;
    const hasError = video.error || status === 'error';
    const isReady =
      video.readyState >= 2 || hasError || status === 'idle' || sourceType === 'embed';

    if (isReady) {
      this.endVisualTransition();
    } else {
      const onVideoReady = () => {
        video.removeEventListener('loadeddata', onVideoReady);
        video.removeEventListener('playing', onVideoReady);
        video.removeEventListener('canplay', onVideoReady);
        video.removeEventListener('error', onVideoReady);
        video.removeEventListener('emptied', onVideoReady);
        this.checkTransitionCompletion();
      };

      video.addEventListener('loadeddata', onVideoReady);
      video.addEventListener('playing', onVideoReady);
      video.addEventListener('canplay', onVideoReady);
      video.addEventListener('error', onVideoReady);
      video.addEventListener('emptied', onVideoReady);

      this.cleanupReadyListener = () => {
        video.removeEventListener('loadeddata', onVideoReady);
        video.removeEventListener('playing', onVideoReady);
        video.removeEventListener('canplay', onVideoReady);
        video.removeEventListener('error', onVideoReady);
        video.removeEventListener('emptied', onVideoReady);
      };
    }
  }

  endVisualTransition(): void {
    if (this.cleanupTransitionListeners) {
      this.cleanupTransitionListeners();
      this.cleanupTransitionListeners = undefined;
    }
    if (this.cleanupReadyListener) {
      this.cleanupReadyListener();
      this.cleanupReadyListener = undefined;
    }
    this.isTransitionAnimationFinished = false;
    this.host.isVisualTransitioning = false;
    this.host.transitionStage = 'idle';
    this.isTransitionLockedInternal = false;
    this.isDragPreviewActive = false;
    this.dragPreviewDirection = null;

    const domCanvas = this.dragCanvasEl || (this.host.shadowRoot?.querySelector('.transition-canvas') as HTMLCanvasElement | null);
    if (domCanvas) {
      domCanvas.style.transform = '';
      domCanvas.style.transition = '';
    }
    this.dragCanvasEl = null;

    if (this.host.videoElement) {
      this.host.videoElement.removeAttribute('poster');
    }

    if (this.host.shouldAutoplayAfterTransition) {
      if (this.host.controller) {
        this.host.controller.play();
      }
      setTimeout(() => {
        this.host.shouldAutoplayAfterTransition = false;
        this.host.requestUpdate();
      }, 150);
    }

    this.host.thumbnailCache.trigger();
    this.host.prefetch.trigger();
  }

  throttleTransition(callback: () => void): void {
    const now = Date.now();
    if (now - this.lastFeedTransitionTime >= 800) {
      this.lastFeedTransitionTime = now;
      callback();
    }
  }

  /**
   * Starts a live drag-follow preview: the incoming video's cached thumbnail
   * slides in tracking the finger, mirroring Reels/Shorts drag behavior.
   * The canvas is left in transitionStage 'idle' (which has no matching CSS
   * transform/transition rule) so it is driven purely by inline styles here.
   */
  private beginDragPreview(direction: 'next' | 'prev'): void {
    if (this.isTransitionLockedInternal || this.isDragPreviewActive || this.dragPreviewPending) return;
    if (this.host.displayMode !== 'vertical' || !this.host.videoElement) return;
    if (!this.host.playerState.playlist || this.host.playerState.playlist.length <= 1) return;

    this.dragPreviewPending = true;
    const wasPlayingOrEnded = this.host.playerState.isPlaying || this.host.playerState.status === 'ended';
    this.host.shouldAutoplayAfterTransition = wasPlayingOrEnded;
    this.host.suppressPlayPauseFeedback = wasPlayingOrEnded;

    this.host.transitionDirection = direction;
    this.host.isVisualTransitioning = true;
    this.host.transitionStage = 'idle';

    this.host.updateComplete.then(() => {
      this.dragPreviewPending = false;
      // The gesture may have already ended (fast flick) before this resolved.
      if (!this.isTouchActive) {
        this.host.isVisualTransitioning = false;
        return;
      }
      const prepared = this.prepareTransitionFrames(direction);
      if (!prepared) {
        this.host.isVisualTransitioning = false;
        return;
      }
      this.dragCanvasEl = prepared.domCanvas;
      this.dragPreviewCanvasHeight = prepared.canvasHeight;
      this.dragPreviewDirection = direction;
      this.isDragPreviewActive = true;
      this.dragCanvasEl.style.transition = 'none';
      this.updateDragPreview(this.touchDeltaY);
    });
  }

  /** Moves the drag-preview canvas to follow the given raw touch deltaY. */
  private updateDragPreview(deltaY: number): void {
    if (!this.isDragPreviewActive || !this.dragCanvasEl || !this.dragPreviewDirection) return;
    const canvasHeight = this.dragPreviewCanvasHeight;
    const offsetPx =
      this.dragPreviewDirection === 'next'
        ? Math.max(-canvasHeight, Math.min(0, deltaY))
        : Math.max(-canvasHeight, Math.min(0, -canvasHeight + deltaY));
    this.dragCanvasEl.style.transform = `translateY(${offsetPx}px)`;
  }

  /** Finger lifted past the threshold: animate the rest of the way and commit the switch. */
  private completeDragPreview(direction: 'next' | 'prev'): void {
    const domCanvas = this.dragCanvasEl;
    const canvasHeight = this.dragPreviewCanvasHeight;
    this.isDragPreviewActive = false;
    this.dragPreviewDirection = null;

    if (!domCanvas) {
      this.host.isVisualTransitioning = false;
      return;
    }

    this.isTransitionLockedInternal = true;
    this.host.prefetch.setDirection(direction);
    this.isTransitionAnimationFinished = false;

    const targetY = direction === 'next' ? -canvasHeight : 0;
    const duration = 'var(--player-vertical-transition-duration, 0.6s)';
    const easing = 'var(--player-vertical-transition-easing, cubic-bezier(0.16, 1, 0.3, 1))';

    domCanvas.style.transition = `transform ${duration} ${easing}`;
    // Force a reflow so the browser commits the current (dragged) position
    // as the transition's starting point before the target changes below.
    void domCanvas.offsetHeight;

    requestAnimationFrame(() => {
      domCanvas.style.transform = `translateY(${targetY}px)`;
    });

    if (direction === 'next') {
      this.host.controller.next();
    } else {
      this.host.controller.previous();
    }

    const handleTransitionEnd = (e: TransitionEvent) => {
      if (e.propertyName === 'transform' && e.target === domCanvas) {
        domCanvas.removeEventListener('transitionend', handleTransitionEnd);
        this.onTransitionAnimationEnd();
      }
    };
    const fallbackTimeout = setTimeout(() => {
      domCanvas.removeEventListener('transitionend', handleTransitionEnd);
      this.onTransitionAnimationEnd();
    }, 700);
    domCanvas.addEventListener('transitionend', handleTransitionEnd);
    this.cleanupTransitionListeners = () => {
      clearTimeout(fallbackTimeout);
      domCanvas.removeEventListener('transitionend', handleTransitionEnd);
    };
  }

  /** Finger lifted without passing the threshold: spring the preview back and cancel. */
  private cancelDragPreview(): void {
    const domCanvas = this.dragCanvasEl;
    this.isDragPreviewActive = false;
    this.dragPreviewDirection = null;

    if (!domCanvas) {
      this.host.isVisualTransitioning = false;
      return;
    }

    const duration = 'var(--player-vertical-transition-duration, 0.6s)';
    const easing = 'var(--player-vertical-transition-easing, cubic-bezier(0.16, 1, 0.3, 1))';
    domCanvas.style.transition = `transform ${duration} ${easing}`;
    requestAnimationFrame(() => {
      domCanvas.style.transform = 'translateY(0px)';
    });

    const cleanup = () => {
      domCanvas.removeEventListener('transitionend', handleTransitionEnd);
      clearTimeout(fallbackTimeout);
      this.host.isVisualTransitioning = false;
      this.host.transitionStage = 'idle';
      domCanvas.style.transform = '';
      domCanvas.style.transition = '';
      this.dragCanvasEl = null;
      if (this.host.videoElement) {
        this.host.videoElement.removeAttribute('poster');
      }
    };
    const handleTransitionEnd = (e: TransitionEvent) => {
      if (e.propertyName === 'transform' && e.target === domCanvas) {
        cleanup();
      }
    };
    const fallbackTimeout = setTimeout(cleanup, 300);
    domCanvas.addEventListener('transitionend', handleTransitionEnd);
  }

  private handleWheel = (e: WheelEvent) => {
    if (
      this.host.displayMode !== 'vertical' ||
      !this.host.playerState.playlist ||
      this.host.playerState.playlist.length <= 1
    ) {
      return;
    }

    e.preventDefault();

    if (Math.abs(e.deltaY) < 10) {
      return;
    }

    if (e.deltaY > 0) {
      this.throttleTransition(() => this.host.next());
    } else if (e.deltaY < 0) {
      this.throttleTransition(() => this.host.previous());
    }
  };

  private handleVideoDown(clientX: number, clientY: number, isTouchEvent: boolean, originalEvent: Event) {
    if (isTouchEvent && this.isTouchOnInteractiveElement(originalEvent as TouchEvent)) {
      return;
    }

    this.gestureLastTouchType = isTouchEvent;

    if (this.gestureLongPressTimer) {
      clearTimeout(this.gestureLongPressTimer);
      this.gestureLongPressTimer = null;
    }

    this.gestureState = 'DOWN';
    this.gestureStartX = clientX;
    this.gestureStartY = clientY;

    if (this.host.videoElement) {
      const rect = this.host.videoElement.getBoundingClientRect();
      this.gestureIsRightSide = (clientX - rect.left) > (rect.width / 2);
    } else {
      this.gestureIsRightSide = false;
    }

    this.gestureStartVolume = this.host.playerState.volume || 0;
    this.gestureStartTimeVal = this.host.playerState.currentTime || 0;
    this.gestureActiveDrag = 'NONE';

    const gestures = this.host.config?.vertical?.gestures;
    const isVertical = this.host.displayMode === 'vertical';
    const isLongPressEnabled = gestures?.longPressToSpeed ?? isVertical;

    if (isLongPressEnabled && !this.host.playerState.isLive) {
      this.gestureLongPressTimer = window.setTimeout(() => {
        this.gestureState = 'LONG_PRESS';
        this.isLongPressSpeedActiveInternal = true;
        this.host.isSpeedOverlayFadingOut = false;

        if (this.host.speedLockState === 'LOCKED') {
          this.host.speedLockState = 'LOCKED_HOLDING';
          this.host.activeSpeedFeedback = this.host.playerState.playbackRate || 2.0;
          this.host.requestUpdate();
        } else {
          this.preLongPressPlaybackRate = this.host.playerState.playbackRate || 1;
          const targetRate = gestures?.longPressSpeed || 2.0;
          this.host.controller.setPlaybackRate(targetRate);
          this.host.speedLockState = 'HOLDING';
          this.host.activeSpeedFeedback = targetRate;
          this.host.requestUpdate();
        }
      }, 500);
    }
  }

  private handleVideoMove(clientX: number, clientY: number, isTouchEvent: boolean, originalEvent: Event) {
    const deltaX = clientX - this.gestureStartX;
    const deltaY = clientY - this.gestureStartY;

    if (this.gestureState === 'DOWN') {
      if (Math.hypot(deltaX, deltaY) > 10) {
        if (Math.abs(deltaX) > Math.abs(deltaY)) {
          this.gestureState = 'SWIPE';
          this.gestureActiveDrag = 'HORIZONTAL';
          if (this.gestureLongPressTimer) {
            clearTimeout(this.gestureLongPressTimer);
            this.gestureLongPressTimer = null;
          }
        } else {
          // Vertical swipe
          if (this.host.displayMode === 'vertical') {
            this.gestureState = 'IDLE';
            this.gestureActiveDrag = 'NONE';
            if (this.gestureLongPressTimer) {
              clearTimeout(this.gestureLongPressTimer);
              this.gestureLongPressTimer = null;
            }
            return;
          } else {
            this.gestureState = 'SWIPE';
            this.gestureActiveDrag = 'VERTICAL';
            if (this.gestureLongPressTimer) {
              clearTimeout(this.gestureLongPressTimer);
              this.gestureLongPressTimer = null;
            }
          }
        }
      }
    }

    if (this.gestureState === 'SWIPE') {
      if (this.gestureActiveDrag === 'HORIZONTAL') {
        if (this.host.videoElement && this.host.playerState.duration > 0 && !this.host.playerState.isLive) {
          const rect = this.host.videoElement.getBoundingClientRect();
          const percent = deltaX / rect.width;
          const seekRange = Math.min(90, this.host.playerState.duration);
          const seekOffset = percent * seekRange;
          const targetTime = Math.max(0, Math.min(this.host.playerState.duration, this.gestureStartTimeVal + seekOffset));
          
          this.host.controller.seek(targetTime);
          this.host.handleActivity();
        }
      } else if (this.gestureActiveDrag === 'VERTICAL') {
        if (this.gestureIsRightSide) {
          if (this.host.videoElement) {
            const rect = this.host.videoElement.getBoundingClientRect();
            const percentChange = -(deltaY / rect.height);
            const targetVolume = Math.max(0, Math.min(1, this.gestureStartVolume + percentChange));
            
            this.host.controller.setVolume(targetVolume);
            this.host.handleActivity();
          }
        } else {
          this.host.handleActivity();
        }
      }
    } else if (this.gestureState === 'LONG_PRESS') {
      const threshold = 40;

      if (this.host.speedLockState === 'HOLDING') {
        if (deltaY > threshold) {
          this.host.speedLockState = 'READY_TO_LOCK';
          this.host.requestUpdate();
        }
      } else if (this.host.speedLockState === 'READY_TO_LOCK') {
        if (deltaY <= threshold) {
          this.host.speedLockState = 'HOLDING';
          this.host.requestUpdate();
        }
      } else if (this.host.speedLockState === 'LOCKED_HOLDING') {
        if (deltaY > threshold) {
          this.host.speedLockState = 'READY_TO_UNLOCK';
          this.host.requestUpdate();
        }
      } else if (this.host.speedLockState === 'READY_TO_UNLOCK') {
        if (deltaY <= threshold) {
          this.host.speedLockState = 'LOCKED_HOLDING';
          this.host.requestUpdate();
        }
      }
    }
  }

  private handleVideoUp(clientX: number, clientY: number, isTouchEvent: boolean, originalEvent: Event) {
    if (this.gestureLongPressTimer) {
      clearTimeout(this.gestureLongPressTimer);
      this.gestureLongPressTimer = null;
    }

    const state = this.gestureState;
    this.gestureState = 'IDLE';

    if (state === 'LONG_PRESS') {
      this.triggerLongPressEnd(originalEvent);
    } else if (state === 'SWIPE') {
      this.host.handleActivity();
    } else if (state === 'DOWN') {
      const now = Date.now();
      const elapsed = now - this.gestureLastTapTime;

      if (elapsed < 300 && elapsed > 0) {
        if (this.gestureSingleTapTimer) {
          clearTimeout(this.gestureSingleTapTimer);
          this.gestureSingleTapTimer = null;
        }
        this.gestureLastTapTime = 0;
        this.triggerDoubleTap(clientX, originalEvent);
      } else {
        this.gestureLastTapTime = now;
        this.gestureSingleTapTimer = window.setTimeout(() => {
          this.gestureSingleTapTimer = null;
          this.triggerSingleTap();
        }, 250);
      }
    }
  }

  private handleVideoTouchStart = (e: TouchEvent) => {
    if (e.touches.length > 1) return;
    const touch = e.touches[0];
    this.handleVideoDown(touch.clientX, touch.clientY, true, e);
  };

  private handleVideoTouchMove = (e: TouchEvent) => {
    if (e.touches.length > 1) return;
    const touch = e.touches[0];
    this.handleVideoMove(touch.clientX, touch.clientY, true, e);

    if (this.gestureState === 'LONG_PRESS' || this.gestureState === 'SWIPE') {
      if (e.cancelable) {
        e.preventDefault();
      }
    }
  };

  private handleVideoTouchEnd = (e: TouchEvent) => {
    const touch = e.changedTouches[0];
    if (touch) {
      this.handleVideoUp(touch.clientX, touch.clientY, true, e);
    }
    if (e.cancelable) {
      e.preventDefault();
    }
  };

  private handleVideoTouchCancel = (e: TouchEvent) => {
    if (this.gestureLongPressTimer) {
      clearTimeout(this.gestureLongPressTimer);
      this.gestureLongPressTimer = null;
    }
    this.gestureState = 'IDLE';
  };

  private handleVideoMouseDown = (e: MouseEvent) => {
    if (e.button !== 0) return;
    this.handleVideoDown(e.clientX, e.clientY, false, e);
  };

  private handleVideoMouseMove = (e: MouseEvent) => {
    this.handleVideoMove(e.clientX, e.clientY, false, e);
  };

  private handleVideoMouseUp = (e: MouseEvent) => {
    if (e.button !== 0) return;
    this.handleVideoUp(e.clientX, e.clientY, false, e);
  };

  private handleVideoMouseLeave = (e: MouseEvent) => {
    if (this.gestureLongPressTimer) {
      clearTimeout(this.gestureLongPressTimer);
      this.gestureLongPressTimer = null;
    }
    if (this.gestureState === 'LONG_PRESS') {
      this.triggerLongPressEnd(e);
    }
    this.gestureState = 'IDLE';
  };

  private triggerLongPressEnd(e: Event) {
    if (this.isLongPressSpeedActiveInternal) {
      const gestures = this.host.config?.vertical?.gestures;
      if (this.host.speedLockState === 'HOLDING') {
        this.host.controller.setPlaybackRate(this.preLongPressPlaybackRate);
        this.host.isSpeedOverlayFadingOut = true;
        this.host.requestUpdate();

        if (this.host.speedFeedbackTimer) clearTimeout(this.host.speedFeedbackTimer);
        this.host.speedFeedbackTimer = window.setTimeout(() => {
          this.host.activeSpeedFeedback = null;
          this.host.speedLockState = 'IDLE';
          this.host.isSpeedOverlayFadingOut = false;
          this.host.requestUpdate();
        }, 250);
      } else if (this.host.speedLockState === 'READY_TO_LOCK') {
        this.host.speedLockState = 'LOCKED';
        this.host.activeSpeedFeedback = this.host.playerState.playbackRate || 2.0;
        this.host.isSpeedOverlayFadingOut = false;
        this.host.requestUpdate();

        if (this.host.speedFeedbackTimer) clearTimeout(this.host.speedFeedbackTimer);
        this.host.speedFeedbackTimer = window.setTimeout(() => {
          this.host.isSpeedOverlayFadingOut = true;
          this.host.requestUpdate();
          this.host.speedFeedbackTimer = window.setTimeout(() => {
            this.host.activeSpeedFeedback = null;
            this.host.isSpeedOverlayFadingOut = false;
            this.host.requestUpdate();
          }, 250);
        }, 1000);
      } else if (this.host.speedLockState === 'LOCKED_HOLDING') {
        this.host.speedLockState = 'LOCKED';
        this.host.activeSpeedFeedback = this.host.playerState.playbackRate || 2.0;
        this.host.isSpeedOverlayFadingOut = false;
        this.host.requestUpdate();

        if (this.host.speedFeedbackTimer) clearTimeout(this.host.speedFeedbackTimer);
        this.host.speedFeedbackTimer = window.setTimeout(() => {
          this.host.isSpeedOverlayFadingOut = true;
          this.host.requestUpdate();
          this.host.speedFeedbackTimer = window.setTimeout(() => {
            this.host.activeSpeedFeedback = null;
            this.host.isSpeedOverlayFadingOut = false;
            this.host.requestUpdate();
          }, 250);
        }, 1000);
      } else if (this.host.speedLockState === 'READY_TO_UNLOCK') {
        this.host.controller.setPlaybackRate(this.preLongPressPlaybackRate);
        this.host.isSpeedOverlayFadingOut = true;
        this.host.requestUpdate();

        if (this.host.speedFeedbackTimer) clearTimeout(this.host.speedFeedbackTimer);
        this.host.speedFeedbackTimer = window.setTimeout(() => {
          this.host.activeSpeedFeedback = null;
          this.host.speedLockState = 'IDLE';
          this.host.isSpeedOverlayFadingOut = false;
          this.host.requestUpdate();
        }, 250);
      }

      setTimeout(() => {
        this.isLongPressSpeedActiveInternal = false;
        this.host.requestUpdate();
      }, 50);
    }
  }

  private triggerSingleTap() {
    if (this.isLongPressSpeedActiveInternal) {
      return;
    }
    if (this.host.settingsMenu.isOpen) {
      this.host.settingsMenu.close();
      return;
    }
    if (this.host.config?.controls?.play === false || this.host.config?.controls?.playButton === false) {
      return;
    }
    if (
      this.host.playerState.status === 'ended' &&
      !this.host.playerState.isLive &&
      this.host.displayMode !== 'vertical'
    ) {
      this.host.handleReplay();
      return;
    }
    this.host.controller.togglePlay();
    this.host.handleActivity();
  }

  private triggerDoubleTap(clientX: number, originalEvent: Event) {
    if (this.host.config?.controls?.seekbar === false) return;
    if (this.host.playerState.isLive && !this.host.playerState.canSeekInDvr) return;
    const isVertical = this.host.displayMode === 'vertical';
    const isDoubleTapEnabled = isVertical
      ? this.host.config?.vertical?.gestures?.doubleTapToSeek !== false
      : true;
    if (!isDoubleTapEnabled) return;

    const rect = this.host.videoElement.getBoundingClientRect();
    const clickX = clientX - rect.left;
    const skipInterval = this.host.config?.playback?.doubleTapInterval || 10;

    if (clickX < rect.width / 2) {
      this.host.controller.seekBy(-skipInterval);
      this.host.showFeedbackOverlay('rewind');
    } else {
      this.host.controller.seekBy(skipInterval);
      this.host.showFeedbackOverlay('fastforward');
    }
    this.host.handleActivity();
  }

  private isTouchOnInteractiveElement(e: TouchEvent): boolean {
    const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
    return path.some((el) => {
      if (!(el instanceof Element)) return false;
      const tagName = el.tagName.toLowerCase();
      const role = el.getAttribute ? el.getAttribute('role') : null;
      const classList = el.classList;
      return (
        tagName === 'button' ||
        tagName === 'player-seekbar' ||
        tagName === 'player-vertical-controls' ||
        role === 'button' ||
        role === 'menuitem' ||
        role === 'menuitemradio' ||
        (classList &&
          (classList.contains('controls-bar') ||
            classList.contains('settings-menu') ||
            classList.contains('settings-menu-wrapper') ||
            classList.contains('sleep-timer-dialog-card')))
      );
    });
  }

  private handleTouchStart = (e: TouchEvent) => {
    if (this.gestureState === 'LONG_PRESS' || this.isLongPressSpeedActiveInternal) {
      return;
    }
    const swipeToNav = this.host.config?.vertical?.gestures?.swipeToNavigate !== false;
    const snapBehavior = this.host.config?.vertical?.snapBehavior !== 'none';
    if (
      this.host.displayMode !== 'vertical' ||
      !swipeToNav ||
      !snapBehavior ||
      !this.host.playerState.playlist ||
      this.host.playerState.playlist.length <= 1
    ) {
      return;
    }
    if (this.isTouchOnInteractiveElement(e)) {
      return;
    }
    const touch = e.touches[0];
    this.touchStartY = touch.clientY;
    this.touchStartX = touch.clientX;
    this.touchDeltaY = 0;
    this.isTouchActive = true;
    this.host.handleActivity();
  };

  private handleTouchMove = (e: TouchEvent) => {
    if (this.gestureState === 'LONG_PRESS' || this.isLongPressSpeedActiveInternal) {
      if (e.cancelable) {
        e.preventDefault();
      }
      return;
    }
    const swipeToNav = this.host.config?.vertical?.gestures?.swipeToNavigate !== false;
    const snapBehavior = this.host.config?.vertical?.snapBehavior !== 'none';
    if (
      this.host.displayMode !== 'vertical' ||
      !swipeToNav ||
      !snapBehavior ||
      !this.host.playerState.playlist ||
      this.host.playerState.playlist.length <= 1
    ) {
      return;
    }
    if (this.isTouchOnInteractiveElement(e)) {
      return;
    }
    const touch = e.touches[0];
    const deltaY = touch.clientY - this.touchStartY;
    const deltaX = touch.clientX - this.touchStartX;

    this.touchDeltaY = deltaY;

    // If vertical movement is dominant, prevent default page scrolling behavior
    const isVerticalDrag = Math.abs(deltaY) > Math.abs(deltaX) && Math.abs(deltaY) > 5;
    if (isVerticalDrag && e.cancelable) {
      e.preventDefault();
    }

    if (this.isDragPreviewActive) {
      this.updateDragPreview(deltaY);
    } else if (isVerticalDrag && Math.abs(deltaY) > 10 && !this.isTransitionLockedInternal) {
      this.beginDragPreview(deltaY < 0 ? 'next' : 'prev');
    }

    this.host.handleActivity();
  };

  private handleTouchEnd = () => {
    if (this.gestureState === 'LONG_PRESS' || this.isLongPressSpeedActiveInternal) {
      return;
    }
    const swipeToNav = this.host.config?.vertical?.gestures?.swipeToNavigate !== false;
    const snapBehavior = this.host.config?.vertical?.snapBehavior !== 'none';
    if (
      this.host.displayMode !== 'vertical' ||
      !swipeToNav ||
      !snapBehavior ||
      !this.host.playerState.playlist ||
      this.host.playerState.playlist.length <= 1
    ) {
      return;
    }

    const threshold = this.host.config?.vertical?.swipeThreshold ?? 50; // swipe threshold in pixels
    const deltaY = this.touchDeltaY;
    const passedNext = deltaY < -threshold;
    const passedPrev = deltaY > threshold;

    if (this.isDragPreviewActive) {
      const direction = this.dragPreviewDirection;
      if (direction === 'next' && passedNext) {
        this.lastFeedTransitionTime = Date.now();
        this.completeDragPreview('next');
      } else if (direction === 'prev' && passedPrev) {
        this.lastFeedTransitionTime = Date.now();
        this.completeDragPreview('prev');
      } else {
        this.cancelDragPreview();
      }
    } else {
      // Preview never initialized (e.g. a very fast flick) - fall back to an instant snap.
      if (passedNext) {
        this.throttleTransition(() => this.host.next());
      } else if (passedPrev) {
        this.throttleTransition(() => this.host.previous());
      }
    }

    // Reset tracking variables
    this.touchStartY = 0;
    this.touchStartX = 0;
    this.touchDeltaY = 0;
    this.isTouchActive = false;
  };
}
