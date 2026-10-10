// SPDX-License-Identifier: Apache-2.0
// Serves the existing editor WASM build; never launches Electron.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const wasmDir = path.join(root, 'desktop/public/wasm');
const wasm = fs.readFileSync(path.join(wasmDir, 'esengine.wasm'));
const metadata = { wasmSha256: createHash('sha256').update(wasm).digest('hex'), wasmBytes: wasm.length };
const { createServer } = await import(pathToFileURL(path.join(root, 'desktop/node_modules/vite/dist/node/index.js')).href);
const server = await createServer({ configFile: false, root,
  optimizeDeps: { noDiscovery: true, entries: [] },
  server: { host: '127.0.0.1', port: 5197, strictPort: true },
  plugins: [{ name: 'layout-cpu-benchmark', configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname === '/__layout-build.json') {
        res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(metadata));
      } else if (['/__layout-wasm/esengine.js', '/__layout-wasm/esengine.wasm'].includes(url.pathname)) {
        res.setHeader('Content-Type', url.pathname.endsWith('.wasm') ? 'application/wasm' : 'application/javascript');
        res.end(fs.readFileSync(path.join(wasmDir, path.basename(url.pathname))));
      } else if (url.pathname === '/__layout-cpu-benchmark') {
        server.transformIndexHtml(req.url, '<html lang="zh"><head><meta charset="utf-8"><title>2D 布局 CPU 对照</title></head><body><main id="root"></main><script type="module" src="/tools/ui-layout-cpu-benchmark.ts"></script></body></html>')
          .then(html => { res.setHeader('Content-Type', 'text/html'); res.end(html); });
      } else next();
    });
  } }],
});
await server.listen();
console.log('Layout CPU benchmark: http://127.0.0.1:5197/__layout-cpu-benchmark');
