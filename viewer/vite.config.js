import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  // rapier3d-compat は WASM を base64 inline で持つため
  // Vite の pre-bundle から除外してそのまま使う
  optimizeDeps: {
    exclude: ['@dimforge/rapier3d-compat'],
  },
  build: {
    target: 'esnext',  // top-level await のため
    rollupOptions: {
      input: {
        viewer: resolve(import.meta.dirname, 'index.html'),
        game: resolve(import.meta.dirname, 'game.html'),
      },
    },
  },
  server: {
    // output/ ディレクトリの GLB を直接参照できるよう親ディレクトリをルートに
    fs: {
      allow: ['..'],
    },
  },
});
