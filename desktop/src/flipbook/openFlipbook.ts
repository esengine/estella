// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    openFlipbook.ts
 * @brief   Open / create a .esanim sprite flipbook from the Content Browser.
 *          Mirrors openTileset.ts (open + create-next-to-texture + .meta + re-scan).
 */

import { createAnimClip, serializeAnimClip } from 'esengine';
import { AnimClipDocument } from './AnimClipDocument';
import { useSelection } from '@/store/selectionStore';
import { ProjectStore } from '@/project/ProjectStore';
import { AssetRegistry } from '@/project/AssetRegistry';
import { confirmDiscardDoc } from '@/project/discardGuard';
import { dockApi } from '@/layout/dockApi';
import { baseName } from '@/project/assetMeta';
import { Toasts } from '@/store/Toasts';
import { t } from '@/i18n';

/** Open an existing .esanim into the Flipbook editor and reveal the panel. */
export async function openFlipbook(path: string): Promise<void> {
  // Already-open file: just front the panel — a reload would clobber unsaved edits.
  if (AnimClipDocument.isOpen && AnimClipDocument.filePath === path) {
    dockApi.openPanel('flipbook');
    useSelection.getState().selectAsset(path);
    return;
  }
  if (!(await confirmDiscardDoc(AnimClipDocument.dirty, t('discard.openAsset', { name: baseName(path) })))) return;
  try {
    const text = await window.estella.fs.read(path);
    AnimClipDocument.openJson(JSON.parse(text), path);
    dockApi.openPanel('flipbook');
    useSelection.getState().selectAsset(path);
  } catch (e) {
    Toasts.push(t('fb.toast.openFailed', { error: String(e) }), 'error');
  }
}

function imageSize(url: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => reject(new Error('image load failed'));
    img.src = url;
  });
}

/** A strip of square cells is the most common sheet shape; fall back to 32px. */
function guessCell(w: number, h: number): number {
  if (h > 0 && w % h === 0 && w / h <= 256) return h;
  return 32;
}

/** Create a .esanim next to a texture (slicing it), then open it. */
export async function createFlipbookFromTexture(texturePath: string): Promise<void> {
  const ref = AssetRegistry.assetRef(texturePath);
  if (!ref) {
    Toasts.push(t('fb.toast.texUntracked'), 'error');
    return;
  }
  let size: { w: number; h: number };
  try {
    size = await imageSize(`estella://project/${texturePath}`);
  } catch {
    size = { w: 32, h: 32 };
  }
  const cell = guessCell(size.w, size.h);

  const dir = texturePath.includes('/') ? texturePath.slice(0, texturePath.lastIndexOf('/') + 1) : '';
  const base = baseName(texturePath).replace(/\.[^.]+$/, '') || 'Animation';
  let rel = `${dir}${base}.esanim`;
  for (let n = 1; AssetRegistry.assetRef(rel); n++) rel = `${dir}${base}-${n}.esanim`;

  const asset = createAnimClip(ref, cell, cell, size.w, size.h);
  const uuid = crypto.randomUUID();
  try {
    await window.estella.fs.write(rel, JSON.stringify(serializeAnimClip(asset), null, 2) + '\n');
    await window.estella.fs.write(
      rel + '.meta',
      JSON.stringify({ uuid, version: '1.0', type: 'animclip', importer: {} }, null, 2) + '\n',
    );
  } catch (e) {
    Toasts.push(t('fb.toast.createFailed', { error: String(e) }), 'error');
    return;
  }
  await ProjectStore.refreshAssets(); // re-scan so the new clip is tracked
  Toasts.push(t('fb.toast.created', { name: rel.split('/').pop() ?? rel }), 'info');
  await openFlipbook(rel);
}
