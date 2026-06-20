/**
 * @file  Project-script bundler (REARCH_EDITOR_REALM.md Phase P1 / RC12 §E8-1).
 *
 * Bundles a project's `src/main.ts` into a single ESM with `esengine` left
 * EXTERNAL, written to `.esengine/cache/`. The bundle's bare `import ... from
 * "esengine"` is resolved by an import map in the isolated play realm to that
 * realm's own SDK instance — so the engine is never duplicated into each project
 * bundle, and the realm runs the project's real (shipped) code (play==ship).
 *
 * Pure Node (esbuild + fs/path), no Electron imports, so it is unit-testable and
 * reusable; the IPC wiring lives in main.ts.
 */
import { build, type BuildResult } from 'esbuild';
import { existsSync } from 'node:fs';
import path from 'node:path';

/** esengine and any subpath import are left for the realm's import map to resolve. */
const EXTERNAL = ['esengine', 'esengine/*'];
const DEFAULT_SRC_DIR = 'src';
const DEFAULT_ENTRY = 'main.ts';
/** Local, gitignored build cache inside the project (next to workspace.json). */
const CACHE_DIR = '.esengine/cache';
const OUTPUT = 'scripts.mjs';

export interface BuildScriptsResult {
  ok: boolean;
  /** Absolute path to the bundled ESM, or null if the build failed. */
  outputPath: string | null;
  errors: string[];
  warnings: string[];
}

/**
 * Bundle `<root>/<srcDir>/<entry>` → `<root>/.esengine/cache/scripts.mjs`,
 * esengine external. Never throws — failures come back as `{ ok:false, errors }`.
 */
export async function buildProjectScripts(
  root: string,
  opts?: { srcDir?: string; entry?: string },
): Promise<BuildScriptsResult> {
  const entryPath = path.join(root, opts?.srcDir ?? DEFAULT_SRC_DIR, opts?.entry ?? DEFAULT_ENTRY);
  if (!existsSync(entryPath)) {
    return { ok: false, outputPath: null, errors: [`script entry not found: ${entryPath}`], warnings: [] };
  }
  const outputPath = path.join(root, CACHE_DIR, OUTPUT);
  try {
    const result: BuildResult = await build({
      entryPoints: [entryPath],
      bundle: true,
      format: 'esm',
      platform: 'browser',
      target: 'es2020',
      external: EXTERNAL,
      outfile: outputPath,
      sourcemap: true,
      write: true,
      logLevel: 'silent',
    });
    return {
      ok: true,
      outputPath,
      errors: result.errors.map((e) => e.text),
      warnings: result.warnings.map((w) => w.text),
    };
  } catch (err) {
    const e = err as { errors?: { text: string }[]; warnings?: { text: string }[]; message?: string };
    return {
      ok: false,
      outputPath: null,
      errors: e.errors?.map((x) => x.text) ?? [String(e.message ?? err)],
      warnings: e.warnings?.map((x) => x.text) ?? [],
    };
  }
}
