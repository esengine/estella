// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  tilemapLiveSync.ts
 * @brief Editor→runtime live channel for a TilemapLayer's `.estileset` ref list.
 *
 * `tilesetAssets` is out-of-band — NOT a C++ ABI field — so the editor's reconciler
 * drops it when it projects a component change to the World, and the scene codec's
 * `importData` (which owns `tilesetRefs_`) only runs on a FULL scene load. That
 * leaves no path for "the editor added a tileset to this layer" to reach the running
 * tilemap plugin, so the sync would keep rendering from the stale ref list.
 *
 * This singleton is that path: the active {@link TilemapPlugin} binds its ref-apply
 * in `build()` (and clears it in `cleanup()`); the editor pushes a ref-list change
 * through {@link TilemapLiveSync.setLayerTilesets}, the plugin updates `tilesetRefs_`
 * and clears `liveResolved_`, and the next sync re-resolves the multi-slot render
 * table + animations + collision LIVE. It is the exact analog of
 * `TilemapAPI.importChunks` for painted tiles — an out-of-band field pushed straight
 * to the runtime, bypassing the reconciler. Unbound (no runtime) = a no-op.
 */

/** Apply a layer's `.estileset` refs to the running plugin (empty = clear). */
export type ApplyTilesetRefs = (entity: number, refs: readonly string[]) => void;

let apply: ApplyTilesetRefs | null = null;

export const TilemapLiveSync = {
    /** The active TilemapPlugin registers its ref-apply (build) / clears it (cleanup). */
    _bind(fn: ApplyTilesetRefs | null): void {
        apply = fn;
    },
    /** Push a layer's `.estileset` refs to the runtime so the next sync re-resolves. */
    setLayerTilesets(entity: number, refs: readonly string[]): void {
        apply?.(entity, refs);
    },
};
