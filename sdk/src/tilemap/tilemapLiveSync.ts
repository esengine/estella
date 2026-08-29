// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  tilemapLiveSync.ts
 * @brief Editor→runtime live channel for a TilemapLayer's `.estileset` ref list.
 *
 * `tilesetAssets` is out-of-band — NOT a C++ ABI field — so the editor's reconciler
 * drops it when it projects a component change to the World, and the scene codec's
 * `importData` only runs on a FULL scene load. That leaves no path for "the editor
 * added a tileset to this layer" to reach the running tilemap plugin, so the sync
 * would keep rendering from the stale ref list. This is that path.
 *
 * It takes the App to push into. A module-level "active runtime" pointer answered
 * whichever plugin built last, so an editor world and a play world in one process
 * could not both be driven.
 */
import type { App } from '../app/app';
import { TilemapRuntimeState } from './tilemapPlugin';

export const TilemapLiveSync = {
    /** Push a layer's `.estileset` refs to `app`'s runtime so its next sync
     *  re-resolves. A no-op for an app with no tilemap runtime. */
    setLayerTilesets(app: App, entity: number, refs: readonly string[]): void {
        if (!app.hasResource(TilemapRuntimeState)) return;
        app.getResource(TilemapRuntimeState).setLayerTilesets(entity, refs);
    },
};
