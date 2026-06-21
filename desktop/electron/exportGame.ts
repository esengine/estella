/**
 * @file  Game export (REARCH_EDITOR_REALM Phase S — play == ship). Produces a
 *        self-contained, static-servable web build of the open project:
 *          - cookAssets → reachable assets (paths preserved) + assets.manifest.json
 *          - esbuild the game host (gameHost.ts, esengine INLINED) → game.js
 *          - copy the /wasm runtime
 *          - emit index.html + game.config.json (the entry scene)
 *        The host boots the SAME runtime the editor's play realm uses
 *        (initPlayRealmRuntime), so the shipped game is what was played.
 *
 *        Pure Node (esbuild + fs) — IPC wiring is in main.ts.
 */
import { build } from 'esbuild';
import { writeFile, mkdir, cp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { cookAssets } from './cookAssets';

export interface ExportGameResult {
  ok: boolean;
  outDir: string;
  /** Count of assets included (reachable from the entry scene). */
  included: number;
  warnings: string[];
  errors: string[];
}

function indexHtml(title: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' data: blob:; worker-src 'self' blob:;"
    />
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
    <script type="module" src="./game.js"></script>
  </body>
</html>
`;
}

/**
 * Export the open project to a runnable web build in `outDir`. `entryScene` is
 * the project-relative scene to boot; `gameHostEntry` the gameHost.ts source;
 * `wasmDir` the engine runtime to copy.
 */
export async function exportGame(opts: {
  root: string;
  entryScene: string;
  gameHostEntry: string;
  wasmDir: string;
  outDir: string;
  title?: string;
}): Promise<ExportGameResult> {
  const absOut = path.isAbsolute(opts.outDir) ? opts.outDir : path.join(opts.root, opts.outDir);
  const warnings: string[] = [];
  const errors: string[] = [];
  await mkdir(absOut, { recursive: true });

  // 1. Cook reachable assets + manifest (the entry scene file is staged too).
  const cook = await cookAssets(opts.root, { entryScenes: [opts.entryScene], outDir: absOut });
  warnings.push(...cook.warnings);

  // 2. Bundle the game host (esengine inlined → self-contained game.js).
  try {
    const res = await build({
      entryPoints: [opts.gameHostEntry],
      bundle: true,
      format: 'esm',
      platform: 'browser',
      target: 'es2020',
      outfile: path.join(absOut, 'game.js'),
      sourcemap: false,
      write: true,
      logLevel: 'silent',
    });
    errors.push(...res.errors.map((e) => e.text));
    warnings.push(...res.warnings.map((w) => w.text));
  } catch (err) {
    const e = err as { errors?: { text: string }[]; message?: string };
    errors.push(...(e.errors?.map((x) => x.text) ?? [String(e.message ?? err)]));
    return { ok: false, outDir: absOut, included: cook.included.length, warnings, errors };
  }

  // 3. Copy the wasm runtime (glue + binary + side modules).
  if (existsSync(opts.wasmDir)) {
    await cp(opts.wasmDir, path.join(absOut, 'wasm'), { recursive: true });
  } else {
    warnings.push(`wasm runtime dir not found: ${opts.wasmDir}`);
  }

  // 4. Host page + entry-scene config.
  await writeFile(path.join(absOut, 'index.html'), indexHtml(opts.title ?? 'Game'));
  await writeFile(
    path.join(absOut, 'game.config.json'),
    JSON.stringify({ entryScene: opts.entryScene }, null, 2) + '\n',
  );

  return { ok: errors.length === 0, outDir: absOut, included: cook.included.length, warnings, errors };
}
