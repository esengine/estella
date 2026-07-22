// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    openStateMachine.ts
 * @brief   Open / create a `.esfsm` (the visual state machine, AI2).
 */
import { emptyFsm } from 'esengine';
import { FsmGraphDocument } from './FsmGraphDocument';
import { type GraphAssetKind, openGraphAsset, createGraphAsset } from '@/document/openGraphAsset';

const FSM: GraphAssetKind = {
  document: FsmGraphDocument,
  panelId: 'statemachine',
  titleKey: 'fsm.tabTitle',
  ext: 'esfsm',
  defaultName: 'NewStateMachine',
  metaType: 'statemachine',
  emptyDef: emptyFsm,
  toast: { openFailed: 'fsm.toastOpenFailed', createFailed: 'fsm.toastCreateFailed', created: 'fsm.toastCreated' },
};

/** Open an existing `.esfsm` into the state-machine editor and reveal the panel. */
export const openStateMachine = (path: string): Promise<void> => openGraphAsset(FSM, path);

/** Create a new `.esfsm` (+ .meta) in @p dir, then open it. */
export const createStateMachine = (dir: string): Promise<void> => createGraphAsset(FSM, dir);
