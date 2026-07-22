// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The ONE `.meta` minter. Every path that turns a plain file into a
 *        registered asset — the import door, the create door, and the scan's
 *        orphan-adoption pass — mints through here, so the uuid/version/type/
 *        importer shape can never diverge between doors.
 *
 *        The ext→type vocabulary is single-sourced in `tools/assetMetaTable.js`,
 *        shared verbatim with the CLI `tools/asset-meta.js`, so the two mint
 *        doors can never disagree on a file's `.meta` type.
 */
import { writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { META_EXT } from './contentPolicy';
import { importerDefaults } from '../src/project/assetImporter';
import { EXT_TO_TYPE, metaTypeForExt } from '../../tools/assetMetaTable.js';

export const META_VERSION = '2.0';

export { EXT_TO_TYPE };

/** The meta `type` for a file name/path, or null for unknown extensions. */
export function metaTypeFor(file: string): string | null {
  return metaTypeForExt(file);
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
