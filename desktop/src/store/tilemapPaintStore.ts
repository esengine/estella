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

export type PaintTool = 'brush' | 'erase' | 'rect' | 'line' | 'bucket' | 'select' | 'eyedropper' | 'terrain';

/** One tileset in the active layer's palette: its `.estileset` path, parsed asset, and
 *  the GLOBAL tile-id base (firstId) it occupies — matching the runtime tileset model, so
 *  a cell painted from this tileset encodes to the gid the renderer resolves back to it. */
export interface PaletteTileset {
    path: string;
    asset: TilesetAsset;
    firstId: number;
}

/** A rectangular tile-grid selection (inclusive corners, unordered). */
export interface TileRect {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
}

interface TilemapPaintState {
    /** The active layer's tilesets, in firstId order (one entry = a single-tileset layer). */
    tilesets: PaletteTileset[];
    /** Index into `tilesets` of the palette the painter shows + paints from. */
    activeTileset: number;
    /** Active `.estileset` palette (project-relative path), or null. Mirrors tilesets[activeTileset]. */
    tilesetPath: string | null;
    /** The parsed active palette asset (kept here so the viewport terrain tool can resolve). */
    tilesetAsset: TilesetAsset | null;
    /** The active brush pattern. A 1×1 stamp is the classic single-tile brush. */
    stamp: TileStamp;
    /** The active terrain set index (for the terrain tool). */
    terrainSet: number;
    /** The select tool's current marquee (tile coords), or null. */
    selection: TileRect | null;
    /** The copy/cut buffer — a stamp lifted from a selection; pasted via the brush. */
    clipboard: TileStamp | null;
    /** The active tool; null = not painting (the Viewport selects normally). */
    tool: PaintTool | null;
    /** Replace the active layer's palette list (from its tilesetAssets); resets active to 0. */
    setTilesets(tilesets: PaletteTileset[]): void;
    /** Switch which tileset in the list the palette shows/paints from. */
    setActiveTileset(index: number): void;
    setTileset(path: string | null): void;
    setTilesetAsset(asset: TilesetAsset | null): void;
    setStamp(stamp: TileStamp): void;
    setSelection(selection: TileRect | null): void;
    setClipboard(clipboard: TileStamp | null): void;
    /** Set a 1×1 brush of one tile id (palette single-click; loses any flip flags). */
    setBrushTile(tileId: number): void;
    setTerrainSet(set: number): void;
    flipH(): void;
    flipV(): void;
    rotateCW(): void;
    setTool(tool: PaintTool | null): void;
}

export const useTilemapPaint = create<TilemapPaintState>((set) => ({
    tilesets: [],
    activeTileset: 0,
    tilesetPath: null,
    tilesetAsset: null,
    stamp: singleStamp(encodeTile(1)),
    terrainSet: 0,
    selection: null,
    clipboard: null,
    tool: null,
    setTilesets: (tilesets) => set({
        tilesets,
        activeTileset: 0,
        tilesetPath: tilesets[0]?.path ?? null,
        tilesetAsset: tilesets[0]?.asset ?? null,
    }),
    setActiveTileset: (index) => set((s) => {
        const ts = s.tilesets[index];
        return ts ? { activeTileset: index, tilesetPath: ts.path, tilesetAsset: ts.asset } : {};
    }),
    setTileset: (tilesetPath) => set({ tilesetPath }),
    setTilesetAsset: (tilesetAsset) => set({ tilesetAsset }),
    setStamp: (stamp) => set({ stamp }),
    setSelection: (selection) => set({ selection }),
    setClipboard: (clipboard) => set({ clipboard }),
    setBrushTile: (tileId) => set({ stamp: singleStamp(encodeTile(tileId)) }),
    setTerrainSet: (terrainSet) => set({ terrainSet }),
    flipH: () => set((s) => ({ stamp: flipStampH(s.stamp) })),
    flipV: () => set((s) => ({ stamp: flipStampV(s.stamp) })),
    rotateCW: () => set((s) => ({ stamp: rotateStampCW(s.stamp) })),
    setTool: (tool) => set({ tool }),
}));
