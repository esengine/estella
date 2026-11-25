// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { resolveInside } from '../fs/pathSandbox';
import { adoptOrphan, metaUuidOf } from './assetMeta';
import { META_EXT } from './contentPolicy';
import { importAseprite, type AsepriteSheetSettings } from './asepriteImport';
import { importPsd } from './psdImport';
import { psdLayerContext, savePsdLayerHistory } from './psdLayerHistory';
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
  const context = await psdLayerContext(location, stem);
  const art = importPsd(await readFile(absSource), stem, destDir ? destDir + '/' : '', context);
  const { absDir, write, release, products } = await sourceProductWriter(location);
  const prefab = stem + '.esprefab';
  const warnings = [...art.warnings];
  if (!art.images.length && !context.previous) return { products, warnings };
  for (const name of context.reassigned) {
    await release(name);
    warnings.push(name + ' now belongs to another asset and was kept separate from this Photoshop import.');
  }
  // Reserve the chosen identities before writing pixels. Retrying an interrupted import must reuse its names.
  const absPrefab = resolveInside(absDir, prefab, 'product directory');
  await location.beforeWrite?.(destDir ? destDir + '/' + prefab : prefab);
  await adoptOrphan(absPrefab);
  await savePsdLayerHistory(absPrefab, art.history);
  const records = new Map(art.history.current.map(row => [row.file, row]));
  for (const image of art.images) {
    await write(image.file, image.bytes, async abs => {
      await adoptOrphan(abs);
      const uuid = await metaUuidOf(abs);
      if (uuid) records.get(image.file)!.fileUuid = uuid;
    });
  }
  await write(prefab, JSON.stringify(art.prefab, null, 2) + '\n', abs => savePsdLayerHistory(abs, art.history));
  const current = new Set(art.images.map(image => image.file));
  for (const row of [...art.history.current, ...art.history.retired]) {
    if (row.file && !current.has(row.file) && await release(row.file)) {
      warnings.push(row.file + ' is no longer drawn by the Photoshop file. Existing texture references keep their last imported image.');
    }
  }
  return { products, warnings };
}
