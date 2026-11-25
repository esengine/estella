// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { adoptOrphan } from './assetMeta';
import { META_EXT } from './contentPolicy';
import { importAseprite, type AsepriteSheetSettings } from './asepriteImport';
import { importPsd } from './psdImport';
import { sourceProductWriter, type SourceFileLocation } from './sourceProducts';
import type { SourceProducts } from './sourceImportTypes';

/** The source owns the grid. Keep user-edited sampler settings and the sheet's UUID. */
async function settleSheet(abs: string, settings: AsepriteSheetSettings): Promise<void> {
  if (await adoptOrphan(abs, { ...settings }) === 'adopted') return;
  const file = abs + META_EXT;
  const meta = JSON.parse(await readFile(file, 'utf8'));
  if (isDeepStrictEqual(meta.importer?.sheet, settings.sheet)) return;
  meta.importer = { ...meta.importer, sheet: { ...settings.sheet } };
  await writeFile(file, JSON.stringify(meta, null, 2) + '\n', 'utf8');
}

export async function importAsepriteFile(location: SourceFileLocation): Promise<SourceProducts> {
  const { absSource, destDir } = location;
  const stem = path.basename(absSource, path.extname(absSource));
  const art = importAseprite(await readFile(absSource), stem, destDir ? destDir + '/' : '');
  const { write, products } = await sourceProductWriter(location);
  await write(art.sheet.file, art.sheet.bytes, abs => settleSheet(abs, art.settings));
  for (const clip of art.clips) await write(clip.file, JSON.stringify(clip.data, null, 2) + '\n');
  return { products, warnings: art.warnings };
}

export async function importPsdFile(location: SourceFileLocation): Promise<SourceProducts> {
  const { absSource, destDir } = location;
  const stem = path.basename(absSource, path.extname(absSource));
  const art = importPsd(await readFile(absSource), stem, destDir ? destDir + '/' : '');
  const { write, products } = await sourceProductWriter(location);
  for (const image of art.images) await write(image.file, image.bytes);
  if (art.images.length) await write(stem + '.esprefab', JSON.stringify(art.prefab, null, 2) + '\n');
  return { products, warnings: art.warnings };
}
