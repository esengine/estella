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
import { readFile, writeFile, open } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { META_EXT } from './contentPolicy';
import { importerDefaults } from '../project/importSettings';
import {
  EXT_TO_TYPE, META_VERSION, metaTypeForExt, metaTypeForContent, needsContentType, CONTENT_SNIFF_BYTES, dataImporterForHead,
} from '../../../tools/assetMetaTable.js';

export { EXT_TO_TYPE, META_VERSION };

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

/** A fresh `.meta` document for an asset of `type`. `importer` overrides the
 *  type's defaults — what an importing SOURCE asked for (a glTF sampler's filter
 *  and wrap), which is only ever the initial value; the file owns it after that. */
export function mintMeta(type: string, importer?: Record<string, unknown>): Record<string, unknown> {
  return {
    uuid: randomUUID(), version: META_VERSION, type,
    importer: { ...importerDefaults(type), ...importer },
  };
}

/**
 * What a colour lookup table's image needs, or null for any other image: a strip of N slices of N by N, so N squared wide and N high
 * (1024 by 32 for 32, the size the LUT effects read). It is data and not a picture: compressing it, mipping it or decoding it as
 * sRGB colour changes what it answers, and nothing about the image says so. A stranger's 1024 by 32 sprite strip is the price of knowing.
 */
export async function lutStripImporter(absFile: string): Promise<Record<string, unknown> | null> {
  if (!absFile.toLowerCase().endsWith('.png')) return null;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(absFile, 'r');
    const head = Buffer.alloc(24);
    const { bytesRead } = await handle.read(head, 0, 24, 0);
    // The IHDR chunk: the signature, then the width and the height as big-endian words at 16 and 20.
    if (bytesRead < 24 || head.readUInt32BE(0) !== 0x89504e47) return null;
    const width = head.readUInt32BE(16), height = head.readUInt32BE(20);
    if (![16, 32, 64].includes(height) || width !== height * height) return null;
    return { use: 'data', compress: 'off', mipmaps: false, sRGB: false, filterMode: 'linear', wrapMode: 'clamp', maxSize: width };
  } catch {
    return null;
  } finally {
    await handle?.close();
  }
}

/** What a texture file that is plainly numbers needs (assetMetaTable's `dataImporterForHead`), or null for a picture. */
export async function wideImageImporter(absFile: string): Promise<Record<string, unknown> | null> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(absFile, 'r');
    const head = Buffer.alloc(32);
    const { bytesRead } = await handle.read(head, 0, 32, 0);
    return dataImporterForHead(absFile, head.subarray(0, bytesRead));
  } catch {
    return null;
  } finally {
    await handle?.close();
  }
}

/**
 * Adopt an orphan: mint `<absFile>.meta` iff the file has none and it resolves
 * to a known asset type. Returns what happened, so callers can count adoptions /
 * skip unknowns without re-deriving the checks.
 */
export async function adoptOrphan(absFile: string,
                                  importer?: Record<string, unknown>): Promise<'adopted' | 'has-meta' | 'unknown-type'> {
  if (existsSync(absFile + META_EXT)) return 'has-meta';
  const type = await metaTypeForFile(absFile);
  if (!type) return 'unknown-type';
  // What the file's own shape says comes first, and what an importing source asked for over it.
  if (type === 'texture') importer = { ...(await lutStripImporter(absFile) ?? await wideImageImporter(absFile) ?? {}), ...importer };
  // Exclusive: the file's creator may have written its sidecar since the check, and
  // the uuid it handed out is the one refs point at.
  try {
    await writeFile(absFile + META_EXT, JSON.stringify(mintMeta(type, importer), null, 2) + '\n',
                    { encoding: 'utf8', flag: 'wx' });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return 'has-meta';
    throw err;
  }
  return 'adopted';
}

/** The uuid `<absFile>.meta` holds, or null where it has none (or none that reads). */
export async function metaUuidOf(absFile: string): Promise<string | null> {
  try {
    const meta = JSON.parse(await readFile(absFile + META_EXT, 'utf8')) as { uuid?: unknown };
    return typeof meta.uuid === 'string' ? meta.uuid.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** The source that owns a generated asset, if its sidecar records one. */
export async function importSourceOf(absFile: string): Promise<string | null> {
  try {
    const meta = JSON.parse(await readFile(absFile + META_EXT, 'utf8')) as { source?: unknown };
    return typeof meta.source === 'string' ? meta.source.toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * Says in `<absProduct>.meta` which asset an import made it from: `source`, that asset's uuid, so a model's
 * sub-assets stay under the model. The Content Browser
 * folds a product under its source by it, and a re-import that rewrites the product keeps it. Written only where it
 * changes, so a re-import of an unchanged model touches no `.meta`.
 */
export async function recordImportSource(absProduct: string, sourceUuid: string): Promise<void> {
  let meta: Record<string, unknown>;
  try {
    meta = JSON.parse(await readFile(absProduct + META_EXT, 'utf8')) as Record<string, unknown>;
  } catch {
    return; // no sidecar to say it in (a file of a type the project does not index)
  }
  if (meta.source === sourceUuid) return;
  meta.source = sourceUuid;
  await writeFile(absProduct + META_EXT, JSON.stringify(meta, null, 2) + '\n', 'utf8');
}

/** A product no longer made by its source remains an ordinary asset at the same path and UUID. */
export async function releaseImportSource(absProduct: string, sourceUuid: string, beforeWrite?: () => void | Promise<void>): Promise<boolean> {
  const sidecar = absProduct + META_EXT;
  let meta: Record<string, unknown>;
  try { meta = JSON.parse(await readFile(sidecar, 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
  if (typeof meta.source !== 'string' || meta.source.toLowerCase() !== sourceUuid) return false;
  await beforeWrite?.();
  delete meta.source;
  await writeFile(sidecar, JSON.stringify(meta, null, 2) + '\n', 'utf8');
  return true;
}
