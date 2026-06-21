/**
 * @file  Play-realm host assembly (REARCH_EDITOR_REALM import-map phase). Stages a
 *        self-contained realm under the project's `.esengine/play/` so the editor
 *        can run it from `estella://project/.esengine/play/play.html` (everything
 *        same-origin estella://):
 *          - host.js   esbuild of src/playHost.ts, esengine EXTERNAL
 *          - sdk/       a copy of the SDK dist (the import-map target)
 *          - wasm/      a copy of the engine runtime (glue + binary + side modules)
 *          - play.html  the host page: import map (esengine → ./sdk) + host.js
 *        The project bundle (`.esengine/cache/scripts.mjs`, esengine external —
 *        built separately by buildProjectScripts) resolves esengine through the
 *        SAME import map, so its defineComponent/defineSystem register into the
 *        instance the host's createWebApp uses (custom components+systems run).
 *
 *        Pure Node (esbuild + fs); IPC wiring in main.ts.
 */
import { build } from 'esbuild';
import { cp, mkdir, rm, writeFile, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const PLAY_DIR = '.esengine/play';

// Subpath exports can't be a single `esengine/` → `./sdk/` mapping (import maps
// don't append /index.js for directories), so list the real files (mirrors
// sdk/package.json `exports`).
const IMPORT_MAP = {
  imports: {
    esengine: './sdk/index.js',
    'esengine/spine': './sdk/spine/index.js',
    'esengine/physics': './sdk/physics/index.js',
    'esengine/wasm': './sdk/wasm.js',
    'esengine/factory': './sdk/webAppFactory.js',
  },
};

// The inline import map is an inline <script>, so CSP must allow it — by HASH
// (not 'unsafe-inline', which would permit any inline script). 'unsafe-eval' is
// for the emscripten glue; everything else is same-origin estella://.
const IMPORT_MAP_JSON = JSON.stringify(IMPORT_MAP);
const IMPORT_MAP_HASH = `sha256-${createHash('sha256').update(IMPORT_MAP_JSON).digest('base64')}`;

const PLAY_HTML = `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'self' estella:; script-src 'self' 'unsafe-eval' '${IMPORT_MAP_HASH}' estella:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: estella:; font-src 'self' data: estella:; connect-src 'self' data: blob: estella:; worker-src 'self' blob:;"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no" />
    <title>Estella Play</title>
    <script type="importmap">${IMPORT_MAP_JSON}</script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: 100%; height: 100%; overflow: hidden; background: #0e121b; }
      #canvas { display: block; width: 100%; height: 100%; touch-action: none; outline: none; }
    </style>
  </head>
  <body>
    <canvas id="canvas"></canvas>
    <script type="module" src="./host.js"></script>
  </body>
</html>
`;

export interface PlayRealmResult {
  ok: boolean;
  /** Project-relative path to the host page → `estella://project/<hostPath>`. */
  hostPath: string;
  errors: string[];
}

/** Copy `src`→`dst` only when `marker`'s mtime changed since the last copy. */
async function syncDir(src: string, dst: string, marker: string, stampFile: string): Promise<void> {
  if (!existsSync(src)) return;
  const sig = String((await stat(marker)).mtimeMs);
  if (existsSync(dst) && existsSync(stampFile) && (await readFile(stampFile, 'utf8')) === sig) return;
  await rm(dst, { recursive: true, force: true });
  await cp(src, dst, { recursive: true });
  await writeFile(stampFile, sig);
}

export async function buildPlayRealm(opts: {
  root: string;
  playHostEntry: string;
  sdkDistDir: string;
  wasmDir: string;
}): Promise<PlayRealmResult> {
  const out = path.join(opts.root, PLAY_DIR);
  const errors: string[] = [];
  await mkdir(out, { recursive: true });

  // 1. Host module — esengine EXTERNAL (resolved by the realm's import map).
  try {
    const res = await build({
      entryPoints: [opts.playHostEntry],
      bundle: true,
      format: 'esm',
      platform: 'browser',
      target: 'es2020',
      external: ['esengine', 'esengine/*'],
      outfile: path.join(out, 'host.js'),
      sourcemap: false,
      write: true,
      logLevel: 'silent',
    });
    errors.push(...res.errors.map((e) => e.text));
  } catch (err) {
    const e = err as { errors?: { text: string }[]; message?: string };
    errors.push(...(e.errors?.map((x) => x.text) ?? [String(e.message ?? err)]));
    return { ok: false, hostPath: '', errors };
  }

  // 2. SDK + wasm copies (hash-gated on a marker file's mtime).
  await syncDir(opts.sdkDistDir, path.join(out, 'sdk'), path.join(opts.sdkDistDir, 'index.js'), path.join(out, '.sdk-stamp'));
  await syncDir(opts.wasmDir, path.join(out, 'wasm'), path.join(opts.wasmDir, 'esengine.js'), path.join(out, '.wasm-stamp'));

  // 3. Host page.
  await writeFile(path.join(out, 'play.html'), PLAY_HTML);

  return { ok: errors.length === 0, hostPath: `${PLAY_DIR}/play.html`, errors };
}
