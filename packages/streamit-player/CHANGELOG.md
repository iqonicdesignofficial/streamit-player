# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Brightness swipe on the left half of the video (0-100%, 50% = original picture), with an on-screen percentage. Remembered across sessions; disable with `gestures.brightness: false`.
- Landscape fullscreen on phones: touch devices rotate to landscape for landscape video and unlock on exit. Opt out with `layout.lockLandscapeOnFullscreen: false`.
- Picture-in-Picture placeholder: a centered PiP icon and "Playing in Picture-in-Picture" (over the dimmed poster, if set) replaces Chrome's plain built-in text.

### Changed

- **Smart Seek / Precise Seek frame capture is much lighter.** Hover thumbnails snap to a 1-10s time grid (1s in precise-seek mode) and are served from an LRU cache of 400 frames, so scrubbing reuses frames instead of decoding a new one every 0.1s. The hidden capture video now loads only metadata (`preload="metadata"`) and its hls.js/dash.js instances buffer just a few seconds, so it no longer competes with the real player for bandwidth. The black-frame check reads a 16x9 downscale instead of the whole frame, capture uses a GPU-backed canvas, and three duplicated capture paths were merged into one.
- The first seekbar hover is pre-warmed: shortly after playback starts the hidden video loads its metadata (not for live streams, and not when Save-Data or a 2G connection is detected).
- Playlist neighbours now preload only their first frame plus at most 3 chapter frames (previously about 10 interval frames each), and not at all when Save-Data or 2G is detected.
- New optional `ThumbnailProvider.warmUp()` and exported `isConstrainedNetwork()` helper.

### Fixed

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
