// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Environment import: a panorama source in the project produces the
 *        `.esenv` a light can actually reference.
 *
 * The same shape as the model import — the engine loads no panorama format, so a
 * file that is only copied in leaves the user with something nothing can light
 * with. The convolutions happen here, once, rather than at every load.
 *
 * Several kinds of source, one import: a Radiance `.hdr`, an OpenEXR `.exr`, and a `.escube`
 * that names six images or one low-dynamic-range panorama picture (see `environmentCube`).
 * All are the `panorama` asset type, so they share the import settings
 * (`IMPORTER_SCHEMAS.panorama`), the Re-import door and the products.
 */
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';
import { resolveInside } from '../fs/pathSandbox';
import { sourceProductWriter, type SourceFileLocation } from './sourceProducts';
import type { SourceImportResult } from './sourceImportTypes';
import { adoptOrphan } from './assetMeta';
import {
  importEnvironment, importEnvironmentFromPanorama, ENV_IMAGE_SETTINGS,
  type ImportedEnvironment, type EnvironmentImportOptions,
} from './environmentImport';
import { decodeExr } from './exrDecode';
import { ldrToPanorama, LDR_NOTE } from './ldrPanorama';
import {
  cubeFacesToPanorama, parseCubeSource, CUBE_FACE_NAMES, CUBE_FACE_LABELS, CubeImportError,
  type CubeFace, type CubeFaceSet, type CubeFaceName, type CubeSourceDocument,
} from './environmentCube';

/** An editor host can additionally read other formats its OS supports. */
export type HostImageDecoder = (bytes: Uint8Array) => Promise<{ width: number; height: number; rgba: Uint8Array } | null>;

/**
 * Import `absSource` (already inside the project) into `destDir`, writing the
 * prefiltered atlas and the `.esenv` that names it.
 *
 * A source that cannot be read writes nothing, so the last good products stay as they
 * were: everything is decoded and validated before the first file is touched.
 */
export async function importEnvironmentFile(location: SourceFileLocation, overrides?: EnvironmentImportOptions,
                                            decodeExtra?: HostImageDecoder): Promise<SourceImportResult> {
  const { root, projectRoot = root, absSource } = location;
  const stem = path.basename(absSource).replace(/\.(hdr|exr|escube)$/i, '');
  const options = { ...panoramaOptions(absSource), ...overrides };
  const kind = path.extname(absSource).toLowerCase();
  const result = kind === '.escube' ? await importCube(projectRoot, absSource, stem, options, decodeExtra)
    : kind === '.exr' ? importExr(absSource, stem, options)
      : importEnvironment(new Uint8Array(readFileSync(absSource)), stem, options);
  const { write, products } = await sourceProductWriter(location);
  const imageMeta = (file: string) => adoptOrphan(file, { ...ENV_IMAGE_SETTINGS });
  await write(result.atlasName, result.atlasBytes, imageMeta);
  result.document.specular = result.atlasName;
  if (result.sky) {
    await write(result.sky.name, result.sky.bytes, imageMeta);
    result.document.sky = result.sky.name;
  }
  await write(`${stem}.esenv`, `${JSON.stringify(result.document, null, 2)}\n`);

  return { products, warnings: result.warnings, report: result.report };
}

/** An OpenEXR panorama: read in linear light, warnings and all. */
function importExr(absSource: string, stem: string, options: EnvironmentImportOptions): ImportedEnvironment {
  const { panorama, warnings } = decodeExr(new Uint8Array(readFileSync(absSource)));
  const imported = importEnvironmentFromPanorama(panorama, stem, options);
  imported.warnings.unshift(...warnings);
  return imported;
}

/** Both import hosts decode PNG and JPEG to the same RGBA pixels. */
async function decodeImage(abs: string, file: string, what: string, decodeExtra?: HostImageDecoder): Promise<{ width: number; height: number; rgba: Uint8Array }> {
  const bytes = await readFile(abs).catch(() => { throw new Error(`${what}: ${file} could not be read`); });
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50) {
    try {
      const png = PNG.sync.read(Buffer.from(bytes));
      return { width: png.width, height: png.height, rgba: new Uint8Array(png.data) };
    } catch (e) {
      throw new Error(`${what}: ${file} is not a readable PNG (${(e as Error).message})`);
    }
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    try {
      const image = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true });
      return { width: image.width, height: image.height, rgba: image.data };
    } catch (error) {
      const image = await decodeExtra?.(bytes);
      if (image) return image;
      throw new Error(`${what}: ${file} is not a readable JPEG (${(error as Error).message})`);
    }
  }
  const image = await decodeExtra?.(bytes);
  if (image) return image;
  throw new Error(`${what}: ${file} is not a readable PNG or JPEG`);
}

async function decodeFace(abs: string, file: string, face: CubeFaceName,
                          turn: Pick<CubeFace, 'rotate' | 'flip'>, decodeExtra?: HostImageDecoder): Promise<CubeFace> {
  try {
    return { ...await decodeImage(abs, file, `face ${CUBE_FACE_LABELS[face]}`, decodeExtra), ...turn };
  } catch (e) {
    throw new CubeImportError((e as Error).message, face);
  }
}

/** A `.escube`'s six images, resampled into a panorama and imported as one. */
async function importCube(root: string, absSource: string, stem: string,
                          options: EnvironmentImportOptions, decodeExtra?: HostImageDecoder): Promise<ImportedEnvironment> {
  let source: CubeSourceDocument;
  try {
    source = parseCubeSource(JSON.parse(await readFile(absSource, 'utf8')));
  } catch (e) {
    if (e instanceof CubeImportError) throw e;
    throw new CubeImportError(`${path.basename(absSource)} is not valid JSON (${(e as Error).message})`);
  }
  // One lat-long picture instead of six faces: a low-dynamic-range source, said so.
  if (source.panorama) {
    let image;
    try {
      image = await decodeImage(resolveInside(root, source.panorama.file, 'project root'), source.panorama.file, 'panorama image', decodeExtra);
    } catch (e) {
      throw new CubeImportError((e as Error).message);
    }
    const imported = importEnvironmentFromPanorama(ldrToPanorama(image, source.colorSpace ?? 'srgb'), stem, options);
    imported.warnings.unshift(LDR_NOTE);
    return imported;
  }
  const faces: CubeFaceSet = {};
  for (const name of CUBE_FACE_NAMES) {
    const spec = source.faces[name];
    if (!spec) continue;
    faces[name] = await decodeFace(resolveInside(root, spec.file, 'project root'), spec.file, name,
                                   { rotate: spec.rotate, flip: spec.flip }, decodeExtra);
  }
  return importEnvironmentFromPanorama(cubeFacesToPanorama(faces, source.colorSpace ?? 'srgb'), stem, options);
}

/** The `.meta` settings that decide how finely this source is baked: the fields of
 *  `IMPORTER_SCHEMAS.panorama`, read the same for either kind of source. */
function panoramaOptions(absSource: string): EnvironmentImportOptions {
  try {
    const meta = JSON.parse(readFileSync(`${absSource}.meta`, 'utf8')) as
      { importer?: { faceSize?: unknown; skyWidth?: unknown } };
    const { faceSize, skyWidth } = meta.importer ?? {};
    return {
      ...(typeof faceSize === 'number' && faceSize >= 8 ? { faceSize } : {}),
      ...(typeof skyWidth === 'number' && skyWidth >= 0 ? { skyWidth } : {}),
    };
  } catch {
    return {};
  }
}
