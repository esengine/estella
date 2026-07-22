// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    openBehaviorTree.ts
 * @brief   Open / create a `.esbt` (the visual behavior tree, AI3).
 */
import { emptyBt, ensureBtIds, type BtDefinition } from 'esengine';
import { BtDocument } from './BtDocument';
import { type GraphAssetKind, openGraphAsset, createGraphAsset } from '@/document/openGraphAsset';

const BT: GraphAssetKind = {
  document: BtDocument,
  panelId: 'behaviortree',
  titleKey: 'bt.tabTitle',
  ext: 'esbt',
  defaultName: 'NewBehaviorTree',
  metaType: 'behaviortree',
  emptyDef: emptyBt,
  // Hand-written trees may lack editor ids; assign before editing.
  parse: (json) => ensureBtIds(json as BtDefinition),
  toast: { openFailed: 'bt.toastOpenFailed', createFailed: 'bt.toastCreateFailed', created: 'bt.toastCreated' },
};

/** Open an existing `.esbt` into the behavior-tree editor and reveal the panel. */
export const openBehaviorTree = (path: string): Promise<void> => openGraphAsset(BT, path);

/** Create a new `.esbt` (+ .meta) in @p dir, then open it. */
export const createBehaviorTree = (dir: string): Promise<void> => createGraphAsset(BT, dir);
