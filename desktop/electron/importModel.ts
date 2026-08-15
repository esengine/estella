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
import { resolveInRoot } from './projectFs';
import { capture } from './fileJournal';
import { adoptOrphan } from '../../pipeline/src/assets/assetMeta';
import {
  importGltfMeshes, encodeImportedMesh, assembleGltfPrefab,
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

  const { meshes, textures, nodes, warnings } = importGltfMeshes(
    new Uint8Array(readFileSync(absSource)), stem,
    (uri) => {
      const abs = path.join(sourceDir, decodeURIComponent(uri));
      return existsSync(abs) ? new Uint8Array(readFileSync(abs)) : null;
    },
  );

  const products: string[] = [];
  const write = async (name: string, bytes: Uint8Array | string): Promise<string> => {
    const rel = destDir ? `${destDir}/${name}` : name;
    await capture(rel, 'write');
    await writeFile(path.join(absDir, name), bytes);
    await adoptOrphan(path.join(absDir, name));  // keeps the uuid a re-import must not change
    products.push(rel);
    return rel;
  };

  // An image the source points at is left where it lies when that is already in
  // the project; one from outside is copied in, named for the model so a second
  // import of a different model cannot land on it.
  const externalRefs = new Map<string, string>();
  const external = (uri: string): string => externalRefs.get(uri) ?? uri;
  for (const mesh of meshes) {
    const image = mesh.material?.baseColorTexture;
    if (!image?.external || externalRefs.has(image.file)) continue;
    const abs = path.join(sourceDir, decodeURIComponent(image.file));
    if (!existsSync(abs)) continue;
    if (isInsideRoot(root, abs)) {
      externalRefs.set(image.file, projectRef(abs));
      continue;
    }
    const name = `${stem}_${path.basename(abs)}`;
    const rel = destDir ? `${destDir}/${name}` : name;
    await capture(rel, 'write');
    await copyFile(abs, path.join(absDir, name));
    await adoptOrphan(path.join(absDir, name));
    products.push(rel);
    externalRefs.set(image.file, rel);
  }

  for (const mesh of meshes) await write(`${mesh.name}.esmesh`, encodeImportedMesh(mesh));
  for (const texture of textures) await write(texture.name, texture.bytes);
  if (meshes.length > 0) {
    const prefab = assembleGltfPrefab(stem, meshes, {
      refs: { prefix: destDir ? `${destDir}/` : '', external },
      nodes,
    });
    await write(`${stem}.esprefab`, `${JSON.stringify(prefab, null, 2)}\n`);
  }
  return { products, warnings };
}
