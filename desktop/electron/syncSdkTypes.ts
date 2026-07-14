// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Stage the SDK's type declarations into a project's `.esengine/sdk` so
 *        its tsconfig (`esengine` → ./.esengine/sdk/index.d.ts) resolves in the
 *        IDE the moment the project is opened — before it is ever played. Types
 *        only; the play runtime (js + wasm) is staged separately under
 *        `.esengine/play` by buildPlayRealm.
 *
 *        Same contract as the play staging: STAMPED (re-mirror only when the
 *        editor/SDK changed, not on every open) and LOUD (no reachable SDK dist
 *        is an error the caller must surface — a silently skipped mirror is how
 *        "cannot find module 'esengine'" shipped in v0.22.0 with zero trace).
 */
import { cp, mkdir, readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const STAMP_FILE = '.stamp';

/**
 * Ensure `<root>/.esengine/sdk` mirrors the SDK's `*.d.ts` tree (layout
 * preserved so index.d.ts's chunk imports — shared/, physics/, spine/ —
 * resolve). `candidates` are SDK dist locations in preference order: the
 * packaged app lists the asar-unpacked path first and the in-asar path as the
 * fallback (Node's patched fs reads the archive fine — only NATIVE consumers
 * like esbuild need the unpacked copy). Throws when none exists.
 *
 * Returns whether the mirror was (re)written — a matching stamp skips the walk.
 */
export async function ensureSdkTypes(
  root: string,
  candidates: readonly string[],
  appVersion: string,
): Promise<{ staged: boolean }> {
  const src = candidates.find((c) => existsSync(path.join(c, 'index.d.ts')));
  if (!src) {
    throw new Error(
      `SDK dist not found (looked in: ${candidates.join(' | ')}) — ` +
      `the project's .esengine/sdk types mirror cannot be staged, so the IDE ` +
      `cannot resolve the 'esengine' module.`,
    );
  }

  // Stamp = editor version + the dist's own freshness (its index.d.ts mtime):
  // releases restage on update, dev restages after every SDK rebuild.
  const stamp = `${appVersion}:${(await stat(path.join(src, 'index.d.ts'))).mtimeMs}`;
  const dst = path.join(root, '.esengine', 'sdk');
  const stampPath = path.join(dst, STAMP_FILE);
  const current = await readFile(stampPath, 'utf8').catch(() => null);
  if (current === stamp && existsSync(path.join(dst, 'index.d.ts'))) return { staged: false };

  await copyDeclarations(src, dst);
  await mkdir(dst, { recursive: true }); // a dist with zero .d.ts never creates dst
  await writeFile(stampPath, stamp, 'utf8');
  return { staged: true };
}

async function copyDeclarations(src: string, dst: string): Promise<void> {
  let made = false;
  for (const entry of await readdir(src, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      await copyDeclarations(path.join(src, entry.name), path.join(dst, entry.name));
    } else if (entry.name.endsWith('.d.ts')) {
      if (!made) { await mkdir(dst, { recursive: true }); made = true; }
      await cp(path.join(src, entry.name), path.join(dst, entry.name));
    }
  }
}
