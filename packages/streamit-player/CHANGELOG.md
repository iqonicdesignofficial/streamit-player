# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Brightness swipe on the left half of the video (0-100%, 50% = original picture), with an on-screen percentage. Remembered across sessions; disable with `gestures.brightness: false`.
- Landscape fullscreen on phones: touch devices rotate to landscape for landscape video and unlock on exit. Opt out with `layout.lockLandscapeOnFullscreen: false`.
- Picture-in-Picture placeholder: a centered PiP icon and "Playing in Picture-in-Picture" (over the dimmed poster, if set) replaces Chrome's plain built-in text.
- `config.hls`: options such as `capLevelToPlayerSize`, `maxBufferLength`, `backBufferLength`, `fragLoadPolicy` or a custom `loader` are passed to hls.js on top of the player's defaults, and `lowLatencyMode` (on by default, VOD included) can be turned off. DRM settings still come from `config.drm` and cannot be overridden. New exported type `HlsConfigOverrides`.
- `config.recovery`: the HLS/DASH retry count and backoff (`network.maxRetries`, `network.retryDelayMs`), the HLS silent-attempt timeout (`network.attemptTimeoutMs`), the HTTP statuses that are never retried (`network.noRetryStatuses`, default `[401, 403, 410]`), the stall watchdog stages (`stall.enabled`, `nudgeAfterMs`, `restartAfterMs`, `failAfterMs`) and the decode-error recovery reset (`media.resetAfterSeconds`) are configurable. Defaults are unchanged; invalid values fall back to the default with a configuration warning. New exported type `RecoveryConfig`.
- The `error` / `player-error` event now carries `httpCode` and `details` (for example `403` and `fragLoadError`) when a network error caused it, so an app can tell an expired link from a connection that is down. Existing `message` is unchanged.
- `PlayerController.reportFatalError(message, cause?)` sets the error state and dispatches `error` in one call; source handlers can implement an optional `recoverStall()` (done for HLS).

### Changed

- **Smart Seek / Precise Seek frame capture is much lighter.** Hover thumbnails snap to a 1-10s time grid (1s in precise-seek mode) and are served from an LRU cache of 400 frames, so scrubbing reuses frames instead of decoding a new one every 0.1s. The hidden capture video now loads only metadata (`preload="metadata"`) and its hls.js/dash.js instances buffer just a few seconds, so it no longer competes with the real player for bandwidth. The black-frame check reads a 16x9 downscale instead of the whole frame, capture uses a GPU-backed canvas, and three duplicated capture paths were merged into one.
- The first seekbar hover is pre-warmed: shortly after playback starts the hidden video loads its metadata (not for live streams, and not when Save-Data or a 2G connection is detected).
- Playlist neighbours now preload only their first frame plus at most 3 chapter frames (previously about 10 interval frames each), and not at all when Save-Data or 2G is detected.
- New optional `ThumbnailProvider.warmUp()` and exported `isConstrainedNetwork()` helper.

### Fixed

