import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5000,
    host: true,
    allowedHosts: [
      '.ngrok-free.dev',
      '.trycloudflare.com'
    ]
  }
});
