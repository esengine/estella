// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Project-script bundler.
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
import type { BuildResult } from 'esbuild';
import { existsSync } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadEsbuild } from './esbuildRuntime';
import { explainBundleErrors, type BundleMessage } from './bundleDiagnostics';
import { officialPackagesPlugin } from './officialPackages';
import { COCOS_COMPAT_VERSION, cocosCompatPlugin } from './cocosCompat';

/** esengine and any subpath import are left for the realm's import map to resolve. */
const EXTERNAL = ['esengine', 'esengine/*'];
/** Default startup entry (project-relative). */
const DEFAULT_ENTRY = 'src/main.ts';
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

/** Bumped when what a build does changes in a way the stamp cannot see, so an older bundle is rebuilt. */
const STAMP_VERSION = 1;
const STAMP = 'scripts.stamp.json';

/** What a bundle was built from: enough to know, without building, whether building again would give the same bytes. */
interface BuildStamp {
  version: number;
  compat: number;
  esbuild: string;
  entry: string;
  packagesDir: string;
  /** Every file the bundle read, with its size and modification time. */
  inputs: Record<string, [number, number]>;
  warnings: string[];
}

/** The file an esbuild metafile input names, or null for one a plugin made up (a namespace, not a path). */
function inputFile(key: string): string | null {
  if (/^[A-Za-z]:[\\/]/.test(key)) return key;
  if (key.includes(':')) return null;
  return path.resolve(key);
}

async function signature(file: string): Promise<[number, number] | null> {
  try {
    const s = await stat(file);
    return [s.size, Math.round(s.mtimeMs)];
  } catch {
    return null;
  }
}

/** The stamp when the bundle on disk is still what building now would write; null when it must be built. */
async function currentStamp(stampPath: string, outputPath: string, want: Omit<BuildStamp, 'inputs' | 'warnings'>): Promise<BuildStamp | null> {
  if (!existsSync(outputPath)) return null;
  let stamp: BuildStamp;
  try {
    stamp = JSON.parse(await readFile(stampPath, 'utf8')) as BuildStamp;
  } catch {
    return null;
  }
  if (stamp.version !== want.version || stamp.compat !== want.compat || stamp.esbuild !== want.esbuild
    || stamp.entry !== want.entry || stamp.packagesDir !== want.packagesDir) return null;
  const files = Object.entries(stamp.inputs);
  // in slices, so a project of thousands of scripts does not open thousands of files at once
  for (let i = 0; i < files.length; i += 256) {
    const now = await Promise.all(files.slice(i, i + 256).map(([file]) => signature(file)));
    for (const [j, sig] of now.entries()) {
      const was = files[i + j]![1];
      if (!sig || sig[0] !== was[0] || sig[1] !== was[1]) return null;
    }
  }
  return stamp;
}

/**
 * Bundle `<root>/<entry>` (project-relative, default `src/main.ts`) →
 * `<root>/.esengine/cache/scripts.mjs`, esengine external. Never throws —
 * failures come back as `{ ok:false, errors }`.
 *
 * A bundle of a project of thousands of scripts takes seconds, and the editor asks for one at every Play. It is built again only when a file
 * it read has changed (or how it is built has): the files are stamped beside it, and checking them costs a stat each.
 */
export async function buildProjectScripts(
  root: string,
  opts: { entry?: string; packagesDir: string },
): Promise<BuildScriptsResult> {
  const entryPath = path.join(root, opts.entry ?? DEFAULT_ENTRY);
  if (!existsSync(entryPath)) {
    return { ok: false, outputPath: null, errors: [`script entry not found: ${entryPath}`], warnings: [] };
  }
  const outputPath = path.join(root, CACHE_DIR, OUTPUT);
  const stampPath = path.join(root, CACHE_DIR, STAMP);
  try {
    const esbuild = await loadEsbuild();
    const want = { version: STAMP_VERSION, compat: COCOS_COMPAT_VERSION, esbuild: esbuild.version, entry: entryPath, packagesDir: opts.packagesDir };
    const fresh = await currentStamp(stampPath, outputPath, want);
    if (fresh) return { ok: true, outputPath, errors: [], warnings: fresh.warnings };

    const result: BuildResult = await esbuild.build({
      entryPoints: [entryPath],
      bundle: true,
      format: 'esm',
      platform: 'browser',
      target: 'es2020',
      external: EXTERNAL,
      plugins: [officialPackagesPlugin(opts.packagesDir), cocosCompatPlugin()],
      outfile: outputPath,
      sourcemap: true,
      write: true,
      metafile: true,
      logLevel: 'silent',
    });
    const warnings = result.warnings.map((w) => w.text);
    // What it read, plus what esbuild reads without reporting: the project's tsconfig and package.json decide how a file is compiled.
    const files = new Set<string>([path.join(root, 'tsconfig.json'), path.join(root, 'package.json')]);
    for (const key of Object.keys(result.metafile?.inputs ?? {})) {
      const file = inputFile(key);
      if (file) files.add(file);
    }
    const inputs: Record<string, [number, number]> = {};
    for (const file of files) {
      const sig = await signature(file);
      if (sig) inputs[file] = sig;
    }
    await writeFile(stampPath, JSON.stringify({ ...want, inputs, warnings } satisfies BuildStamp));
    return {
      ok: true,
      outputPath,
      errors: explainBundleErrors(result.errors),
      warnings,
    };
  } catch (err) {
    const e = err as { errors?: BundleMessage[]; warnings?: { text: string }[]; message?: string };
    return {
      ok: false,
      outputPath: null,
      errors: e.errors ? explainBundleErrors(e.errors) : [String(e.message ?? err)],
      warnings: e.warnings?.map((x) => x.text) ?? [],
    };
  }
}
