import 'streamit-player';
import { formatTime, VastProvider, VmapProvider, ImaProvider, SimidRuntime } from 'streamit-player/core';

document.addEventListener('DOMContentLoaded', () => {
  const player = document.getElementById('test-player') as any;
  (window as any).player = player;

  const sourceTypeSelect = document.getElementById('source-type') as HTMLSelectElement;
  const displayModeSelect = document.getElementById('display-mode-select') as HTMLSelectElement;
  const videoUrlInput = document.getElementById('video-url-input') as HTMLInputElement;
  const localFilePicker = document.getElementById('local-file-picker') as HTMLInputElement;
  const selectedFileName = document.getElementById('selected-file-name') as HTMLSpanElement;
  const loadSourceBtn = document.getElementById('load-source-btn') as HTMLButtonElement;

  // Playlist elements
  const addUrlBtn = document.getElementById('add-url-btn') as HTMLButtonElement;
  const addFileBtn = document.getElementById('add-file-btn') as HTMLButtonElement;
  const fileLabel = document.getElementById('file-label') as HTMLLabelElement;
  const videoFileExtraContainer = document.getElementById(
    'video-file-extra-container'
  ) as HTMLDivElement;

  const isPlaylistSource = (url: string | null): boolean => {
    if (!url) return false;
    const isVertical = displayModeSelect.value === 'vertical';
    if (!isVertical) return false;

    const norm = url.split('?')[0].toLowerCase();

    if (sourceTypeSelect.value === 'file') {
      return (
        activeFileBlobUrls.length > 1 &&
        activeFileBlobUrls.some((u) => u.split('?')[0].toLowerCase() === norm)
      );
    }

    const urls: string[] = [videoUrlInput.value.trim()];
    const extraInputs = Array.from(
      document.querySelectorAll('.playlist-url-input')
    ) as HTMLInputElement[];
    extraInputs.forEach((input) => {
      const val = input.value.trim();
      if (val) urls.push(val);
    });
    return urls.length > 1 && urls.some((u) => u.split('?')[0].toLowerCase() === norm);
  };

  let activeFeedIndex = 0;

  const addPlaylistInputRow = (url: string = '') => {
    const row = document.createElement('div');
    row.className = 'playlist-url-row';
    row.style.cssText = 'display: flex; gap: 8px; align-items: center;';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'playlist-url-input';
    input.placeholder = 'Additional Video URL...';
    input.value = url;

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'remove-url-btn';
    removeBtn.innerHTML = '✕';
    removeBtn.addEventListener('click', () => {
      row.remove();
    });

    row.appendChild(input);
    row.appendChild(removeBtn);
    const container = document.getElementById('video-url-extra-container');
    if (container) {
      container.appendChild(row);
    }
  };

  const addPlaylistFileRow = (file: File) => {
    const row = document.createElement('div') as HTMLDivElement & { file: File };
    row.className = 'playlist-url-row playlist-file-row';
    row.style.cssText = 'display: flex; gap: 8px; align-items: center;';
    row.file = file;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'playlist-url-input';
    input.readOnly = true;
    input.value = file.name;

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'remove-url-btn';
    removeBtn.innerHTML = '✕';
    removeBtn.addEventListener('click', () => {
      row.remove();
    });

    row.appendChild(input);
    row.appendChild(removeBtn);
    if (videoFileExtraContainer) {
      videoFileExtraContainer.appendChild(row);
    }
  };

  addFileBtn.addEventListener('click', () => {
    const tempInput = document.createElement('input');
    tempInput.type = 'file';
    tempInput.accept = 'video/*';
    tempInput.style.display = 'none';
    tempInput.addEventListener('change', () => {
      if (tempInput.files?.[0]) {
        addPlaylistFileRow(tempInput.files[0]);
      }
    });
    tempInput.click();
  });

  const MP4_PLAYLIST_PRESETS = [
    'https://player-sandbox.s3.ap-south-1.amazonaws.com/130970-748605024_medium.mp4',
    'https://player-sandbox.s3.ap-south-1.amazonaws.com/6535337-uhd_2160_4096_25fps.mp4',
    'https://player-sandbox.s3.ap-south-1.amazonaws.com/151109-800210380.mp4',
    'https://player-sandbox.s3.ap-south-1.amazonaws.com/189692-886572510.mp4',
    'https://player-sandbox.s3.ap-south-1.amazonaws.com/7188507_Vertical_Video_Vertical_Content_2160x3840.mp4',
    'https://player-sandbox.s3.ap-south-1.amazonaws.com/14834206_2160_3840_30fps.mp4',
  ];

  const rebuildUrlInputs = (urls: string[]) => {
    const container = document.getElementById('video-url-extra-container');
    if (container) {
      const rows = container.querySelectorAll('.playlist-url-row');
      rows.forEach((row) => row.remove());
    }
    if (videoUrlInput) {
      videoUrlInput.value = urls[0] || '';
    }
    for (let i = 1; i < urls.length; i++) {
      addPlaylistInputRow(urls[i]);
    }
  };

  const syncUrlInputs = (sourceTypeChanged = false) => {
    const isVertical = displayModeSelect.value === 'vertical';
    const val = sourceTypeSelect.value;

    const container = document.getElementById('video-url-extra-container');
    if (container) {
      if (isVertical) {
        container.classList.add('vertical-playlist-scroll');
      } else {
        container.classList.remove('vertical-playlist-scroll');
      }
    }

    if (isVertical && val !== 'file') {
      addUrlBtn.style.display = 'inline-block';
    } else {
      addUrlBtn.style.display = 'none';
    }

    if (val === 'file') {
      panelUrlInput.style.display = 'none';
      panelFileInput.style.display = 'block';

      if (isVertical) {
        fileLabel.textContent = 'SELECT VIDEO FILES';
        addFileBtn.style.display = 'inline-block';
        videoFileExtraContainer.style.display = 'flex';
        videoFileExtraContainer.classList.add('vertical-playlist-scroll');
      } else {
        fileLabel.textContent = 'Select Video File';
        addFileBtn.style.display = 'none';
        videoFileExtraContainer.style.display = 'none';
        videoFileExtraContainer.classList.remove('vertical-playlist-scroll');
      }
      return;
    } else {
      panelUrlInput.style.display = 'block';
      panelFileInput.style.display = 'none';
      fileLabel.textContent = 'Select Video File';
      addFileBtn.style.display = 'none';
      videoFileExtraContainer.style.display = 'none';
      videoFileExtraContainer.classList.remove('vertical-playlist-scroll');
    }

    if (!isVertical) {
      if (val === 'blob') {
        if (activeGeneratedBlobUrl) {
          rebuildUrlInputs([activeGeneratedBlobUrl]);
        } else {
          rebuildUrlInputs(['Local Blob URL Preset (will generate on load)']);
        }
      } else if (presets[val]?.[0]) {
        rebuildUrlInputs([presets[val][0].url]);
      } else {
        rebuildUrlInputs(['']);
      }
    } else {
      if (val === 'mp4') {
        const firstPreset =
          presets['mp4'][0]?.url ||
          'https://cdn.plyr.io/static/demo/View_From_A_Blue_Moon_Trailer-1080p.mp4';
        rebuildUrlInputs([firstPreset, ...MP4_PLAYLIST_PRESETS]);
      } else if (sourceTypeChanged) {
        if (val === 'blob') {
          if (activeGeneratedBlobUrl) {
            rebuildUrlInputs([activeGeneratedBlobUrl]);
          } else {
            rebuildUrlInputs(['Local Blob URL Preset (will generate on load)']);
          }
        } else if (presets[val]?.[0]) {
          rebuildUrlInputs([presets[val][0].url]);
        } else {
          rebuildUrlInputs(['']);
        }
      }
    }
  };

  addUrlBtn.addEventListener('click', () => {
    addPlaylistInputRow('');
  });

  displayModeSelect.addEventListener('change', () => {
    if (player) {
      player.displayMode = displayModeSelect.value as 'standard' | 'vertical';
    }
    syncUrlInputs(false);
  });

  const liveModeSelect = document.getElementById('live-mode-select') as HTMLSelectElement;
  liveModeSelect.addEventListener('change', () => {
    if (player) {
      const mode = liveModeSelect.value;
      player.setAttribute('live-mode', mode);
    }
  });

  // Dynamic panels
  const panelUrlInput = document.getElementById('panel-url-input') as HTMLDivElement;
  const panelFileInput = document.getElementById('panel-file-input') as HTMLDivElement;

  // Telemetry items
  const stateStatus = document.getElementById('state-status') as HTMLSpanElement;
  const stateFormat = document.getElementById('state-format') as HTMLSpanElement;
  const stateTime = document.getElementById('state-time') as HTMLSpanElement;
  const stateVolume = document.getElementById('state-volume') as HTMLSpanElement;
  const stateQuality = document.getElementById('state-quality') as HTMLSpanElement;
  const stateSubtitles = document.getElementById('state-subtitles') as HTMLSpanElement;
  const stateAudio = document.getElementById('state-audio') as HTMLSpanElement;
  const statePip = document.getElementById('state-pip') as HTMLSpanElement;
  const stateLive = document.getElementById('state-live') as HTMLSpanElement;
  const stateLowLatency = document.getElementById('state-low-latency') as HTMLSpanElement;
  const stateLiveLatency = document.getElementById('state-live-latency') as HTMLSpanElement;
  const stateDvrWindow = document.getElementById('state-dvr-window') as HTMLSpanElement;

  // Verified Presets Map
  const presets: Record<
    string,
    Array<{
      name: string;
      url: string;
      subtitles?: Array<{ src: string; label: string; srclang: string; default?: boolean }>;
      variants?: Array<{ src: string; label: string }>;
    }>
  > = {
    mp4: [
      {
        name: 'View From A Blue Moon Trailer',
        url: 'https://cdn.plyr.io/static/demo/View_From_A_Blue_Moon_Trailer-1080p.mp4',
      },
      {
        name: 'Big Buck Bunny (MP4 - Single Quality)',
        url: 'https://www.w3schools.com/html/mov_bbb.mp4',
      },
      {
        name: 'Ayutthaya HD (MP4 - CORS Enabled)',
        url: 'https://photo-sphere-viewer-data.netlify.app/assets/equirectangular-video/Ayutthaya_HD.mp4',
      },
    ],
    mov: [
      {
        name: 'Local MOV Video Test',
        url: '/videos/file_example_MOV_1280_1_4MB.mov',
      },
    ],
    hls: [
      {
        name: 'LL-HLS Live Demo',
        url: 'https://storage.googleapis.com/shaka-demo-assets/angel-one-hls/hls.m3u8',
      },
      {
        name: 'Mux HLS (CEA-608 Embedded Captions)',
        url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
      },
      {
        name: 'Angel One HLS (Multiple Audio Languages & Subtitles)',
        url: 'https://storage.googleapis.com/shaka-demo-assets/angel-one-hls/hls.m3u8',
      },
    ],
    dash: [
      {
        name: 'DASH Live Stream (Dash-IF LiveSim)',
        url: 'https://livesim.dashif.org/livesim/chunkdur_1/ato_7/testpic4_8s/Manifest.mpd',
      },
      {
        name: 'Sintel DASH (Multiple Audio Languages & Subtitles)',
        url: 'https://storage.googleapis.com/shaka-demo-assets/sintel/dash.mpd',
      },
      {
        name: 'Angel One DASH (Multiple Audio Languages)',
        url: 'https://storage.googleapis.com/shaka-demo-assets/angel-one/dash.mpd',
      },
    ],
    webm: [
      {
        name: 'Sintel Open Movie (WebM - Full HD 720p)',
        url: 'https://upload.wikimedia.org/wikipedia/commons/transcoded/f/f1/Sintel_movie_4K.webm/Sintel_movie_4K.webm.720p.vp9.webm',
      },
      {
        name: 'Sintel Open Movie (WebM - 480p)',
        url: 'https://upload.wikimedia.org/wikipedia/commons/transcoded/f/f1/Sintel_movie_4K.webm/Sintel_movie_4K.webm.480p.vp9.webm',
      },
      {
        name: 'Sintel Short Trailer (52s)',
        url: 'https://media.w3.org/2010/05/sintel/trailer.webm',
      },
    ],
    embed: [
      {
        name: 'Sintel Open Movie (YouTube Embed)',
        url: 'https://www.youtube.com/watch?v=ICYTZWCy4I8',
      },
      {
        name: 'Vimeo Embed Video',
        url: 'https://vimeo.com/76979871',
      },
    ],
  };

  let activeGeneratedBlobUrl: string | null = null;
  let activeFileBlobUrls: string[] = [];

  // Cleanup active blob URL on unload
  window.addEventListener('beforeunload', () => {
    if (activeGeneratedBlobUrl) {
      URL.revokeObjectURL(activeGeneratedBlobUrl);
      activeGeneratedBlobUrl = null;
    }
    if (activeFileBlobUrls.length > 0) {
      activeFileBlobUrls.forEach((url) => URL.revokeObjectURL(url));
      activeFileBlobUrls = [];
    }
  });

  // Handle panel swaps on source type dropdown selection
  let isInitialLoad = true;
  sourceTypeSelect.addEventListener('change', () => {
    syncUrlInputs(true);
    isInitialLoad = false;
  });

  // Track local file selection
  localFilePicker.addEventListener('change', () => {
    if (localFilePicker.files?.[0]) {
      selectedFileName.textContent = ` (${localFilePicker.files[0].name})`;
    } else {
      selectedFileName.textContent = '';
    }
  });

  // Tab switching logic for Chapters Demo Panel
  const tabButtons = Array.from(document.querySelectorAll('.demo-tab-btn')) as HTMLButtonElement[];
  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      tabButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');

      const targetTab = btn.getAttribute('data-tab');
      const tabContents = Array.from(
        document.querySelectorAll('.demo-tab-content')
      ) as HTMLDivElement[];
      tabContents.forEach((content) => {
        if (content.id === `demo-tab-${targetTab}`) {
          content.style.display = 'block';
        } else {
          content.style.display = 'none';
        }
      });

      if (targetTab === 'ott') {
        const chapters = player.playerState?.chapters;
        if (chapters && chapters.length > 0) {
          loadOttThumbnails(chapters);
        }
      }
    });
  });

  let currentChaptersJson = '';
  let currentChaptersSource = '';
  const externalPanel = document.getElementById('external-chapters-panel') as HTMLDivElement;
  const sidebarContainer = document.getElementById('sidebar-chapters-container') as HTMLDivElement;
  const courseContainer = document.getElementById('course-chapters-container') as HTMLDivElement;
  const ottContainer = document.getElementById('ott-chapters-container') as HTMLDivElement;

  let ottThumbnailsLoadedForSource = '';

  const loadOttThumbnails = async (chapters: any[]) => {
    const currentSource = player.playerState?.currentSource || '';
    if (!currentSource || ottThumbnailsLoadedForSource === currentSource) return;
    ottThumbnailsLoadedForSource = currentSource;

    const activeProvider = player.controllerInstance?.getThumbnailProvider();

    for (let idx = 0; idx < chapters.length; idx++) {
      const ch = chapters[idx];
      try {
        const thumbInfo = await activeProvider?.getThumbnail(ch.startTime, 'low');
        if (thumbInfo && thumbInfo.url) {
          const thumbContainer = document.getElementById(`ott-thumb-${idx}`);
          if (thumbContainer) {
            if (thumbContainer.querySelector('.ott-scene-thumb-img')) continue;
            const img = document.createElement('img');
            img.src = thumbInfo.url;
            img.className = 'ott-scene-thumb-img';

            // Remove existing SVG play icon if present
            const svg = thumbContainer.querySelector('svg');
            if (svg) svg.remove();

            // Insert img before the badge
            thumbContainer.insertBefore(img, thumbContainer.firstChild);
          }
        }
      } catch (err) {
        console.warn(`Failed to fetch thumbnail for chapter ${idx} at time ${ch.startTime}:`, err);
      }
    }
  };

  const renderExternalChapters = (chapters: any[]) => {
    const chaptersJson = JSON.stringify(chapters);
    const currentSource = player.playerState?.currentSource || '';
    if (chaptersJson === currentChaptersJson && currentSource === currentChaptersSource) return;
    currentChaptersJson = chaptersJson;
    currentChaptersSource = currentSource;

    if (!chapters || chapters.length === 0) {
      externalPanel.style.display = 'none';
      sidebarContainer.innerHTML = '';
      courseContainer.innerHTML = '';
      ottContainer.innerHTML = '';
      ottThumbnailsLoadedForSource = '';
      return;
    }

    externalPanel.style.display = 'block';

    // 1. Render Standard Sidebar style chapters list
    sidebarContainer.innerHTML = chapters
      .map((ch, idx) => {
        return `
        <div class="sidebar-chapter-item" data-index="${idx}">
          <div class="sidebar-chapter-title">
            <strong>${ch.title}</strong>
            <div class="sidebar-chapter-description">${ch.description || ''}</div>
          </div>
          <span class="sidebar-chapter-time-badge">${formatTime(ch.startTime)}</span>
        </div>
      `;
      })
      .join('');

    // Bind click handlers to Sidebar items
    Array.from(sidebarContainer.querySelectorAll('.sidebar-chapter-item')).forEach((item) => {
      item.addEventListener('click', () => {
        const idx = parseInt(item.getAttribute('data-index') || '0');
        // Test index-based seekToChapter API
        player.controllerInstance.seekToChapter(idx);
      });
    });

    // 2. Render Course Syllabus lecture chapters
    courseContainer.innerHTML = chapters
      .map((ch, idx) => {
        const start = ch.startTime;
        const end =
          ch.endTime !== undefined
            ? ch.endTime
            : chapters[idx + 1]
              ? chapters[idx + 1].startTime
              : player.playerState.duration;
        const durSecs = end - start;
        const durText = durSecs > 0 ? formatTime(durSecs) : 'Lecture';
        return `
        <div class="course-chapter-item" data-index="${idx}">
          <div class="course-chapter-left">
            <span class="course-checkmark-outer"><span class="course-checkmark-inner"></span></span>
            <div class="course-chapter-title">${ch.title}</div>
          </div>
          <span class="course-chapter-duration">${durText}</span>
        </div>
      `;
      })
      .join('');

    // Bind click handlers to Course items
    Array.from(courseContainer.querySelectorAll('.course-chapter-item')).forEach((item) => {
      item.addEventListener('click', () => {
        const idx = parseInt(item.getAttribute('data-index') || '0');
        // Test string (ID) based seekToChapter API
        const id = chapters[idx].id;
        player.controllerInstance.seekToChapter(id);
      });
    });

    // 3. Render OTT Scene Select
    ottContainer.innerHTML = chapters
      .map((ch, idx) => {
        const start = ch.startTime;
        const end =
          ch.endTime !== undefined
            ? ch.endTime
            : chapters[idx + 1]
              ? chapters[idx + 1].startTime
              : player.playerState.duration;
        const durSecs = end - start;
        return `
        <div class="ott-scene-card" data-index="${idx}">
          <div class="ott-scene-thumb-placeholder" id="ott-thumb-${idx}">
            <svg viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
            <span class="ott-scene-duration-badge">${durSecs > 0 ? formatTime(durSecs) : ''}</span>
          </div>
          <div class="ott-scene-progress-bar">
            <div class="ott-scene-progress-fill" id="ott-fill-${idx}"></div>
          </div>
          <div class="ott-scene-info">
            <div class="ott-scene-title">${ch.title}</div>
            <div class="ott-scene-start">Starts at ${formatTime(ch.startTime)}</div>
          </div>
        </div>
      `;
      })
      .join('');

    // Bind click handlers to OTT items
    Array.from(ottContainer.querySelectorAll('.ott-scene-card')).forEach((item) => {
      item.addEventListener('click', () => {
        const idx = parseInt(item.getAttribute('data-index') || '0');
        player.controllerInstance.seekToChapter(idx);
      });
    });

    // Check if OTT tab is currently active/visible. If so, load thumbnails.
    const ottTab = document.getElementById('demo-tab-ott') as HTMLDivElement;
    if (ottTab && ottTab.style.display === 'block') {
      loadOttThumbnails(chapters);
    } else {
      ottThumbnailsLoadedForSource = ''; // reset to trigger load when tab is clicked
    }
  };

  // Universal load source router
  loadSourceBtn.addEventListener('click', async () => {
    if (!player || !player.controllerInstance) {
      console.warn('Player SDK is not yet initialized.');
      return;
    }

    const type = sourceTypeSelect.value;

    if (type !== 'blob' && activeGeneratedBlobUrl) {
      URL.revokeObjectURL(activeGeneratedBlobUrl);
      activeGeneratedBlobUrl = null;
    }

    if (type !== 'file' && activeFileBlobUrls.length > 0) {
      activeFileBlobUrls.forEach((url) => URL.revokeObjectURL(url));
      activeFileBlobUrls = [];
    }

    try {
      if (type === 'file') {
        const files: File[] = [];
        if (localFilePicker.files?.[0]) {
          files.push(localFilePicker.files[0]);
        }

        const isVertical = displayModeSelect.value === 'vertical';
        if (isVertical) {
          const extraRows = Array.from(document.querySelectorAll('.playlist-file-row')) as Array<
            HTMLDivElement & { file?: File }
          >;
          extraRows.forEach((row) => {
            if (row.file) {
              files.push(row.file);
            }
          });
        }

        if (files.length === 0) {
          alert('Please select a local video file first.');
          return;
        }

        // Revoke any previous Blob URLs to avoid memory leaks
        if (activeFileBlobUrls.length > 0) {
          activeFileBlobUrls.forEach((url) => URL.revokeObjectURL(url));
          activeFileBlobUrls = [];
        }

        // Create new Blob URLs
        const blobUrls = files.map((file) => {
          const url = URL.createObjectURL(file);
          activeFileBlobUrls.push(url);
          return url;
        });

        if (isVertical && blobUrls.length > 1) {
          const sources = blobUrls.map((url) => ({
            src: url,
            type: 'file' as const,
          }));
          player.loadPlaylist(sources);
        } else {
          player.loadSource({ src: blobUrls[0], type: 'file' });
        }
      } else {
        const isVertical = displayModeSelect.value === 'vertical';
        const mainUrl = videoUrlInput.value.trim();

        // Handle generated blob url preset logic
        let resolvedMainUrl = mainUrl;
        if (type === 'blob' && (!mainUrl || mainUrl.includes('generate'))) {
          if (!activeGeneratedBlobUrl) {
            videoUrlInput.value = 'Generating local blob URL, please wait...';
            const res = await fetch(
              '/videos/Tears_of_Steel___4k_version_(in_HD)___Blender_Foundation_channel_6a13f75fd8b69.mp4'
            );
            if (!res.ok) throw new Error(`HTTP error ${res.status}`);
            const blob = await res.blob();
            activeGeneratedBlobUrl = URL.createObjectURL(blob);
            resolvedMainUrl = activeGeneratedBlobUrl;
            videoUrlInput.value = activeGeneratedBlobUrl;
          } else {
            resolvedMainUrl = activeGeneratedBlobUrl;
          }
        }

        if (!resolvedMainUrl) {
          alert('Please provide a valid URL to load.');
          return;
        }

        const urls: string[] = [resolvedMainUrl];

        if (isVertical) {
          const extraInputs = Array.from(
            document.querySelectorAll('.playlist-url-input')
          ) as HTMLInputElement[];
          extraInputs.forEach((input) => {
            const val = input.value.trim();
            if (val) {
              urls.push(val);
            }
          });
        }

        if (isVertical && urls.length > 1) {
          const sources = urls.map((url) => {
            let urlType = type;
            const normUrl = url.split('?')[0].toLowerCase();
            if (normUrl.endsWith('.m3u8')) urlType = 'hls';
            else if (normUrl.endsWith('.mpd')) urlType = 'dash';
            else if (normUrl.endsWith('.webm')) urlType = 'webm';
            else if (normUrl.endsWith('.mov')) urlType = 'mov';
            else if (
              url.includes('youtube.com') ||
              url.includes('youtu.be') ||
              url.includes('vimeo.com')
            ) {
              urlType = 'embed';
            } else {
              urlType = 'mp4';
            }

            let matchedPreset: any = null;
            for (const key of Object.keys(presets)) {
              const match = presets[key].find((p) => p.url === url);
              if (match) {
                matchedPreset = match;
                break;
              }
            }

            return {
              src: url,
              type: urlType as any,
              variants: matchedPreset?.variants,
              subtitles: matchedPreset?.subtitles,
            };
          });
          player.loadPlaylist(sources);
        } else {
          // Single source
          let matchedPreset: any = null;
          for (const key of Object.keys(presets)) {
            const match = presets[key].find((p) => p.url === resolvedMainUrl);
            if (match) {
              matchedPreset = match;
              break;
            }
          }

          const sourceObj: any = {
            src: resolvedMainUrl,
            type: type as any,
          };

          if (matchedPreset) {
            sourceObj.variants = matchedPreset.variants;
            sourceObj.subtitles = matchedPreset.subtitles;
          }

          player.loadSource(sourceObj);
        }
      }
    } catch (e: any) {
      alert(`Failed to load source: ${e.message || e}`);
      console.error(e);
    }
  });

  let lastLoadedSource = '';

  const isControllerInitializedMap = new WeakMap<any, boolean>();
  function initializeControllerListeners(playerEl: any) {
    if (isControllerInitializedMap.has(playerEl) || !playerEl.controllerInstance) return;
    isControllerInitializedMap.set(playerEl, true);

    // Register ad providers automatically on player startup
    const ads = playerEl.controllerInstance.ads;
    if (ads) {
      ads.registerProvider('VAST', new VastProvider());
      ads.registerProvider('VMAP', new VmapProvider());
      ads.registerProvider('IMA', new ImaProvider());
    }

    playerEl.controllerInstance.on('metadata', (e: any) => {
      const metadataCard = document.getElementById('metadata-card-container');
      if (metadataCard) {
        metadataCard.style.display = 'block';
      }

      const container = document.getElementById('metadata-events-container');
      if (container) {
        const item = document.createElement('div');
        item.className = 'metadata-event-item';
        item.style.borderBottom = '1px solid rgba(255, 255, 255, 0.08)';
        item.style.paddingBottom = '6px';
        item.style.marginBottom = '6px';

        const timeStr = formatTime(e.timestamp);
        item.innerHTML = `
          <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
            <span style="color: #a855f7; font-weight: 600;">[${e.sourceProtocol.toUpperCase()} ${e.type}]</span>
            <span style="color: var(--label-color);">${timeStr} (${e.timestamp.toFixed(2)}s)</span>
          </div>
          <pre style="margin: 0; color: #e2e8f0; overflow-x: auto; font-size: 0.7rem; font-family: inherit;">${JSON.stringify(e.parsedData || e.rawData, null, 2)}</pre>
        `;
        container.appendChild(item);

        while (container.children.length > 100 && container.firstChild) {
          container.removeChild(container.firstChild);
        }

        const autoscroll = document.getElementById('metadata-autoscroll') as HTMLInputElement;
        if (autoscroll && autoscroll.checked) {
          container.scrollTop = container.scrollHeight;
        }
      }
    });



    const clearBtn = document.getElementById('metadata-clear-btn');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        const container = document.getElementById('metadata-events-container');
        if (container) container.innerHTML = '';
      });
    }

    const exportBtn = document.getElementById('metadata-export-btn');
    if (exportBtn) {
      exportBtn.addEventListener('click', async () => {
        const container = document.getElementById('metadata-events-container');
        if (container) {
          let reportText = `METADATA EVENT LOG REPORT\n`;
          reportText += `Generated at: ${new Date().toISOString()}\n`;
          reportText += `========================================\n\n`;

          if (playerEl.controllerInstance) {
            reportText += `PLAYER STATE\n`;
            reportText += `------------\n`;
            const state = playerEl.controllerInstance.getState();
            reportText += `Playback Time: ${state.currentTime ? state.currentTime.toFixed(2) : '0.00'}s\n`;
            reportText += `Duration: ${state.duration ? state.duration.toFixed(2) : '0.00'}s\n`;
            reportText += `Volume: ${state.volume !== undefined ? (state.volume * 100).toFixed(0) : '100'}%\n`;
            reportText += `Muted: ${state.muted ? 'Yes' : 'No'}\n`;
            reportText += `Error: ${state.error || 'None'}\n\n`;
          }

          reportText += `EVENT LOG TRACE\n`;
          reportText += `---------------\n`;
          reportText += container.innerText;

          const blob = new Blob([reportText], { type: 'text/plain' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `metadata-events-report-${Date.now()}.txt`;
          a.click();
          URL.revokeObjectURL(url);
        }
      });
    }
  }

  // Initialize expando properties on the main player element to ensure multi-instance safety
  const p = player as any;
  p._hasResetForLoading = false;

  player.addEventListener('player-state-change', (e: CustomEvent) => {
    const state = e.detail;
    const targetPlayer = e.currentTarget as any;

    // Sync sandbox empty player state
    const stage = document.querySelector('.player-stage');
    const emptyOverlay = document.getElementById('sandbox-empty-state');
    const hasSource = !!(
      state.currentSource ||
      (player.controllerInstance && player.controllerInstance.getState().currentSource)
    );
    if (stage && emptyOverlay) {
      if (!hasSource) {
        stage.classList.add('empty');
        emptyOverlay.classList.remove('hidden');
      } else {
        stage.classList.remove('empty');
        emptyOverlay.classList.add('hidden');
      }
    }

    if (targetPlayer.controllerInstance) {
      initializeControllerListeners(targetPlayer);
    }

    if (state.status === 'loading') {
      if (!targetPlayer._hasResetForLoading) {
        targetPlayer._hasResetForLoading = true;

        const container = document.getElementById('metadata-events-container');
        if (container) container.innerHTML = '';
        const metadataCard = document.getElementById('metadata-card-container');
        if (metadataCard) metadataCard.style.display = 'none';
      }
    } else {
      targetPlayer._hasResetForLoading = false;
    }

    if (state.currentSource && state.currentSource !== lastLoadedSource) {
      lastLoadedSource = state.currentSource;

      // Sync activeFeedIndex if we loaded a playlist item
      const currentSrc = state.currentSource || '';
      if (isPlaylistSource(currentSrc)) {
        const norm = currentSrc.split('?')[0].toLowerCase();
        let idx = -1;
        if (sourceTypeSelect.value === 'file') {
          idx = activeFileBlobUrls.findIndex((u) => u.split('?')[0].toLowerCase() === norm);
        } else {
          const urls: string[] = [videoUrlInput.value.trim()];
          const extraInputs = Array.from(
            document.querySelectorAll('.playlist-url-input')
          ) as HTMLInputElement[];
          extraInputs.forEach((input) => {
            const val = input.value.trim();
            if (val) urls.push(val);
          });
          idx = urls.findIndex((u) => u.split('?')[0].toLowerCase() === norm);
        }
        if (idx !== -1) {
          activeFeedIndex = idx;
        }
      }

      const srcLower = state.currentSource.toLowerCase();
      // Only Syntel and preset synthetic demo files get mocked chapters
      if (srcLower.includes('sintel') || srcLower.includes('ayutthaya')) {
        player.controllerInstance.setChapters([
          {
            id: 'ch1',
            title: 'Chapter 1: Intro Scenes',
            startTime: 10,
            endTime: 90,
            description:
              'The grand cinematic introduction showcasing high-fidelity CGI animation presets.',
          },
          {
            id: 'ch2',
            title: 'Chapter 2: Character Intro',
            startTime: 91,
            endTime: 150,
            description:
              'Introduction to Sintel, the main protagonist, wandering through the ancient lands.',
          },
          {
            id: 'ch3',
            title: 'Chapter 3: The Encounter',
            startTime: 151,
            endTime: 390,
            description:
              'An unexpected meeting in the desert which changes the course of her journey.',
          },
          {
            id: 'ch4',
            title: 'Chapter 4: Narrative Climax',
            startTime: 391,
            endTime: 745,
            description: 'Sintel faces the final test of wills. High energy animation sequence.',
          },
        ]);
        player.controllerInstance.setMarkers([
          { id: 'm1', time: 10, label: 'Cinematic Title', type: 'chapter' },
          { id: 'm2', time: 91, label: 'Ad Break', type: 'ad' },
          { id: 'm3', time: 151, label: 'Highlight Scene', type: 'bookmark' },
          { id: 'm4', time: 755, label: 'Credits Start', type: 'bookmark' },
        ]);
      } else {
        player.controllerInstance.setChapters([]);
        player.controllerInstance.clearMarkers();
      }
    }

    // Sync external chapters lists rendering
    if (state.chapters) {
      renderExternalChapters(state.chapters);

      const activeIdx = state.activeChapterIndex;

      // Update active highlight classes in all containers
      Array.from(sidebarContainer.querySelectorAll('.sidebar-chapter-item')).forEach(
        (item, idx) => {
          if (idx === activeIdx) {
            item.classList.add('active');
          } else {
            item.classList.remove('active');
          }
        }
      );

      Array.from(courseContainer.querySelectorAll('.course-chapter-item')).forEach((item, idx) => {
        if (idx === activeIdx) {
          item.classList.add('active');
        } else {
          item.classList.remove('active');
        }

        if (state.chapters[idx] && state.currentTime >= state.chapters[idx].startTime) {
          item.classList.add('completed');
        } else {
          item.classList.remove('completed');
        }
      });

      Array.from(ottContainer.querySelectorAll('.ott-scene-card')).forEach((item, idx) => {
        if (idx === activeIdx) {
          item.classList.add('active');
        } else {
          item.classList.remove('active');
        }

        const ch = state.chapters[idx];
        if (!ch) return;
        const start = ch.startTime;
        const end =
          ch.endTime !== undefined
            ? ch.endTime
            : state.chapters[idx + 1]
              ? state.chapters[idx + 1].startTime
              : state.duration;
        const duration = end - start;

        let progressPercent = 0;
        if (state.currentTime >= end) {
          progressPercent = 100;
        } else if (state.currentTime >= start && duration > 0) {
          progressPercent = ((state.currentTime - start) / duration) * 100;
        }

        const fillEl = document.getElementById(`ott-fill-${idx}`) as HTMLDivElement;
        if (fillEl) {
          fillEl.style.width = `${progressPercent}%`;
        }
      });
    }

    // Status color class updates
    stateStatus.className = 'telemetry-value';
    stateStatus.style.color = '';

    let statusText = 'Disconnected';
    switch (state.status) {
      case 'idle':
        statusText = 'Disconnected';
        stateStatus.style.color = '#64748b';
        break;
      case 'loading':
        statusText = 'Loading';
        stateStatus.style.color = '#fb923c';
        break;
      case 'ready':
        statusText = 'Ready';
        stateStatus.style.color = '#6366f1';
        break;
      case 'playing':
        statusText = 'Playing';
        stateStatus.style.color = '#10b981';
        break;
      case 'paused':
        statusText = 'Paused';
        stateStatus.style.color = '#64748b';
        break;
      case 'buffering':
        statusText = 'Buffering';
        stateStatus.style.color = '#fb923c';
        break;
      case 'ended':
        statusText = 'Ended';
        stateStatus.style.color = '#64748b';
        break;
      case 'error':
        statusText = 'Error';
        stateStatus.style.color = '#ef4444';
        break;
      default:
        statusText = 'Disconnected';
    }
    stateStatus.textContent = statusText;

    // Telemetry simple updates
    let displayFormat = state.sourceType.toUpperCase();
    if (state.currentSource) {
      const urlWithoutParams = state.currentSource.split('?')[0].toLowerCase();
      if (urlWithoutParams.endsWith('.mp4') || urlWithoutParams.endsWith('.m4v')) {
        displayFormat = 'MP4';
      } else if (urlWithoutParams.endsWith('.mov')) {
        displayFormat = 'MOV';
      } else if (urlWithoutParams.endsWith('.m3u8')) {
        displayFormat = 'HLS';
      } else if (urlWithoutParams.endsWith('.mpd')) {
        displayFormat = 'DASH';
      } else if (urlWithoutParams.endsWith('.webm')) {
        displayFormat = 'WEBM';
      }
    }
    stateFormat.textContent = displayFormat;
    stateTime.textContent = `${formatTime(state.currentTime)} / ${formatTime(state.duration)}`;

    if (state.displayMode && displayModeSelect.value !== state.displayMode) {
      displayModeSelect.value = state.displayMode;
    }

    stateVolume.textContent = state.isMuted ? 'Muted' : `${Math.round(state.volume * 100)}%`;
    stateQuality.textContent = state.activeQuality;
    const activeSub = state.subtitleTracks.find((t: any) => t.id === state.activeSubtitleTrackId);
    stateSubtitles.textContent = activeSub ? activeSub.label || activeSub.language || 'On' : 'Off';
    if (stateAudio) {
      const activeAudio = state.audioTracks[state.activeAudioTrack];
      stateAudio.textContent = activeAudio || 'Default';
    }
    if (statePip) {
      statePip.textContent = state.pictureInPicture ? 'Active' : 'Inactive';
      statePip.style.color = state.pictureInPicture ? '#10b981' : '';
    }

    if (stateLive) {
      stateLive.textContent = state.isLive ? 'Yes' : 'No';
      stateLive.style.color = state.isLive ? '#ef4444' : '';
    }
    const liveOnlyItems = document.querySelectorAll('.live-only-item') as NodeListOf<HTMLElement>;
    liveOnlyItems.forEach((item) => {
      item.style.display = state.isLive ? 'flex' : 'none';
    });
    if (stateLowLatency) {
      stateLowLatency.textContent = state.isLive
        ? state.isLowLatency
          ? 'Yes (Low Latency)'
          : 'No (Standard Live)'
        : 'N/A';
      stateLowLatency.style.color = state.isLive && state.isLowLatency ? '#10b981' : '';
    }
    if (stateLiveLatency) {
      stateLiveLatency.textContent = state.isLive
        ? state.liveLatency !== null
          ? `${state.liveLatency.toFixed(2)}s`
          : 'Calculating...'
        : '-';
    }
    if (stateDvrWindow) {
      stateDvrWindow.textContent = state.isLive
        ? `${Math.round(state.dvrWindow)}s (Seekable: ${state.canSeekInDvr ? 'Yes' : 'No'})`
        : '-';
    }

    // Phase 9 UX Refinement for Live Mode config
    const liveModeGroup = document.getElementById('live-mode-group') as HTMLDivElement;
    const liveModeSelectNode = document.getElementById('live-mode-select') as HTMLSelectElement;
    if (liveModeGroup && liveModeSelectNode) {
      if (state.isLive) {
        liveModeGroup.style.display = 'block';
        if (state.hasDvr === false) {
          liveModeSelectNode.disabled = true;
          liveModeSelectNode.value = 'live-only';
          player?.setAttribute('live-mode', 'live-only');
        } else {
          liveModeSelectNode.disabled = false;
          if (state.liveMode) {
            liveModeSelectNode.value = state.liveMode;
          }
        }
      } else {
        liveModeGroup.style.display = 'none';
      }
    }
  });

  // Sandbox Toast display system
  let toastTimer: any = null;
  const showSandboxToast = (message: string) => {
    const toast = document.getElementById('sandbox-toast');
    if (toast) {
      toast.textContent = message;
      toast.classList.add('show');
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        toast.classList.remove('show');
      }, 3000);
    }
  };

  // Bind clicks on empty overlay to show advice toast
  const emptyOverlay = document.getElementById('sandbox-empty-state');
  if (emptyOverlay) {
    emptyOverlay.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      showSandboxToast('Choose a source and click Load Source.');
    });
  }

  // Initial check of the player empty state
  const initialStage = document.querySelector('.player-stage');
  const initialOverlay = document.getElementById('sandbox-empty-state');
  if (initialStage && initialOverlay) {
    const hasSource = !!(
      player.src ||
      (player.controllerInstance && player.controllerInstance.getState().currentSource)
    );
    if (!hasSource) {
      initialStage.classList.add('empty');
      initialOverlay.classList.remove('hidden');
    } else {
      initialStage.classList.remove('empty');
      initialOverlay.classList.add('hidden');
    }
  }

  // Setup Phase 3 Empty State & Localization Demo
  player.config = {
    locale: {
      live: 'LIVE EDGE',
      normal: 'Normal',
    },
    emptyState: {
      icon: '✨',
      title: 'No Media Selected',
      subtitle: 'Click load source to play the demo',
      buttonText: 'Load Demo Source',
    },
  };
  if (typeof player.requestUpdate === 'function') {
    player.requestUpdate();
  }

  player.addEventListener('player-empty-state-click', () => {
    videoUrlInput.value = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';
    sourceTypeSelect.value = 'url';
    sourceTypeSelect.dispatchEvent(new Event('change'));
    loadSourceBtn.click();
    showSandboxToast('Loaded demo source via empty state click!');
  });

  // --- Production Advertisements Sandbox Controls ---
  const adsSupportToggle = document.getElementById('ads-support-toggle') as HTMLInputElement;
  const adsConfigSection = document.getElementById('ads-config-section') as HTMLDivElement;
  const adsProviderSelect = document.getElementById('ads-provider-select') as HTMLSelectElement;

  // Provider panel containers
  const panelVast = document.getElementById('ad-panel-vast') as HTMLDivElement;
  const panelVmap = document.getElementById('ad-panel-vmap') as HTMLDivElement;
  const panelIma = document.getElementById('ad-panel-ima') as HTMLDivElement;
  const panelSimid = document.getElementById('ad-panel-simid') as HTMLDivElement;
  const panelHtml = document.getElementById('ad-panel-html') as HTMLDivElement;

  // URL Input elements
  const inputVastUrl = document.getElementById('ad-url-vast') as HTMLInputElement;
  const inputVmapUrl = document.getElementById('ad-url-vmap') as HTMLInputElement;
  const inputImaUrl = document.getElementById('ad-url-ima') as HTMLInputElement;
  const inputSimidVastUrl = document.getElementById('ad-url-simid-vast') as HTMLInputElement;
  const inputHtmlContent = document.getElementById('ad-url-html-content') as HTMLInputElement;

  const skipModeSelect = document.getElementById('ad-skip-mode') as HTMLSelectElement;
  const skipOffsetWrap = document.getElementById('ad-skip-offset-wrap') as HTMLDivElement;
  const skipOffsetInput = document.getElementById('ad-skip-offset') as HTMLInputElement;
  const adRoleTypeSelect = document.getElementById('ad-role-type') as HTMLSelectElement;
  const adRoleOffsetWrap = document.getElementById('ad-role-offset-wrap') as HTMLDivElement;
  const adRoleOffsetInput = document.getElementById('ad-role-offset') as HTMLInputElement;
  const vmapWarning = document.getElementById('ad-vmap-warning') as HTMLDivElement;

  // The "default: 80% / 18% of stage" copy was meaningless to read at a
  // glance - nobody can eyeball what percentage of an unknown player size
  // resolves to. Show the actual computed px box instead, kept live via
  // ResizeObserver so it tracks the real player size as it changes.
  const sizeDefaultHint = document.getElementById('ad-html-size-default-hint');
  const updateSizeDefaultHint = () => {
    if (!sizeDefaultHint) return;
    const stage = document.querySelector('.player-stage') as HTMLElement | null;
    const stageWidth = stage?.clientWidth || 640;
    const stageHeight = stage?.clientHeight || 360;
    const defaultW = Math.round(stageWidth * 0.8);
    const defaultH = Math.round(stageHeight * 0.18);
    sizeDefaultHint.textContent = `(default: fills content, capped ${defaultW}×${defaultH}px)`;
  };
  updateSizeDefaultHint();
  const stageForSizeHint = document.querySelector('.player-stage');
  if (stageForSizeHint && typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(updateSizeDefaultHint).observe(stageForSizeHint);
  }

  let activeSimidRuntime: SimidRuntime | null = null;

  // If an ad is still active (e.g. a previous demo's ad is mid-playback),
  // the AdState machine rejects a new startAdBreak() silently - force it
  // back to idle first so the next ad request always has a clean slate.
  const resetActiveAdIfAny = () => {
    const adsCtrl = player.controllerInstance?.ads;
    if (adsCtrl?.manager && adsCtrl.manager.getAdState() !== 'idle') {
      adsCtrl.manager.recover('sandbox: starting a new ad request');
    }
  };

  // Skip offset input only means something when skip is force-enabled
  // ("Allow Skip" / AdSkipMode.USER) - "Default" defers to the ad's own
  // skip timing, "Don't Allow Skip" has no offset to configure.
  if (skipModeSelect && skipOffsetWrap) {
    const updateSkipOffsetVisibility = () => {
      skipOffsetWrap.style.display = skipModeSelect.value === 'user' ? 'flex' : 'none';
    };
    skipModeSelect.addEventListener('change', updateSkipOffsetVisibility);
    updateSkipOffsetVisibility();
  }

  // "Ad Role Type": Auto/Preroll play immediately when Load Source is
  // clicked (today's default behavior). Midroll/Postroll instead schedule
  // the ad via player.ads.schedule() so it fires later during playback.
  // Only VAST itself supports this - a VMAP document already encodes its
  // own break positions, so this control only appears on the VAST panel.
  const htmlRoleTypeSelect = document.getElementById('ad-html-role-type') as HTMLSelectElement;
  const htmlRoleOffsetWrap = document.getElementById('ad-html-role-offset-wrap') as HTMLDivElement;
  if (htmlRoleTypeSelect && htmlRoleOffsetWrap) {
    const updateHtmlRoleOffsetVisibility = () => {
      htmlRoleOffsetWrap.style.display = htmlRoleTypeSelect.value === 'midroll' ? 'flex' : 'none';
    };
    htmlRoleTypeSelect.addEventListener('change', updateHtmlRoleOffsetVisibility);
    updateHtmlRoleOffsetVisibility();
  }

  if (adRoleTypeSelect && adRoleOffsetWrap) {
    const updateRoleOffsetVisibility = () => {
      adRoleOffsetWrap.style.display = adRoleTypeSelect.value === 'midroll' ? 'flex' : 'none';
    };
    adRoleTypeSelect.addEventListener('change', updateRoleOffsetVisibility);
    updateRoleOffsetVisibility();
  }

  // Warn when the pasted URL looks like a VMAP tag while "Native VAST" is selected
  if (inputVastUrl && vmapWarning) {
    inputVastUrl.addEventListener('input', () => {
      vmapWarning.style.display = inputVastUrl.value.includes('output=vmap') ? 'block' : 'none';
    });
  }

  // Toggle visibility of Ads section
  adsSupportToggle.addEventListener('change', () => {
    adsConfigSection.style.display = adsSupportToggle.checked ? 'block' : 'none';
  });

  // Switch visible fields based on selected Advertisement Type
  const updateProviderPanels = () => {
    const selectedType = adsProviderSelect.value;
    if (panelVast) panelVast.style.display = selectedType === 'VAST' ? 'flex' : 'none';
    if (panelVmap) panelVmap.style.display = selectedType === 'VMAP' ? 'flex' : 'none';
    if (panelIma) panelIma.style.display = selectedType === 'IMA' ? 'flex' : 'none';
    if (panelSimid) panelSimid.style.display = selectedType === 'SIMID' ? 'flex' : 'none';
    if (panelHtml) panelHtml.style.display = selectedType === 'HTML_OVERLAY' ? 'flex' : 'none';
  };

  adsProviderSelect.addEventListener('change', updateProviderPanels);

  // Keep the HTML Overlay content field's placeholder/label in sync with the
  // selected creative source so it's clear what format is expected there.
  const htmlSourceTypeSelect = document.getElementById('ad-html-source-type') as HTMLSelectElement;
  const htmlContentLabel = document.getElementById('ad-html-content-label') as HTMLLabelElement;
  const updateHtmlOverlayFieldHints = () => {
    if (!htmlSourceTypeSelect || !inputHtmlContent || !htmlContentLabel) return;
    switch (htmlSourceTypeSelect.value) {
      case 'url':
        htmlContentLabel.textContent = 'Creative URL (iframe src)';
        inputHtmlContent.placeholder = 'https://example.com/creative.html (leave blank for built-in demo iframe)';
        break;
      case 'image':
        htmlContentLabel.textContent = 'Image URL';
        inputHtmlContent.placeholder = 'https://example.com/banner.png (leave blank for built-in demo SVG)';
        break;
      case 'vast':
        htmlContentLabel.textContent = 'VAST NonLinear Tag URL';
        inputHtmlContent.placeholder = 'A VAST tag URL (output=vast / gampad/ads / .xml) whose response includes a NonLinearAds section';
        break;
      case 'xml':
        htmlContentLabel.textContent = 'Raw VAST XML';
        inputHtmlContent.placeholder = 'Paste a full <VAST>...</VAST> document containing a NonLinearAds section';
        break;
      case 'string':
      default:
        htmlContentLabel.textContent = 'Creative Content / URL';
        inputHtmlContent.placeholder = 'Paste HTML Content String... (leave blank for built-in demo banner)';
        break;
    }
  };
  if (htmlSourceTypeSelect) {
    htmlSourceTypeSelect.addEventListener('change', updateHtmlOverlayFieldHints);
    updateHtmlOverlayFieldHints();
  }

  // Position only has an effect for "Player Container" - HtmlOverlayRenderer
  // intentionally skips positioning entirely for an external slot, since that
  // element's placement is controlled by the host page's own layout. Hide the
  // field when it would silently do nothing, to avoid the false impression
  // that it's broken.
  const htmlTargetSelect = document.getElementById('ad-html-target') as HTMLSelectElement;
  const htmlPositionWrap = document.getElementById('ad-html-position-wrap') as HTMLDivElement;
  const updateHtmlOverlayTargetHints = () => {
    if (!htmlTargetSelect || !htmlPositionWrap) return;
    htmlPositionWrap.style.display = htmlTargetSelect.value === 'external' ? 'none' : 'flex';
  };
  if (htmlTargetSelect) {
    htmlTargetSelect.addEventListener('change', updateHtmlOverlayTargetHints);
    updateHtmlOverlayTargetHints();
  }

  // Helper to ensure core providers are registered on controller
  const ensureProvidersRegistered = () => {
    const adsCtrl = player.controllerInstance?.ads;
    if (!adsCtrl) return null;
    return adsCtrl;
  };

  // Intercept Load Source button to handle Ads initialization & playback
  loadSourceBtn.addEventListener('click', async () => {
    // A new source invalidates any previously scheduled ad breaks
    resetActiveAdIfAny();

    // Cleanup previous SIMID / HTML Overlays
    if (activeSimidRuntime) {
      activeSimidRuntime.destroyRuntime();
      activeSimidRuntime = null;
    }
    if (player.controllerInstance?.ads?.manager) {
      const mgr = player.controllerInstance.ads.manager;
      try {
        mgr.resetAdBreak();
        mgr.transitionTo('idle' as any);
      } catch (_) {}
      if (mgr.getHtmlOverlayRenderer()) {
        try {
          mgr.getHtmlOverlayRenderer().destroy();
        } catch (e) {
          // ignore
        }
      }
    }

    if (!adsSupportToggle.checked) {
      player.config = {
        ...player.config,
        ads: { enabled: false }
      };
      if (typeof player.requestUpdate === 'function') {
        player.requestUpdate();
      }
      return;
    }

    const providerType = adsProviderSelect.value;

    // STEP 6: Validation check for Custom URLs
    if (providerType === 'VAST') {
      const url = inputVastUrl ? inputVastUrl.value.trim() : '';
      if (!url) {
        showSandboxToast('Error: Please enter a valid VAST XML URL.');
        return;
      }
    } else if (providerType === 'VMAP') {
      const url = inputVmapUrl ? inputVmapUrl.value.trim() : '';
      if (!url) {
        showSandboxToast('Error: Please enter a valid VMAP XML URL.');
        return;
      }
    } else if (providerType === 'IMA') {
      const url = inputImaUrl ? inputImaUrl.value.trim() : '';
      if (!url) {
        showSandboxToast('Error: Please enter a valid Google IMA Tag URL.');
        return;
      }
    } else if (providerType === 'SIMID') {
      const vastUrl = inputSimidVastUrl ? inputSimidVastUrl.value.trim() : '';
      if (!vastUrl) {
        showSandboxToast('Error: Please enter a valid VAST URL for SIMID.');
        return;
      }
    } else if (providerType === 'HTML_OVERLAY') {
      const sourceType = (document.getElementById('ad-html-source-type') as HTMLSelectElement)?.value || 'string';
      const rawContent = (document.getElementById('ad-url-html-content') as HTMLInputElement)?.value.trim() || '';
      if (sourceType === 'string' && !rawContent) {
        showSandboxToast('Notice: HTML String field empty. Loading default promo overlay banner preset.');
      } else if (sourceType === 'url' && !rawContent) {
        showSandboxToast('Notice: HTML URL field empty. Loading dynamic web component iframe creative preset.');
      } else if (sourceType === 'image' && !rawContent) {
        showSandboxToast('Notice: Image URL field empty. Loading interactive SVG creative preset.');
      } else if ((sourceType === 'vast' || sourceType === 'xml') && !rawContent) {
        showSandboxToast('Error: Please enter a valid VAST XML URL or Raw VAST XML string.');
        return;
      }
    }

    const adsCtrl = ensureProvidersRegistered();
    if (!adsCtrl) {
      showSandboxToast('Error: Player controller not ready.');
      return;
    }

    // Generate AdsConfig & set on player
    const adsConfig: any = {
      enabled: true,
      provider: providerType === 'SIMID' ? 'VAST' : providerType,
      // If a VAST/VMAP/IMA response includes Companion ads, show them in the same
      // demo "external page slot" used by the HTML Overlay panel's External Slot
      // target - without this, companions are silently dropped (see AdsManager.showCompanions).
      ui: {
        adOverlaySlot: '#sandbox-external-overlay-slot',
      },
    };

    // Reveal the slot immediately rather than waiting on a 'companionshown'
    // event round-trip - simpler and doesn't depend on event bridging timing.
    const externalOverlaySlotEl = document.getElementById('sandbox-external-overlay-slot');
    if (externalOverlaySlotEl) externalOverlaySlotEl.style.display = 'block';

    if (providerType === 'VAST') {
      adsConfig.tagUrl = inputVastUrl.value.trim();
      adsConfig.playback = {
        skipMode: skipModeSelect.value,
        skipOffset: skipModeSelect.value === 'user' ? Number(skipOffsetInput.value) : undefined,
      };
    } else if (providerType === 'VMAP') {
      adsConfig.tagUrl = inputVmapUrl.value.trim();
    } else if (providerType === 'IMA') {
      adsConfig.tagUrl = inputImaUrl.value.trim();
    } else if (providerType === 'SIMID') {
      adsConfig.tagUrl = inputSimidVastUrl.value.trim();
    } else if (providerType === 'HTML_OVERLAY') {
      const sourceType = (document.getElementById('ad-html-source-type') as HTMLSelectElement)?.value || 'string';
      const rawContent = (document.getElementById('ad-url-html-content') as HTMLInputElement)?.value.trim() || '';
      adsConfig.tagUrl = (sourceType === 'vast' || sourceType === 'xml') ? rawContent : undefined;
      adsConfig.providerOptions = {
        htmlContent: rawContent || undefined,
      };
    }

    player.config = {
      ...player.config,
      ads: adsConfig,
    };

    if (typeof player.requestUpdate === 'function') {
      player.requestUpdate();
    }

    // Execute ad loading & playback with public SDK APIs
    setTimeout(async () => {
      const targetProviderName = providerType === 'SIMID' || providerType === 'HTML_OVERLAY' ? 'VAST' : providerType;
      const provider = adsCtrl.getProvider(targetProviderName);

      if (!provider) {
        showSandboxToast(`Error: ${targetProviderName} provider not registered.`);
        return;
      }

      if (providerType === 'VAST') {
        const url = inputVastUrl.value.trim();
        const roleType = adRoleTypeSelect ? adRoleTypeSelect.value : 'auto';
        if (roleType === 'auto' || roleType === 'preroll') {
          showSandboxToast(`VAST: Requesting ad from ${url}...`);
          const res = await provider.requestAds(url);
          if (res.success) {
            showSandboxToast('VAST ad loaded. Starting playback...');
            await provider.playAdBreak();
          } else {
            showSandboxToast(`VAST ad request failed: ${res.error?.message || 'Unknown error'}`);
          }
        } else {
          let offset: number | string | undefined;
          if (roleType === 'midroll') {
            const raw = adRoleOffsetInput.value.trim();
            offset = raw.endsWith('%') ? raw : Number(raw);
          }
          adsCtrl.schedule({ tagUrl: url, type: roleType as any, timeOffset: offset });
          showSandboxToast(`VAST ad scheduled as ${roleType}${offset !== undefined ? ` @ ${offset}` : ''}. Continue/start content playback to trigger it.`);
        }
      } else if (providerType === 'VMAP') {
        const url = inputVmapUrl.value.trim();
        showSandboxToast(`VMAP: Requesting ad schedule from ${url}...`);
        const res = await provider.requestAds(url);
        if (res.success) {
          showSandboxToast('VMAP schedule loaded. Starting playback...');
          player.play();
        } else {
          showSandboxToast(`VMAP load failed: ${res.error?.message || 'Unknown error'}`);
        }
      } else if (providerType === 'IMA') {
        const url = inputImaUrl.value.trim();
        showSandboxToast(`Google IMA: Requesting ads from ${url}...`);
        const res = await provider.requestAds(url);
        if (res.success) {
          showSandboxToast('Google IMA Ads loader initialized. Starting playback...');
          await provider.playAdBreak();
        } else {
          showSandboxToast(`Google IMA load failed: ${res.error?.message || 'Unknown error'}`);
        }
      } else if (providerType === 'SIMID') {
        const vastUrl = inputSimidVastUrl.value.trim();
        showSandboxToast(`SIMID: Requesting VAST ad from ${vastUrl}...`);
        const res = await provider.requestAds(vastUrl);
        if (res.success) {
          showSandboxToast('SIMID VAST ad loaded.');
          await provider.playAdBreak();
        } else {
          showSandboxToast(`SIMID VAST request failed: ${res.error?.message || 'Unknown error'}`);
        }
      } else if (providerType === 'HTML_OVERLAY') {
        const sourceType = (document.getElementById('ad-html-source-type') as HTMLSelectElement)?.value || 'string';
        const rawContent = (document.getElementById('ad-url-html-content') as HTMLInputElement)?.value.trim() || '';
        const targetType = (document.getElementById('ad-html-target') as HTMLSelectElement)?.value || 'player';
        const position = (document.getElementById('ad-html-position') as HTMLSelectElement)?.value || 'bottom';
        const duration = Number((document.getElementById('ad-html-duration') as HTMLInputElement)?.value || 15);
        const closeDelay = Number((document.getElementById('ad-html-close-delay') as HTMLInputElement)?.value || 0);
        // One "Size" field pair drives both maxWidth/maxHeight (the canvas cap)
        // and width/height (the declared size) - feeding the same numbers into
        // both always yields scale=1 in HtmlOverlayRenderer's aspect-preserving
        // path, so the rendered box is identical to using the cap alone. No
        // reason to expose these as two separate controls; see recalculateLayout().
        const widthRaw = (document.getElementById('ad-html-width') as HTMLInputElement)?.value.trim();
        const heightRaw = (document.getElementById('ad-html-height') as HTMLInputElement)?.value.trim();
        const htmlRoleTypeSelect = document.getElementById('ad-html-role-type') as HTMLSelectElement;
        const htmlRoleOffsetInput = document.getElementById('ad-html-role-offset') as HTMLInputElement;
        const htmlRoleType = htmlRoleTypeSelect ? htmlRoleTypeSelect.value : 'auto';

        const sizeWidth = widthRaw ? Number(widthRaw) : undefined;
        const sizeHeight = heightRaw ? Number(heightRaw) : undefined;

        const adConfig: any = {
          id: `html-overlay-${Date.now()}`,
          title: 'HTML Overlay Ad',
          duration,
          closeDelay,
          position,
          maxWidth: sizeWidth,
          maxHeight: sizeHeight,
          width: sizeWidth,
          height: sizeHeight,
          externalSlot: targetType === 'external' ? '#sandbox-external-overlay-slot' : undefined,
        };

        if (targetType === 'external') {
          const externalSlot = document.getElementById('sandbox-external-overlay-slot');
          if (externalSlot) externalSlot.style.display = 'block';
        }

        if (sourceType === 'string') {
          adConfig.htmlContent = rawContent || '<div style="background: linear-gradient(135deg, #1e293b, #0f172a); color: #38bdf8; padding: 12px 18px; border-radius: 8px; border: 1px solid rgba(56,189,248,0.3); text-align: center; font-family: sans-serif;"><strong style="color:#fff;">Special Offer!</strong> Upgrade to Premium for 50% Off <a href="https://example.com" target="_blank" style="color:#38bdf8; margin-left: 10px; font-weight: bold; text-decoration: underline;">Claim Now</a></div>';
          adConfig.htmlUrl = undefined;
        } else if (sourceType === 'url') {
          adConfig.htmlUrl = rawContent || 'about:blank';
          adConfig.htmlContent = undefined;
          adConfig.useIframe = true;
          if (!rawContent) {
            adConfig.htmlContent = '<!DOCTYPE html><html><body style="margin:0; background:#0f172a; color:#f8fafc; font-family:sans-serif; display:flex; align-items:center; justify-content:center; height:100vh;"><div style="text-align:center;"><span style="color:#a855f7; font-weight:bold;">⚡ Dynamic Iframe Creative</span></div></body></html>';
          }
        } else if (sourceType === 'image') {
          adConfig.imageUrl = rawContent || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="468" height="60" viewBox="0 0 468 60"><rect width="468" height="60" fill="%230f172a" rx="6"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="%2338bdf8" font-family="sans-serif" font-size="14" font-weight="bold">⚡ Interactive SVG/Image Overlay Creative</text></svg>';
          adConfig.htmlContent = undefined;
          adConfig.htmlUrl = undefined;
          adConfig.clickThroughUrl = 'https://example.com';
        } else if (sourceType === 'vast' || sourceType === 'xml') {
          adConfig.htmlUrl = rawContent;
          adConfig.tagUrl = rawContent;
          adConfig.htmlContent = undefined;
          adConfig.sourceType = 'vast';
        } else {
          adConfig.sourceType = sourceType;
          adConfig.htmlContent = undefined;
        }

        if (htmlRoleType === 'auto') {
          showSandboxToast('HTML Overlay: Rendering overlay creative...');
          const success = await adsCtrl.showOverlay(adConfig);
          if (success) {
            showSandboxToast('HTML Overlay active.');
          } else {
            showSandboxToast('HTML Overlay rendering failed.');
          }
        } else {
          let offset: number | string | undefined;
          if (htmlRoleType === 'midroll') {
            const raw = htmlRoleOffsetInput ? htmlRoleOffsetInput.value.trim() : '';
            offset = raw.endsWith('%') ? raw : Number(raw);
          }
          adsCtrl.schedule({ type: htmlRoleType as any, timeOffset: offset, provider: 'HTML_OVERLAY', overlay: adConfig });
          showSandboxToast(`HTML Overlay scheduled as ${htmlRoleType}${offset !== undefined ? ` @ ${offset}` : ''}. Continue/start content playback to trigger it.`);
        }
      }
    }, 150);
  });

  // Listen and log ad & overlay events to console
  const adEvents = [
    'adloadstart', 'adloaded', 'adstart', 'adpause', 'adresume', 'adskip', 'adcomplete', 'aderror', 'adclick', 'admilestone', 'skipavailable', 'adverificationready', 'companionshown', 'companionerror', 'vmapparseerror', 'vmapbreakerror',
    'htmloverlayavailable', 'htmloverlayloaded', 'htmloverlayshown', 'htmloverlayhidden', 'htmloverlayclosed', 'htmloverlayclick', 'htmloverlaycompleted', 'htmloverlayerror', 'htmloverlayupdated'
  ];
  // Only the events a sandbox user actually needs a toast for; everything in
  // adEvents is still logged to console. Load/creative/milestone/technical
  // events (adloadstart, adloaded, admilestone, adverificationready, and most
  // of the htmloverlay* lifecycle) fire multiple times per ad in quick
  // succession and just spam/overwrite the single toast slot.
  const adEventMessages: Record<string, (detail: any) => string> = {
    adstart: () => 'Ad: playback started',
    adpause: () => 'Ad: paused',
    adresume: () => 'Ad: resumed',
    adskip: () => 'Ad: skipped by viewer',
    adcomplete: () => 'Ad: finished, resuming content',
    aderror: (d) => `Ad error: ${d?.error?.message || 'failed to load or play the ad'}`,
    adclick: () => 'Ad: click-through opened',
    skipavailable: () => 'Ad: skip button is now available',
    companionshown: () => 'Companion ad displayed alongside the video',
    companionerror: (d) => `Companion ad failed: ${d?.reason || 'could not be displayed'}`,
    vmapparseerror: (d) => `VMAP error: ${d?.message || 'could not parse the ad schedule'}`,
    vmapbreakerror: (d) => `Ad break failed: ${d?.message || 'could not load ads for this break'}`,
    htmloverlayshown: () => 'HTML overlay ad: now showing',
    htmloverlayclosed: () => 'HTML overlay ad: closed by viewer',
    htmloverlayerror: (d) => {
      if (d?.isLinearRedirect) {
        return 'Linear VAST ad detected. Redirecting to video ad player...';
      }
      return `HTML overlay ad error: ${d?.message || 'failed to render'}`;
    },
  };
  adEvents.forEach(evt => {
    // Player.ts re-dispatches controller events as DOM CustomEvents prefixed
    // with "player-" (e.g. controller event "adloaded" -> DOM event
    // "player-adloaded") - every other listener in this file already follows
    // that convention (see 'player-state-change' above); this block didn't,
    // which meant none of these ever actually fired.
    player.addEventListener(`player-${evt}`, (e: any) => {
      if (['htmloverlayerror', 'htmloverlayavailable', 'htmloverlayloaded', 'htmloverlayshown', 'adstart'].includes(evt)) {
        console.log(`[VAST-DIAG][EVENT] ${evt}`, e.detail);
      }
      console.log(`[Ad Event] ${evt}`, e.detail);
      const toMessage = adEventMessages[evt];
      if (toMessage) showSandboxToast(toMessage(e.detail));
    });
  });

  // Companion ads render into the shared "external page slot" demo element
  // (see the ui.adOverlaySlot wiring above) - make sure it's visible whenever
  // a companion actually shows, since it defaults to hidden until then.
  player.addEventListener('player-companionshown', () => {
    const slot = document.getElementById('sandbox-external-overlay-slot');
    if (slot) slot.style.display = 'block';
  });

  sourceTypeSelect.dispatchEvent(new Event('change'));
});

