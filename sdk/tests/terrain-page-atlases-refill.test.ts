// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A ground's page atlases are owed after a device loss, so their refill runs: it forgets the pages, which are made again as they
 *        are wanted, and pays the device for the blank storage the atlases come back with.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from '../src/app/app';
import { TextureContent, type CppResourceManager } from '../src/wasm';
import { initResourceManager, shutdownResourceManager, textureRefill } from '../src/wasm/resourceManager';
import { createPageAtlases } from '../src/terrain/atlases';

function engine() {
    let next = 20;
    const content = new Map<number, number>();
    const rm = {
        createTextureFromBytes: vi.fn((_w: number, _h: number, _p: Uint8Array, _f: number, _flip: boolean, c: number) => {
            const handle = next++;
            content.set(handle, c);
            return handle;
        }),
        restoreTextureContent: vi.fn((_handle: number) => {}),
    };
    initResourceManager(rm as unknown as CppResourceManager);
    return { rm, content, app: { wasmModule: null } as unknown as App };
}

afterEach(() => shutdownResourceManager());

describe('terrain page atlases after a device loss', () => {
    it('are content their creator composes, so a loss leaves them owed and their refill is asked', () => {
        const { content, app } = engine();
        const atlases = createPageAtlases(app, 3, 4, () => {});
        expect(atlases.map((h) => content.get(h))).toEqual([TextureContent.Composed, TextureContent.Composed, TextureContent.Composed]);
    });

    it('forget the pages and pay for the blank storage when refilled', async () => {
        const { rm, app } = engine();
        const forget = vi.fn();
        const atlases = createPageAtlases(app, 2, 4, forget);
        for (const h of atlases) expect(await textureRefill(h)!()).toBe(true);
        expect(forget).toHaveBeenCalledTimes(2);
        expect(rm.restoreTextureContent.mock.calls.map(([h]) => h)).toEqual(atlases);
    });
});
