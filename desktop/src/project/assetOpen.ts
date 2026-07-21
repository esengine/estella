// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  assetOpen.ts
 * @brief The double-click open action per asset type — the dispatch behind the
 *        Content Browser. Kept separate from the pure `assetTypes` registry
 *        because the actions pull in heavy editor modules (scene/clip/tileset
 *        openers); folding them into the registry would create import cycles.
 */
import type { AssetType } from '@/types';
import { ProjectStore } from './ProjectStore';
import { confirmDiscard } from './discardGuard';
import { t } from '@/i18n';
import { toggleAudioPreview } from './audioPreview';
import { openAnimationClip } from '@/timeline/openClip';
import { openFlipbook } from '@/flipbook/openFlipbook';
import { openTileset } from '@/tileset/openTileset';
import { openMaterial } from '@/material/openMaterial';
import { openMaterialGraph } from '@/material/openMaterialGraph';
import { openStateMachine } from '@/fsm/openStateMachine';
import { openAnimatorController } from '@/animator/openAnimatorController';
import { openBehaviorTree } from '@/bt/openBehaviorTree';

/** Open action per asset type; types absent here aren't double-click-openable. */
export const ASSET_OPEN: Partial<Record<AssetType, (path: string, name: string) => void>> = {
  scene: async (path, name) => {
    if (!(await confirmDiscard(t('discard.openScene', { name })))) return;
    void ProjectStore.openScene(path);
  },
  audio: (path) => toggleAudioPreview(path),
  animation: (path) => void openAnimationClip(path),
  animclip: (path) => void openFlipbook(path),
  tileset: (path) => void openTileset(path),
  material: (path) => void openMaterial(path),
  materialgraph: (path) => void openMaterialGraph(path),
  statemachine: (path) => void openStateMachine(path),
  animatorcontroller: (path) => void openAnimatorController(path),
  behaviortree: (path) => void openBehaviorTree(path),
};
