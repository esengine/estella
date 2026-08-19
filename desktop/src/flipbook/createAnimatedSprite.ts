// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    createAnimatedSprite.ts
 * @brief   Spawn a playing sprite-flipbook entity from a .esanim through the
 *          unified create pipeline (mirrors createTilemap.ts): `build` yields a
 *          Transform + Sprite + SpriteAnimator prefab seeded so the edit-mode
 *          static pose IS frame 0 (sheet texture + first cell's UV window), and
 *          Play animates with zero code.
 */
import {
  parseAnimClipAsset, animClipCellUv, animClipFramePivot, type AnimClipAssetData,
} from 'esengine';
import { Images } from 'lucide-react';
import { createFromSource, animatedSpritePrefab, type EntitySource } from '@/engine/entitySources';
import { useSelection } from '@/store/selectionStore';
import { AssetRegistry } from '@/project/AssetRegistry';
import { Toasts } from '@/store/Toasts';
import { t } from '@/i18n';

function animClipSource(clipPath: string, clipRef: string, asset: AnimClipAssetData): EntitySource {
  const name = (clipPath.split('/').pop() ?? 'Sprite').replace(/\.[^.]+$/, '') || 'Sprite';
  const sheet = asset.sheet;
  const firstCell = asset.frames.find((f) => f.cell !== undefined)?.cell;
  const first = asset.frames[0];
  return {
    id: `animclip:${clipPath}`,
    label: name,
    category: '2D',
    icon: Images,
    build: () =>
      animatedSpritePrefab(name, clipRef, {
        texture: sheet?.texture ?? asset.frames[0]?.texture,
        size: sheet ? { x: sheet.cellWidth, y: sheet.cellHeight } : undefined,
        uv: sheet && firstCell !== undefined ? animClipCellUv(sheet, firstCell) : undefined,
        pivot: first ? animClipFramePivot(asset, first) ?? undefined : undefined,
        loop: asset.loop ?? true,
      }),
    afterCreate: (_ctx, rootId) => {
      useSelection.getState().select(rootId);
    },
  };
}

/** Create a Sprite + SpriteAnimator entity referencing the given .esanim and select it. */
export async function createAnimatedSpriteFromClip(
  clipPath: string,
  position?: { x: number; y: number; z?: number },
): Promise<void> {
  const clipRef = AssetRegistry.assetRef(clipPath); // .esanim → @uuid
  if (!clipRef) {
    Toasts.push(t('fb.toast.clipUntracked'), 'error');
    return;
  }
  let asset: AnimClipAssetData;
  try {
    asset = parseAnimClipAsset(JSON.parse(await window.estella.fs.read(clipPath)));
  } catch (e) {
    Toasts.push(t('fb.toast.openFailed', { error: String(e) }), 'error');
    return;
  }
  // Preload the sheet texture so the seeded frame renders immediately in edit mode.
  const texRef = asset.sheet?.texture ?? asset.frames[0]?.texture;
  const texPath = texRef ? AssetRegistry.assetInfo(texRef)?.path : undefined;
  if (texPath) await AssetRegistry.assetRefForPath(texPath, 'texture');
  await createFromSource(animClipSource(clipPath, clipRef, asset), { parent: null, position });
}
