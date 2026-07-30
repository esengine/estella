// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    openClip.ts
 * @brief   Open a multi-track timeline (.estimeline) from disk into the Sequencer.
 *
 * Reads the project file, parses it through the unified clip loader (tolerating
 * legacy flipbook-shaped files), opens it as the editor TimelineDocument bound
 * to the current selection as its preview root, and reveals the Sequencer.
 * Sprite flipbooks (.esanim) open in the Flipbook editor instead.
 */

import { parseAnimationClip } from 'esengine';
import { t } from '@/i18n';
import { TimelineDocument } from './TimelineDocument';
import { previewRootFor } from './previewRoot';
import { useSequencerStore } from '@/store/sequencerStore';
import { dockApi } from '@/layout/dockApi';
import { Toasts } from '@/store/Toasts';
import { ProjectStore } from '@/project/ProjectStore';
import { confirmDiscardDoc } from '@/project/discardGuard';
import { baseName } from '@/project/assetMeta';

export async function openAnimationClip(path: string): Promise<void> {
  // Already-open file: front the Sequencer and rebind the preview root — a
  // reload would clobber unsaved edits.
  if (TimelineDocument.isOpen && TimelineDocument.filePath === path) {
    TimelineDocument.setRootEntity(previewRootFor(path));
    dockApi.revealAndExpand('sequencer');
    return;
  }
  if (!(await confirmDiscardDoc(TimelineDocument.dirty, t('discard.openAsset', { name: baseName(path) })))) return;
  try {
    const text = await window.estella.fs.read(path);
    const asset = parseAnimationClip(JSON.parse(text));
    // Bind the preview to the entity that PLAYS this clip (else the selection) so
    // scrubbing animates something: opened from the Content Browser the selection is
    // an asset, and binding to that bound to nothing at all.
    const rootEntity = previewRootFor(path);
    TimelineDocument.open({ asset, filePath: path, rootEntity });
    useSequencerStore.getState().resetForClip();
    dockApi.revealAndExpand('sequencer');
    if (rootEntity == null) {
      Toasts.push(t('seq.toast.unbound', { name: baseName(path) }), 'info', 5000);
    }
  } catch (e) {
    Toasts.push(t('seq.toast.openFailed', { error: String(e) }), 'error');
  }
}

// A blank multi-track timeline, in the canonical serialized shape parseAnimationClip
// reads (the Sequencer fills it by recording keys on a selected entity).
const BLANK_CLIP = { version: '1.1', type: 'timeline', duration: 5, wrapMode: 'loop', tracks: [] };

/** Create an empty `.estimeline` timeline in @p dir and open it in the Sequencer. */
export async function createAnimationClip(dir: string): Promise<void> {
  const folder = dir ? (dir.endsWith('/') ? dir : `${dir}/`) : '';
  let rel = `${folder}NewAnimation.estimeline`;
  for (let n = 1; ProjectStore.assetRef(rel); n++) rel = `${folder}NewAnimation-${n}.estimeline`;
  try {
    await window.estella.fs.write(rel, JSON.stringify(BLANK_CLIP, null, 2) + '\n');
    await window.estella.fs.write(
      rel + '.meta',
      JSON.stringify({ uuid: crypto.randomUUID(), version: '1.0', type: 'animation', importer: { autoMigrate: true } }, null, 2) + '\n',
    );
  } catch (e) {
    Toasts.push(t('seq.toast.createFailed', { error: String(e) }), 'error');
    return;
  }
  await ProjectStore.refreshAssets();
  Toasts.push(t('seq.toast.created', { name: baseName(rel) }), 'info');
  await openAnimationClip(rel);
}
