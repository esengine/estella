// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    openBehaviorTree.ts
 * @brief   Open / create a `.esbt` (the visual behavior tree, AI3). A `.esbt` IS
 *          the runtime BtDefinition, so there is no compile step — Save writes JSON.
 */
import { emptyBt, ensureBtIds, type BtDefinition } from 'esengine';
import { BtDocument } from './BtDocument';
import { ProjectStore } from '@/project/ProjectStore';
import { confirmDiscardDoc } from '@/project/discardGuard';
import { dockApi } from '@/layout/dockApi';
import { baseName } from '@/project/assetMeta';
import { Toasts } from '@/store/Toasts';
import { t } from '@/i18n';

export async function openBehaviorTree(path: string): Promise<void> {
  // Already-open file: just front the panel — a reload would clobber unsaved edits.
  if (BtDocument.isOpen && BtDocument.filePath === path) {
    dockApi.openDocument('behaviortree', 'behaviortree', t('bt.tabTitle'));
    return;
  }
  if (!(await confirmDiscardDoc(BtDocument.dirty, t('discard.openAsset', { name: baseName(path) })))) return;
  try {
    const text = await window.estella.fs.read(path);
    // Hand-written trees may lack editor ids; assign before editing.
    BtDocument.openJson(ensureBtIds(JSON.parse(text) as BtDefinition), path);
    dockApi.openDocument('behaviortree', 'behaviortree', t('bt.tabTitle'));
  } catch (e) {
    Toasts.push(t('bt.toastOpenFailed', { error: String(e) }), 'error');
  }
}

export async function createBehaviorTree(dir: string): Promise<void> {
  const folder = dir ? (dir.endsWith('/') ? dir : `${dir}/`) : '';
  let rel = `${folder}NewBehaviorTree.esbt`;
  for (let n = 1; ProjectStore.assetRef(rel); n++) rel = `${folder}NewBehaviorTree-${n}.esbt`;

  const def = emptyBt();
  try {
    await window.estella.fs.write(rel, JSON.stringify(def, null, 2) + '\n');
    await window.estella.fs.write(
      rel + '.meta',
      JSON.stringify({ uuid: crypto.randomUUID(), version: '1.0', type: 'behaviortree', importer: { autoMigrate: true } }, null, 2) + '\n',
    );
  } catch (e) {
    Toasts.push(t('bt.toastCreateFailed', { error: String(e) }), 'error');
    return;
  }
  await ProjectStore.refreshAssets();
  Toasts.push(t('bt.toastCreated', { name: baseName(rel) }), 'info');
  await openBehaviorTree(rel);
}
