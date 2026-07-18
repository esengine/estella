// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  tilesetView.ts
 * @brief The Tileset Editor's view state (the active authoring mode tab), lifted out
 *        of the component so other surfaces can deep-link into a specific tab — e.g.
 *        the painter's terrain tool opens the editor directly on the Terrain tab.
 *        Editor-session state — never serialized.
 */
import { create } from 'zustand';

export type TilesetEditMode = 'collision' | 'terrain' | 'animation' | 'properties';

export const useTilesetView = create<{
    mode: TilesetEditMode;
    setMode: (mode: TilesetEditMode) => void;
}>((set) => ({
    mode: 'collision',
    setMode: (mode) => set({ mode }),
}));
