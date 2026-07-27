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
import { assetTypeRegistry, assetTypeDef } from './assetTypes';
import { ProjectStore } from './ProjectStore';
import { confirmDiscard } from './discardGuard';
import { t } from '@/i18n';
import { Toasts } from '@/store/Toasts';
import { useEditorStore } from '@/store/editorStore';
import { externalPrograms } from './externalPrograms';
import { toggleAudioPreview } from './audioPreview';
import { openAnimationClip } from '@/timeline/openClip';
import { openFlipbook } from '@/flipbook/openFlipbook';
import { openTileset } from '@/tileset/openTileset';
import { openMaterial } from '@/material/openMaterial';
import { openMaterialGraph } from '@/material/openMaterialGraph';
import { openStateMachine } from '@/fsm/openStateMachine';
import { openAnimatorController } from '@/animator/openAnimatorController';
import { openBehaviorTree } from '@/bt/openBehaviorTree';

/**
 * Open an asset by type — built-ins from the table below, contributed types from
 * their own registration (a plugin carries its open action on the type itself, since
 * it has no import cycle to design around). Returns false when nothing can open it.
 */
export function openAssetOfType(type: AssetType, path: string, name: string): boolean {
  const builtin = ASSET_OPEN[type];
  if (builtin) {
    builtin(path, name);
    return true;
  }
  const contributed = assetTypeRegistry.get(type);
  if (contributed?.open) {
    contributed.open(path);
    return true;
  }
  void openOutside(type, path);
  return true;
}

/**
 * Hand a file to something outside the editor: the program configured for its
 * kind, else whatever the OS opens it with.
 *
 * This is the end of the chain, and it always does something — which is the point.
 * A double-click that silently did nothing was the whole bug: the editor has no
 * script editor and no image editor, so every `.ts` and every `.png` fell off the
 * end of a table that only knew about editors this editor ships.
 */
async function openOutside(type: AssetType, path: string): Promise<void> {
  const slot = assetTypeDef(type).externalProgram ?? '';
  // Empty program = "decide for me", which main answers with the editor it can
  // detect for this slot, or the OS default. Deliberately NOT resolved here: the
  // common case is a user who has never opened the settings page.
  const program = slot ? externalPrograms.pathFor(slot) : '';
  const failure = await window.estella?.shell?.launchProgram?.(slot, program, path);
  if (!failure) return;
  if (!program) {
    Toasts.push(t('toast.openFailed'), 'error');
    return;
  }
  // Configured months ago, uninstalled since. Say which program, and offer the
  // one action that fixes it rather than making the user hunt for the setting.
  Toasts.push(t(failure === 'missing' ? 'toast.programMissing' : 'toast.programFailed', { program }), 'error', 6000, {
    label: t('set.title'),
    run: () => useEditorStore.getState().openSettings('externalTools'),
  });
}

/** Open action per built-in asset type; types absent here aren't double-click-openable. */
export const ASSET_OPEN: Partial<Record<AssetType, (path: string, name: string) => void>> = {
  scene: async (path, name) => {
    if (!(await confirmDiscard(t('discard.openScene', { name })))) return;
    void ProjectStore.openScene(path);
  },
  prefab: (path) => void ProjectStore.openPrefab(path),
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
