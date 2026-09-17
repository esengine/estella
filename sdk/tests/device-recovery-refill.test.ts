// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  After a device loss, a texture no asset path can load again goes to the
 *        refill its creator provided; one nobody provided for is forgone by name.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Assets } from '../src/asset/Assets';
import type { Backend } from '../src/asset/Backend';
import { TextureContent, type CppResourceManager, type ESEngineModule } from '../src/wasm';
import {
    initResourceManager,
    provideTextureContent,
    shutdownResourceManager,
    textureRefill,
    withdrawTextureContent,
} from '../src/wasm/resourceManager';

function owing(rows: Array<[number, number, string]>) {
    const owed = new Map(rows.map(([handle, content, path]) => [handle, { content, path }]));
    const rm = {
        texturesAwaitingReupload: () => [...owed].map(([h, o]) => `${h}|${o.content}|${o.path}`).join('\n'),
        forgoTextureContent: vi.fn((handle: number) => { owed.delete(handle); }),
        adoptTextureContent: vi.fn(() => true),
        releaseTexture: vi.fn(),
    };
    initResourceManager(rm as unknown as CppResourceManager);
    const assets = new Assets({
        backend: { resolveUrl: (p: string) => p } as unknown as Backend,
        module: { _malloc: () => 0, _free: () => {} } as unknown as ESEngineModule,
    });
    return { rm, owed, assets };
}

afterEach(() => shutdownResourceManager());

describe('device recovery: texture refills', () => {
    it('asks the refill its creator provided, and forgoes content nobody provided for', async () => {
        const { rm, owed, assets } = owing([
            [7, TextureContent.GlyphPage, ''],
            [8, TextureContent.Canvas, ''],
        ]);
        const refill = vi.fn(() => { owed.delete(7); return true; });
        provideTextureContent(7, refill);

        expect(await assets.reuploadTexturesAfterDeviceLoss()).toBe(1);
        expect(refill).toHaveBeenCalledTimes(1);
        expect(rm.forgoTextureContent).toHaveBeenCalledTimes(1);
        expect(rm.forgoTextureContent).toHaveBeenCalledWith(8);
    });

    it('keeps a texture owed when its refill fails, so a later attempt can pay it', async () => {
        const { rm, assets } = owing([[9, TextureContent.AtlasPage, 'dragon/page.png']]);
        provideTextureContent(9, async () => { throw new Error('offline'); });

        expect(await assets.reuploadTexturesAfterDeviceLoss()).toBe(0);
        expect(rm.forgoTextureContent).not.toHaveBeenCalled();
        expect(assets.texturesAwaitingReupload().map((t) => t.handle)).toEqual([9]);
    });

    it('forgets a withdrawn refill, and every refill when the resource manager goes', () => {
        owing([]);
        provideTextureContent(3, () => true);
        provideTextureContent(4, () => true);
        withdrawTextureContent(3);
        expect(textureRefill(3)).toBeUndefined();
        expect(textureRefill(4)).toBeDefined();

        shutdownResourceManager();
        expect(textureRefill(4)).toBeUndefined();
    });
});
