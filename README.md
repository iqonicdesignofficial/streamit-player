# Streamit Player SDK (`streamit-player`)

A headless, framework-agnostic video playback engine (`streamit-player/core`) with a Lit-based Web Component UI layer (`streamit-player/web-components` and `streamit-player`), supporting adaptive streaming (HLS & MPEG-DASH), multi-DRM, a full advertising stack (VAST/VMAP/IMA/SIMID), live/DVR, and a Reels/Shorts-style vertical feed experience.

This document is a complete, current inventory of every feature implemented in the codebase today - what it does, how a developer turns it on or off, and where it lives in the source. Anything marked **Not configurable** genuinely has no on/off switch in the code today (called out explicitly rather than guessed).

---

## Table of Contents

1. [Streaming & Source Support](#1-streaming--source-support)
2. [Live Streaming](#2-live-streaming)
3. [Digital Rights Management (DRM)](#3-digital-rights-management-drm)
4. [Advertising & Monetization](#4-advertising--monetization)
5. [Core Playback API](#5-core-playback-api)
6. [Playlist Management](#6-playlist-management)
7. [Subtitles & Closed Captions](#7-subtitles--closed-captions)
8. [Multi-Audio-Track Support](#8-multi-audio-track-support)
9. [Chapters & Timeline Markers](#9-chapters--timeline-markers)
10. [Smart Seek - Thumbnail & Precise-Seek Preview](#10-smart-seek--thumbnail--precise-seek-preview)
11. [Sleep Timer](#11-sleep-timer)
12. [Media Session (OS / Lock-Screen Controls)](#12-media-session-os--lock-screen-controls)
13. [Keyboard Shortcuts](#13-keyboard-shortcuts)
14. [Picture-in-Picture, Mini & Floating Modes](#14-picture-in-picture-mini--floating-modes)
15. [Quality / Bitrate Control](#15-quality--bitrate-control)
16. [User Preference Persistence](#16-user-preference-persistence)
17. [Touch & Mobile Gesture Controls](#17-touch--mobile-gesture-controls)
18. [Vertical Feed Player (Reels / Shorts-Style)](#18-vertical-feed-player-reels--shorts-style)
19. [Seekbar](#19-seekbar)
20. [Volume Control](#20-volume-control)
21. [Playback Speed Control](#21-playback-speed-control)
22. [Settings Menu](#22-settings-menu)
23. [Theming & White-Label Customization](#23-theming--white-label-customization)
24. [Plugin & Extension API](#24-plugin--extension-api)
25. [Responsive / Mobile Layout](#25-responsive--mobile-layout)
26. [Empty State, Loading & Error UI](#26-empty-state-loading--error-ui)
27. [Error Handling & Network Resilience](#27-error-handling--network-resilience)
28. [Plain HTML & Browser CDN](#28-plain-html--browser-cdn)
29. [React 18 Integration](#29-react-18-integration)
30. [React 19 Integration](#30-react-19-integration)
31. [Next.js Integration (App Router & Pages Router)](#31-nextjs-integration-app-router--pages-router)
32. [Laravel Integration (Blade & Inertia)](#32-laravel-integration-blade--inertia)
33. [WordPress Integration (Classic & Gutenberg)](#33-wordpress-integration-classic--gutenberg)
34. [Headless / Core-Only TypeScript](#34-headless--core-only-typescript)

---

## 1. Streaming & Source Support

| Source type | Protocol / Format | Engine used | Notes |
|---|---|---|---|
| **Progressive MP4/MOV/WebM** | Direct file playback | Native `<video>` | Multi-bitrate "variant" switching via source-swap with playhead/play-state restoration; native multi-audio-track via `HTMLMediaElement.audioTracks` |
| **HLS** (`.m3u8`) | HTTP Live Streaming, adaptive bitrate | **hls.js** (dynamically imported), with native fallback on Safari (`canPlayType`) | Live, DVR, low-latency (LL-HLS), multi-audio, in-manifest subtitles |
| **MPEG-DASH** (`.mpd`) | Adaptive bitrate | **dash.js** (dynamically imported) | Dynamic/live manifests, DVR, low-latency |
| **Embedded** | YouTube, Vimeo, sanitized iframe HTML | Native `<iframe>` | Ads (VAST/VMAP/IMA) are intentionally disabled for this source type - no controllable `<video>` element to intercept |

**Auto-detection:** if `source.type` isn't given explicitly, it's inferred from the URL - `.m3u8`→HLS, `.mpd`→DASH, `.webm`→WebM, `.mov`→MOV, `youtube.com`/`youtu.be`/`vimeo.com`/raw `<iframe>` strings→Embed, everything else defaults to MP4.

**Configurable:** source type per item (`PlayerSource.type`), DRM per source, ads per source, multi-bitrate variants (`PlayerSourceVariant[]`).

---

## 2. Live Streaming

| Feature | Description | Configurable? |
|---|---|---|
| **Live-only mode** | Straight live playback, no rewind | `config.live.mode = 'live-only'` |
| **Live DVR mode** | Rewind within the stream's available DVR window | `config.live.mode = 'live-dvr'` (default), also settable per-source |
| **DVR window detection** | Computed from HLS playlist type/duration or DASH `timeShiftBufferDepth` | Automatic - reflects what the manifest actually reports (the player never fabricates DVR history) |
| **Seek-in-DVR** | Seeking is a no-op on `live-only` streams even if the manifest technically has a window | `canSeekInDvr` derived automatically; `controls.liveDVR` toggles the seek UI |
| **Live edge / sync position** | Target position just behind the live edge (5s low-latency / 15s standard delay) | Automatic |
| **Snap-to-live-edge** | One button/API call (`seekToLiveEdge()`) jumps back to live and resumes | `controls.liveEdgeButton` toggles the UI button |
| **Low-latency mode (LL-HLS / DASH low-latency)** | Detected via manifest `partTarget`/`partHoldBack` (HLS) or `lowLatencyEnabled` (DASH) | Automatic detection, engine-level; exposed as `isLowLatency` state |
| **Live status/latency telemetry** | `isLive`, `isAtLiveEdge`, `liveLatency`, `hasDvr`, `dvrWindow`, `canSeekInDvr`, `seekableRange` all live in player state for a host UI/dashboard to read | Always on |

---

## 3. Digital Rights Management (DRM)

| DRM System | Key System String | Notes |
|---|---|---|
| **Widevine** | `com.widevine.alpha` | Chrome/Edge/Firefox/Android |
| **PlayReady** | `com.microsoft.playready`, `.recommendation`, `com.chromecast.playready` | Edge/Windows/Chromecast |
| **FairPlay** | `com.apple.fps`, `.1_0` / `.2_0` / `.3_0` | Safari/iOS, **including legacy prefixed WebKit APIs** for older Safari versions |
| **ClearKey** | `org.w3.clearkey` | Inline key/JWK support - no license server required |

**Additional DRM capabilities:**
- Automatic capability probing (`navigator.requestMediaKeySystemAccess`) across all four systems with graceful capability fallback tiers.
- License/certificate fetch with exponential-backoff retry (default 3 attempts, 10s timeout - both configurable), per-attempt cancellation via `AbortController`, so in-flight requests are cleanly aborted on source change/destroy.
- Server certificates cached to avoid duplicate fetches across sessions.
- `licenseRequestInterceptor` / `licenseResponseInterceptor` hooks for consumers who need to modify the raw EME challenge/response.
- Global EME instrumentation (session created/closed, key change, license request/response, errors) surfaced as player events for DRM debugging/telemetry.

**Configurable:** `config.drm` (global) and `PlayerSource.drm` (per-source override) - covers each system's config, `certificateUrl` (FairPlay), `clearkeys` map, robustness levels, and retry/timeout.

---

## 4. Advertising & Monetization

| Standard | Support | Notes |
|---|---|---|
| **VAST** (2.0 – 4.2) | ✅ Full, hand-rolled namespace-safe XML parser (no third-party VAST library) | InLine + Wrapper chains (loop-protected, depth-limited), ad pods/sequencing, Linear + NonLinear (overlay) + Companion creatives, `UniversalAdId`, Open Measurement `Verification` nodes |
| **VMAP** (ad break scheduling) | ✅ Full | Resolves `start`/`end`/percentage/absolute cue points against content duration, `repeatAfter` recurring breaks, frequency capping (min time between breaks, min content watched, max ads per session/hour) |
| **Google IMA SDK** | ✅ Full | Muted-autoplay enforcement (Chrome policy compliant), silent-failure watchdogs (start-timeout + DOM-detachment monitoring), ad-blocker detection |
| **SIMID** (interactive ads, v1.0) | ✅ Full | Sandboxed iframe + postMessage bridge, per-creative origin allowlisting, full handshake/session state machine, click-through URL scheme validation |
| **HTML Overlay ads** | ✅ Full | Image/iframe/template/string-HTML creatives, responsive auto-sizing, trusted-origin allowlist (exact-match, not substring), configurable close button, duration-based auto-close |
| **VPAID** | ❌ Not implemented | Deprecated industry-wide in favor of VAST 4 + SIMID |
| **Server-Side Ad Insertion (SSAI)** | ❌ Not implemented | Everything is client-side (CSAI) - no manifest-stitched ad support |

**Ad break types:** pre-roll, mid-roll, post-roll - via VMAP scheduling *or* a separate manual `AdScheduler` API (numeric-seconds or percentage-based offsets). **These two scheduling mechanisms are not meant to be combined** - the codebase detects and warns if both are configured at once (fires `adschedulerconflict`), and the recommendation is to pick one per player instance.

**Ad state machine:** a strict transition table (`IDLE → REQUESTING → LOADED → PLAYING/PAUSED/BUFFERING/SKIPPING → ENDED`, with `ERROR` and a hard-reset path back to `IDLE`). Content playback state (position, volume, quality, audio/subtitle track, fullscreen, PiP) is captured before an ad break and restored after - with quality/seek only reapplied if they actually changed, to avoid a visible rebuffer stall on adaptive sources.

**Playback interception:** while an ad is playing, `play`/`pause`/`seek`/`setVolume`/`setMuted` calls on the main player are intercepted and redirected to the ad, so a consumer can't accidentally skip past or mute the wrong thing.

**Tracking events fired:** impression, creativeView, start, firstQuartile, midpoint, thirdQuartile, complete, pause, resume, mute, unmute, skip, click (+ click-through navigation), and error pixels with macro substitution (`[ERRORCODE]`, `[CACHEBUSTING]`, etc.) - delivered with automatic retry and 404/400 short-circuiting.

**Companion ads:** fully supported - rendered into developer-configured DOM slots matched by closest size, with a documented, intentional "no slot configured → no companion shown" fallback (never silently overlaps a playing linear ad).

**Configurable:** `config.ads` - master `enabled` switch, provider selection, tag URL, request timeout/retry, playback (skip mode/offset), tracking toggles + custom tracker callback, UI (countdown/skip-button visibility, companion slot mapping, HTML sanitizer), and provider-specific options. SIMID has its own sub-config (origin allowlist, handshake/creative timeouts, click-through permission). **Ads are automatically disabled for embedded (YouTube/Vimeo) sources** regardless of config, since there's no controllable video element to intercept.

---

## 5. Core Playback API

The full public method surface on the player controller:

`play()` · `pause()` · `togglePlay()` · `seek(time)` · `seekBy(seconds)` · `setVolume(0–1)` · `setMuted(bool)` · `toggleMute()` · `setPlaybackRate(rate)` · `toggleFullscreen()` · `enterPictureInPicture()` / `exitPictureInPicture()` / `togglePictureInPicture()` · `loadCaptions()` / `toggleCaptions()` / `setSubtitleTrack()` · `setSubtitleAppearance()` · `setQuality()` / `setAudioTrack()` · `setChapters()` / `nextChapter()` / `prevChapter()` / `seekToChapter()` · `setMarkers()` / `addMarker()` · `setLoop()` / `toggleLoop()` · `setAutoScroll()` / `toggleAutoScroll()` · `setSleepTimer()` and related sleep-timer getters · `loadSource()` · full playlist API (below) · `seekToLiveEdge()` · `getStatistics()` (fps, dropped frames, bitrate, bandwidth, buffer health, live latency) · `addEventListener()` / `onStateChange()` · `updateConfig()` / `exportConfig()` · `destroy()` (full teardown: timers, keyboard manager, ads, thumbnail provider, source manager, blob URL revocation).

Every play/pause/seek/volume call is routed through a registered-interceptor chain, which is how the ads subsystem cleanly takes over playback during a break without special-casing ad logic throughout the controller.

---

## 6. Playlist Management

`appendPlaylistItem` · `insertPlaylistItem` · `removePlaylistItem` · `replacePlaylistItem` · `movePlaylistItem` · `clearPlaylist` · `setPlaylist`/`loadPlaylist` · `next()` / `previous()` (cyclic, with a history stack for "previous")

- **Repeat modes:** `off` | `repeat-all`
- **Near-end auto-advance signal:** fires a `playlist-near-end` event a configurable number of seconds before the current item ends (default 1s) - useful for preloading the next item's UI.
- **Events:** `playlist-loaded`, `playlist-cleared`, `playlist-change`, `playlist-index-change`, `playlist-next`, `playlist-previous`, `playlist-item-added/removed/replaced/moved`, `playlist-near-end`, `playlist-repeat-change`.

**Configurable:** `config.playlistRepeatMode`, `config.nearEndThreshold`.

---

## 7. Subtitles & Closed Captions

- Track model supports `native` (`<track>` elements), `external`, in-manifest `hls`, and in-manifest `dash` subtitle sources.
- Language selection persists across sessions (see [§16](#16-user-preference-persistence)).

**Full subtitle appearance customization** (`SubtitleAppearance`) - every field a viewer can adjust:

| Property | Options |
|---|---|
| Font family | Default, Proportional Sans-Serif, Monospace Sans-Serif, Proportional Serif, Monospace Serif, Casual, Cursive, Small Capitals |
| Font size | 50%–400% |
| Font color | Named/hex color |
| Font opacity | 0–100% |
| Background color | Named/hex color |
| Background opacity | 0–100% |
| Window color | Named/hex color |
| Window opacity | 0–100% |
| Character edge style | Default, None, Raised, Depressed, Uniform, Drop Shadow |

Settings persist to `localStorage` and survive reloads.

**Configurable:** `controls.subtitles` / `controls.captions` (alias) turns the whole feature on/off - confirmed the UI genuinely disappears when set `false`, not just hidden.

---

## 8. Multi-Audio-Track Support

- Available on MP4 (native `audioTracks`), HLS (hls.js audio tracks), and DASH (dash.js tracks-for-type).
- Tracks are automatically de-duplicated by language/label/role/channel-count, with a friendly display label (including a channel descriptor like "Stereo" / "5.1" for DASH) generated via `Intl.DisplayNames` (with a ~25-language static fallback table for environments without it).
- Selected language persists across sessions and is auto-restored once the new source's track list populates.

**Configurable:** `controls.audioTracks`.

---

## 9. Chapters & Timeline Markers

- **Chapters:** `{ id, title, startTime, endTime?, description? }` - set per-source or at runtime.
- **Markers:** generic timeline points with a `type` (`chapter`, `ad`, `bookmark`, `analytics`, `metadata`, or any custom string), each independently show/hide-able by type.
- **Auto-generated metadata markers** from in-band ID3 (HLS) / emsg (DASH) events, automatically suppressed on live-only streams where they wouldn't make sense.
- **Public chapter-navigation API** - this is what lets a completely custom, external chapter UI be built outside the player's own controls (confirmed in the sandbox demo's "Chapter Navigation Examples" panel, built entirely against these primitives): `getChapters()`, `getActiveChapter()`, `nextChapter()`, `prevChapter()` (with a small grace window so "previous" restarts the current chapter if you're a few seconds in, matching standard media-player UX), `seekToChapter(idOrIndex)`, plus a `chapterchange` event and `player-select-chapter` custom DOM event for building your own clickable list.
- Built-in chapter popup button (keyboard-navigable, focus-restoring) and a chapters screen inside the Settings menu.
- Keyboard shortcuts: `Ctrl+→` / `Ctrl+←` for next/previous chapter.

**Configurable:** chapters require `smartSeek` to be enabled and are **opt-in** in the built-in settings menu (`controls.chapters` defaults to off - the popup button itself just self-hides if there are zero chapters, independent of that setting). Markers gated similarly via `controls.markers`.

---

## 10. Smart Seek - Thumbnail & Precise-Seek Preview

Four interchangeable thumbnail providers, auto-selected based on what's configured for the source (falls back in this order: VTT → sprite sheet → live frame capture):

| Provider | Source | How it works |
|---|---|---|
| **Frame Capture** | Any playable source | A hidden, muted, off-screen video seeks to the target time and the frame is captured to canvas/JPEG on the fly - works without any pre-generated thumbnail asset |
| **VTT (WebVTT cue sheet)** | `vttUrl` | Standard thumbnail-track format, supports sprite-region fragments (`#xywh=`) |
| **Sprite sheet** | `spriteUrl` + tile layout | Fixed-interval sprite-sheet lookup by tile position |
| **Auto** | Whatever's configured | Picks the best strategy automatically |

**Precise Seeking (filmstrip mode):** dragging the seekbar handle *upward* more than ~40px above the track switches from a single hover thumbnail to a live horizontal filmstrip of ~11 nearby frames (1 second apart, centered on the drag position) rendered directly above the seekbar - a frame-accurate scrubbing experience similar to professional NLE tools, backed by the same frame-capture pipeline with idle-throttling disabled during the drag so captures stream continuously.

**Also included:** snap-to-chapter and snap-to-marker on drag release (seek lands exactly on the marker/chapter boundary if you release nearby), smooth-drag interpolation, and full keyboard-accessible seeking (arrow keys ±5s, PageUp/PageDown ±30s, Home/End).

**Configurable:** `config.smartSeek` (boolean or detailed config: type, VTT/sprite URLs, thumbnails/storyboard sub-toggles, hover delay, chapter/marker snapping, caching) and `config.preciseSeek` (boolean or detailed config: frame-accuracy, smooth dragging, live-dragging, keyboard precision, continuous updates) - both independently disable-able and overridable per-source.

---

## 11. Sleep Timer

- Presets: Off, 10, 15, 20, 30, 45, 60 minutes, or **"End of current video"** (VOD only - rejected on live streams, since there's no defined end).
- Live countdown with second-by-second updates; automatically pauses playback and fires a clear expiration event when the timer runs out.
- **Tab-backgrounding recovery** - if the browser tab was backgrounded and the timer's `setInterval` got throttled, the remaining time is correctly caught up the moment the tab becomes visible again, rather than silently drifting.
- Full inspection API: current state, remaining time, active preset, running/expired flags.

**Configurable:** `controls.sleepTimer` toggles the settings-menu entry; custom preset list via `config.sleepTimer.presets`.

---

## 12. Media Session (OS / Lock-Screen Controls)

When the browser supports the Media Session API, the player automatically wires up:
- Title/artist/artwork metadata (from the source, with sensible fallbacks) shown on the lock screen / OS media overlay / hardware media keys.
- Hardware-button handlers: play, pause, seek backward/forward (default 10s), seek-to, and - only when a playlist with more than one item is loaded - previous/next track.
- Continuous position sync (duration, playback rate, current position) so OS scrubbers stay accurate.
- Playback-state sync so the OS shows the correct play/pause icon.

**Configurable:** always active when the browser API exists - no dedicated on/off flag was found (it's a "free" capability that doesn't need explicit opt-in).

---

## 13. Keyboard Shortcuts

| Key(s) | Action |
|---|---|
| `Space`, `K` | Play / Pause |
| `←` / `J` | Seek back 10s |
| `→` / `L` | Seek forward 10s |
| `↑` | Volume up (+10%) |
| `↓` | Volume down (−10%) |
| `M` | Mute toggle |
| `F` | Fullscreen toggle |
| `P` | Picture-in-Picture toggle |
| `R` | Loop toggle |
| `Ctrl` + `→` | Next chapter |
| `Ctrl` + `←` | Previous chapter |
| `Home` | Seek to start |
| `End` | Seek to end |
| `,` | Step back one frame |
| `.` | Step forward one frame |
| `Shift` + `>` | Increase playback speed |
| `Shift` + `<` | Decrease playback speed |
| `0`–`9` | Jump to 0%–90% of the timeline |

- **During ad playback**, only play/pause, mute, volume, and fullscreen shortcuts remain active - everything else that would affect content playback is suppressed.
- **Every shortcut respects the matching feature's config toggle** - e.g. seek shortcuts do nothing if the seekbar is disabled, chapter shortcuts do nothing if chapters are disabled.
- **Fully rebindable** - a developer can bind new keys, unbind defaults, replace the entire keymap, or register brand-new named actions with their own handlers.

**Configurable:** `config.hotkeys` - `true`/`false` (whole feature on/off), `bindings` (full replacement), `overrides` (additive changes to the defaults).

---

## 14. Picture-in-Picture, Mini & Floating Modes

| Mode | Description |
|---|---|
| **Native Picture-in-Picture** | Standard browser PiP window, with a Safari/iOS `webkitSetPresentationMode` fallback for browsers that don't support the modern API |
| **Mini display mode** | A distinct, fixed bottom-right-docked compact player layout (own CSS, not the OS-level PiP window) |
| **Floating display mode** | A distinct, fixed, screen-centered modal-style floating player layout |

**Configurable:** PiP control-bar button via `controls.pictureInPicture`/`controls.pip`; PiP as a settings-menu row is opt-in (`settings.pictureInPicture`); Mini/Floating are selected via `displayMode`.

---

## 15. Quality / Bitrate Control

- Manual quality selection alongside automatic adaptive bitrate (labeled "Auto (1080p)" style when Auto is picking a specific rung).
- Works across MP4 (source-swap between provided variants), HLS (hls.js level selection), and DASH (dash.js representation/quality selection).
- Duplicate-resolution renditions are automatically disambiguated with a bitrate suffix (e.g. two 1080p renditions at different bitrates both stay distinguishable in the menu).

**Configurable:** `controls.quality`.

---

## 16. User Preference Persistence

The following preferences are saved to `localStorage` and automatically restored on the next visit - via a wrapper that safely no-ops (never throws) when `localStorage` is unavailable (private browsing, SSR, quota exceeded)

This means: when someone changes a setting once, the player remembers it the next time they come back - even after closing the browser - by saving it to the browser's local storage (a small bit of storage on the user's device, not your server).

Concretely, these 9 things are remembered automatically:

· Volume level · Muted or not · Loop on/off · Auto-scroll on/off (vertical mode)· Playback speed · Captions on/off · All the subtitle style choices (font, color, size, etc.) · Which subtitle language was picked · Which audio language was picked

Note: the initial config values for these (e.g. `config.volume`) only apply on a viewer's very first visit - once a preference is saved, it always wins over the config default on subsequent loads.


---

## 17. Touch & Mobile Gesture Controls

| Gesture | Behavior | Zone | Configurable? |
|---|---|---|---|
| **Tap** | Play/pause toggle | Anywhere on video | Follows the play-button control toggle |
| **Double-tap (left side)** | Rewind by a configurable interval (default 10s), with a rewind-feedback overlay | Left half of video | Vertical mode: yes (`vertical.gestures.doubleTapToSeek`). Standard mode: tied to seekbar being enabled |
| **Double-tap (right side)** | Fast-forward by the same interval, with a forward-feedback overlay | Right half of video | Same as above |
| **Horizontal drag (swipe-to-seek)** | Scrubs playback position proportional to drag distance (up to 90s or full duration) | Anywhere on video (standard mode) | **Not currently configurable** - no dedicated toggle exists; only gated by "not live" and duration > 0 |
| **Vertical drag on right half (volume gesture)** | Adjusts volume proportionally to drag height, shows a live "N%" HUD pill | Right half of video, standard mode only | **The gesture itself has no dedicated toggle**; the resulting on-screen HUD can be hidden via the volume-overlay config |
| **Long-press (speed boost)** | Holding for 500ms boosts playback speed (default 2×), with an on-screen speed indicator | Anywhere on video | `vertical.gestures.longPressToSpeed` (on by default in vertical mode, off in standard mode) and `vertical.gestures.longPressSpeed` (target multiplier) |
| **Long-press + drag down (speed lock)** | While long-pressing, dragging down past a threshold arms a "lock" so 2× speed persists after release - press again and drag down to unlock. On-screen prompts guide the gesture ("Slide down to lock 2× speed" → "Release to lock") | Same | Bundled with the long-press toggle above - no separate flag |
| **Vertical swipe (feed navigation)** | See [§18](#18-vertical-feed-player-reels--shorts-style) below | Anywhere except buttons/seekbar/menus, vertical mode only | `vertical.gestures.swipeToNavigate`, `vertical.snapBehavior` |
| **Mouse wheel / trackpad scroll** | Desktop equivalent of the vertical swipe - scrolls to the next/previous playlist item | Vertical mode only | Implicitly requires a multi-item playlist |

A "brightness" gesture does **not** exist in the current codebase - noted here explicitly so it isn't assumed to be present.

---

## 18. Vertical Feed Player (Reels / Shorts-Style)

A dedicated `display-mode="vertical"` layout that turns the player into a TikTok/Reels/Shorts-style full-screen vertical feed.

| Feature | Description | Configurable? |
|---|---|---|
| **9:16 vertical layout** | Full-screen or contained vertical aspect-ratio player | Set via `displayMode = 'vertical'` |
| **Up/down navigation rail** | A configurable-side action rail (play, prev/next, volume popover, captions, fullscreen, settings) | `vertical.railPosition` (left/right), `vertical.railButtons`/`controls.groups.rail` (which buttons + order), `controls.actionRail` (show/hide the whole rail) |
| **Swipe-to-navigate** | Vertical drag anywhere except on interactive elements (buttons/seekbar/menus) advances to the next/previous item | `vertical.gestures.swipeToNavigate`, `vertical.snapBehavior` |
| **Live drag-follow preview** | While dragging, the next/previous video's frame slides in and tracks your finger 1:1 in real time - released past the swipe threshold (default 50px) completes the transition and switches videos; released short of it springs back with no change, exactly like Reels/Shorts | `vertical.swipeThreshold` (px) |
| **Mouse-wheel navigation** | Desktop scroll wheel triggers the same next/previous transition (instant snap, no drag-follow - wheel deltas are discrete events) | Same gates as swipe |
| **Snap/crossfade transition animation** | Smooth slide transition on programmatic (button-triggered) navigation | Duration/easing via `--player-vertical-transition-duration` / `--player-vertical-transition-easing` CSS variables |
| **Auto-scroll** | Automatically advances to the next feed item when the current one ends | `vertical.autoScroll` (off by default) |
| **Loop behavior** | Documented single-video-loop and playlist-loop settings for vertical mode | `vertical.loopSingleVideo`, `vertical.loopPlaylist` |
| **Center play-pulse overlay** | A pulsating center play button shown when paused | `vertical.showCenterPlayButton` |
| **Vertical progress bar** | Embedded seekbar in the action rail | `vertical.showProgressBar`, `controls.timeline`, `controls.seekbar` |
| **Mobile viewport correctness** | Uses dynamic viewport units (`100dvh`/`100dvw`) layered over standard `vh`/`vw`, so the layout doesn't jump when a mobile browser's address bar shows/hides | Always on for vertical mode |
| **Gesture-safe touch handling** | `touch-action: none` on the video surface prevents the browser's native scroll/zoom from fighting the custom swipe gestures | Always on for vertical mode |
| **Thumbnail prefetching for neighbors** | The next/previous playlist items' thumbnails are pre-generated on an idle callback, which is what makes the drag-follow preview show a real frame instead of a blank/black placeholder | Automatic - depends on the source actually being reachable (see note below) |

> **Operational note:** the drag-follow preview's "next video" frame requires the *browser* to be able to load that video cross-origin for canvas capture (`crossOrigin: 'anonymous'`). If your video CDN/bucket doesn't send proper CORS headers for the origin your app is served from, the preview falls back to a black frame even though the swipe mechanics themselves work correctly - this is a hosting/CORS configuration matter, not a player bug (confirmed and resolved for this project's own S3 bucket during development).

---

## 19. Seekbar

- **Hover/drag thumbnail preview**, supporting both single frame-capture images and cropped sprite-sheet regions.
- **Chapter markers** rendered directly on the timeline, click-to-seek.
- **Precise-seeking filmstrip mode** - see [§10](#10-smart-seek--thumbnail--precise-seek-preview).
- **Marker-snap-on-release** - seeking near a marker/chapter snaps exactly onto it.
- **Live DVR-aware rendering** - distinguishes VOD progress from a live DVR window, and disables interactivity entirely for pure live streams with no DVR.
- **Smooth-drag interpolation** for a polished scrubbing feel.
- **Full keyboard accessibility** (arrow keys, Page Up/Down, Home/End) with proper `role="slider"` semantics.
- **Elapsed/remaining time toggle** - click the time display to switch between "elapsed" and "time remaining."

**Configurable:** `controls.timelinePreview`/`hoverTooltip`/`tooltip` for the hover preview; `smartSeek` sub-flags for thumbnails/storyboard; snap-to-chapter/marker behavior via the Smart Seek/Precise Seek config.

---

## 20. Volume Control

- Standard click/drag slider in the control bar.
- Vertical-mode rail equivalent: a popover slider that reveals on hover (desktop) or touch-hold (mobile), auto-hiding after 3 seconds of inactivity.
- Touch-drag gesture with a live percentage HUD (see [§17](#17-touch--mobile-gesture-controls)).
- Mute toggle button.

**Configurable:** `controls.volume` (whole control), `controls.mute`, and the volume-overlay HUD independently via the overlay config.

---

## 21. Playback Speed Control

- Standard-mode presets: `0.25× 0.5× 0.75× 1× 1.25× 1.5× 1.75× 2× 2.5× 3× 4×`
- Vertical (Reels-style) presets, deliberately reduced for a simpler feed UI: `0.5× 1× 2×`
- Both preset lists are fully overridable.
- Reflected in the long-press gesture indicator and the settings-menu speed screen.

**Configurable:** `config.playback.playbackRates` (override the preset list), `controls.playbackSpeed`/`vertical.menus.playbackSpeed` (show/hide the control).

---

## 22. Settings Menu

A multi-screen settings stack (not a flat list) - each row can drill into its own screen:

| Screen | Contents |
|---|---|
| **Main** | Playback Speed, Quality, Audio Dubs, Subtitles, Chapters, Picture-in-Picture (opt-in), Fullscreen (opt-in), and - depending on mode - either Auto Scroll (vertical) or Sleep Timer + Loop Video (standard) |
| **Playback Speed** | List of speed presets |
| **Quality** | Available renditions, with an "HD" badge for 720p and above |
| **Audio Dubs** | Available audio-language tracks |
| **Subtitles** | Off + available subtitle tracks, plus a link into styling options |
| **Subtitle Styling** | Font family, font color, font size, font opacity, background color/opacity, window color/opacity, character edge style - each its own picker screen - plus a one-click Reset |
| **Sleep Timer** | Off / preset durations / "End of video" (VOD only) |
| **Chapters** | Full chapter list with timestamps |

Custom screens and custom rows can be registered by a host application or plugin without touching player internals.

**Configurable:** every row above has its own visibility flag (see individual sections), plus a global `settings.order` array to reorder the main screen's rows, and legacy-alias support (e.g. `captions` → `subtitles`) so older configs keep working.

---

## 23. Theming & White-Label Customization

- **Four built-in presets**: `light`, `dark`, `glass-dark` (default), `glass-light`.
- **A very large surface of `--player-*` CSS custom properties** (70+) covering colors, glassmorphism blur/shadow, spacing, border radius, typography, button sizing, the live badge, the volume bar, and a full sub-group specifically for the Smart Seek thumbnail-preview tooltip (border, shadow, background, sizing, animation, arrow, backdrop blur, and more) - every one of them independently overridable by a host application for full white-label branding.
- **Custom variable passthrough** - any additional CSS variable can be injected via theme config without needing the SDK to predefine it.
- **Icon registry** - every icon (24 built-in icons: play, pause, volume states, settings, fullscreen, PiP, captions, seek, chapters, markers, etc.) can be replaced globally, via a named "icon pack," or per player instance - accepting a raw SVG string, a template, a DOM element, or a function (for dynamic icons like the seek-amount badge).
- **Shadow DOM `::part()` selectors** and **named slots** (top/bottom overlays, watermark, logo, ad overlay, left/right/center control groups, and vertical-mode-specific slots) for structural customization beyond CSS variables alone.

**Configurable:** `config.theme.preset` + per-property overrides, `registerIconPack()`/`useIconPack()`/`setIcon()`, full CSS variable overrides, slot content injection.

---

## 24. Plugin & Extension API

A genuine third-party extension surface, not just internal hooks:

| Method | Purpose |
|---|---|
| `registerPlugin(plugin)` | Installs a full plugin implementing the `PlayerPlugin` interface |
| `registerControl(id, renderer)` | Adds a custom control-bar button |
| `registerOverlay(id, options)` / `setOverlayTemplate()` / `setOverlayTiming()` | Registers or customizes a temporary feedback overlay (buffering, error, volume, speed, live, ads, etc.) |
| `registerSettingsItem(item)` | Adds a custom row to the settings menu |
| `registerSettingsScreen(id, renderer)` | Adds an entirely custom settings sub-screen |
| `registerContextMenuItem(item)` | Adds an item to the right-click context menu |
| `disableContextMenu()` | Turns off the custom context menu entirely |

A `PlayerPlugin` can also contribute its own control buttons, settings screen, and settings items directly from the plugin object, plus tie into lifecycle hooks (install, attach, etc.).

**Config export/import**: `exportConfig()`/`updateConfig()` - needed because the live config uses reactive Proxy objects internally that don't survive a plain `structuredClone`.

---

## 25. Responsive / Mobile Layout

- Two dedicated breakpoints (600px and 480px) that shrink control-bar padding, icon sizes, overlay sizing, and settings-menu dimensions for small screens.
- Vertical mode gets its own independent restyle (full-width rounded control bar, bottom-sheet settings menu with a visible drag handle) regardless of screen size.
- Dynamic viewport units (`dvh`/`dvw`) prevent mobile-browser-chrome resize jank in vertical fullscreen.
- Dedicated `touch-action` handling so custom gestures don't fight native browser scroll/zoom.

**Configurable:** layout behavior is automatic/CSS-driven, not a developer-facing toggle.

---

## 26. Empty State, Loading & Error UI

| State | Behavior | Configurable? |
|---|---|---|
| **Empty state** (no source loaded) | Icon, title, subtitle, and a call-to-action button, fully data-driven | **Yes, genuinely** - `config.emptyState` can be `false` to disable entirely, or given custom `icon`/`title`/`subtitle`/`buttonText`, or a completely custom `render()` function replacing the built-in markup outright |
| **Error overlay** | Alert icon, error message, "Retry Playback" button that reloads the current source | Overlay-level show/hide via config; content fully replaceable via `setOverlayTemplate('error', ...)` |
| **Buffering/loading spinner** | Standard loading indicator | `controls.loadingSpinner` |
| **Replay overlay** | Shown at end of playback | `controls.replayButton` |
| **Toast notifications** | Generic success/error/info messages, auto-dismiss after 3 seconds | Programmatic, not config-gated |
| **Sleep-timer-expired dialog** | Modal shown when the sleep timer runs out | Tied to sleep timer configuration |

---

## 27. Error Handling & Network Resilience

- **HLS**: automatic recovery ladder for media errors (recover → swap audio codec + recover → full detach/reattach), exponential-backoff retry for network/manifest errors (up to 3 attempts), with DRM license 401/403 treated as non-recoverable immediately rather than retried pointlessly.
- **DASH**: exponential-backoff retry with playhead/play-state restoration on recovery; auth and unsupported-key-system errors are non-recoverable.
- **DRM**: same exponential-backoff retry pattern for license/certificate fetches.
- **Cancellation on destroy/source-change**: every in-flight network request (DRM, thumbnails, manifests) is tied to an `AbortController` that's triggered on destroy or source swap, and handler-level guards prevent a stale async callback from a previous source from corrupting current playback state.
- **User-facing error messages**: common HTTP failure classes (404, 403, 5xx) get friendly, specific error text rather than a raw stack trace.

---

## 28. Plain HTML & Browser CDN

You can use `<streamit-player>` directly in standard HTML via Modern ESM CDN or Classic IIFE CDN:

### Modern ESM (`<script type="module">`)
```html
<!DOCTYPE html>
<html>
<head>
  <script type="module" src="https://cdn.jsdelivr.net/npm/streamit-player/dist/streamit-player.esm.min.js"></script>
</head>
<body>
  <streamit-player id="player" style="width: 100%; aspect-ratio: 16/9; display: block;"></streamit-player>
  <script type="module">
    const player = document.getElementById('player');
    player.config = {
      source: { type: 'hls', src: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8' },
      playback: { autoplay: true, muted: true }
    };
  </script>
</body>
</html>
```

### Classic Script (`IIFE`)
```html
<script src="https://cdn.jsdelivr.net/npm/streamit-player/dist/streamit-player.iife.min.js"></script>
<streamit-player id="player" style="width: 100%; aspect-ratio: 16/9; display: block;"></streamit-player>
<script>
  window.addEventListener('DOMContentLoaded', function() {
    var player = document.getElementById('player');
    player.config = {
      source: { type: 'mp4', src: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4' }
    };
  });
</script>
```

---

## 29. React 18 Integration

`<streamit-player>` is a native Custom Element registered by `streamit-player`. In React <19, pass complex objects via `ref` and `useEffect`:

```tsx
import { useEffect, useRef } from 'react';
import 'streamit-player';
import type { PlayerConfiguration, PlayerController } from 'streamit-player/core';

export function VideoPlayer({ config }: { config: PlayerConfiguration }) {
  const ref = useRef<HTMLElement & { config?: PlayerConfiguration; getController?: () => PlayerController }>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.config = config;
    }
  }, [config]);

  return <streamit-player ref={ref} style={{ width: '100%', aspectRatio: '16/9', display: 'block' }} />;
}
```

---

## 30. React 19 Integration

React 19 natively passes properties to Custom Elements without requiring `ref` workarounds:

```tsx
import 'streamit-player';
import type { PlayerConfiguration } from 'streamit-player/core';

export function VideoPlayer({ config }: { config: PlayerConfiguration }) {
  return (
    <streamit-player
      config={config}
      onPlayerPlay={() => console.log('Playing')}
      style={{ width: '100%', aspectRatio: '16/9', display: 'block' }}
    />
  );
}
```

---

## 31. Next.js Integration (App Router & Pages Router)

`<streamit-player>` guards DOM registrations in SSR/Node.js contexts. In Next.js, render with dynamic import (`ssr: false`) to avoid client-server hydration mismatch:

```tsx
// components/StreamitPlayerClient.tsx
'use client';

import { useEffect, useRef } from 'react';
import 'streamit-player';
import type { PlayerConfiguration } from 'streamit-player/core';

export default function StreamitPlayerClient({ config }: { config: PlayerConfiguration }) {
  const ref = useRef<HTMLElement & { config?: PlayerConfiguration }>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.config = config;
    }
  }, [config]);

  return <streamit-player ref={ref} style={{ width: '100%', aspectRatio: '16/9', display: 'block' }} />;
}
```

```tsx
// app/watch/page.tsx
import dynamic from 'next/dynamic';

const StreamitPlayer = dynamic(() => import('@/components/StreamitPlayerClient'), {
  ssr: false,
  loading: () => <div style={{ width: '100%', aspectRatio: '16/9', background: '#0f172a' }} />
});

export default function WatchPage() {
  return (
    <main>
      <h1>Video Player</h1>
      <StreamitPlayer config={{ source: { type: 'hls', src: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8' } }} />
    </main>
  );
}
```

---

## 32. Laravel Integration (Blade & Inertia)

### Laravel Blade with Vite
In `resources/js/app.js`:
```javascript
import 'streamit-player';
```

In `resources/views/watch.blade.php`:
```html
@extends('layouts.app')

@section('content')
<div class="video-container" style="max-width: 960px; margin: 0 auto; aspect-ratio: 16/9;">
    <streamit-player id="laravel-player" style="width: 100%; height: 100%; display: block;"></streamit-player>
</div>

@push('scripts')
<script>
    document.addEventListener('DOMContentLoaded', () => {
        const player = document.getElementById('laravel-player');
        if (player) {
            player.config = {
                source: { type: 'hls', src: '{{ $video->stream_url }}' }
            };
        }
    });
</script>
@endpush
@endsection
```

### Laravel Inertia (Vue 3)
```html
<template>
  <div style="width: 100%; aspect-ratio: 16/9;">
    <streamit-player ref="playerRef" style="width: 100%; height: 100%; display: block;" />
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import 'streamit-player';

const props = defineProps({ videoUrl: String });
const playerRef = ref(null);

onMounted(() => {
  if (playerRef.value) {
    playerRef.value.config = {
      source: { type: 'hls', src: props.videoUrl }
    };
  }
});
</script>
```

---

## 33. WordPress Integration (Classic & Gutenberg)

### WordPress Classic PHP Shortcode (`functions.php`)
```php
function register_streamit_player() {
    wp_enqueue_script(
        'streamit-player-iife',
        'https://cdn.jsdelivr.net/npm/streamit-player/dist/streamit-player.iife.min.js',
        array(),
        '1.0.0',
        true
    );
}
add_action('wp_enqueue_scripts', 'register_streamit_player');

function render_streamit_player_shortcode($atts) {
    $atts = shortcode_atts(array(
        'src' => '',
        'type' => 'mp4',
        'id' => 'streamit-' . wp_rand(1000, 9999)
    ), $atts);

    ob_start();
    ?>
    <div style="width: 100%; aspect-ratio: 16/9; max-width: 960px; margin: 20px auto;">
        <streamit-player id="<?php echo esc_attr($atts['id']); ?>" style="width:100%; height:100%; display:block;"></streamit-player>
    </div>
    <script>
        document.addEventListener('DOMContentLoaded', function() {
            var el = document.getElementById('<?php echo esc_attr($atts['id']); ?>');
            if (el) el.config = { source: { type: '<?php echo esc_attr($atts['type']); ?>', src: '<?php echo esc_url($atts['src']); ?>' } };
        });
    </script>
    <?php
    return ob_get_clean();
}
add_shortcode('streamit_player', 'render_streamit_player_shortcode');
```

---

## 34. Headless / Core-Only TypeScript

Build your own bespoke UI around the headless engine with **zero Lit or UI DOM overhead**:

```typescript
import { PlayerController } from 'streamit-player/core';
import type { PlayerConfiguration, PlayerState } from 'streamit-player/core';

const videoElement = document.getElementById('my-video') as HTMLVideoElement;
const config: PlayerConfiguration = {
  source: {
    type: 'hls',
    src: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8'
  }
};

const controller = new PlayerController(videoElement, config);

controller.onStateChange((state: PlayerState) => {
  console.log('State updated:', state.playbackState, state.currentTime);
});

await controller.play();
```

---

*This document reflects the codebase as of the last update. Regenerate/re-audit before using it in an external-facing comparison, since features and config surfaces evolve.*
