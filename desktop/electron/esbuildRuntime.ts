// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The single door to esbuild in the main process. esbuild's node lib
 *        snapshots ESBUILD_BINARY_PATH at module load and spawns that binary
 *        as a NATIVE service — child_process does not read through app.asar,
 *        so a packaged app must point it at the app.asar.unpacked twin BEFORE
 *        the library first evaluates. A static `import 'esbuild'` anywhere in
 *        the main bundle evaluates ahead of every module body (ESM semantics),
 *        too early for any env assignment — importing lazily through here
 *        makes the ordering intrinsic instead of an import-order accident,
 *        and keeps the tool out of editor startup.
 *
 *        Pure Node (no Electron imports — the callers are unit-testable):
 *        "packaged" is detected by what actually matters here, whether this
 *        module runs from inside an asar archive.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type Esbuild = typeof import('esbuild');

let loaded: Promise<Esbuild> | null = null;

export function loadEsbuild(): Promise<Esbuild> {
  if (!loaded) {
    // import.meta.url, not __dirname: the main bundle is ESM (no __dirname),
    // and a typeof-guarded __dirname dodges the bundler's ESM rewrite.
    const here = path.dirname(fileURLToPath(import.meta.url));
    if (/app\.asar[\\/]/.test(here) && !process.env.ESBUILD_BINARY_PATH) {
      // Same flat layout electron-builder packs + asarUnpacks (electron-builder.yml).
      const exe =
        process.platform === 'win32'
          ? path.join('@esbuild', `win32-${process.arch}`, 'esbuild.exe')
          : path.join('@esbuild', `${process.platform}-${process.arch}`, 'bin', 'esbuild');
      process.env.ESBUILD_BINARY_PATH = path
        .join(here, '..', 'node_modules', exe)
        .replace(/app\.asar(?=[\\/])/, 'app.asar.unpacked');
    }
    loaded = import('esbuild');
  }
  return loaded;
}
