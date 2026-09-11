import { defineConfig } from 'vite';
import { fileURLToPath } from 'url';
import dts from 'vite-plugin-dts';

export default defineConfig({
  build: {
    lib: {
      entry: {
        index: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
        Player: fileURLToPath(new URL('./src/Player.ts', import.meta.url)),
        PlayButton: fileURLToPath(new URL('./src/PlayButton.ts', import.meta.url)),
        Seekbar: fileURLToPath(new URL('./src/Seekbar.ts', import.meta.url)),
        VolumeControl: fileURLToPath(new URL('./src/VolumeControl.ts', import.meta.url)),
        SeekButton: fileURLToPath(new URL('./src/SeekButton.ts', import.meta.url)),
        ChaptersButton: fileURLToPath(new URL('./src/ChaptersButton.ts', import.meta.url)),
        VerticalControls: fileURLToPath(new URL('./src/VerticalControls.ts', import.meta.url)),
        Themes: fileURLToPath(new URL('./src/Themes.ts', import.meta.url)),
        IconRegistry: fileURLToPath(new URL('./src/icons/IconRegistry.ts', import.meta.url)),
      },
      name: 'PlayerWebComponents',
      fileName: (format, name) => {
        const ext = format === 'es' ? 'js' : 'cjs';
        if (name === 'index') {
          return `web-components.${ext}`;
        }
        return `${name}.${ext}`;
      },
      formats: ['es', 'cjs'],
    },
    rollupOptions: {
      external: ['lit', 'lit/decorators.js', '@player/core'],
      output: {
        globals: {
          lit: 'Lit',
          'lit/decorators.js': 'Lit.decorators',
          '@player/core': 'PlayerCore',
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
