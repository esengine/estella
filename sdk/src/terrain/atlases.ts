// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    atlases.ts
 * @brief   The atlases a ground's pages are drawn from (pages.ts): made blank, and refilled by forgetting the pages.
 */
import type { App } from '../app/app';
import { createTextureFromPixels } from '../runtime/runtimeAssets';
import { getResourceManager, provideTextureContent } from '../wasm/resourceManager';
import { TextureContent } from '../wasm';

/**
 * `count` blank `size`-square atlases (heights, paint, then paint2 for a ground of more than four layers); 0 for one the engine refused.
 * The device keeps no copy: a page is made from the source whenever it is wanted, so after a loss `forget` drops them all and they are
 * made again. That leaves the atlases the blank storage they come back with, which is their content, and pays the device for them.
 */
export function createPageAtlases(app: App, count: number, size: number, forget: () => void): number[] {
    const blank = new Uint8Array(size * size * 4);
    const params = { filterMode: 'linear', wrapMode: 'clamp', srgb: false } as const;
    const atlases: number[] = [];
    for (let i = 0; i < count; i++) {
        const handle = createTextureFromPixels(app.wasmModule, { width: size, height: size, pixels: blank }, TextureContent.Composed, false, params);
        if (handle) provideTextureContent(handle, () => { forget(); getResourceManager()?.restoreTextureContent?.(handle); return true; });
        atlases.push(handle);
    }
    return atlases;
}
