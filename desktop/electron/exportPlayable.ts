// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Playable-ad export (REARCH_EXPORT E3). Produces ONE self-contained
 *        `index.html` (no external requests — ad networks require single-file):
 *          - the SINGLE_FILE engine glue (esengine.single.js, global ESEngineModule
 *            with the wasm embedded as base64) inlined as a <script>;
 *          - assets as base64 data URLs + scenes inlined as <script> globals
 *            (keyed by the scene's @uuid: refs — EmbeddedAssetProvider resolves them);
 *          - the playable host + esengine + project scripts esbuilt to ONE IIFE.
 *        Boots the SAME shipping runtime via initPlayableRuntime (play == ship).
 *
 *        Correct-by-construction against initPlayableRuntime + the SINGLE_FILE glue
 *        contract (no playable simulator here — runtime is validated by the user in
 *        a browser / ad preview). Pure Node (esbuild + fs); IPC wiring in main.ts.
 */
import { build } from 'esbuild';
import { writeFile, mkdir, readFile, stat, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { cookAssets } from './cookAssets';

export interface ExportPlayableResult {
  ok: boolean;
  platform: 'playable';
  outDir: string;
  included: number;
  /** Final index.html size in bytes (for ad-network size limits). */
  bytes: number;
  warnings: string[];
  errors: string[];
}

interface CookManifest {
  entries: { uuid: string; path: string; type: string }[];
}

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
  svg: 'image/svg+xml', ktx2: 'image/ktx2', json: 'application/json', esscene: 'application/json',
  fnt: 'text/plain', txt: 'text/plain', ogg: 'audio/ogg', mp3: 'audio/mpeg', wav: 'audio/wav',
  m4a: 'audio/mp4', aac: 'audio/aac', ttf: 'font/ttf', woff: 'font/woff', woff2: 'font/woff2',
};
const mimeOf = (p: string): string => MIME[path.extname(p).slice(1).toLowerCase()] ?? 'application/octet-stream';

/** Escape `</script` so inlined content can't close the host <script> early. */
const inlineSafe = (s: string): string => s.replace(/<\/script/gi, '<\\/script');

function indexHtml(title: string, glue: string, globals: string, bundle: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no" />
    <title>${title}</title>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: 100%; height: 100%; overflow: hidden; background: #0e121b; }
      #canvas { display: block; width: 100%; height: 100%; touch-action: none; }
    </style>
  </head>
  <body>
    <canvas id="canvas"></canvas>
    <script>${inlineSafe(glue)}</script>
    <script>${inlineSafe(globals)}</script>
    <script>${inlineSafe(bundle)}</script>
  </body>
</html>
`;
}

/**
 * Export the open project as a single-file playable ad. `playableHostEntry` is the
 * host source (src/playableHost.ts); `glueFile` the SINGLE_FILE engine glue
 * (esengine.single.js from `-t playable`).
 */
export async function exportPlayable(opts: {
  root: string;
  entryScene: string;
  scriptsEntry?: string;
  playableHostEntry: string;
  glueFile: string;
  outDir: string;
  title?: string;
  minify?: boolean;
}): Promise<ExportPlayableResult> {
  const title = opts.title ?? 'Game';
  const absOut = path.isAbsolute(opts.outDir) ? opts.outDir : path.join(opts.root, opts.outDir);
  const warnings: string[] = [];
  const errors: string[] = [];
  await mkdir(absOut, { recursive: true });
  const cookDir = path.join(absOut, '.playable-cook');

  // 1. Cook reachable assets to a temp dir (everything ends up inlined → removed after).
  const cook = await cookAssets(opts.root, { entryScenes: [opts.entryScene], outDir: cookDir });
  warnings.push(...cook.warnings);

  // 2. Assets → base64 data URLs, keyed by the scene's @uuid: refs.
  const assets: Record<string, string> = {};
  try {
    const manifest = JSON.parse(await readFile(path.join(cookDir, 'assets.manifest.json'), 'utf8')) as CookManifest;
    for (const e of manifest.entries) {
      const buf = await readFile(path.join(cookDir, e.path));
      assets[`@uuid:${e.uuid}`] = `data:${mimeOf(e.path)};base64,${buf.toString('base64')}`;
    }
  } catch (err) {
    errors.push(`assets: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 3. Scene inlined (keeps @uuid: refs — EmbeddedAssetProvider resolves them).
  const sceneName = path.basename(opts.entryScene).replace(/\.[^.]+$/, '');
  let scenes: Array<{ name: string; data: unknown }> = [];
  try {
    const data = JSON.parse(await readFile(path.join(cookDir, opts.entryScene), 'utf8'));
    scenes = [{ name: sceneName, data }];
  } catch (err) {
    errors.push(`scene: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 4. Host + esengine + project scripts → ONE IIFE (esengine INLINED; no import map).
  const scriptsAbs = opts.scriptsEntry ? path.join(opts.root, opts.scriptsEntry) : null;
  const entrySrc =
    (scriptsAbs && existsSync(scriptsAbs) ? `import ${JSON.stringify(scriptsAbs)};\n` : '') +
    `import ${JSON.stringify(opts.playableHostEntry)};\n`;
  let bundle = '';
  try {
    const res = await build({
      stdin: { contents: entrySrc, resolveDir: opts.root, loader: 'js', sourcefile: 'playable-entry.js' },
      bundle: true,
      format: 'iife',
      platform: 'browser',
      target: 'es2020',
      minify: opts.minify ?? false,
      write: false,
      outfile: 'game-bundle.js',
      logLevel: 'silent',
    });
    errors.push(...res.errors.map((e) => e.text));
    bundle = res.outputFiles?.[0]?.text ?? '';
  } catch (err) {
    const e = err as { errors?: { text: string }[]; message?: string };
    errors.push(...(e.errors?.map((x) => x.text) ?? [String(e.message ?? err)]));
  }

  // 5. The SINGLE_FILE glue (global ESEngineModule, wasm embedded).
  let glue = '';
  if (existsSync(opts.glueFile)) glue = await readFile(opts.glueFile, 'utf8');
  else warnings.push(`single-file engine glue not found: ${opts.glueFile} — run \`node build-tools/cli.js build -t playable\``);

  // 6. Assemble the single HTML, then drop the temp cook dir.
  const globals =
    `window.__GAME_ASSETS__=${JSON.stringify(assets)};` +
    `window.__GAME_SCENES__=${JSON.stringify(scenes)};` +
    `window.__GAME_FIRST__=${JSON.stringify(sceneName)};`;
  const outFile = path.join(absOut, 'index.html');
  await writeFile(outFile, indexHtml(title, glue, globals, bundle));
  await rm(cookDir, { recursive: true, force: true });

  const bytes = (await stat(outFile)).size;
  // Ad networks cap playable size (Facebook ~2MB, Google ~5MB). A full WASM engine
  // + assets typically exceeds this — surface it rather than silently ship a reject.
  if (bytes > 2 * 1024 * 1024) {
    warnings.push(`playable is ~${(bytes / 1024 / 1024).toFixed(1)}MB — likely over ad-network limits (Facebook ~2MB, Google ~5MB).`);
  }

  return { ok: errors.length === 0, platform: 'playable', outDir: absOut, included: cook.included.length, bytes, warnings, errors };
}
