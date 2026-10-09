// SPDX-License-Identifier: Apache-2.0
// Browser-only staging of the real Play host. Never launches Electron.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stage = path.join(root, 'output/ui-events-play-browser');
fs.mkdirSync(stage, { recursive: true });
const { build } = await import(pathToFileURL(path.join(root, 'desktop/node_modules/esbuild/lib/main.js')).href);
const { createServer } = await import(pathToFileURL(path.join(root, 'desktop/node_modules/vite/dist/node/index.js')).href);
const { default: react } = await import(pathToFileURL(path.join(root, 'desktop/node_modules/@vitejs/plugin-react/dist/index.js')).href);
const assembly = path.join(stage, 'assemble.mjs');
await build({ entryPoints: [path.join(root, 'desktop/electron/buildPlayRealm.ts')], outfile: assembly, bundle: true, platform: 'node', format: 'esm' });
const { buildPlayRealm } = await import(pathToFileURL(assembly).href);
const staged = await buildPlayRealm({ root: stage, playHostArtifact: path.join(root, 'desktop/dist-electron/hosts/playHost.js'), sdkDistDir: path.join(root, 'sdk/dist'), wasmDir: path.join(root, 'desktop/public/wasm') });
if (!staged.ok) throw Error(staged.errors.join('\n'));
const scripts = path.join(stage, '.esengine/cache/scripts.mjs');
await build({ entryPoints: [path.join(root, 'tools/ui-events-play-project.ts')], outfile: scripts, bundle: true, format: 'esm', platform: 'browser', external: ['esengine', 'esengine/*'] });
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript', '.wasm': 'application/wasm', '.json': 'application/json' };
const server = await createServer({ configFile: false, root: path.join(root, 'desktop'),
 resolve: { alias: [{find:'@',replacement:path.join(root,'desktop/src')},{find:/^esengine$/,replacement:path.join(root,'sdk/dist/index.js')}] },
 server: { host:'127.0.0.1', port:5195, strictPort:true, fs:{allow:[root]} },
 plugins: [react(), {
  name:'ui-events-play-browser', enforce:'pre',
  transform(code, id) {
   // Only the test server substitutes the native project URL with its HTTP mount.
   if (id.replaceAll('\\','/').endsWith('/src/engine/PlayRealm.ts')) return code.replaceAll('estella://project/', '/__project/');
  },
  configureServer(server) { server.middlewares.use((req,res,next)=>{
   const url = new URL(req.url, 'http://127.0.0.1');
   if (url.pathname.startsWith('/__project/')) {
    const file = path.resolve(stage, '.' + url.pathname.slice('/__project'.length));
    if (!file.startsWith(stage + path.sep)) { res.statusCode=403;res.end();return; }
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {res.statusCode=404;res.end();return;}
    res.setHeader('Content-Type',mime[path.extname(file)]??'application/octet-stream');res.end(fs.readFileSync(file));
   } else if (url.pathname==='/__events-scene.json') {
    res.setHeader('Content-Type','application/json');res.end(fs.readFileSync(path.join(root,'tools/ui-mask-inspection.esscene')));
   } else if (url.pathname==='/__events-play') {
    const entry=`/@fs/${path.join(root,'tools/ui-events-play-browser.tsx').replaceAll('\\','/')}`;
    server.transformIndexHtml(req.url,`<html><head><title>UI Events Play verification</title></head><body><div id="root"></div><script type="module" src="${entry}"></script></body></html>`).then(html=>{res.setHeader('Content-Type','text/html');res.end(html);});
   } else next();
  }); }
 }]
});
await server.listen();
console.log('UI Events Play fixture: http://127.0.0.1:5195/__events-play');
