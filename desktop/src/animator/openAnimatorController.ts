// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    openAnimatorController.ts
 * @brief   Open / create a `.esanimator` (the animation controller state machine).
 */
import { emptyAnimatorController } from 'esengine';
import { AnimatorGraphDocument } from './AnimatorGraphDocument';
import { type GraphAssetKind, openGraphAsset, createGraphAsset } from '@/document/openGraphAsset';

const ANIMATOR: GraphAssetKind = {
  document: AnimatorGraphDocument,
  panelId: 'animatorcontroller',
  titleKey: 'anim.tabTitle',
  ext: 'esanimator',
  defaultName: 'NewAnimator',
  metaType: 'animatorcontroller',
  emptyDef: emptyAnimatorController,
  toast: { openFailed: 'anim.toastOpenFailed', createFailed: 'anim.toastCreateFailed', created: 'anim.toastCreated' },
};

/** Open an existing `.esanimator` into the controller editor and reveal the panel. */
export const openAnimatorController = (path: string): Promise<void> => openGraphAsset(ANIMATOR, path);

/** Create a new `.esanimator` (+ .meta) in @p dir, then open it. */
export const createAnimatorController = (dir: string): Promise<void> => createGraphAsset(ANIMATOR, dir);
