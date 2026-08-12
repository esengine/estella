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
import { isInsideRoot } from './pathSandbox';
import { resolveInRoot, META_EXT } from './projectFs';
import { capture } from './fileJournal';
import { EXT_TO_TYPE, metaTypeFor, metaTypeForFile, mintMeta, writeMeta, adoptOrphan } from './assetMeta';
import { CONTENT_TYPED_EXTENSIONS } from '../../tools/assetMetaTable.js';

/** The supported import extensions (no leading dot) — used by the file dialog filter.
 *  The content-typed ones are offered too: a Spine JSON skeleton is a `.json`, and a
 *  dialog that hides it leaves the user no way to bring one in. Whether such a file
 *  really is an asset is settled by reading it (metaTypeForFile), not by the filter. */
export const IMPORT_EXTENSIONS = [
  ...new Set([...Object.keys(EXT_TO_TYPE), ...CONTENT_TYPED_EXTENSIONS]),
].map((e) => e.slice(1));

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
  if (!isInsideRoot(root, abs)) return null;
  const rel = path.relative(path.resolve(root), path.resolve(abs));
  return rel ? rel.replace(/\\/g, '/') : null;
}

/** Canonical creation extension per meta type — the inverse of {@link EXT_TO_TYPE},
 *  with the JSON spelling preferred where several extensions share a type. */
const TYPE_TO_EXT: Record<string, string> = (() => {
  const inv: Record<string, string> = {};
  for (const [ext, type] of Object.entries(EXT_TO_TYPE)) if (!(type in inv)) inv[type] = ext;
  return { ...inv, tilemap: '.tmj', bitmapFont: '.bmfont' };
})();

/**
 * Create a new asset file in `destDir` with `content` + a fresh `.meta` (uuid + the
 * given type), deduping the name so it never clobbers. Returns the new project-
 * relative path. Powers the Content Browser "New …" menu (e.g. New Scene) and the
 * MCP create_asset door. A bare stem gets the type's canonical extension — an
 * extensionless file would still register (the meta carries the type) but breaks
 * every consumer that types by extension; a type/extension mismatch is incoherent
 * on disk, so both are loud errors rather than silent writes.
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
  let named = baseName;
  if (!path.extname(named)) {
    const ext = TYPE_TO_EXT[type];
    if (!ext) {
      throw new Error(
        `unknown asset type "${type}" — pass a baseName with an extension, or one of: ${Object.keys(TYPE_TO_EXT).join(', ')}`,
      );
    }
    named += ext;
  } else {
    const extType = metaTypeFor(named);
    if (extType && extType !== type) {
      throw new Error(`type "${type}" does not match extension "${path.extname(named)}" (which is "${extType}")`);
    }
  }
  const name = uniqueName(absDir, named);
  const abs = path.join(absDir, name);
  const rel = destDir ? `${destDir}/${name}` : name;
  await capture(rel, 'write');
  await writeFile(abs, content, 'utf8');
  await writeFile(abs + META_EXT, JSON.stringify(mintMeta(type), null, 2) + '\n', 'utf8');
  return rel;
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
    const type = await metaTypeForFile(src);
    if (!type) {
      skipped.push(path.basename(src));
      continue;
    }
    const inside = relInRoot(root, src);
    if (inside) {
      // Registering in place only mints a sidecar; the file itself is untouched.
      // Captured anyway, so a revert takes the `.meta` — and with it the
      // registry entry — back off a file the user had not adopted.
      await capture(inside, 'write');
      await adoptOrphan(path.resolve(root, inside)); // 'has-meta' = already registered, keep its uuid
      imported.push(inside);
      continue;
    }
    const name = uniqueName(absDir, path.basename(src));
    const absDest = path.join(absDir, name);
    const rel = destDir ? `${destDir}/${name}` : name;
    await capture(rel, 'write');
    await copyFile(src, absDest);
    await writeMeta(absDest, type);
    imported.push(rel);
  }
  return { imported, skipped };
}
