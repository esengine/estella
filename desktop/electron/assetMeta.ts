// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The ONE `.meta` minter. Every path that turns a plain file into a
 *        registered asset — the import door, the create door, and the scan's
 *        orphan-adoption pass — mints through here, so the uuid/version/type/
 *        importer shape can never diverge between doors.
 *
 *        The ext→type table mirrors the canonical CLI `tools/asset-meta.js`
 *        (meta `type` vocabulary, NOT the SDK's EditorAssetType spellings);
 *        kept in sync by hand — a stable lookup table, and keeping this
 *        desktop-contained avoids reaching into the root tools/.
 */
import { writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { META_EXT } from './contentPolicy';
import { importerDefaults } from '../src/project/assetImporter';

export const META_VERSION = '2.0';

/** Import/adoption ext → `.meta` type (the meta vocabulary the scan reads). */
export const EXT_TO_TYPE: Record<string, string> = {
  '.png': 'texture', '.jpg': 'texture', '.jpeg': 'texture', '.webp': 'texture', '.bmp': 'texture',
  '.ktx2': 'texture',
  '.wav': 'audio', '.mp3': 'audio', '.ogg': 'audio', '.aac': 'audio', '.flac': 'audio', '.m4a': 'audio', '.webm': 'audio',
  '.mp4': 'video', '.m4v': 'video', '.mov': 'video',
  '.esprefab': 'prefab', '.esscene': 'scene', '.esshader': 'shader', '.esmaterial': 'material', '.esmat': 'material',
  '.esanim': 'animclip', '.esanimclip': 'animclip', '.estimeline': 'animation',
  '.estileset': 'tileset', '.esfsm': 'statemachine', '.esbt': 'behaviortree', '.eslocale': 'locale',
  '.fnt': 'bitmapFont', '.bmfont': 'bitmapFont', '.ttf': 'font', '.otf': 'font', '.woff': 'font', '.woff2': 'font',
  '.tmx': 'tilemap', '.tmj': 'tilemap',
  '.skel': 'spine', '.atlas': 'spine',
  '.inputmap': 'inputmap',
};

/** The meta `type` for a file name/path, or null for unknown extensions. */
export function metaTypeFor(file: string): string | null {
  return EXT_TO_TYPE[path.extname(file).toLowerCase()] ?? null;
}

/** A fresh `.meta` document for an asset of `type`. */
export function mintMeta(type: string): Record<string, unknown> {
  return { uuid: randomUUID(), version: META_VERSION, type, importer: importerDefaults(type) };
}

/** Write `<absFile>.meta` for @p absFile. Pass `type` to override the
 *  extension-derived one (the create door knows its type explicitly). */
export async function writeMeta(absFile: string, type: string): Promise<void> {
  await writeFile(absFile + META_EXT, JSON.stringify(mintMeta(type), null, 2) + '\n', 'utf8');
}

/**
 * Adopt an orphan: mint `<absFile>.meta` iff the file has none and its
 * extension names a known asset type. Returns what happened, so callers can
 * count adoptions / skip unknowns without re-deriving the checks.
 */
export async function adoptOrphan(absFile: string): Promise<'adopted' | 'has-meta' | 'unknown-type'> {
  if (existsSync(absFile + META_EXT)) return 'has-meta';
  const type = metaTypeFor(absFile);
  if (!type) return 'unknown-type';
  await writeMeta(absFile, type);
  return 'adopted';
}
