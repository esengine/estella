// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    openTileset.ts
 * @brief   Open / create a .estileset from the Content Browser (docs/REARCH_TILEMAP.md T2).
 *          Mirrors openClip.ts (open) and ProjectStore.createPrefabFromEntity (create + .meta
 *          + registry re-scan).
 */

import { createTileset as createTilesetAsset, serializeTileset } from 'esengine';
import { TilesetDocument } from './TilesetDocument';
import { ProjectStore } from '@/project/ProjectStore';
import { dockApi } from '@/layout/dockApi';
import { baseName } from '@/project/assetMeta';
import { Toasts } from '@/store/Toasts';

/** Open an existing .estileset into the Tileset editor and reveal the panel. */
export async function openTileset(path: string): Promise<void> {
  try {
    const text = await window.estella.fs.read(path);
    TilesetDocument.openJson(JSON.parse(text), path);
    dockApi.revealAndExpand('tileset');
  } catch (e) {
    Toasts.push(`无法打开瓦片集：${String(e)}`, 'error');
  }
}

/** Create a .estileset next to a texture (referencing it), then open it. */
export async function createTilesetFromTexture(texturePath: string): Promise<void> {
  const ref = ProjectStore.assetRef(texturePath);
  if (!ref) {
    Toasts.push('该纹理未被项目追踪，无法创建瓦片集', 'error');
    return;
  }
  const dir = texturePath.includes('/') ? texturePath.slice(0, texturePath.lastIndexOf('/') + 1) : '';
  const base = baseName(texturePath).replace(/\.[^.]+$/, '') || 'Tileset';
  let rel = `${dir}${base}.estileset`;
  for (let n = 1; ProjectStore.assetRef(rel); n++) rel = `${dir}${base}-${n}.estileset`;

  const asset = createTilesetAsset(ref, 16, 16, 1);
  const uuid = crypto.randomUUID();
  try {
    await window.estella.fs.write(rel, JSON.stringify(serializeTileset(asset), null, 2) + '\n');
    await window.estella.fs.write(
      rel + '.meta',
      JSON.stringify({ uuid, version: '1.0', type: 'tileset', importer: { autoMigrate: true } }, null, 2) + '\n',
    );
  } catch (e) {
    Toasts.push(`创建瓦片集失败：${String(e)}`, 'error');
    return;
  }
  await ProjectStore.refreshAssets(); // re-scan so the new tileset is tracked
  Toasts.push(`已创建瓦片集：${rel.split('/').pop()}`, 'info');
  await openTileset(rel);
}
