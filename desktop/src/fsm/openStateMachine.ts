// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    openStateMachine.ts
 * @brief   Open / create a `.esfsm` (the visual state machine, AI2).
 * @details A `.esfsm` IS the runtime FsmDefinition (states carry x/y layout the
 *          interpreter ignores), so there is no compile step — Save (in the
 *          editor) just writes the JSON. Create writes the definition + .meta.
 */
import { emptyFsm } from 'esengine';
import { FsmGraphDocument } from './FsmGraphDocument';
import { ProjectStore } from '@/project/ProjectStore';
import { dockApi } from '@/layout/dockApi';
import { baseName } from '@/project/assetMeta';
import { Toasts } from '@/store/Toasts';

/** Open an existing `.esfsm` into the state-machine editor and reveal the panel. */
export async function openStateMachine(path: string): Promise<void> {
  try {
    const text = await window.estella.fs.read(path);
    FsmGraphDocument.openJson(JSON.parse(text), path);
    dockApi.openDocument('statemachine', 'statemachine', 'State Machine');
  } catch (e) {
    Toasts.push(`无法打开状态机：${String(e)}`, 'error');
  }
}

/** Create a new `.esfsm` (+ .meta) in @p dir, then open it. */
export async function createStateMachine(dir: string): Promise<void> {
  const folder = dir ? (dir.endsWith('/') ? dir : `${dir}/`) : '';
  let rel = `${folder}NewStateMachine.esfsm`;
  for (let n = 1; ProjectStore.assetRef(rel); n++) rel = `${folder}NewStateMachine-${n}.esfsm`;

  const def = emptyFsm();
  try {
    await window.estella.fs.write(rel, JSON.stringify(def, null, 2) + '\n');
    await window.estella.fs.write(
      rel + '.meta',
      JSON.stringify({ uuid: crypto.randomUUID(), version: '1.0', type: 'statemachine', importer: { autoMigrate: true } }, null, 2) + '\n',
    );
  } catch (e) {
    Toasts.push(`创建状态机失败：${String(e)}`, 'error');
    return;
  }
  await ProjectStore.refreshAssets();
  Toasts.push(`已创建状态机：${baseName(rel)}`, 'info');
  await openStateMachine(rel);
}