- HLS playback no longer stays on "buffering" forever when a segment keeps failing (expired signed URL, HTTP 403, or a segment that never answers). The retry budget (3 attempts, 2s/4s/8s backoff) used to be restored by playlist reloads, which hls.js repeats during every recovery, and a reload that went quiet was never noticed. It is now restored only when a main-stream fragment is buffered, and an attempt with no progress for 20s while the viewer is out of data counts as failed, so the ladder always ends in an error. A refusal (HTTP 401, 403 or 410, as with an expired signed URL) skips the ladder and is reported at once, with wording that says the link may have expired: with a refused segment the error now arrives after about 30s (hls.js's own retries) instead of 84s, and in about a second if `config.hls.fragLoadPolicy` is lowered.
- HLS media (decode) error recovery can no longer loop forever: its three-stage budget was reset by every playlist reload (constant on live streams), so a persistent decode error never reached "Fatal media decoding failure". It is now restored only after playback has moved 10s past the last media error.
- Fatal HLS and DASH errors (retries exhausted, media decoding failure, stream initialization crash, DRM initialization failure, "HLS not supported", library failed to load) now fire `error` / `player-error`; before they only wrote `error` into state. Rejected sources (invalid embed host, malformed source) fire it too.
- The stall watchdog now also covers buffering and escalates: nudge after 5s (when not buffering), ask the stream to restart loading after 15s, raise a `Playback stalled` error after 60s. It resumes if playback recovers on its own.
- Controller events that were never re-dispatched on the element now arrive as `player-<name>`: `subtitletrackschanged`, `subtitletrackchange`, `subtitleenabled`, `subtitledisabled`, `subtitleappearancechange`, `audioTracksChanged`, `audioTrackChanged`, `live-status-change`, `live-sync-update`, `live-edge-sync`, `sleeptimerstart`, `sleeptimerupdate`, `sleeptimerexpired`, `sleeptimercancelled`, `adschedulerconflict`. `player-metadata` was dispatched twice per event and is now dispatched once.
- An HLS subtitle track selected as soon as the tracks were announced was cleared a moment later by hls.js picking its own default; the announcement now waits for that, so the selection sticks.
- Hardening: if the `src` attribute is set but the property is still empty at first render (element created before the module registered it), the attribute is used.
- The player UI did not re-render when Picture-in-Picture started or ended.
- The precise-seek filmstrip could leave cells stuck on the loading shimmer: its 11 requests exceeded the provider's queue of 9, so 2 were dropped and never retried. The queue now covers a full window, requests go nearest-the-playhead first, and failed cells retry after 1.5s.

## [Released]

## [1.0.2] - 2026-09-12

### Fixed

- Seeking back into the DVR window of a live DASH stream now stays at the chosen position. Before,
  dash.js kept loading segments near the live edge and moved the playhead back there.
- Live catch-up on low-latency DASH streams now reacts only to the viewer's own seeks, "go to live"
  and resuming playback, not to seeks dash.js makes internally.

## [1.0.0] - 2026-09-11

Initial public release of `streamit-player`.

### Added

- `<streamit-player>` Lit web component with controls, settings menu, keyboard shortcuts,
  gestures (double-tap seek, long-press speed), four theme presets and CSS custom-property theming.
  The `<player-player>` tag names are kept as aliases.
- Headless `PlayerController` engine via `streamit-player/core`, with no UI dependencies.
- Playback of MP4, WebM and MOV files, HLS (via the `hls.js` peer dependency) and
  MPEG-DASH (via the `dashjs` peer dependency), plus live and DVR streams. Both libraries are
  loaded on demand, only when an HLS or DASH source plays.
- Low-latency DASH: low-latency mode follows the stream's manifest, and live catch-up keeps
  latency low while the viewer follows the live edge, in both live-only and DVR modes. It pauses
  while the viewer is watching behind live in the DVR window and resumes when they go back to live.
- Multi-DRM: Widevine, PlayReady, FairPlay and ClearKey.
- Advertising: VAST, VMAP, Google IMA, SIMID interactive ads and HTML overlays.
- Smart Seek thumbnail previews, chapters, markers, subtitles, audio-track and quality selection,
  playlists, vertical feed mode, sleep timer, Picture-in-Picture and Media Session support.
- Plugin and extension APIs for custom controls, overlays, settings items and context-menu items.
- ES module and CommonJS builds with TypeScript declarations, and standalone CDN bundles
  (`streamit-player.esm.min.js` and the `window.StreamitPlayer` IIFE build).

[Unreleased]: https://github.com/iqonicdesignofficial/streamit-player/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/iqonicdesignofficial/streamit-player/releases/tag/v1.0.1
[1.0.0]: https://github.com/iqonicdesignofficial/streamit-player/releases/tag/v1.0.0
