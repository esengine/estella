// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    openAnimatorController.ts
 * @brief   Open / create a `.esanimator` (the animation controller state machine).
 * @details A `.esanimator` IS the runtime AnimatorControllerDef (states carry x/y
 *          layout the interpreter ignores), so there is no compile step — Save
 *          just writes the JSON. Create writes the definition + .meta.
 */
import { emptyAnimatorController } from 'esengine';
import { AnimatorGraphDocument } from './AnimatorGraphDocument';
import { ProjectStore } from '@/project/ProjectStore';
import { confirmDiscardDoc } from '@/project/discardGuard';
import { dockApi } from '@/layout/dockApi';
import { baseName } from '@/project/assetMeta';
import { Toasts } from '@/store/Toasts';
import { t } from '@/i18n';

/** Open an existing `.esanimator` into the controller editor and reveal the panel. */
export async function openAnimatorController(path: string): Promise<void> {
  // Already-open file: just front the panel — a reload would clobber unsaved edits.
  if (AnimatorGraphDocument.isOpen && AnimatorGraphDocument.filePath === path) {
    dockApi.openDocument('animatorcontroller', 'animatorcontroller', t('anim.tabTitle'));
    return;
  }
  if (!(await confirmDiscardDoc(AnimatorGraphDocument.dirty, t('discard.openAsset', { name: baseName(path) })))) return;
  try {
    const text = await window.estella.fs.read(path);
    AnimatorGraphDocument.openJson(JSON.parse(text), path);
    dockApi.openDocument('animatorcontroller', 'animatorcontroller', t('anim.tabTitle'));
  } catch (e) {
    Toasts.push(t('anim.toastOpenFailed', { error: String(e) }), 'error');
  }
}

/** Create a new `.esanimator` (+ .meta) in @p dir, then open it. */
export async function createAnimatorController(dir: string): Promise<void> {
  const folder = dir ? (dir.endsWith('/') ? dir : `${dir}/`) : '';
  let rel = `${folder}NewAnimator.esanimator`;
  for (let n = 1; ProjectStore.assetRef(rel); n++) rel = `${folder}NewAnimator-${n}.esanimator`;

  const def = emptyAnimatorController();
  try {
    await window.estella.fs.write(rel, JSON.stringify(def, null, 2) + '\n');
    await window.estella.fs.write(
      rel + '.meta',
      JSON.stringify({ uuid: crypto.randomUUID(), version: '1.0', type: 'animatorcontroller', importer: { autoMigrate: true } }, null, 2) + '\n',
    );
  } catch (e) {
    Toasts.push(t('anim.toastCreateFailed', { error: String(e) }), 'error');
    return;
  }
  await ProjectStore.refreshAssets();
  Toasts.push(t('anim.toastCreated', { name: baseName(rel) }), 'info');
  await openAnimatorController(rel);
}
