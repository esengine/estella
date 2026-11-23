// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  After a device loss, a texture no asset path can load again goes to the
 *        refill its creator provided; one nobody provided for is forgone by name.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Assets } from '../src/asset/Assets';
import { HttpBackend } from '../src/asset/Backend';
import { setLinearColorSpace } from '../src/ecs/env';
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
    const assets = Assets.create({
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

    it('keeps a newly held file when its old warm handle disappears during another refill', async () => {
        const path = 'changed.png:f';
        const { rm, owed, assets } = owing([[7, TextureContent.GlyphPage, ''], [8, TextureContent.Asset, path]]);
        const resident = new Map([[path, 8]]);
        Object.assign(rm, {
            getTextureRefCount: (handle: number) => handle === 8 ? 0 : 1,
            invalidateTexturePath: (key: string) => resident.delete(key),
            trimTextureCache: () => 0,
        });
        provideTextureContent(7, async () => {
            await Promise.resolve();
            owed.delete(7);
            owed.delete(8);
            resident.set(path, 9);
            return true;
        });
        expect(await assets.reuploadTexturesAfterDeviceLoss()).toBe(1);
        expect(resident.get(path)).toBe(9);
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

    it('refills identical paths from their own loaders at their resident size with the authored sampler', async () => {
        const paths = new Map<number, string>();
        const images = new Map<number, { width: number; pixel: number; format: number }>();
        const owed = new Set<number>();
        let next = 0;
        const rm = {
            createTextureFromBytes: (width: number, _height: number, pixels: Uint8Array, format: number) => {
                images.set(++next, { width, pixel: pixels[0]!, format });
                return next;
            },
            registerTextureWithPath: (h: number, path: string) => paths.set(h, path),
            texturesAwaitingReupload: () => [...owed].map(h => `${h}|${TextureContent.Asset}|${paths.get(h)}`).join('\n'),
            adoptTextureContent: (h: number, fresh: number) => {
                images.set(h, images.get(fresh)!);
                owed.delete(h);
                return true;
            },
            releaseTexture: (h: number) => images.delete(h),
        };
        initResourceManager(rm as unknown as CppResourceManager);
        setLinearColorSpace(true);
        const file = 'tex/shared.png';
        const makeAssets = (edge: number, pixel: number, srgb: boolean) => {
            const assets = Assets.create({ backend: new HttpBackend({ baseUrl: '' }), module: null });
            assets.setAssetRefResolver(() => file);
            assets.setTextureImportSettingsResolver(ref => ref === 'authored' ? { srgb } : undefined);
            assets.noteMeshSurface({ texture: 'authored' });
            assets.setTextureStreamingStart(edge);
            assets.getTextureLoader().setPixelDecoder(async (_path, _flip, size) => ({
                width: size || 512, height: 1, pixels: new Uint8Array((size || 512) * 4).fill(pixel),
                sourceWidth: 512, sourceHeight: 1,
            }));
            return assets;
        };
        const a = makeAssets(64, 17, false), b = makeAssets(256, 31, true);
        try {
            const first = (await a.loadTexture('authored')).handle, second = (await b.loadTexture('authored')).handle;
            await a.resizeTexture(first, 128);
            const expected = [{ width: 128, pixel: 17, format: 1 }, { width: 256, pixel: 31, format: 2 }];
            expect([images.get(first), images.get(second)]).toEqual(expected);
            images.clear();
            owed.add(first); owed.add(second);
            expect(b.texturesAwaitingReupload().map(row => row.path)).toEqual([file + ':f', file + ':f']);
            expect(await b.reuploadTexturesAfterDeviceLoss()).toBe(2);
            expect([images.get(first), images.get(second)]).toEqual(expected);
            expect(owed.size).toBe(0);
            const old = textureRefill(first)!;
            a.releaseAll(); b.releaseAll();
            expect(textureRefill(first)).toBeUndefined();
            expect(textureRefill(second)).toBeUndefined();
            expect(await old()).toBe(false);
        } finally { a.releaseAll(); b.releaseAll(); setLinearColorSpace(false); }
    });
});
