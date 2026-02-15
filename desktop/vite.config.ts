import { defineConfig, type Plugin } from 'vite';

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
  },
});
