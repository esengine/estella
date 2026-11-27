// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    textureUsage.ts
 * @brief   Mesh texture uses that determine compression, streaming and atlas eligibility.
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
import type { ComponentData, PrefabOverride } from '../../../sdk/src/prefab/types';
import type { AssetEntry } from './assetDb';
import { addrType } from './addressableRecord';
import { findDocumentAsset } from '../../../sdk/src/asset/documentRef';
import { assetRefId } from '../../../sdk/src/asset/AssetRegistry';
import { COMPONENT_META } from '../../../sdk/src/ecs/component.generated';
import { canonicalComponentType } from '../../../sdk/src/scene/legacyComponents';
import { readMaterialProperty } from '../../../sdk/src/render/materialProperty';
import type { MaterialAssetData } from '../../../sdk/src/render/material';

/** How a mesh draws a texture: on its surface, or as the baked light the surface reads. */
export type MeshTextureRole = 'surface' | 'lightmap';

interface Documented {
  entities?: Array<{
    components?: ComponentData[];
    overrides?: PrefabOverride[];
    added?: Array<{ components?: ComponentData[] }>;
    nestedPrefab?: { overrides?: PrefabOverride[] };
  }>;
  overrides?: PrefabOverride[];
}

function visitComponentFields(doc: Documented, visit: (type: string, fields: Record<string, unknown>) => void): void {
  const component = (value: ComponentData | null | undefined) => {
    if (typeof value?.type === 'string') visit(value.type, value.data);
  };
  const overrides = (items?: readonly PrefabOverride[]) => {
    if (!Array.isArray(items)) return;
    for (const edit of items) {
      if (edit?.type === 'property' && edit.componentType && edit.propertyName) {
        visit(edit.componentType, { [edit.propertyName]: edit.value });
      } else if (edit?.type === 'component_added' || edit?.type === 'component_replaced') {
        component(edit.componentData);
      }
    }
  };
  overrides(doc.overrides);
  if (!Array.isArray(doc.entities)) return;
  for (const entity of doc.entities) {
    if (!entity) continue;
    if (Array.isArray(entity.components)) entity.components.forEach(component);
    if (Array.isArray(entity.added)) for (const added of entity.added) {
      if (Array.isArray(added?.components)) added.components.forEach(component);
    }
    overrides(entity.overrides);
    overrides(entity.nestedPrefab?.overrides);
  }
}

type MaterialDocument = Partial<Pick<MaterialAssetData, 'instanceOf' | 'properties'>>;

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
  const byUuid = new Map(entries.map((e) => [assetRefId(e.uuid) ?? e.uuid.toLowerCase(), e]));
  const byPath = new Map(entries.map((e) => [e.path, e]));
  const resolve = (ref: string, docPath: string, first: 'project' | 'document' = 'project'): AssetEntry | undefined => {
    const uuid = assetRefId(ref);
    if (uuid !== null) return byUuid.get(uuid);
    return findDocumentAsset(docPath, ref, file => byPath.get(file), first);
  };

  const drawn = new Map<string, Set<MeshTextureRole>>();
  const draw = (uuid: string, role: MeshTextureRole): void => {
    const roles = drawn.get(uuid) ?? new Set<MeshTextureRole>();
    roles.add(role);
    drawn.set(uuid, roles);
  };
  const materials = new Set<AssetEntry>();
  const docs = entries.filter((e) => e.type === 'scene' || e.type === 'prefab');
  await Promise.all(docs.map(async (doc) => {
    let parsed: Documented;
    try {
      parsed = JSON.parse(await read(doc.path)) as Documented;
    } catch {
      return;
    }
    if (!parsed) return;
    visitComponentFields(parsed, (authoredType, data) => {
      const type = canonicalComponentType(authoredType);
      for (const field of COMPONENT_META[type]?.assetFields ?? []) {
        // Baked lighting participates in compression but the renderer does not stream it by texel density.
        const lightmap = type === 'MeshLightmap' && field.field === 'lightmap';
        if (!field.measuresTextureDensity && !lightmap) continue;
        const ref = data?.[field.field];
        const target = typeof ref === 'string' ? resolve(ref, doc.path) : undefined;
        if (!target || addrType(target.type) !== field.type) continue;
        if (field.type === 'texture') draw(target.uuid, lightmap ? 'lightmap' : 'surface');
        else if (field.type === 'material') materials.add(target);
      }
    });
  }));

  const files = new Map<AssetEntry, Promise<MaterialDocument | null>>();
  const materialFile = (entry: AssetEntry): Promise<MaterialDocument | null> => {
    let pending = files.get(entry);
    if (!pending) {
      pending = Promise.resolve()
        .then(() => read(entry.path))
        .then(text => JSON.parse(text) as MaterialDocument)
        .catch(() => null);
      files.set(entry, pending);
    }
    return pending;
  };
  await Promise.all([...materials].map(async leaf => {
    const chain = new Set<AssetEntry>(), bound = new Set<string>();
    let current: AssetEntry | undefined = leaf;
    while (current && !chain.has(current)) {
      chain.add(current);
      const doc = await materialFile(current);
      if (!doc) break;
      for (const [name, value] of Object.entries(doc.properties ?? {})) {
        if (bound.has(name)) continue;
        const uniform = readMaterialProperty(value);
        if (uniform === undefined) continue;
        if (typeof uniform === 'string') {
          const texture = resolve(uniform, current.path, 'document');
          if (!texture || addrType(texture.type) !== 'texture') continue;
          draw(texture.uuid, 'surface');
        }
        bound.add(name);
      }
      const parent: AssetEntry | undefined = typeof doc.instanceOf === 'string' ? resolve(doc.instanceOf, current.path, 'document') : undefined;
      current = parent?.type === 'material' ? parent : undefined;
    }
  }));
  return drawn;
}
