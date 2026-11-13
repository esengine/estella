// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    texture-recipe.test.ts
 * @brief   A texture that is a recipe: which paths are one, what draws them, what a recipe may need, and that what is drawn is kept.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
    hasTextureRecipeDrawer, isTextureRecipePath, renderTextureRecipe, setTextureRecipeDrawer, textureRecipeCacheKey, textureRecipeStats,
    type RecipeFileReader,
} from '../src/asset/textureRecipe';
import { Assets } from '../src/asset/AssetPlugin';
import type { App } from '../src/app/app';
import { setPlatform } from '../src/platform/base';
import type { PlatformAdapter } from '../src/platform/types';
import { getAddressableType } from '../src/assetTypes';
import { imagePixelsAt } from '../src/terrain/layerArrays';
import { encodeUtf8 } from '../src/util/utf8';

afterEach(() => setTextureRecipeDrawer(null));

/** A project that is a few files by path. */
const project = (files: Record<string, unknown>): RecipeFileReader => async (path) => {
    if (!(path in files)) throw new Error(`there is no file at ${path}`);
    const file = files[path];
    const bytes = file instanceof Uint8Array ? file : encodeUtf8(typeof file === 'string' ? file : JSON.stringify(file));
    return bytes.slice().buffer as ArrayBuffer;
};

const FLAG = { size: [8, 4], background: '#0000ff', layers: [{ shape: 'rect', at: [0, 0], size: [4, 4], fill: '#ff0000' }] };
const pixel = (drawn: { width: number; pixels: Uint8Array }, x: number, y: number): number[] => Array.from(drawn.pixels.subarray((y * drawn.width + x) * 4, (y * drawn.width + x) * 4 + 4));

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
        expect(hasTextureRecipeDrawer()).toBe(false);
        await expect(renderTextureRecipe('assets/wall.esimage', project({ 'assets/wall.esimage': FLAG }))).rejects.toThrow(/assets\/wall\.esimage.*esengine\/image/);
    });

    it('is drawn by the raster once esengine/image is imported: the pixels are the picture its source says', async () => {
        (await import('../src/image/index')).installTextureRecipes();
        expect(hasTextureRecipeDrawer()).toBe(true);
        const drawn = await renderTextureRecipe('assets/flag.esimage', project({ 'assets/flag.esimage': FLAG }));
        expect([drawn.width, drawn.height, drawn.pixels.length]).toEqual([8, 4, 8 * 4 * 4]);
        expect(pixel(drawn, 1, 1)).toEqual([255, 0, 0, 255]);
        expect(pixel(drawn, 6, 2)).toEqual([0, 0, 255, 255]);
    });

    it('refuses a source that is not a picture, by what is wrong with it', async () => {
        (await import('../src/image/index')).installTextureRecipes();
        await expect(renderTextureRecipe('a.esimage', project({ 'a.esimage': '{"size":8}' }))).rejects.toThrow();
        await expect(renderTextureRecipe('a.esimage', project({ 'a.esimage': { mapOf: 'b.esimage', map: 'height' } }))).rejects.toThrow(/normal, surface/);
        await expect(renderTextureRecipe('a.esimage', project({ 'a.esimage': { mapOf: 'b.png', map: 'normal' } }))).rejects.toThrow(/mapOf/);
    });
});

