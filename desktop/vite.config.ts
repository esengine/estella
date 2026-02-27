import { resolve } from 'path';
import { readFileSync } from 'fs';
import { defineConfig, type Plugin } from 'vite';

const tauriConf = JSON.parse(readFileSync(resolve(__dirname, 'src-tauri/tauri.conf.json'), 'utf-8'));
const sdkPkg = JSON.parse(readFileSync(resolve(__dirname, '../sdk/package.json'), 'utf-8'));

const host = process.env.TAURI_DEV_HOST;

function tauriHtmlFixes(): Plugin {
  return {
    name: 'tauri-html-fixes',
    enforce: 'post',
    transformIndexHtml(html) {
      let result = html.replace(/ crossorigin/g, '');

      const linkMatch = result.match(/<link rel="stylesheet"[^>]*>/);
      const scriptMatch = result.match(/<script type="module"[^>]*><\/script>/);
      if (linkMatch && scriptMatch) {
        const linkTag = linkMatch[0];
        const scriptTag = scriptMatch[0];
        result = result.replace(linkTag, '').replace(scriptTag, `${linkTag}\n  ${scriptTag}`);
      }

      return result;
    },
  };
}

export default defineConfig({
  clearScreen: false,
  plugins: [tauriHtmlFixes()],
  define: {
    __ENGINE_VERSION__: JSON.stringify(tauriConf.version),
    __SDK_VERSION__: JSON.stringify(sdkPkg.version),
  },
  server: {
    port: 5173,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          host,
          port: 5174,
        }
      : undefined,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  build: {
    target: 'esnext',
    minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_DEBUG,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        'panel-window': resolve(__dirname, 'panel-window.html'),
      },
    },
  },
});
