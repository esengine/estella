// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The project's open data context, bundled for the play realm.
 *
 * The same file a mini-game export bundles (`<root>/open-data/index.ts`), built
 * the same way: as one self-contained script with NO `esengine` — that runtime
 * has no engine, and a context that imports one must fail here rather than on a
 * device. The realm evaluates the output against a stand-in host, so what the
 * editor rehearses is the file that ships.
 *
 * Pure Node (esbuild + fs/path), no Electron imports.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { loadEsbuild } from './esbuildRuntime';
import { explainBundleErrors, type BundleMessage } from './bundleDiagnostics';

/** Same directory name the exporter reads, and the same entry candidates. */
const OPEN_DATA_DIR = 'open-data';
const ENTRIES = ['index.ts', 'index.js'];
const CACHE_DIR = '.esengine/cache';
const OUTPUT = 'open-data.js';

export interface BuildOpenDataResult {
  ok: boolean;
  /** Absolute path to the bundle, or null when the project declares no context. */
  outputPath: string | null;
  errors: string[];
  warnings: string[];
}

/**
 * Bundle `<root>/open-data/index.ts` → `<root>/.esengine/cache/open-data.js`.
 *
 * A project with no context directory is `ok` with a null path — most games have
 * none, and that is not a failure. Never throws.
 */
export async function buildOpenDataContext(root: string): Promise<BuildOpenDataResult> {
  const entry = ENTRIES
    .map((f) => path.join(root, OPEN_DATA_DIR, f))
    .find((f) => existsSync(f));
  if (!entry) return { ok: true, outputPath: null, errors: [], warnings: [] };

  const outputPath = path.join(root, CACHE_DIR, OUTPUT);
  try {
    const { build } = await loadEsbuild();
    const result = await build({
      entryPoints: [entry],
      bundle: true,
      // One script that runs on eval, because the realm hands it a host rather
      // than importing it: a module would need an import map the context has no
      // business in.
      format: 'iife',
      platform: 'browser',
      target: 'es2020',
      outfile: outputPath,
      sourcemap: false,
      write: true,
      logLevel: 'silent',
    });
    return {
      ok: true,
      outputPath,
      errors: explainBundleErrors(result.errors),
      warnings: result.warnings.map((w) => w.text),
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
