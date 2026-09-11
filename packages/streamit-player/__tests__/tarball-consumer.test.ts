import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { createRequire } from 'module';
import { JSDOM } from 'jsdom';

const nodeRequire = createRequire(import.meta.url);

describe('Production Tarball & Multi-Framework Consumer Test Suite', () => {
  const packageDir = path.resolve(__dirname, '..');
  const distDir = path.join(packageDir, 'dist');

  it('generates npm package tarball without unpermitted internal files', () => {
    const output = execSync('npm pack --dry-run --json', { cwd: packageDir, encoding: 'utf8' });
    const [packResult] = JSON.parse(output);

    const pkg = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
    expect(packResult.name).toBe('streamit-player');
    expect(packResult.version).toBe(pkg.version);

    const packedFiles: string[] = packResult.files.map((f: any) => f.path);

    // Verify all packed files are in dist, root metadata, or docs
    for (const file of packedFiles) {
      const isAllowed =
        file.startsWith('dist/') ||
        file === 'package.json' ||
        file === 'README.md' ||
        file === 'LICENSE' ||
        file === 'CHANGELOG.md';
      expect(isAllowed, `Unexpected file in npm tarball: ${file}`).toBe(true);
    }

    // Verify prohibited files outside dist are NOT in tarball
    expect(packedFiles).not.toContain('vite.config.ts');
    expect(packedFiles).not.toContain('vitest.config.ts');
    expect(packedFiles).not.toContain('tsconfig.json');
    expect(packedFiles.some((f) => !f.startsWith('dist/') && f.includes('src/'))).toBe(false);
  }, 30000);

  it('keeps custom-element registration when a bundler tree-shakes a bare side-effect import', () => {
    // `import 'streamit-player'` uses no exports, so bundlers keep only modules that the
    // package.json `sideEffects` field marks as side-effectful. The element definitions live
    // in a hashed shared chunk (Player-*.js) that must not be dropped. esbuild runs in a
    // child process because it refuses to run inside the jsdom environment.
    const entry = path.join(distDir, 'index.js').replace(/\\/g, '/');
    const script = [
      `const { build } = require(${JSON.stringify(nodeRequire.resolve('esbuild'))});`,
      `build({`,
      `  stdin: { contents: ${JSON.stringify(`import ${JSON.stringify(entry)};`)}, resolveDir: ${JSON.stringify(packageDir)} },`,
      `  bundle: true, write: false, format: 'esm', platform: 'browser',`,
      `  external: ['hls.js', 'dashjs'], logLevel: 'error',`,
      `}).then((r) => process.stdout.write(String(r.outputFiles[0].text.includes('customElements.define("streamit-player"'))));`,
    ].join('\n');
    const registered = execSync('node -', { input: script, cwd: packageDir, encoding: 'utf8' }).trim();
    expect(registered, 'a bundled `import "streamit-player"` must still define <streamit-player>').toBe('true');
  }, 30000);

  describe('Subpath Module Imports Verification (ESM)', () => {
    it('imports "streamit-player" root bundle and registers custom elements', async () => {
      const rootModule = await import(path.join(distDir, 'index.js'));
      expect(rootModule.PlayerPlayer).toBeDefined();
      expect(rootModule.THEME_PRESETS).toBeDefined();
      expect(rootModule.TimelineMath).toBeDefined();
      expect(customElements.get('streamit-player')).toBeDefined();
    });

    it('imports "streamit-player/core" headless module without UI code', async () => {
      const coreModule = await import(path.join(distDir, 'core/index.js'));
      expect(coreModule.PlayerController).toBeDefined();
      expect(coreModule.TimelineMath).toBeDefined();
      expect(coreModule.formatTime).toBeDefined();
    });

    it('imports "streamit-player/web-components" UI module', async () => {
      const wcModule = await import(path.join(distDir, 'web-components/index.js'));
      expect(wcModule.PlayerPlayer).toBeDefined();
      expect(wcModule.PlayerPlayButton).toBeDefined();
      expect(wcModule.PlayerSeekbar).toBeDefined();
      expect(wcModule.PlayerVolumeControl).toBeDefined();
    });
  });

  describe('Subpath Module Requires Verification (CommonJS)', () => {
    it('requires "streamit-player/core" CommonJS bundle without throwing', () => {
      const coreCjs = nodeRequire(path.join(distDir, 'core/index.cjs'));
      expect(coreCjs.PlayerController).toBeDefined();
      expect(coreCjs.TimelineMath).toBeDefined();
      expect(coreCjs.formatTime).toBeDefined();
    });

    it('requires "streamit-player" root CommonJS bundle without throwing', () => {
      const rootCjs = nodeRequire(path.join(distDir, 'index.cjs'));
      expect(rootCjs.PlayerPlayer).toBeDefined();
      expect(rootCjs.PlayerController).toBeDefined();
    });

    it('requires "streamit-player/web-components" CommonJS bundle without throwing', () => {
      const wcCjs = nodeRequire(path.join(distDir, 'web-components/index.cjs'));
      expect(wcCjs.PlayerPlayer).toBeDefined();
      expect(wcCjs.PlayerPlayButton).toBeDefined();
    });
  });

  describe('Custom Element Primary & Legacy Aliases Registration', () => {
    const aliasPairs = [
      ['streamit-player', 'player-player'],
      ['streamit-play-button', 'player-play-button'],
      ['streamit-seekbar', 'player-seekbar'],
      ['streamit-volume-control', 'player-volume-control'],
      ['streamit-seek-button', 'player-seek-button'],
      ['streamit-chapters-button', 'player-chapters-button'],
      ['streamit-vertical-controls', 'player-vertical-controls']
    ];

    for (const [primary, alias] of aliasPairs) {
      it(`registers both primary <${primary}> and legacy alias <${alias}>`, () => {
        const PrimaryCtor = customElements.get(primary);
        const AliasCtor = customElements.get(alias);

        expect(PrimaryCtor, `<${primary}> must be defined`).toBeDefined();
        expect(AliasCtor, `<${alias}> must be defined`).toBeDefined();

        // Instantiate both elements
        const primaryEl = document.createElement(primary);
        const aliasEl = document.createElement(alias);

        expect(primaryEl).toBeInstanceOf(HTMLElement);
        expect(aliasEl).toBeInstanceOf(HTMLElement);
      });
    }
  });

  describe('React 18 & 19 Integration Pattern Verification', () => {
    it('supports mounting, config setting, event listeners, and unmounting', () => {
      const playerEl = document.createElement('streamit-player') as any;
      document.body.appendChild(playerEl);

      playerEl.setAttribute('src', 'https://example.com/stream.m3u8');
      playerEl.setAttribute('controls', '');
      expect(playerEl.getAttribute('src')).toBe('https://example.com/stream.m3u8');

      const testConfig = { autoplay: true, muted: true };
      playerEl.config = testConfig;
      expect(playerEl.config).toBe(testConfig);

      let playFired = false;
      const playListener = () => {
        playFired = true;
      };
      playerEl.addEventListener('player-play', playListener);

      playerEl.dispatchEvent(new CustomEvent('player-play', { bubbles: true, composed: true }));
      expect(playFired).toBe(true);

      playerEl.removeEventListener('player-play', playListener);
      document.body.removeChild(playerEl);
      expect(playerEl.parentElement).toBeNull();
    });
  });

  describe('CDN Standalone Artifacts Execution', () => {
    it('ESM CDN bundle exists and has valid JS', () => {
      const cdnEsm = path.join(distDir, 'streamit-player.esm.min.js');
      expect(fs.existsSync(cdnEsm)).toBe(true);
      const content = fs.readFileSync(cdnEsm, 'utf8');
      expect(content.length).toBeGreaterThan(10000);
    });

    it('IIFE CDN bundle executes and registers global in browser sandbox context', () => {
      const cdnIife = path.join(distDir, 'streamit-player.iife.min.js');
      expect(fs.existsSync(cdnIife)).toBe(true);
      const content = fs.readFileSync(cdnIife, 'utf8');
      expect(content.length).toBeGreaterThan(10000);

      // Execute in full JSDOM browser environment
      const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
        runScripts: 'dangerously'
      });

      const scriptEl = dom.window.document.createElement('script');
      scriptEl.textContent = content;
      dom.window.document.body.appendChild(scriptEl);

      const win = dom.window as any;
      expect(win.StreamitPlayer).toBeDefined();
      expect(win.StreamitPlayer.PlayerPlayer).toBeDefined();
      expect(win.StreamitPlayer.PlayerController).toBeDefined();
      expect(win.customElements.get('streamit-player')).toBeDefined();
      expect(win.customElements.get('player-player')).toBeDefined();
    });
  });

  describe('TypeScript Declaration Verification', () => {
    it('validates declaration files exist for all subpath entry points', () => {
      expect(fs.existsSync(path.join(distDir, 'src/index.d.ts'))).toBe(true);
      expect(fs.existsSync(path.join(distDir, 'core/src/index.d.ts'))).toBe(true);
      expect(fs.existsSync(path.join(distDir, 'web-components/src/index.d.ts'))).toBe(true);
    });

    it('typechecks a consumer fixture against generated dist declarations with zero errors', () => {
      const fixtureTs = `
        import 'streamit-player';
        import { PlayerController } from 'streamit-player/core';
        import type { PlayerConfiguration, PlayerState } from 'streamit-player/core';
        import { PlayerPlayer, THEME_PRESETS } from 'streamit-player/web-components';

        const config: PlayerConfiguration = {
          autoplay: true,
          muted: false,
          theme: { preset: 'glass-dark' }
        };

        const dummyVideo = {} as HTMLVideoElement;
        const controller = new PlayerController(dummyVideo, config);
        controller.onStateChange((state: PlayerState) => {
          const isAtLiveEdge: boolean = state.isAtLiveEdge;
          const currentPos: number = state.currentTime;
        });

        const player = new PlayerPlayer();
        const theme = THEME_PRESETS['glass-dark'];
      `;

      const tmpDir = path.join(packageDir, 'node_modules/.tmp-ts-verify');
      if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
      }

      const consumerFile = path.join(tmpDir, 'consumer.ts');
      const tsconfigFile = path.join(tmpDir, 'tsconfig.json');

      fs.writeFileSync(consumerFile, fixtureTs, 'utf8');
      fs.writeFileSync(
        tsconfigFile,
        JSON.stringify({
          compilerOptions: {
            target: 'ES2022',
            module: 'ESNext',
            moduleResolution: 'bundler',
            lib: ['DOM', 'DOM.Iterable', 'ES2022'],
            strict: true,
            noEmit: true,
            baseUrl: '.',
            paths: {
              'streamit-player': [path.relative(tmpDir, path.join(distDir, 'src/index.d.ts')).replace(/\\/g, '/')],
              'streamit-player/core': [path.relative(tmpDir, path.join(distDir, 'core/src/index.d.ts')).replace(/\\/g, '/')],
              'streamit-player/web-components': [path.relative(tmpDir, path.join(distDir, 'web-components/src/index.d.ts')).replace(/\\/g, '/')]
            }
          },
          include: ['consumer.ts']
        }),
        'utf8'
      );

      // Run tsc
      const tscOutput = execSync(`npx tsc -p "${tsconfigFile}"`, {
        cwd: packageDir,
        encoding: 'utf8'
      });
      expect(tscOutput.trim()).toBe('');

      // Cleanup
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });
  });
});
