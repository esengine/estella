// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    tilemap-live-sync.test.ts
 * @brief   The editor→runtime channel for a layer's `.estileset` ref list, and
 *          which app it reaches.
 *
 * @details An editor world beside a play world is two Apps. The push names the
 *          one it is for, so neither the caller nor the runtime has to work out
 *          which of them a pointer happens to be aimed at.
 */
import { describe, it, expect } from 'vitest';
import { App } from '../src/app/app';
import { TilemapLiveSync } from '../src/tilemap/tilemapLiveSync';
import { TilemapRuntime, TilemapRuntimeState } from '../src/tilemap/tilemapPlugin';

/** An app carrying a runtime whose applies are observable. */
function appWithRuntime(): { app: App; seen: Array<{ entity: number; refs: string[] }> } {
    const app = App.new();
    const runtime = new TilemapRuntime();
    const seen: Array<{ entity: number; refs: string[] }> = [];
    (runtime as unknown as { applyTilesetRefs_: (e: number, r: readonly string[]) => void })
        .applyTilesetRefs_ = (entity, refs) => seen.push({ entity, refs: [...refs] });
    app.insertResource(TilemapRuntimeState, runtime);
    return { app, seen };
}

describe('a live tileset push names the app it is for', () => {
    it('reaches that app\'s runtime, and only that one', () => {
        // Deliberately the same entity id in both: two Apps always have them.
        const edit = appWithRuntime();
        const play = appWithRuntime();

        TilemapLiveSync.setLayerTilesets(edit.app, 10, ['@uuid:a', '@uuid:b']);

        expect(edit.seen).toEqual([{ entity: 10, refs: ['@uuid:a', '@uuid:b'] }]);
        expect(play.seen, 'the other realm was driven too').toEqual([]);
    });

    it('an empty list still forwards — that is how a layer is cleared', () => {
        const { app, seen } = appWithRuntime();
        TilemapLiveSync.setLayerTilesets(app, 3, []);
        expect(seen).toEqual([{ entity: 3, refs: [] }]);
    });

    it('an app with no tilemap runtime is a no-op, not a throw', () => {
        expect(() => TilemapLiveSync.setLayerTilesets(App.new(), 1, ['@uuid:x'])).not.toThrow();
    });

    it('a disposed runtime stops delivering', () => {
        const { app, seen } = appWithRuntime();
        app.getResource(TilemapRuntimeState).dispose();
        TilemapLiveSync.setLayerTilesets(app, 1, ['@uuid:a']);
        expect(seen).toEqual([]);
    });
});
