// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Asset import (Content Browser C4). Brings files into the project's
 *        asset registry: external files are copied into the project + given a
 *        `.meta` sidecar; files ALREADY inside the project are registered in
 *        place (meta minted iff missing) — never duplicated. The scan only
 *        sees files that HAVE a `.meta`, so this is the registration door.
 */
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { resolveInRoot, META_EXT } from './projectFs';
import { EXT_TO_TYPE, metaTypeFor, mintMeta, writeMeta, adoptOrphan } from './assetMeta';

/** The supported import extensions (no leading dot) — used by the file dialog filter. */
export const IMPORT_EXTENSIONS = Object.keys(EXT_TO_TYPE).map((e) => e.slice(1));

/** A unique destination name in `absDir`: "hero.png" → "hero 2.png" if taken. */
function uniqueName(absDir: string, name: string): string {
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let candidate = name;
  for (let i = 2; existsSync(path.join(absDir, candidate)); i++) candidate = `${stem} ${i}${ext}`;
  return candidate;
}

/** The project-relative (forward-slashed) path of `abs` under `root`, or null
 *  when `abs` lives outside the project. */
function relInRoot(root: string, abs: string): string | null {
  const rel = path.relative(path.resolve(root), path.resolve(abs));
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel.replace(/\\/g, '/');
}

/**
 * Create a new asset file in `destDir` with `content` + a fresh `.meta` (uuid + the
 * given type), deduping the name so it never clobbers. Returns the new project-
 * relative path. Powers the Content Browser "New …" menu (e.g. New Scene).
 */
export async function createAsset(
  root: string,
  destDir: string,
  baseName: string,
  content: string,
  type: string,
): Promise<string> {
  const absDir = resolveInRoot(root, destDir);
  await mkdir(absDir, { recursive: true });
  const name = uniqueName(absDir, baseName);
  const abs = path.join(absDir, name);
  await writeFile(abs, content, 'utf8');
  await writeFile(abs + META_EXT, JSON.stringify(mintMeta(type), null, 2) + '\n', 'utf8');
  return destDir ? `${destDir}/${name}` : name;
}

export interface ImportResult {
  /** Project-relative paths of the imported (or adopted-in-place) files. */
  imported: string[];
  /** Base names skipped (unknown / unsupported extension). */
  skipped: string[];
}

/**
 * Bring `sources` (absolute paths) into the registry:
 *   - external files are copied into project-relative `destDir` + given a `.meta`
 *     (existing names deduped, never clobbered);
 *   - files already inside the project are REGISTERED IN PLACE (meta minted iff
 *     missing, existing uuid preserved) — importing a project file must never
 *     spawn a "name 2" copy with a different identity.
 * Unknown extensions are skipped.
 */
export async function importAssets(root: string, destDir: string, sources: string[]): Promise<ImportResult> {
  const absDir = resolveInRoot(root, destDir);
  await mkdir(absDir, { recursive: true });
  const imported: string[] = [];
  const skipped: string[] = [];
  for (const src of sources) {
    const type = metaTypeFor(src);
    if (!type) {
      skipped.push(path.basename(src));
      continue;
    }
    const inside = relInRoot(root, src);
    if (inside) {
      await adoptOrphan(path.resolve(root, inside)); // 'has-meta' = already registered, keep its uuid
      imported.push(inside);
      continue;
    }
    const name = uniqueName(absDir, path.basename(src));
    const absDest = path.join(absDir, name);
    await copyFile(src, absDest);
    await writeMeta(absDest, type);
    imported.push(destDir ? `${destDir}/${name}` : name);
  }
  return { imported, skipped };
}
