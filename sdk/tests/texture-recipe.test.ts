// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    texture-recipe.test.ts
 * @brief   A texture that is a recipe: which paths are one, what draws them, and that what is drawn is the picture its source says.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { hasTextureRecipeRenderer, isTextureRecipePath, renderTextureRecipe, setTextureRecipeRenderer } from '../src/asset/textureRecipe';
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
