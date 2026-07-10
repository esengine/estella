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
import { dockApi } from '@/layout/dockApi';
import { baseName } from '@/project/assetMeta';
import { Toasts } from '@/store/Toasts';

export async function openBehaviorTree(path: string): Promise<void> {
  try {
    const text = await window.estella.fs.read(path);
    // Hand-written trees may lack editor ids; assign before editing.
    BtDocument.openJson(ensureBtIds(JSON.parse(text) as BtDefinition), path);
    dockApi.openDocument('behaviortree', 'behaviortree', 'Behavior Tree');
  } catch (e) {
    Toasts.push(`Failed to open behavior tree: ${String(e)}`, 'error');
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
    Toasts.push(`Failed to create behavior tree: ${String(e)}`, 'error');
    return;
  }
  await ProjectStore.refreshAssets();
  Toasts.push(`Created behavior tree: ${baseName(rel)}`, 'info');
  await openBehaviorTree(rel);
}
