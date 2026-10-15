# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Brightness swipe.** A vertical swipe on the left half of the video now adjusts brightness (0-100%, 50% = original picture) with an on-screen percentage, like volume does on the right half. It is a video filter, remembered across sessions, and can be turned off with `gestures.brightness: false`.
- **Landscape fullscreen on phones.** Entering fullscreen with a landscape video rotates touch devices to landscape and releases the lock on exit. Vertical mode and portrait videos are left alone. Opt out with `layout.lockLandscapeOnFullscreen: false`.
- **Picture-in-Picture placeholder.** While in PiP the player area shows a centered PiP icon and "Playing in Picture-in-Picture" (over the dimmed poster, if one is set) instead of Chrome's plain built-in text. Themeable via CSS variables, parts and the `icon-pip-placeholder` slot.

### Changed

- **Smart Seek / Precise Seek frame capture is much lighter.** Hover thumbnails snap to a 1-10s time grid (1s in precise-seek mode) and are served from an LRU cache of 400 frames, so scrubbing reuses frames instead of decoding a new one every 0.1s. The hidden capture video now loads only metadata (`preload="metadata"`) and its hls.js/dash.js instances buffer just a few seconds, so it no longer competes with the real player for bandwidth. The black-frame check reads a 16x9 downscale instead of the whole frame, capture uses a GPU-backed canvas, and three duplicated capture paths were merged into one.
- The first seekbar hover is pre-warmed: shortly after playback starts the hidden video loads its metadata (not for live streams, and not when Save-Data or a 2G connection is detected).
- Playlist neighbours now preload only their first frame plus at most 3 chapter frames (previously about 10 interval frames each), and not at all when Save-Data or 2G is detected.
- New optional `ThumbnailProvider.warmUp()` and exported `isConstrainedNetwork()` helper.

### Fixed

- The player UI did not re-render when Picture-in-Picture started or ended, so the PiP button state could lag behind.
- The precise-seek filmstrip could leave cells stuck on the loading shimmer: its 11 requests exceeded the provider's queue of 9, so 2 were dropped and never retried. The queue now covers a full window, requests go nearest-the-playhead first, and failed cells retry after 1.5s.

## [1.1.0] - 2026-10-15

### Added

- **Thumbnail Provider warmUp method** - New `warmUp()` method on `ThumbnailProvider` interface enables preloading and caching of thumbnail data before seeking, improving scrubbing performance and reducing seek latency. Smart Seek filmstrip and vertical-mode previews now benefit from automatic preloading.
- **Brightness swipe gesture** - Vertical swipe on the right half of the video now adjusts brightness (in addition to volume on the left half), with a live HUD indicator showing the brightness percentage. Customizable via `config.gestures.brightnessControl`.
- **Picture-in-Picture placeholder** - When PiP is active but the player is minimized, a styled placeholder badge displays the video title and current time, keeping viewers informed without obscuring content.

## [1.0.3] - 2026-09-22

### Fixed

- **Vertical player mode now works correctly when installed in React/Next projects.** The component now recognizes lowercased attribute spellings (`displaymode`, `display_mode`, `livemode`, `autoscroll`, etc.) that frameworks emit when converting JSX props to DOM attributes. This unblocks the action rail, vertical seekbar, swipe-to-navigate gestures, and all vertical-specific UI that was silently failing to activate.
- **Config objects passed as JSX props are now handled gracefully.** When a framework stringifies an object attribute to `[object Object]`, the player now rejects it with a clear console warning instead of silently dropping the entire configuration. Valid JSON config attributes are still accepted.
- **Vertical layout is now reliably rendered.** The host stylesheet's 9:16 aspect ratio, action rail positioning, and control-set selection now all read from a single source of truth (`displayMode`), preventing race conditions where the aspect ratio applied but standard controls rendered anyway.

### Testing

- Fixed jsdom `localStorage` availability in Node 25+ environments, unblocking execution of the vertical-feed gesture test suite (swipe navigation, double-tap seek, long-press speed, canvas double-buffer transitions). All 313 tests now pass.

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

[Unreleased]: https://github.com/iqonicdesignofficial/streamit-player/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/iqonicdesignofficial/streamit-player/compare/v1.0.3...v1.1.0
[1.0.3]: https://github.com/iqonicdesignofficial/streamit-player/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/iqonicdesignofficial/streamit-player/compare/v1.0.0...v1.0.2
[1.0.1]: https://github.com/iqonicdesignofficial/streamit-player/releases/tag/v1.0.1
[1.0.0]: https://github.com/iqonicdesignofficial/streamit-player/releases/tag/v1.0.0
