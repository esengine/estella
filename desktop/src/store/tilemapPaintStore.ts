// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  tilemapPaintStore.ts
 * @brief Transient tilemap-painting state: the active tileset palette (path + parsed
 *        asset), the brush (a {@link TileStamp}, so multi-tile selection + flip + rotate
 *        flow through one model), the active terrain set, and the active paint tool. When
 *        a tool is set AND a TilemapLayer is selected, the Viewport paints instead of
 *        selecting. Editor-session state — never serialized.
 */
import { create } from 'zustand';
import {
    type TileStamp, type TilesetAsset,
    singleStamp, flipStampH, flipStampV, rotateStampCW, encodeTile,
} from 'esengine';

export type PaintTool = 'brush' | 'erase' | 'rect' | 'eyedropper' | 'terrain';

interface TilemapPaintState {
    /** Active `.estileset` palette (project-relative path), or null. */
    tilesetPath: string | null;
    /** The parsed active palette asset (kept here so the viewport terrain tool can resolve). */
    tilesetAsset: TilesetAsset | null;
    /** The active brush pattern. A 1×1 stamp is the classic single-tile brush. */
    stamp: TileStamp;
    /** The active terrain set index (for the terrain tool). */
    terrainSet: number;
    /** The active tool; null = not painting (the Viewport selects normally). */
    tool: PaintTool | null;
    setTileset(path: string | null): void;
    setTilesetAsset(asset: TilesetAsset | null): void;
    setStamp(stamp: TileStamp): void;
    /** Set a 1×1 brush of one tile id (palette single-click; loses any flip flags). */
    setBrushTile(tileId: number): void;
    setTerrainSet(set: number): void;
    flipH(): void;
    flipV(): void;
    rotateCW(): void;
    setTool(tool: PaintTool | null): void;
}

export const useTilemapPaint = create<TilemapPaintState>((set) => ({
    tilesetPath: null,
    tilesetAsset: null,
    stamp: singleStamp(encodeTile(1)),
    terrainSet: 0,
    tool: null,
    setTileset: (tilesetPath) => set({ tilesetPath }),
    setTilesetAsset: (tilesetAsset) => set({ tilesetAsset }),
    setStamp: (stamp) => set({ stamp }),
    setBrushTile: (tileId) => set({ stamp: singleStamp(encodeTile(tileId)) }),
    setTerrainSet: (terrainSet) => set({ terrainSet }),
    flipH: () => set((s) => ({ stamp: flipStampH(s.stamp) })),
    flipV: () => set((s) => ({ stamp: flipStampV(s.stamp) })),
    rotateCW: () => set((s) => ({ stamp: rotateStampCW(s.stamp) })),
    setTool: (tool) => set({ tool }),
}));
