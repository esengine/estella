// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The ONE `.meta` minter. Every path that turns a plain file into a
 *        registered asset — the import door, the create door, and the scan's
 *        orphan-adoption pass — mints through here, so the uuid/version/type/
 *        importer shape can never diverge between doors.
 *
 *        The file→type vocabulary is single-sourced in `tools/assetMetaTable.js`,
 *        shared verbatim with the CLI `tools/asset-meta.js`, so the two mint
 *        doors can never disagree on a file's `.meta` type.
 */
import { writeFile, open } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { META_EXT } from './contentPolicy';
import { importerDefaults } from '../../pipeline/src/project/importSettings';
import {
  EXT_TO_TYPE, metaTypeForExt, metaTypeForContent, needsContentType, CONTENT_SNIFF_BYTES,
} from '../../tools/assetMetaTable.js';

export const META_VERSION = '2.0';

export { EXT_TO_TYPE };

/** The meta `type` a file's NAME declares, or null when the name cannot say. */
export function metaTypeFor(file: string): string | null {
  return metaTypeForExt(file);
}

/** The first @p bytes of a file as text, or '' if it can't be read. */
async function readHead(absFile: string, bytes: number): Promise<string> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(absFile, 'r');
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead).toString('utf8');
  } catch {
    return '';
  } finally {
    await handle?.close();
  }
}

/**
 * The meta `type` for a file ON DISK — the door every minter should use. The
 * name answers for almost everything; for the extensions it cannot type
 * ({@link needsContentType}) the file's own header does. Spine's JSON skeleton
 * is the case: it is a plain `.json`, so a name-only door left it unregistered
 * and its component slot had nothing to offer — which is the whole of "my Spine
 * 2.1 skeleton cannot be assigned".
 */
export async function metaTypeForFile(absFile: string): Promise<string | null> {
  const byName = metaTypeForExt(absFile);
  if (byName || !needsContentType(absFile)) return byName;
  return metaTypeForContent(absFile, await readHead(absFile, CONTENT_SNIFF_BYTES));
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
 * Adopt an orphan: mint `<absFile>.meta` iff the file has none and it resolves
 * to a known asset type. Returns what happened, so callers can count adoptions /
 * skip unknowns without re-deriving the checks.
 */
export async function adoptOrphan(absFile: string): Promise<'adopted' | 'has-meta' | 'unknown-type'> {
  if (existsSync(absFile + META_EXT)) return 'has-meta';
  const type = await metaTypeForFile(absFile);
  if (!type) return 'unknown-type';
  await writeMeta(absFile, type);
  return 'adopted';
}
