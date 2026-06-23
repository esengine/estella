// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  tilemapPaintStore.ts
 * @brief Transient tilemap-painting state: the active tileset
 *        palette, the selected brush tile, and the active paint tool. When a tool is
 *        set AND a TilemapLayer entity is selected, the Viewport paints instead of
 *        selecting. Editor-session state — never serialized.
 */
import { create } from 'zustand';

export type PaintTool = 'brush' | 'erase' | 'rect' | 'eyedropper';

interface TilemapPaintState {
  /** Active `.estileset` palette (project-relative path), or null. */
  tilesetPath: string | null;
  /** The tile id to paint (1-based; 0 = empty/erase). */
  brushTileId: number;
  /** The active tool; null = not painting (the Viewport selects normally). */
  tool: PaintTool | null;
  setTileset(path: string | null): void;
  setBrush(tileId: number): void;
  setTool(tool: PaintTool | null): void;
}

export const useTilemapPaint = create<TilemapPaintState>((set) => ({
  tilesetPath: null,
  brushTileId: 1,
  tool: null,
  setTileset: (tilesetPath) => set({ tilesetPath }),
  setBrush: (brushTileId) => set({ brushTileId }),
  setTool: (tool) => set({ tool }),
}));
