// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    openTileset.ts
 * @brief   Open / create a .estileset from the Content Browser.
 *          Mirrors openClip.ts (open) and ProjectStore.createPrefabFromEntity (create + .meta
 *          + registry re-scan).
 */

import { createTileset as createTilesetAsset, serializeTileset } from 'esengine';
import { TilesetDocument } from './TilesetDocument';
import { ProjectStore } from '@/project/ProjectStore';
import { AssetRegistry } from '@/project/AssetRegistry';
import { confirmDiscardDoc } from '@/project/discardGuard';
import { dockApi } from '@/layout/dockApi';
import { baseName } from '@/project/assetMeta';
import { Toasts } from '@/store/Toasts';
import { t } from '@/i18n';

/** Open an existing .estileset into the Tileset editor and reveal the panel. */
export async function openTileset(path: string): Promise<void> {
  // Already-open file: just front the panel — a reload would clobber unsaved edits.
  if (TilesetDocument.isOpen && TilesetDocument.filePath === path) {
    dockApi.openPanel('tileset');
    return;
  }
  if (!(await confirmDiscardDoc(TilesetDocument.dirty, t('discard.openAsset', { name: baseName(path) })))) return;
  try {
    const text = await window.estella.fs.read(path);
    TilesetDocument.openJson(JSON.parse(text), path);
    dockApi.openPanel('tileset');
  } catch (e) {
    Toasts.push(t('tile.toast.openFailed', { error: String(e) }), 'error');
  }
}

/** The tile grid a new .estileset is sliced with (from NewTilesetDialog). */
export interface TilesetGridInit {
  tileWidth: number;
  tileHeight: number;
  margin: number;
  spacing: number;
  columns: number;
}

/** Create a .estileset next to a texture (referencing it), then open it. `grid` is the
 *  slice chosen in the New-Tileset dialog; omitted falls back to a plain 16×16 grid. */
export async function createTilesetFromTexture(texturePath: string, grid?: TilesetGridInit): Promise<void> {
  const ref = AssetRegistry.assetRef(texturePath);
  if (!ref) {
    Toasts.push(t('tile.toast.texUntracked'), 'error');
    return;
  }
  const dir = texturePath.includes('/') ? texturePath.slice(0, texturePath.lastIndexOf('/') + 1) : '';
  const base = baseName(texturePath).replace(/\.[^.]+$/, '') || 'Tileset';
  let rel = `${dir}${base}.estileset`;
  for (let n = 1; AssetRegistry.assetRef(rel); n++) rel = `${dir}${base}-${n}.estileset`;

  const g = grid ?? { tileWidth: 16, tileHeight: 16, margin: 0, spacing: 0, columns: 1 };
  const asset = createTilesetAsset(ref, g.tileWidth, g.tileHeight, g.columns);
  asset.margin = g.margin;
  asset.spacing = g.spacing;
  const uuid = crypto.randomUUID();
  try {
    await window.estella.fs.write(rel, JSON.stringify(serializeTileset(asset), null, 2) + '\n');
    await window.estella.fs.write(
      rel + '.meta',
      JSON.stringify({ uuid, version: '1.0', type: 'tileset', importer: { autoMigrate: true } }, null, 2) + '\n',
    );
  } catch (e) {
    Toasts.push(t('tile.toast.createFailed', { error: String(e) }), 'error');
    return;
  }
  await ProjectStore.refreshAssets(); // re-scan so the new tileset is tracked
  Toasts.push(t('tile.toast.createdTileset', { name: rel.split('/').pop() ?? rel }), 'info');
  await openTileset(rel);
}
