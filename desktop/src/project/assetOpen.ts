// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
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
import { EditorHistory } from '@/engine/EditorHistory';
import { openAnimationClip } from '@/timeline/openClip';
import { openTileset } from '@/tileset/openTileset';
import { openMaterial } from '@/material/openMaterial';
import { openMaterialGraph } from '@/material/openMaterialGraph';

/** Open action per asset type; types absent here aren't double-click-openable. */
export const ASSET_OPEN: Partial<Record<AssetType, (path: string, name: string) => void>> = {
  scene: (path, name) => {
    // History is cleared on open, so canUndo ≈ "edited this session" — warn first.
    if (EditorHistory.canUndo() && !window.confirm(`Open ${name}? Unsaved changes will be lost.`)) return;
    void ProjectStore.openScene(path);
  },
  animation: (path) => void openAnimationClip(path),
  tileset: (path) => void openTileset(path),
  material: (path) => void openMaterial(path),
  materialgraph: (path) => void openMaterialGraph(path),
};
