// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/** Pictures laid out for an agent to look at: each one holds what it says, and the colours read are the colours there. */
import { describe, expect, it } from 'vitest';
import { activeArea, blendImages, colorsOf, cropImage, gridOf, outlineOver, resizeImage, sideBySide, toShape, type RgbaImage } from '../src/look/pictures';

type Shade = (x: number, y: number) => readonly [number, number, number];
function image(width: number, height: number, shade: Shade): RgbaImage {
    const rgba = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const c = shade(x / width, y / height);
            rgba.set([c[0], c[1], c[2], 255], (y * width + x) * 4);
        }
    }
    return { width, height, rgba };
}
const flat = (r: number, g: number, b: number, w = 64, h = 36): RgbaImage => image(w, h, () => [r, g, b]);
const at = (img: RgbaImage, x: number, y: number): number[] => Array.from(img.rgba.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 3));

describe('activeArea', () => {
    it('finds the picture inside black bars', () => {
        const barred = image(100, 200, (_, y) => (y < 0.4 || y >= 0.6 ? [0, 0, 0] : [120, 90, 60]));
        expect(activeArea(barred)).toEqual({ x: 0, y: 80, w: 100, h: 40 });
    });

    it('takes a picture with no bars whole', () => {
        expect(activeArea(flat(120, 90, 60, 50, 30))).toEqual({ x: 0, y: 0, w: 50, h: 30 });
    });

    it('does not mistake a night scene for bars', () => {
        expect(activeArea(flat(3, 3, 5, 50, 30))).toEqual({ x: 0, y: 0, w: 50, h: 30 });
    });
});

describe('colorsOf', () => {
    it('finds what colours a picture is made of, and in what share', () => {
        const two = image(100, 100, (x) => (x < 0.75 ? [200, 30, 30] : [30, 30, 200]));
        const { palette } = colorsOf(two);
        expect(palette[0]!.color).toBe('#c81e1e');
        expect(palette[0]!.share).toBeCloseTo(0.75, 1);
        expect(palette.some((p) => p.color === '#1e1ec8')).toBe(true);
    });

    it('reads what the shadows and highlights lean to', () => {
        const graded = image(100, 100, (x) => (x < 0.5 ? [10, 15, 50] : [250, 220, 170]));
        const c = colorsOf(graded);
        expect(c.shadows).toBe('#0a0f32');
        expect(c.highlights).toBe('#fadcaa');
    });

    it('gives the same answer every time', () => {
        const noisy = image(200, 120, (x, y) => [Math.floor(x * 255), Math.floor(y * 255), 90]);
        expect(colorsOf(noisy)).toEqual(colorsOf(noisy));
    });
});

describe('over one another', () => {
    it('blendImages is half of each, and fits the top one to the bottom one', () => {
        const b = blendImages(flat(200, 0, 100, 20, 10), flat(0, 100, 100, 40, 20));
        expect([b.width, b.height]).toEqual([20, 10]);
        expect(at(b, 5, 5)).toEqual([100, 50, 100]);
    });

    it('outlineOver draws the edge of the other picture, and nothing where it has none', () => {
        const under = flat(40, 40, 40, 100, 100);
        const halves = image(100, 100, (x) => (x < 0.5 ? [0, 0, 0] : [255, 255, 255]));
        const o = outlineOver(under, halves);
        expect(at(o, 50, 50)).toEqual([255, 225, 0]);
        expect(at(o, 20, 50)).toEqual([40, 40, 40]);
        expect(at(o, 80, 50)).toEqual([40, 40, 40]);
    });

    it('outlineOver of a blank picture leaves the one under it alone', () => {
        const under = flat(40, 90, 40, 50, 50);
        expect(Array.from(outlineOver(under, flat(120, 120, 120, 50, 50)).rgba)).toEqual(Array.from(under.rgba));
    });

    it('shows the same edge in the same place when the shapes line up, and elsewhere when they do not', () => {
        const figure = (cx: number): RgbaImage => image(120, 120, (x) => (Math.abs(x - cx) < 0.1 ? [230, 230, 230] : [20, 20, 20]));
        const onIt = outlineOver(figure(0.5), figure(0.5));
        const offIt = outlineOver(figure(0.2), figure(0.5));
        expect(at(onIt, 72, 60)).toEqual([255, 225, 0]);
        expect(at(offIt, 72, 60)).toEqual([255, 225, 0]);
        // The figure itself is where the outline is in one, and away from it in the other.
        expect(at(onIt, 60, 60)).toEqual([230, 230, 230]);
        expect(at(offIt, 60, 60)).toEqual([20, 20, 20]);
    });
});

describe('pictures', () => {
    it('cropImage takes the part asked for', () => {
        const c = cropImage(image(10, 10, (x) => (x >= 0.5 ? [255, 0, 0] : [0, 0, 255])), { x: 5, y: 2, w: 3, h: 4 });
        expect([c.width, c.height, c.rgba[0], c.rgba[2]]).toEqual([3, 4, 255, 0]);
    });

    it('resizeImage averages what falls in a pixel', () => {
        const r = resizeImage(image(2, 1, (x) => (x < 0.5 ? [0, 0, 0] : [200, 200, 200])), 1, 1);
        expect(r.rgba[0]).toBe(100);
    });

    it('toShape cuts rather than stretches', () => {
        const wide = image(320, 90, (x) => (x >= 0.25 && x < 0.75 ? [200, 200, 200] : [255, 0, 255]));
        const cut = toShape(wide, 160 / 90);
        expect([cut.width, cut.height]).toEqual([160, 90]);
        expect(at(cut, 0, 40)).toEqual([200, 200, 200]);
        expect(at(cut, 159, 40)).toEqual([200, 200, 200]);
    });

    it('sideBySide lays them out at one height', () => {
        const s = sideBySide([flat(255, 0, 0, 100, 50), flat(0, 255, 0, 100, 100)], 50);
        expect([s.width, s.height]).toEqual([100 + 4 + 50, 50]);
        expect(s.rgba[0]).toBe(255);
        expect(s.rgba[(10 * s.width + 120) * 4 + 1]).toBe(255);
    });

    it('gridOf does not stretch a picture of another shape: it sits whole in a cell the size most of them are', () => {
        const tall = image(10, 40, () => [255, 0, 0]);
        const g = gridOf([tall, flat(0, 255, 0, 40, 20), flat(0, 0, 255, 40, 20)], 3);
        expect([g.width, g.height]).toEqual([3 * 40 + 6, 20]);
        expect(at(g, 20, 10)).toEqual([255, 0, 0]);
        expect(at(g, 2, 10)).toEqual([110, 110, 110]);
    });

    it('gridOf lays out cells row by row', () => {
        const g = gridOf([flat(255, 0, 0, 10, 10), flat(0, 255, 0, 10, 10), flat(0, 0, 255, 10, 10)], 2);
        expect([g.width, g.height]).toEqual([23, 23]);
        expect(g.rgba[(15 * g.width + 2) * 4 + 2]).toBe(255);
    });
});
