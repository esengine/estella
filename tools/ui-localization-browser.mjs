// SPDX-License-Identifier: Apache-2.0
// Ordinary browser fixture. No Electron, native windows or automated desktop launch.
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { createServer } = await import(pathToFileURL(path.join(root, 'desktop/node_modules/vite/dist/node/index.js')).href);
const { default: react } = await import(pathToFileURL(path.join(root, 'desktop/node_modules/@vitejs/plugin-react/dist/index.js')).href);
const server = await createServer({ configFile: false, root: path.join(root, 'desktop'),
  resolve: { alias: [
    { find: '@', replacement: path.join(root, 'desktop/src') },
    { find: /^esengine$/, replacement: path.join(root, 'sdk/dist/index.js') },
  ] },
  server: { host: '127.0.0.1', port: 5194, strictPort: true, fs: { allow: [root] } },
  plugins: [react(), { name: 'ui-localization-fixture', configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url === '/__localization-scene.json') {
        res.setHeader('Content-Type', 'application/json');
        res.end(fs.readFileSync(path.join(root, 'examples/ui-localization-debug/assets/scenes/main.esscene')));
      } else if (req.url === '/__mask-scene.json') {
        res.setHeader('Content-Type', 'application/json');
        res.end(fs.readFileSync(path.join(root, 'tools/ui-mask-inspection.esscene')));
      } else if (req.url === '/__localization') {
        const entry = `/@fs/${path.join(root, 'tools/ui-localization-browser.tsx').replaceAll('\\', '/')}`;
        const html = `<html><head><title>UI localization Web verification</title></head><body><div id="root"></div><script type="module" src="${entry}"></script></body></html>`;
        server.transformIndexHtml(req.url, html).then((result) => { res.setHeader('Content-Type', 'text/html'); res.end(result); });
      } else next();
    });
  } }] });
await server.listen();
console.log('UI localization fixture: http://127.0.0.1:5194/__localization');
