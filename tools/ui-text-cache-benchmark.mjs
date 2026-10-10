// SPDX-License-Identifier: Apache-2.0
// Browser-only CPU benchmark; never launches a desktop runner.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { createServer } = await import(pathToFileURL(path.join(root, 'desktop/node_modules/vite/dist/node/index.js')).href);
const server = await createServer({ configFile: false, root,
  optimizeDeps: { noDiscovery: true, entries: [] },
  server: { host: '127.0.0.1', port: 5196, strictPort: true },
  plugins: [{ name: 'text-cache-benchmark', configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url !== '/__text-cache-benchmark') return next();
      server.transformIndexHtml(req.url, '<html lang="zh"><head><meta charset="utf-8"><title>文字缓存 CPU 对照</title></head><body><main id="root"></main><script type="module" src="/tools/ui-text-cache-benchmark.ts"></script></body></html>')
        .then(html => { res.setHeader('Content-Type', 'text/html'); res.end(html); });
    });
  } }],
});
await server.listen();
console.log('Text cache CPU benchmark: http://127.0.0.1:5196/__text-cache-benchmark');