describe('what a recipe draws on the device', () => {
    const install = async (): Promise<typeof import('../src/image/index')> => {
        const image = await import('../src/image/index');
        // The entry installs its drawer once, on import, and every test here ends by taking it out.
        image.installTextureRecipes();
        return image;
    };

    it('a figure: the body a picture is drawn over is posed here as it is where it is authored', async () => {
        const { renderImage, validateImageSource } = await install();
        const source = { size: 64, background: '#ffffff', layers: [
            { id: 'f', shape: 'figure', at: [32, 60], height: 50 },
            { shape: 'rect', at: [0, 0], size: [64, 64], fill: '#ff0000', clip: 'f' },
        ] };
        const drawn = await renderTextureRecipe('a.esimage', project({ 'a.esimage': source }));
        const direct = renderImage(validateImageSource(source));
        expect(Array.from(drawn.pixels)).toEqual(Array.from(direct.rgba));
        // The red is clipped to the body: there is some of it, and the corner is still paper.
        let red = 0;
        for (let i = 0; i < drawn.pixels.length; i += 4) if (drawn.pixels[i]! > 200 && drawn.pixels[i + 1]! < 80) red++;
        expect(red).toBeGreaterThan(40);
        expect(pixel(drawn, 1, 1)).toEqual([255, 255, 255, 255]);
    });

    it('a picture laid in a picture, where the one laid in is a recipe too', async () => {
        await install();
        const outer = { size: [8, 4], background: '#000000', layers: [{ shape: 'image', src: 'assets/flag.esimage', at: [0, 0], guide: false }] };
        const drawn = await renderTextureRecipe('assets/outer.esimage', project({ 'assets/outer.esimage': outer, 'assets/flag.esimage': FLAG }));
        expect(pixel(drawn, 1, 1)).toEqual([255, 0, 0, 255]);
        expect(pixel(drawn, 6, 2)).toEqual([0, 0, 255, 255]);
        await expect(renderTextureRecipe('assets/outer.esimage', project({ 'assets/outer.esimage': outer }))).rejects.toThrow(/assets\/flag\.esimage/);
        const loop = { size: 4, layers: [{ shape: 'image', src: 'a.esimage', at: [0, 0] }] };
        await expect(renderTextureRecipe('a.esimage', project({ 'a.esimage': loop }))).rejects.toThrow(/needs itself/);
    });

    it('the surface maps of a picture, each a recipe of its own that names the picture', async () => {
        const { renderImage, renderMaterialMaps, validateImageSource } = await install();
        const wall = {
            size: 16, background: '#808080', layers: [{ shape: 'rect', at: [4, 4], size: [8, 8], fill: '#ffffff' }],
            material: { relief: 6, height: [{ shape: 'rect', at: [4, 4], size: [8, 8], fill: '#ffffff' }], roughness: [{ shape: 'rect', at: [0, 0], size: [16, 8], fill: '#ffffff' }] },
        };
        const files = { 'w.esimage': wall, 'w_normal.esimage': { mapOf: 'w.esimage', map: 'normal' }, 'w_surface.esimage': { mapOf: 'w.esimage', map: 'surface' } };
        const source = validateImageSource(wall);
        const maps = renderMaterialMaps(source, renderImage(source));
        const normal = await renderTextureRecipe('w_normal.esimage', project(files));
        expect(Array.from(normal.pixels)).toEqual(Array.from(maps.normal.rgba));
        // The block's left edge leans left: less red than a flat pixel's 128, which the middle of the block is.
        expect(pixel(normal, 4, 8)[0]).toBeLessThan(110);
        expect(pixel(normal, 8, 8).slice(0, 3)).toEqual([128, 128, 255]);
        const surface = await renderTextureRecipe('w_surface.esimage', project(files));
        expect(Array.from(surface.pixels)).toEqual(Array.from(maps.surface!.rgba));
        expect([pixel(surface, 2, 2)[1], pixel(surface, 2, 12)[1]]).toEqual([255, 0]);
    });

    it('one roughness and one metal everywhere is a surface map of one pixel', async () => {
        await install();
        const files = { 'p.esimage': { ...FLAG, material: { roughness: 0.4, metal: 1 } }, 's.esimage': { mapOf: 'p.esimage', map: 'surface' } };
        const surface = await renderTextureRecipe('s.esimage', project(files));
        expect([surface.width, surface.height, Array.from(surface.pixels)]).toEqual([1, 1, [255, 102, 255, 255]]);
    });

    /** A canvas that covers a square of 4 pixels where each character is set, and remembers the font it was set in. */
    const fakeCanvas = (seen: { fonts: string[] }) => (w: number, h: number) => {
        const alpha = new Uint8Array(w * h * 4);
        const ctx = {
            font: '', textBaseline: '', textAlign: '', lineWidth: 1, lineJoin: '',
            setTransform() {}, clearRect() { alpha.fill(0); }, measureText: () => ({ width: 6 }), strokeText() {},
            fillText(_t: string, x: number, y: number) {
                seen.fonts.push(ctx.font);
                for (let dy = -4; dy < 0; dy++) for (let dx = 0; dx < 4; dx++) alpha[((Math.round(y) + dy) * w + Math.round(x) + dx) * 4 + 3] = 255;
            },
            getImageData: () => ({ data: alpha }),
        };
        return { width: w, height: h, getContext: () => ctx };
    };

    it('text, set by the canvas the platform has, in a font file of the project where it names one', async () => {
        await install();
        const seen = { fonts: [] as string[] };
        const registered: [string, number][] = [];
        setPlatform({ name: 'web', createCanvas: fakeCanvas(seen), registerFont: async (family: string, bytes: ArrayBuffer) => { registered.push([family, bytes.byteLength]); } } as unknown as PlatformAdapter);
        const sign = { size: [32, 16], background: '#000000', layers: [{ shape: 'text', text: 'ab', at: [4, 12], fontSize: 8, font: 'assets/fonts/sign.ttf', fill: '#ffff00' }] };
        const drawn = await renderTextureRecipe('sign.esimage', project({ 'sign.esimage': sign, 'assets/fonts/sign.ttf': new Uint8Array(12) }));
        expect(pixel(drawn, 5, 10)).toEqual([255, 255, 0, 255]);
        expect(pixel(drawn, 11, 10)).toEqual([255, 255, 0, 255]);
        expect(pixel(drawn, 20, 10)).toEqual([0, 0, 0, 255]);
        expect(registered).toHaveLength(1);
        expect(registered[0]![1]).toBe(12);
        expect(seen.fonts[0]).toContain(`"${registered[0]![0]}"`);
    });

    it('text where the host has no canvas is refused by what to do about it', async () => {
        await install();
        setPlatform({ name: 'native', createCanvas: () => { throw new Error('no canvas'); } } as unknown as PlatformAdapter);
        const sign = { size: [32, 16], layers: [{ shape: 'text', text: 'a', at: [4, 12], fontSize: 8, fill: '#ffff00' }] };
        await expect(renderTextureRecipe('sign.esimage', project({ 'sign.esimage': sign }))).rejects.toThrow(/2D canvas.*bake/);
    });

    it('whatever reads an image as numbers reads a recipe as its pixels', async () => {
        await install();
        const read = project({ 'assets/flag.esimage': FLAG });
        const app = { hasResource: (r: unknown) => r === Assets, getResource: () => ({ fetchBinary: read }) } as unknown as App;
        const image = await imagePixelsAt(app, 'assets/flag.esimage');
        expect([image!.width, image!.height]).toEqual([8, 4]);
        expect(Array.from(image!.pixels.subarray(0, 4))).toEqual([255, 0, 0, 255]);
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
    const at = (source = SOURCE, more: Record<string, unknown> = {}): RecipeFileReader => project({ 'a.esimage': source, ...more });
    const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
    let drawn = 0;
    const install = (revision: string, needs: readonly string[] = []): void => setTextureRecipeDrawer({
        revision,
        needs: () => needs,
        draw: () => {
            drawn++;
            return { width: 4, height: 2, pixels: new Uint8Array(32).fill(7) };
        },
    });

    it('is drawn once and read back after, by the same source and the same drawer', async () => {
        const { adapter, files, asked } = cachePlatform();
        setPlatform(adapter);
        textureRecipeStats(true);
        drawn = 0;
        install('r1');
        const first = await renderTextureRecipe('a.esimage', at());
        await settle();
        expect([drawn, asked.writes, files.size]).toEqual([1, 1, 1]);
        const second = await renderTextureRecipe('a.esimage', at());
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
        await renderTextureRecipe('a.esimage', at());
        await settle();
        await renderTextureRecipe('a.esimage', at(SOURCE.replace('#00ff00', '#00ff01')));
        expect(drawn).toBe(2);
        await settle();
        install('r2');
        await renderTextureRecipe('a.esimage', at());
        expect(drawn).toBe(3);
        expect(textureRecipeCacheKey(SOURCE, new Map(), 'r1')).not.toBe(textureRecipeCacheKey(SOURCE, new Map(), 'r2'));
    });

    it('is drawn again when a file it was drawn from is another file, and not when it is the same', async () => {
        const { adapter } = cachePlatform();
        setPlatform(adapter);
        drawn = 0;
        install('r1', ['assets/photo.png']);
        await renderTextureRecipe('a.esimage', at(SOURCE, { 'assets/photo.png': new Uint8Array([1, 2, 3]) }));
        await settle();
        await renderTextureRecipe('a.esimage', at(SOURCE, { 'assets/photo.png': new Uint8Array([1, 2, 3]) }));
        expect(drawn).toBe(1);
        await renderTextureRecipe('a.esimage', at(SOURCE, { 'assets/photo.png': new Uint8Array([1, 2, 4]) }));
        expect(drawn).toBe(2);
    });

    it('is drawn again where what was kept is not the size it says, and where nothing is kept at all', async () => {
        const { adapter, files } = cachePlatform();
        setPlatform(adapter);
        drawn = 0;
        install('r1');
        await renderTextureRecipe('a.esimage', at());
        await settle();
        for (const key of files.keys()) files.set(key, files.get(key)!.slice(0, 20));
        await renderTextureRecipe('a.esimage', at());
        expect(drawn).toBe(2);
        // A platform with no cache: every run draws, and nothing is thrown for the want of one.
        setPlatform({ name: 'web' } as unknown as PlatformAdapter);
        await renderTextureRecipe('a.esimage', at());
        await renderTextureRecipe('a.esimage', at());
        expect(drawn).toBe(4);
    });
});
