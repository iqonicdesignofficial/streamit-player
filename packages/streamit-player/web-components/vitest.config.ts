import { defineConfig } from 'vitest/config';

// Newer Node versions expose their own Web Storage `localStorage` global (on by
// default since Node 25), which shadows jsdom's and has no working storage without
// --localstorage-file. Turn it off in the workers so tests get jsdom's localStorage.
const nodeHasWebStorage = 'localStorage' in globalThis;

export default defineConfig({
  test: {
    environment: 'jsdom',
    execArgv: nodeHasWebStorage ? ['--no-experimental-webstorage'] : [],
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
    },
  },
});
