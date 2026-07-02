import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Two-page (MPA) client. Built assets go to ../dist, which the Express server serves.
// In dev, Vite runs on 5173 and proxies API + WebSocket to the Node server on 3000.
export default defineConfig({
  root: 'client',
  plugins: [react()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        player: fileURLToPath(new URL('./client/player.html', import.meta.url)),
        remote: fileURLToPath(new URL('./client/remote.html', import.meta.url)),
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/socket.io': { target: 'http://localhost:3000', ws: true },
    },
  },
});
