import { defineConfig } from 'vite';

export default defineConfig({
  // rapier3d-compat は WASM を base64 inline で持つため
  // Vite の pre-bundle から除外してそのまま使う
  optimizeDeps: {
    exclude: ['@dimforge/rapier3d-compat'],
  },
  build: {
    target: 'esnext',  // top-level await のため
  },
  server: {
    // output/ ディレクトリの GLB を直接参照できるよう親ディレクトリをルートに
    fs: {
      allow: ['..'],
    },
  },
});
