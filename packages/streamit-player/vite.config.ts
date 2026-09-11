import { defineConfig, type UserConfig } from 'vite';
import { fileURLToPath } from 'url';
import dts from 'vite-plugin-dts';

// hls.js / dash.js stay lazy-loaded optional dependencies. A bare 'hls.js'
// specifier can't resolve in a browser without an import map, so the CDN
// bundles point the dynamic import at jsDelivr's ESM builds instead. A
// page-level window.Hls / window.dashjs still takes priority - see
// core/src/vendorLoaders.ts.
const CDN_VENDOR_PATHS = {
  'hls.js': 'https://cdn.jsdelivr.net/npm/hls.js@1/+esm',
  dashjs: 'https://cdn.jsdelivr.net/npm/dashjs@5/+esm',
};

export default defineConfig(({ mode }): UserConfig => {
  if (mode === 'cdn') {
    return {
      build: {
        emptyOutDir: false,
        lib: {
          entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
          name: 'StreamitPlayer',
          formats: ['es', 'iife'],
          fileName: (format) => {
            if (format === 'es') return 'streamit-player.esm.min.js';
            return 'streamit-player.iife.min.js';
          },
        },
        rollupOptions: {
          external: ['hls.js', 'dashjs'],
          output: {
            globals: {
              'hls.js': 'Hls',
              dashjs: 'dashjs',
            },
            paths: CDN_VENDOR_PATHS,
          },
        },
        minify: 'esbuild',
      },
    };
  }

  if (mode === 'cdn-unminified') {
    return {
      build: {
        emptyOutDir: false,
        lib: {
          entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
          name: 'StreamitPlayer',
          formats: ['es', 'iife'],
          fileName: (format) => {
            if (format === 'es') return 'streamit-player.esm.js';
            return 'streamit-player.iife.js';
          },
        },
        rollupOptions: {
          external: ['hls.js', 'dashjs'],
          output: {
            globals: {
              'hls.js': 'Hls',
              dashjs: 'dashjs',
            },
            paths: CDN_VENDOR_PATHS,
          },
        },
        minify: false,
      },
    };
  }

  return {
    build: {
      lib: {
        entry: {
          index: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
          'core/index': fileURLToPath(new URL('./core/src/index.ts', import.meta.url)),
          'web-components/index': fileURLToPath(new URL('./web-components/src/index.ts', import.meta.url)),
        },
        formats: ['es', 'cjs'],
        fileName: (format, name) => `${name}.${format === 'es' ? 'js' : 'cjs'}`,
      },
      rollupOptions: {
        external: ['lit', 'lit/decorators.js', 'hls.js', 'dashjs'],
        output: {
          globals: {
            lit: 'Lit',
            'lit/decorators.js': 'Lit.decorators',
            'hls.js': 'Hls',
            dashjs: 'dashjs',
          },
        },
      },
      minify: false,
    },
    plugins: [
      dts({
        tsconfigPath: './tsconfig.json',
        rollupTypes: false,
      }),
    ],
  };
});
