# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[Unreleased]: https://github.com/iqonicdesignofficial/streamit-player/compare/v1.0.3...HEAD
[1.0.3]: https://github.com/iqonicdesignofficial/streamit-player/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/iqonicdesignofficial/streamit-player/compare/v1.0.0...v1.0.2
[1.0.1]: https://github.com/iqonicdesignofficial/streamit-player/releases/tag/v1.0.1
[1.0.0]: https://github.com/iqonicdesignofficial/streamit-player/releases/tag/v1.0.0
