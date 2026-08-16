// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Environment import: a `.hdr` panorama in the project produces the
 *        `.esenv` a light can actually reference.
 *
 * The same shape as the model import — the engine loads no panorama format, so a
 * file that is only copied in leaves the user with something nothing can light
 * with. The convolutions happen here, once, rather than at every load.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveInRoot } from './projectFs';
import { capture } from './fileJournal';
import { adoptOrphan } from '../../pipeline/src/assets/assetMeta';
import { importEnvironment } from '../../pipeline/src/assets/environmentImport';

export interface EnvironmentImportResult {
  /** Project-relative paths of everything written, in the order it was produced. */
  products: string[];
  warnings: string[];
}

export const PANORAMA_EXTENSIONS = ['.hdr'];

export function isPanoramaSource(file: string): boolean {
  return PANORAMA_EXTENSIONS.includes(path.extname(file).toLowerCase());
}

/**
 * Import `absSource` (already inside the project) into `destDir`, writing the
 * prefiltered atlas and the `.esenv` that names it.
 */
export async function importPanorama(root: string, destDir: string,
                                     absSource: string): Promise<EnvironmentImportResult> {
  const absDir = resolveInRoot(root, destDir);
  await mkdir(absDir, { recursive: true });
  const stem = path.basename(absSource).replace(/\.hdr$/i, '');
  const products: string[] = [];

  const write = async (name: string, bytes: Uint8Array | string,
                       settings?: Record<string, unknown>): Promise<string> => {
    const rel = destDir ? `${destDir}/${name}` : name;
    await capture(rel, 'write');
    await writeFile(path.join(absDir, name), bytes);
    // keeps the uuid a re-import must not change
    await adoptOrphan(path.join(absDir, name), settings);
    products.push(rel);
    return rel;
  };

  const result = importEnvironment(new Uint8Array(readFileSync(absSource)), stem,
                                   panoramaOptions(absSource));

  // The atlas is not a picture: its channels are an RGBM encoding of radiance, so
  // sRGB would linearize what is already linear, and a block compressor would
  // quantize the shared multiplier along with the colour it scales.
  result.document.specular = await write(result.atlasName, result.atlasBytes,
                                         { sRGB: false, compress: false, wrapMode: 'clamp' });
  await write(`${stem}.esenv`, `${JSON.stringify(result.document, null, 2)}\n`);

  return { products, warnings: result.warnings };
}

/** The `.meta` settings that decide how finely this panorama is baked. */
function panoramaOptions(absSource: string): { faceSize?: number } {
  try {
    const meta = JSON.parse(readFileSync(`${absSource}.meta`, 'utf8')) as
      { importer?: { faceSize?: unknown } };
    const faceSize = meta.importer?.faceSize;
    return typeof faceSize === 'number' && faceSize >= 8 ? { faceSize } : {};
  } catch {
    return {};
  }
}
