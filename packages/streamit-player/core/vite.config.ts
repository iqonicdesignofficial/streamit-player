import { defineConfig } from 'vite';
import { fileURLToPath } from 'url';
import dts from 'vite-plugin-dts';

export default defineConfig({
  build: {
    lib: {
      entry: {
        index: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
        PlayerController: fileURLToPath(new URL('./src/PlayerController.ts', import.meta.url)),
        KeyboardManager: fileURLToPath(new URL('./src/KeyboardManager.ts', import.meta.url)),
        TimelineMath: fileURLToPath(new URL('./src/TimelineMath.ts', import.meta.url)),
        utils: fileURLToPath(new URL('./src/utils.ts', import.meta.url)),
        ThumbnailProviders: fileURLToPath(new URL('./src/providers/ThumbnailProviders.ts', import.meta.url)),
        DrmManager: fileURLToPath(new URL('./src/DrmManager.ts', import.meta.url)),
        DrmValidator: fileURLToPath(new URL('./src/DrmValidator.ts', import.meta.url)),
      },
      name: 'PlayerCore',
      fileName: (format, name) => {
        const ext = format === 'es' ? 'js' : 'cjs';
        if (name === 'index') {
          return `core.${ext}`;
        }
        return `${name}.${ext}`;
      },
      formats: ['es', 'cjs'],
    },
    rollupOptions: {
      external: ['hls.js', 'dashjs'],
      output: {
        globals: {
          'hls.js': 'Hls',
          dashjs: 'dashjs',
        },
      },
    },
  },
  plugins: [
    dts({
      tsconfigPath: './tsconfig.json',
      rollupTypes: false,
    }),
  ],
});
