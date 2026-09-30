// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    textureUsage.ts
 * @brief   Which of a project's textures a mesh draws — what a texture's Auto
 *          compression resolves by.
 *
 * @details A texture on a mesh is sampled in full wherever the mesh is seen, and
 *          its decoded size is its cost in video memory; a sprite or UI image is
 *          usually flat art whose PNG is a fraction of a KTX2. So Auto compresses
 *          the first and ships the second as its file.
 *
 *          The whole project is read, not what one build reaches: the editor and
 *          every build resolve Auto the same way, so what the editor shows is what
 *          ships whichever scenes a build starts from.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { AssetEntry } from './assetDb';
import { isBuiltinAssetRef, resolveDocumentRef } from '../../../sdk/src/asset/documentRef';

const UUID_PREFIX = '@uuid:';

/** How a mesh draws a texture: on its surface, or as the baked light the surface reads. */
export type MeshTextureRole = 'surface' | 'lightmap';

/** Component fields whose texture a mesh draws, by the role it plays there. */
const MESH_TEXTURE_FIELDS: Readonly<Record<string, Readonly<Record<string, MeshTextureRole>>>> = {
  MeshRenderer: { texture: 'surface', normalMap: 'surface' },
  MeshLightmap: { lightmap: 'lightmap' },
};
const MESH_MATERIAL_FIELDS: Readonly<Record<string, readonly string[]>> = {
  MeshRenderer: ['material'],
};

interface Documented {
  entities?: Array<{ components?: Array<{ type?: string; data?: Record<string, unknown> }> }>;
}

/** Every string anywhere under @p value. */
function strings(value: unknown, into: string[]): void {
  if (typeof value === 'string') into.push(value);
  else if (Array.isArray(value)) for (const v of value) strings(v, into);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) strings(v, into);
}

/**
 * The uuids of the textures a mesh in @p entries' scenes and prefabs draws, directly
 * or through its material. @p read supplies a document's text (the project file
 * by default).
 */
export async function texturesDrawnIn3D(
  root: string,
  entries: readonly AssetEntry[],
  read?: (file: string) => Promise<string>,
): Promise<Set<string>> {
  return new Set((await meshTextureRoles(root, entries, read)).keys());
}

/** {@link texturesDrawnIn3D}, with the roles each texture plays: a material's are its surface. */
export async function meshTextureRoles(
  root: string,
  entries: readonly AssetEntry[],
  read: (file: string) => Promise<string> = (file) => readFile(path.join(root, file), 'utf8'),
): Promise<Map<string, Set<MeshTextureRole>>> {
  const byUuid = new Map(entries.map((e) => [e.uuid, e]));
  const byPath = new Map(entries.map((e) => [e.path, e]));
  const resolve = (ref: string, docPath: string): AssetEntry | undefined => {
    if (ref.startsWith(UUID_PREFIX)) return byUuid.get(ref.slice(UUID_PREFIX.length));
    if (ref === '' || isBuiltinAssetRef(ref) || ref.includes('://')) return undefined;
    return byPath.get(resolveDocumentRef(docPath, ref).replace(/^\/+/, ''));
  };

  const drawn = new Map<string, Set<MeshTextureRole>>();
  const draw = (uuid: string, role: MeshTextureRole): void => {
    const roles = drawn.get(uuid) ?? new Set<MeshTextureRole>();
    roles.add(role);
    drawn.set(uuid, roles);
  };
  const materials = new Set<string>();
  const docs = entries.filter((e) => e.type === 'scene' || e.type === 'prefab');
  await Promise.all(docs.map(async (doc) => {
    let parsed: Documented;
    try {
      parsed = JSON.parse(await read(doc.path)) as Documented;
    } catch {
      return;
    }
    for (const entity of parsed.entities ?? []) {
      for (const component of entity.components ?? []) {
        const type = component.type ?? '';
        const data = component.data ?? {};
        for (const [field, role] of Object.entries(MESH_TEXTURE_FIELDS[type] ?? {})) {
          const ref = data[field];
          const target = typeof ref === 'string' ? resolve(ref, doc.path) : undefined;
          if (target?.type === 'texture') draw(target.uuid, role);
        }
        for (const field of MESH_MATERIAL_FIELDS[type] ?? []) {
          const ref = data[field];
          const target = typeof ref === 'string' ? resolve(ref, doc.path) : undefined;
          if (target?.type === 'material') materials.add(target.uuid);
        }
      }
    }
  }));

  await Promise.all([...materials].map(async (uuid) => {
    const material = byUuid.get(uuid)!;
    let refs: string[] = [];
    try {
      strings(JSON.parse(await read(material.path)), refs);
    } catch {
      refs = [];
    }
    for (const ref of refs) {
      const target = resolve(ref, material.path);
      if (target?.type === 'texture') draw(target.uuid, 'surface');
    }
  }));
  return drawn;
}
