/// <reference types='vitest' />
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import fs from 'fs';
import path from 'path';

// mkcert certificates for trusted HTTPS on LAN (mobile mic access)
const certPath = path.resolve(import.meta.dirname, 'certs/cert.pem');
const keyPath = path.resolve(import.meta.dirname, 'certs/key.pem');
const hasCerts = fs.existsSync(certPath) && fs.existsSync(keyPath);

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/apps/holo-display',
  server: {
    port: 4200,
    host: '0.0.0.0',
    https: hasCerts
      ? { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }
      : true, // fallback to basicSsl-style self-signed if certs missing
  },
  preview: {
    port: 4300,
    host: '0.0.0.0',
  },
  plugins: [vue(), tailwindcss()],
  // Uncomment this if you are using workers.
  // worker: {
  //  plugins: [],
  // },
  build: {
    outDir: './dist',
    emptyOutDir: true,
    reportCompressedSize: true,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
  test: {
    name: '@org/holo-display',
    watch: false,
    globals: true,
    environment: 'jsdom',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: './test-output/vitest/coverage',
      provider: 'v8' as const,
    },
  },
}));
