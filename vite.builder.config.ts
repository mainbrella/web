import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { siteChromePlugin } from './scripts/site-chrome-plugin.ts';

let staging = false;

export default defineConfig({
  base: '/',
  // Import just the builder's CSS and images; do not copy the public site.
  publicDir: false,
  plugins: [
    siteChromePlugin({ bundleAssets: true }),
    {
      name: 'staging-noindex',
      configResolved(config) { staging = config.mode === 'staging'; },
      generateBundle() {
        if (!staging) return;
        this.emitFile({ type: 'asset', fileName: 'robots.txt', source: 'User-agent: *\nDisallow: /\n' });
        this.emitFile({ type: 'asset', fileName: '_headers', source: '/*\n  X-Robots-Tag: noindex, nofollow\n' });
      },
    },
  ],
  build: {
    outDir: 'dist-builder',
    emptyOutDir: true,
    assetsDir: 'build/assets',
    assetsInlineLimit: 0,
    reportCompressedSize: false,
    manifest: true,
    rollupOptions: {
      input: fileURLToPath(new URL('./build/index.html', import.meta.url)),
    },
  },
});
