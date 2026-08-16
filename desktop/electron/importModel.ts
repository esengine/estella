// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Model import: a `.gltf`/`.glb` in the project produces the assets a
 *        scene can actually reference.
 *
 * The engine loads none of the source formats — a Mesh2D reads `.esmesh` — so a
 * model that is only copied in leaves the user with a file nothing can draw.
 * This is the same import the CLI runs, at the moment the file arrives.
 */
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { isInsideRoot } from '../../pipeline/src/fs/pathSandbox';
import { resolveInRoot, META_EXT } from './projectFs';
import { capture } from './fileJournal';
import { adoptOrphan } from '../../pipeline/src/assets/assetMeta';
import {
  importGltfMeshes, encodeImportedMesh, assembleGltfPrefab, materialProducts,
} from '../../pipeline/src/assets/gltfImport';

export interface ModelImportResult {
  /** Project-relative paths of everything written, in the order it was produced. */
  products: string[];
  /** What the source says that this engine cannot draw — reported, never dropped. */
  warnings: string[];
}

export const MODEL_EXTENSIONS = ['.gltf', '.glb'];

export function isModelSource(file: string): boolean {
  return MODEL_EXTENSIONS.includes(path.extname(file).toLowerCase());
}

/**
 * Import `absSource` (already inside the project) into `destDir`, writing the
 * meshes, the images it carries, and the prefab that assembles them.
 *
 * @param originDir Where the source's own relative uris resolve from. A copied
 *        model no longer sits beside its images, and reading them from where it
 *        landed finds nothing.
 */
export async function importModel(root: string, destDir: string, absSource: string,
                                  originDir?: string): Promise<ModelImportResult> {
  const absDir = resolveInRoot(root, destDir);
  await mkdir(absDir, { recursive: true });
  const sourceDir = originDir ?? path.dirname(absSource);
  const stem = path.basename(absSource).replace(/\.(gltf|glb)$/i, '');
  const projectRef = (abs: string): string =>
    path.relative(path.resolve(root), abs).split(path.sep).join('/');

  const { meshes, textures, nodes, animations, externalFiles, warnings } = await importGltfMeshes(
    new Uint8Array(readFileSync(absSource)), stem,
    (uri) => {
      const abs = path.join(sourceDir, decodeURIComponent(uri));
      return existsSync(abs) ? new Uint8Array(readFileSync(abs)) : null;
    },
  );

  // The source's own `.meta` says how big the model should arrive; re-importing
  // is how an edited setting reaches the products.
  const scale = modelScale(absSource);

  // What each image's sampler asked for, by product name — applied when its
  // `.meta` is first minted and never after: the file's settings are the user's.
  const imageSettings = new Map<string, Record<string, unknown>>();
  for (const mesh of meshes) {
    for (const image of [mesh.material?.baseColorTexture, mesh.material?.normalTexture,
                         mesh.material?.emissiveTexture, mesh.material?.occlusionTexture]) {
      if (image?.settings) imageSettings.set(image.file, { ...image.settings });
    }
  }

  const products: string[] = [];
  const write = async (name: string, bytes: Uint8Array | string): Promise<string> => {
    const rel = destDir ? `${destDir}/${name}` : name;
    await capture(rel, 'write');
    await writeFile(path.join(absDir, name), bytes);
    // keeps the uuid a re-import must not change
    await adoptOrphan(path.join(absDir, name), imageSettings.get(name));
    products.push(rel);
    return rel;
  };

  // A file already in the project is left where it lies; one from outside comes
  // WITH the model, at the same relative path. That is what keeps the copied
  // .gltf pointing at its own .bin, so re-importing it still works.
  const externalRefs = new Map<string, string>();
  const external = (uri: string): string => externalRefs.get(uri) ?? uri;
  for (const uri of externalFiles) {
    const abs = path.join(sourceDir, uri);
    if (!existsSync(abs)) continue;
    if (isInsideRoot(root, abs)) {
      externalRefs.set(uri, projectRef(abs));
      continue;
    }
    // A uri that reaches outside the model's own folder cannot keep its shape in
    // the project: it lands beside the model, and the source's link to it stays
    // broken — said out loud rather than silently rewritten.
    const keepsShape = isInsideRoot(absDir, path.resolve(absDir, uri));
    if (!keepsShape) {
      warnings.push(`${uri} came from outside the model's folder; the copy is beside it`);
    }
    const name = keepsShape ? uri : path.basename(uri);
    const rel = destDir ? `${destDir}/${name}` : name;
    const absDest = path.join(absDir, name);
    await capture(rel, 'write');
    await mkdir(path.dirname(absDest), { recursive: true });
    await copyFile(abs, absDest);
    await adoptOrphan(absDest, imageSettings.get(uri));
    products.push(rel);
    externalRefs.set(uri, rel);
  }

  for (const mesh of meshes) await write(`${mesh.name}.esmesh`, encodeImportedMesh(mesh));
  for (const texture of textures) await write(texture.name, texture.bytes);
  const refs = { prefix: destDir ? `${destDir}/` : '', external };
  for (const material of materialProducts(meshes, stem, refs)) {
    await write(`${material.name}.esmaterial`, `${JSON.stringify(material.data, null, 2)}\n`);
  }
  let firstClip: string | undefined;
  for (const animation of animations) {
    const rel = await write(`${animation.name}.estimeline`,
                            `${JSON.stringify(animation.document, null, 2)}\n`);
    firstClip ??= rel;
  }
  if (meshes.length > 0) {
    const prefab = assembleGltfPrefab(stem, meshes, { refs, nodes, scale, timeline: firstClip });
    await write(`${stem}.esprefab`, `${JSON.stringify(prefab, null, 2)}\n`);
    // A glTF is in metres and a world unit is a design pixel, so a real-world
    // model arrives a few pixels across. Said, not guessed at: the scale is the
    // user's, and this is where they find out they have one.
    const extent = Math.max(...meshes.flatMap(
      (m) => m.data.aabbMax.map((v, i) => v - (m.data.aabbMin[i] ?? 0))));
    if (scale === 1 && extent < 8) {
      warnings.push(`the model is ${extent.toFixed(2)} units across — set Scale in its import`
        + ' settings and reimport if it should be bigger');
    }
  }
  return { products, warnings };
}

/** The `scale` its `.meta` asks for; 1 when there is none, or it is unusable. */
function modelScale(absSource: string): number {
  try {
    const meta = JSON.parse(readFileSync(`${absSource}${META_EXT}`, 'utf8')) as
      { importer?: { scale?: unknown } };
    const scale = meta.importer?.scale;
    return typeof scale === 'number' && scale > 0 ? scale : 1;
  } catch {
    return 1;
  }
}
