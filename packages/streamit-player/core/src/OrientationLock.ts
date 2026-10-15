/** Screen Orientation Lock API, not present in every DOM lib version's `ScreenOrientation` type. */
interface LockableScreenOrientation extends Omit<ScreenOrientation, 'lock' | 'unlock'> {
  lock?(orientation: 'landscape' | 'portrait' | 'any' | 'natural'): Promise<void>;
  unlock?(): void;
}

export interface FullscreenOrientationOptions {
  /** `false` disables the lock entirely. Defaults to `true`. */
  enabled?: boolean;
  /** Vertical/reel layouts keep their portrait orientation. */
  isVerticalLayout?: boolean;
  /** Intrinsic size of the playing video, `0` while metadata is not loaded. */
  videoWidth?: number;
  videoHeight?: number;
}

/** True on phones/tablets: a coarse primary pointer plus touch support. */
export function isTouchPrimaryDevice(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const coarse =
    typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  return coarse && (navigator.maxTouchPoints || 0) > 0;
}

/**
 * Locks the screen to landscape while a landscape video is fullscreen on a
 * touch device, like YouTube/Netflix/Prime. Never throws: browsers without the
 * API (iOS Safari, desktop) or that reject the lock simply keep the current
 * orientation.
 *
 * @returns whether a lock was actually applied.
 */
export async function lockLandscapeForFullscreen(
  options: FullscreenOrientationOptions = {}
): Promise<boolean> {
  if (options.enabled === false || options.isVerticalLayout) return false;
  if (!isTouchPrimaryDevice()) return false;

  const { videoWidth = 0, videoHeight = 0 } = options;
  // Portrait video (e.g. a reel) is better off staying portrait.
  if (videoWidth > 0 && videoHeight > 0 && videoHeight > videoWidth) return false;

  const orientation = (typeof screen !== 'undefined' ? screen.orientation : undefined) as
    | LockableScreenOrientation
    | undefined;
  if (!orientation || typeof orientation.lock !== 'function') return false;

  try {
    await orientation.lock('landscape');
    return true;
  } catch {
    return false;
  }
}

/** Releases any lock taken by {@link lockLandscapeForFullscreen}. Never throws. */
export function unlockOrientation(): void {
  try {
    const orientation = (typeof screen !== 'undefined' ? screen.orientation : undefined) as
      | LockableScreenOrientation
      | undefined;
    orientation?.unlock?.();
  } catch {
    // Unlock is best-effort.
  }
}
