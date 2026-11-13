// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    texture-recipe.test.ts
 * @brief   A texture that is a recipe: which paths are one, what draws them, and that what is drawn is the picture its source says.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { hasTextureRecipeRenderer, isTextureRecipePath, renderTextureRecipe, setTextureRecipeRenderer, textureRecipeCacheKey, textureRecipeStats } from '../src/asset/textureRecipe';
import { setPlatform } from '../src/platform/base';
import type { PlatformAdapter } from '../src/platform/types';
import { getAddressableType } from '../src/assetTypes';

afterEach(() => setTextureRecipeRenderer(null));

describe('a texture recipe', () => {
    it('is a path that ends in .esimage, whatever its case or its query', () => {
        expect(isTextureRecipePath('assets/wall.esimage')).toBe(true);
        expect(isTextureRecipePath('assets/Wall.ESIMAGE?v=3')).toBe(true);
        expect(isTextureRecipePath('assets/wall.png')).toBe(false);
        expect(isTextureRecipePath('assets/wall.esimage.png')).toBe(false);
    });

    it('is a texture to whatever asks what an asset is', () => {
        expect(getAddressableType('assets/wall.esimage')).toBe('texture');
    });

    it('is refused by name where nothing draws recipes, and says what to import', async () => {
        expect(hasTextureRecipeRenderer()).toBe(false);
        await expect(renderTextureRecipe('{}', 'assets/wall.esimage')).rejects.toThrow(/assets\/wall\.esimage.*esengine\/image/);
    });

    it('is drawn by the raster once esengine/image is imported: the pixels are the picture its source says', async () => {
        await import('../src/image/index');
        expect(hasTextureRecipeRenderer()).toBe(true);
        const source = JSON.stringify({ size: [8, 4], background: '#0000ff', layers: [{ shape: 'rect', at: [0, 0], size: [4, 4], fill: '#ff0000' }] });
        const drawn = await renderTextureRecipe(source, 'assets/flag.esimage');
        expect([drawn.width, drawn.height, drawn.pixels.length]).toEqual([8, 4, 8 * 4 * 4]);
        const at = (x: number, y: number): number[] => Array.from(drawn.pixels.subarray((y * 8 + x) * 4, (y * 8 + x) * 4 + 4));
        expect(at(1, 1)).toEqual([255, 0, 0, 255]);
        expect(at(6, 2)).toEqual([0, 0, 255, 255]);
    });

    it('refuses a source that is not a picture, and a picture that needs a body to pose', async () => {
        const { renderImage, validateImageSource } = await import('../src/image/index');
        setTextureRecipeRenderer((source) => { const p = renderImage(validateImageSource(JSON.parse(source))); return { width: p.width, height: p.height, pixels: p.rgba }; });
        await expect(renderTextureRecipe('{"size":8}', 'a.esimage')).rejects.toThrow();
        const figure = JSON.stringify({ size: 64, layers: [{ id: 'f', shape: 'figure', at: [32, 60], height: 50 }] });
        await expect(renderTextureRecipe(figure, 'a.esimage')).rejects.toThrow(/figure/);
    });
});

describe('a drawn recipe is kept', () => {
    /** A platform that is nothing but a content cache, and counts what is asked of it. */
    const cachePlatform = () => {
        const files = new Map<string, ArrayBuffer>();
        const asked = { reads: 0, writes: 0 };
        const adapter = {
            name: 'web',
            readCacheFile: async (key: string) => { asked.reads++; return files.get(key) ?? null; },
            writeCacheFile: async (key: string, bytes: ArrayBuffer) => { asked.writes++; files.set(key, bytes.slice(0)); },
        } as unknown as PlatformAdapter;
        return { adapter, files, asked };
    };
    const SOURCE = JSON.stringify({ size: [4, 2], background: '#00ff00', layers: [] });
    const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
    let drawn = 0;
    const install = (revision: string): void => setTextureRecipeRenderer(() => {
        drawn++;
        return { width: 4, height: 2, pixels: new Uint8Array(32).fill(7) };
    }, revision);

    it('is drawn once and read back after, by the same source and the same drawer', async () => {
        const { adapter, files, asked } = cachePlatform();
        setPlatform(adapter);
        textureRecipeStats(true);
        drawn = 0;
        install('r1');
        const first = await renderTextureRecipe(SOURCE, 'a.esimage');
        await settle();
        expect([drawn, asked.writes, files.size]).toEqual([1, 1, 1]);
        const second = await renderTextureRecipe(SOURCE, 'a.esimage');
        expect(drawn).toBe(1);
        expect([second.width, second.height]).toEqual([4, 2]);
        expect(Array.from(second.pixels)).toEqual(Array.from(first.pixels));
        expect(textureRecipeStats()).toMatchObject({ drawn: 1, reused: 1 });
    });

    it('is drawn again for another source, and for a drawer that draws differently', async () => {
        const { adapter } = cachePlatform();
        setPlatform(adapter);
        drawn = 0;
        install('r1');
        await renderTextureRecipe(SOURCE, 'a.esimage');
        await settle();
        await renderTextureRecipe(SOURCE.replace('#00ff00', '#00ff01'), 'a.esimage');
        expect(drawn).toBe(2);
        await settle();
        install('r2');
        await renderTextureRecipe(SOURCE, 'a.esimage');
        expect(drawn).toBe(3);
        expect(textureRecipeCacheKey(SOURCE, 'r1')).not.toBe(textureRecipeCacheKey(SOURCE, 'r2'));
    });

    it('is drawn again where what was kept is not the size it says, and where nothing is kept at all', async () => {
        const { adapter, files } = cachePlatform();
        setPlatform(adapter);
        drawn = 0;
        install('r1');
        await renderTextureRecipe(SOURCE, 'a.esimage');
        await settle();
        for (const key of files.keys()) files.set(key, files.get(key)!.slice(0, 20));
        await renderTextureRecipe(SOURCE, 'a.esimage');
        expect(drawn).toBe(2);
        // A platform with no cache: every run draws, and nothing is thrown for the want of one.
        setPlatform({ name: 'web' } as unknown as PlatformAdapter);
        await renderTextureRecipe(SOURCE, 'a.esimage');
        await renderTextureRecipe(SOURCE, 'a.esimage');
        expect(drawn).toBe(4);
    });
});
