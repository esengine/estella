// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveInside } from '../fs/pathSandbox';
import { adoptOrphan, metaUuidOf } from './assetMeta';
import { importPsd } from './psdImport';
import { psdLayerContext, savePsdLayerHistory } from './psdLayerHistory';
import { sourceProductWriter, type SourceFileLocation } from './sourceProducts';
import type { SourceProducts } from './sourceImportTypes';

export { importAsepriteFile } from './importAsepriteFile';

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
