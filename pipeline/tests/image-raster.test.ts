// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/** A picture from layers: each draws what it says and where, edges are antialiased, and what is wrong with a source is said before anything is drawn. */
import { describe, expect, it } from 'vitest';
import { imageCacheStats, imageSheet, parseColor, parsePath, pickColors, renderImage, setSheet, valuesImage, zoomImage } from '../src/image/imageRaster';
import { applyImageEdits, IMAGE_BRUSHES, strokeWidths, validateImageSource, type ImageLayer } from '../src/image/imageSource';

const draw = (layers: unknown[], size: number | [number, number] = 64, background?: string): ReturnType<typeof renderImage> => renderImage(validateImageSource({ size, layers, ...(background ? { background } : {}) }));
const px = (img: { width: number; rgba: Uint8Array }, x: number, y: number): number[] => Array.from(img.rgba.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));
const RED = '#ff0000', BLUE = '#0000ff';

describe('colours', () => {
    it('reads every length', () => {
        expect(parseColor('#f00')).toEqual([1, 0, 0, 1]);
        expect(parseColor('#ff000080')[3]).toBeCloseTo(0.5, 2);
        expect(parseColor('#0f08')[3]).toBeCloseTo(0.533, 2);
        expect(() => parseColor('red')).toThrow(/must be/);
    });
});

describe('shapes', () => {
    it('a rect fills what it says, and nothing else is touched', () => {
        const img = draw([{ shape: 'rect', at: [10, 20], size: [30, 10], fill: RED }]);
        expect(px(img, 20, 25)).toEqual([255, 0, 0, 255]);
        expect(px(img, 5, 25)[3]).toBe(0);
        expect(px(img, 45, 25)[3]).toBe(0);
        expect(px(img, 20, 35)[3]).toBe(0);
    });

    it('a round corner takes the corner off', () => {
        const img = draw([{ shape: 'rect', at: [10, 10], size: [40, 40], radius: 12, fill: RED }]);
        expect(px(img, 10, 10)[3]).toBe(0);
        expect(px(img, 30, 11)[3]).toBe(255);
        const corners = draw([{ shape: 'rect', at: [10, 10], size: [40, 40], radius: [12, 0, 0, 0], fill: RED }]);
        expect(px(corners, 10, 10)[3]).toBe(0);
        expect(px(corners, 49, 10)[3]).toBe(255);
    });

    it('edges are antialiased: a circle has pixels partly covered, in about the right amount', () => {
        const img = draw([{ shape: 'circle', at: [32, 32], radius: 20, fill: RED }]);
        let partial = 0, area = 0;
        for (let i = 0; i < 64 * 64; i++) {
            const a = img.rgba[i * 4 + 3]!;
            if (a > 0 && a < 255) partial++;
            area += a / 255;
        }
        expect(partial).toBeGreaterThan(40);
        expect(area).toBeCloseTo(Math.PI * 400, -1);
    });

    it('a half-covered pixel is half: a vertical edge through the middle of a column', () => {
        const img = draw([{ shape: 'rect', at: [10.5, 0], size: [20, 64], fill: RED }]);
        expect(px(img, 10, 30)[3]).toBeGreaterThan(120);
        expect(px(img, 10, 30)[3]).toBeLessThan(135);
    });

    it('a ring has a hole, a star its points, a gear its teeth', () => {
        const ring = draw([{ shape: 'ring', at: [32, 32], radius: 20, inner: 10, fill: RED }]);
        expect(px(ring, 32, 32)[3]).toBe(0);
        expect(px(ring, 32, 17)[3]).toBe(255);
        const star = draw([{ shape: 'star', at: [32, 32], radius: 28, inner: 10, count: 5, fill: RED }]);
        expect(px(star, 32, 8)[3]).toBe(255);
        expect(px(star, 50, 12)[3]).toBe(0);
        const gear = draw([{ shape: 'gear', at: [32, 32], radius: 28, inner: 20, count: 8, fill: RED }], 64);
        expect(px(gear, 32, 6)[3]).toBe(255);
        // Between two teeth, at the height of their tips.
        const a = (-90 + 22.5) * (Math.PI / 180);
        expect(px(gear, Math.round(32 + 26 * Math.cos(a)), Math.round(32 + 26 * Math.sin(a)))[3]).toBe(0);
    });

    it('a polygon is what its points say, and a line needs a stroke', () => {
        const tri = draw([{ shape: 'polygon', points: [[10, 10], [50, 10], [10, 50]], fill: RED }]);
        expect(px(tri, 15, 15)[3]).toBe(255);
        expect(px(tri, 45, 45)[3]).toBe(0);
        const line = draw([{ shape: 'line', points: [[10, 32], [50, 32]], stroke: { color: RED, width: 4 } }]);
        expect(px(line, 30, 32)[3]).toBe(255);
        expect(px(line, 30, 40)[3]).toBe(0);
    });
});

describe('paths', () => {
    it('reads its commands, absolute and relative', () => {
        expect(parsePath('M0 0 L10 0 L10 10 Z')[0]).toEqual({ points: [[0, 0], [10, 0], [10, 10]], closed: true });
        expect(parsePath('M1 1 l2 0 h3 v4')[0]!.points).toEqual([[1, 1], [3, 1], [6, 1], [6, 5]]);
    });

    it('a curve goes through its ends and bows toward its handles', () => {
        const pts = parsePath('M0 0 Q5 10 10 0')[0]!.points;
        expect(pts[0]).toEqual([0, 0]);
        expect(pts[pts.length - 1]).toEqual([10, 0]);
        expect(Math.max(...pts.map((p) => p[1]))).toBeCloseTo(5, 1);
        const cubic = parsePath('M0 0 C0 10 10 10 10 0 S20 -10 20 0')[0]!.points;
        expect(Math.min(...cubic.map((p) => p[1]))).toBeLessThan(-5);
        expect(cubic[cubic.length - 1]).toEqual([20, 0]);
    });

    it('has more than one run, and a hole winds the other way', () => {
        expect(parsePath('M0 0 L1 0 L1 1 Z M5 5 L6 5 L6 6 Z')).toHaveLength(2);
        const hole = draw([{ shape: 'path', d: 'M10 10 H54 V54 H10 Z M20 20 V44 H44 V20 Z', fill: RED }]);
        expect(px(hole, 32, 32)[3]).toBe(0);
        expect(px(hole, 15, 32)[3]).toBe(255);
    });

    it('says what it does not draw', () => {
        expect(() => parsePath('M0 0 A5 5 0 0 1 10 10')).toThrow(/M L H V C S Q T Z/);
        expect(() => parsePath('M0')).toThrow(/short of numbers/);
    });
});

describe('fills and strokes', () => {
    it('a linear gradient runs from one end to the other', () => {
        const img = draw([{ shape: 'rect', at: [0, 0], size: [64, 64], fill: { type: 'linear', from: [0, 0], to: [64, 0], stops: [[0, '#000000'], [1, '#ffffff']] } }]);
        expect(px(img, 1, 30)[0]).toBeLessThan(15);
        expect(px(img, 62, 30)[0]).toBeGreaterThan(240);
        expect(px(img, 32, 30)[0]).toBeGreaterThan(115);
        expect(px(img, 32, 30)[0]).toBeLessThan(140);
    });

    it('a radial gradient runs from its middle out, and a gradient turns with its layer', () => {
        const img = draw([{ shape: 'rect', at: [0, 0], size: [64, 64], fill: { type: 'radial', at: [32, 32], radius: 30, stops: [[0, '#ffffff'], [1, '#000000']] } }]);
        expect(px(img, 32, 32)[0]).toBeGreaterThan(245);
        expect(px(img, 2, 32)[0]).toBeLessThan(10);
        const turned = draw([{ shape: 'rect', at: [0, 0], size: [64, 64], transform: { rotate: 90, origin: [32, 32] }, fill: { type: 'linear', from: [0, 0], to: [64, 0], stops: [[0, '#000000'], [1, '#ffffff']] } }]);
        expect(px(turned, 32, 2)[0]).toBeLessThan(15);
        expect(px(turned, 32, 61)[0]).toBeGreaterThan(240);
    });

    it('a stroke goes round the edge, centred, inside or outside', () => {
        const at = { shape: 'rect', at: [20, 20], size: [24, 24], fill: RED };
        const center = draw([{ ...at, stroke: { color: BLUE, width: 4 } }]);
        expect(px(center, 19, 32)[2]).toBe(255);
        expect(px(center, 20, 32)[2]).toBe(255);
        const inside = draw([{ ...at, stroke: { color: BLUE, width: 4, align: 'inside' } }]);
        expect(px(inside, 18, 32)[3]).toBe(0);
        expect(px(inside, 21, 32)[2]).toBeGreaterThan(200);
        const outside = draw([{ ...at, stroke: { color: BLUE, width: 4, align: 'outside' } }]);
        expect(px(outside, 18, 32)[2]).toBeGreaterThan(200);
        expect(px(outside, 21, 32)).toEqual([255, 0, 0, 255]);
    });

    describe('joins and ends', () => {
        const box = (join?: 'round' | 'miter' | 'bevel'): ImageLayer => ({ shape: 'rect', at: [16, 16], size: [32, 32], stroke: { color: BLUE, width: 8, ...(join ? { join } : {}) } });

        it('rounds a corner unless told otherwise', () => {
            expect(px(draw([box()]), 12, 12)[3]).toBe(0);
            expect(px(draw([box('round')]), 12, 12)[3]).toBe(0);
        });

        it('keeps a corner square when mitred, and cuts it when bevelled', () => {
            expect(px(draw([box('miter')]), 12, 12)).toEqual([0, 0, 255, 255]);
            const cut = draw([box('bevel')]);
            expect(px(cut, 12, 12)[3]).toBe(0);
            expect(px(cut, 15, 15)[3]).toBe(255);
        });

        it('brings a thin tip to a point, sharper than the round one', () => {
            const tip = (join: 'round' | 'miter'): number => {
                const img = draw([{ shape: 'polygon', points: [[32, 30], [40, 60], [24, 60]], stroke: { color: BLUE, width: 4, join } }]);
                for (let y = 0; y < 64; y++) if (px(img, 32, y)[3]! > 128) return y;
                return 64;
            };
            expect(tip('round')).toBeGreaterThanOrEqual(27);
            expect(tip('miter')).toBeLessThanOrEqual(25);
        });

        it('does not throw a long spike off a needle', () => {
            const img = draw([{ shape: 'polygon', points: [[32, 40], [33, 60], [31, 60]], stroke: { color: BLUE, width: 4, join: 'miter' } }]);
            for (let y = 0; y < 30; y++) expect(px(img, 32, y)[3]).toBe(0);
        });

        it('leaves no notch where a straight line has points along it, or round a curve', () => {
            const many: [number, number][] = Array.from({ length: 41 }, (_, i) => [12 + i + 0.3, 32.5]);
            const line = draw([{ shape: 'line', points: many, stroke: { color: BLUE, width: 5, cap: 'butt', join: 'miter' } }]);
            for (let x = 14; x < 50; x++) expect(px(line, x, 32)).toEqual([0, 0, 255, 255]);
            const round = draw([{ shape: 'circle', at: [32, 32], radius: 20.3, stroke: { color: BLUE, width: 4 } }]);
            const mitred = draw([{ shape: 'circle', at: [32, 32], radius: 20.3, stroke: { color: BLUE, width: 4, join: 'miter' } }]);
            let worst = 0;
            for (let i = 3; i < round.rgba.length; i += 4) worst = Math.max(worst, Math.abs(round.rgba[i]! - mitred.rgba[i]!));
            expect(worst).toBeLessThan(64);
        });

        it('leaves no faint tail past a sharp point', () => {
            const img = draw([{ shape: 'polygon', points: [[32, 30], [36, 60], [28, 60]], stroke: { color: BLUE, width: 4, join: 'miter' } }]);
            // The outer point is half the width over the sine of half the angle above the corner.
            const tip = 30 - 2 / Math.sin(Math.atan(4 / 30));
            for (let y = 0; y < Math.floor(tip) - 1; y++) expect(px(img, 32, y)[3]).toBe(0);
            expect(px(img, 32, Math.ceil(tip) + 2)[3]).toBeGreaterThan(0);
        });

        it('ends a line as it is told', () => {
            const end = (cap: 'round' | 'butt' | 'square'): ReturnType<typeof draw> => draw([{ shape: 'line', points: [[20, 32], [44, 32]], stroke: { color: BLUE, width: 8, cap } }]);
            expect(px(end('butt'), 18, 32)[3]).toBe(0);
            expect(px(end('butt'), 21, 32)[3]).toBe(255);
            expect(px(end('square'), 16, 28)[3]).toBe(255);
            expect(px(end('round'), 16, 28)[3]).toBe(0);
            expect(px(end('round'), 17, 32)[3]).toBe(255);
        });

        it('joins where a closed path repeats its first point', () => {
            const img = draw([{ shape: 'path', d: 'M16 16 L48 16 L48 48 L16 48 L16 16 Z', stroke: { color: BLUE, width: 8, join: 'miter' } }]);
            expect(px(img, 12, 12)).toEqual([0, 0, 255, 255]);
        });

        it('keeps an outside stroke\'s corner sharp too', () => {
            const img = draw([{ shape: 'rect', at: [16, 16], size: [32, 32], fill: RED, stroke: { color: BLUE, width: 4, align: 'outside', join: 'miter' } }]);
            expect(px(img, 13, 13)).toEqual([0, 0, 255, 255]);
        });

        it('refuses what is not one', () => {
            const bad = (stroke: object): unknown => validateImageSource({ size: 8, layers: [{ shape: 'circle', at: [4, 4], radius: 2, stroke: { color: RED, width: 1, ...stroke } }] });
            expect(() => bad({ join: 'sharp' })).toThrow(/join must be round, miter or bevel/);
            expect(() => bad({ cap: 'flat' })).toThrow(/cap must be round, butt or square/);
        });
    });

    it('leaves no gap between a fill and its outside stroke, along a curve where edge pixels are partly each', () => {
        const img = draw([{ shape: 'circle', at: [32, 32], radius: 20.3, fill: RED, stroke: { color: BLUE, width: 4, align: 'outside' } }]);
        for (let i = 0; i < 128; i++) {
            const a = (i / 128) * Math.PI * 2;
            const [x, y] = [Math.floor(32 + 20.3 * Math.cos(a)), Math.floor(32 + 20.3 * Math.sin(a))];
            expect(px(img, x, y)[3]).toBeGreaterThan(250);
        }
    });

    it('does not show an outside stroke through a see-through fill', () => {
        const img = draw([{ shape: 'circle', at: [32, 32], radius: 20, fill: '#ff000040', stroke: { color: BLUE, width: 4, align: 'outside' } }]);
        expect(px(img, 32, 20)[2]).toBe(0);
    });
});

describe('layers', () => {
    it('later ones go over earlier ones', () => {
        const img = draw([{ shape: 'rect', at: [0, 0], size: [64, 64], fill: RED }, { shape: 'rect', at: [0, 0], size: [32, 64], fill: BLUE }]);
        expect(px(img, 10, 10)).toEqual([0, 0, 255, 255]);
        expect(px(img, 50, 10)).toEqual([255, 0, 0, 255]);
    });

    it('opacity lets what is behind through, and a colour\'s own alpha counts too', () => {
        const img = draw([{ shape: 'rect', at: [0, 0], size: [64, 64], fill: '#ffffff' }, { shape: 'rect', at: [0, 0], size: [64, 64], fill: '#000000', opacity: 0.5 }]);
        expect(px(img, 10, 10)[0]).toBeGreaterThan(120);
        expect(px(img, 10, 10)[0]).toBeLessThan(135);
        expect(px(img, 10, 10)[3]).toBe(255);
        const own = draw([{ shape: 'rect', at: [0, 0], size: [64, 64], fill: '#00000080' }]);
        expect(px(own, 10, 10)[3]).toBeCloseTo(128, -1);
    });

    it('blends: multiply darkens, screen and add lighten', () => {
        const base = { shape: 'rect', at: [0, 0], size: [64, 64], fill: '#808080' };
        const over = (blend: string): number => px(draw([base, { shape: 'rect', at: [0, 0], size: [64, 64], fill: '#808080', blend }]), 10, 10)[0]!;
        expect(over('multiply')).toBeLessThan(80);
        expect(over('screen')).toBeGreaterThan(180);
        expect(over('add')).toBe(255);
    });

    it('transforms: moved, turned about its middle, scaled', () => {
        const moved = draw([{ shape: 'rect', at: [0, 0], size: [10, 10], fill: RED, transform: { translate: [30, 30] } }]);
        expect(px(moved, 35, 35)[3]).toBe(255);
        expect(px(moved, 5, 5)[3]).toBe(0);
        const turned = draw([{ shape: 'rect', at: [12, 30], size: [40, 4], fill: RED, transform: { rotate: 90 } }]);
        expect(px(turned, 32, 15)[3]).toBe(255);
        expect(px(turned, 15, 32)[3]).toBe(0);
        const big = draw([{ shape: 'rect', at: [27, 27], size: [10, 10], fill: RED, transform: { scale: 2 } }]);
        expect(px(big, 24, 24)[3]).toBe(255);
    });

    it('mirror draws it again across the picture', () => {
        const img = draw([{ shape: 'rect', at: [4, 10], size: [8, 8], fill: RED, mirror: 'x' }]);
        expect(px(img, 8, 14)[3]).toBe(255);
        expect(px(img, 55, 14)[3]).toBe(255);
        expect(px(img, 32, 14)[3]).toBe(0);
        const down = draw([{ shape: 'rect', at: [4, 4], size: [8, 8], fill: RED, mirror: 'y' }]);
        expect(px(down, 8, 55)[3]).toBe(255);
    });

    it('clip keeps it within an earlier layer', () => {
        const img = draw([{ id: 'c', shape: 'circle', at: [32, 32], radius: 10, fill: BLUE }, { shape: 'rect', at: [0, 32], size: [64, 32], fill: RED, clip: 'c' }]);
        expect(px(img, 32, 38)).toEqual([255, 0, 0, 255]);
        expect(px(img, 32, 26)).toEqual([0, 0, 255, 255]);
        expect(px(img, 5, 50)[3]).toBe(0);
    });

    it('a clip stays inside the other layer\'s stroke, which still shows', () => {
        const img = draw([
            { id: 'glass', shape: 'circle', at: [32, 32], radius: 20, fill: '#ffffff', stroke: { color: BLUE, width: 4 } },
            { shape: 'rect', at: [0, 0], size: [64, 64], fill: RED, clip: 'glass' },
        ]);
        expect(px(img, 32, 32)).toEqual([255, 0, 0, 255]);
        // On the stroke, a little in from the edge of the fill: blue, not red.
        expect(px(img, 32, 13)[2]).toBe(255);
        expect(px(img, 32, 13)[0]).toBe(0);
    });

    it('a clip keeps to the fill when the stroke is outside it, and a stroke-only shape has an inside too', () => {
        const outside = draw([
            { id: 'glass', shape: 'circle', at: [32, 32], radius: 20, fill: '#ffffff', stroke: { color: BLUE, width: 4, align: 'outside' } },
            { shape: 'rect', at: [0, 0], size: [64, 64], fill: RED, clip: 'glass' },
        ]);
        expect(px(outside, 32, 14)).toEqual([255, 0, 0, 255]);
        expect(px(outside, 32, 10)[2]).toBe(255);
        const hollow = draw([
            { id: 'o', shape: 'circle', at: [32, 32], radius: 20, stroke: { color: BLUE, width: 4 } },
            { shape: 'rect', at: [0, 0], size: [64, 64], fill: RED, clip: 'o' },
        ]);
        expect(px(hollow, 32, 32)).toEqual([255, 0, 0, 255]);
    });

    it('a clip inside a clip stays inside both', () => {
        const img = draw([
            { id: 'left', shape: 'rect', at: [0, 0], size: [32, 64], fill: BLUE },
            { id: 'top', shape: 'rect', at: [0, 0], size: [64, 32], fill: BLUE, clip: 'left' },
            { shape: 'rect', at: [0, 0], size: [64, 64], fill: RED, clip: 'top' },
        ]);
        expect(px(img, 10, 10)).toEqual([255, 0, 0, 255]);
        expect(px(img, 50, 10)[0]).toBe(0);
        expect(px(img, 10, 50)[0]).toBe(0);
    });

    it('a line has no inside: what clips to it keeps to the line', () => {
        const img = draw([
            { id: 'l', shape: 'line', points: [[0, 32], [64, 32]], stroke: { color: BLUE, width: 6 } },
            { shape: 'rect', at: [0, 0], size: [64, 64], fill: RED, clip: 'l' },
        ]);
        expect(px(img, 32, 32)).toEqual([255, 0, 0, 255]);
        expect(px(img, 32, 10)[3]).toBe(0);
    });

    it('says when a clip names nothing, and when a layer draws nothing', () => {
        expect(draw([{ shape: 'rect', at: [0, 0], size: [10, 10], fill: RED, clip: 'gone' }]).notes.join()).toMatch(/clip "gone"/);
        expect(draw([{ shape: 'rect', at: [500, 500], size: [10, 10], fill: RED, id: 'away' }]).notes.join()).toMatch(/away draws nothing/);
    });

    it('erase cuts through what is there', () => {
        const img = draw([{ shape: 'rect', at: [0, 0], size: [64, 64], fill: RED }, { shape: 'circle', at: [32, 32], radius: 10, fill: '#000000', erase: true }]);
        expect(px(img, 32, 32)[3]).toBe(0);
        expect(px(img, 5, 5)[3]).toBe(255);
    });

    it('a group is one thing: its effect goes round the whole, its erase stays within it, and its transform carries its children', () => {
        const img = draw([
            { shape: 'rect', at: [0, 0], size: [64, 64], fill: BLUE },
            { shape: 'group', layers: [{ shape: 'rect', at: [10, 10], size: [40, 40], fill: RED }, { shape: 'circle', at: [30, 30], radius: 6, fill: '#000', erase: true }] },
        ]);
        expect(px(img, 30, 30)).toEqual([0, 0, 255, 255]);
        const half = draw([{ shape: 'group', opacity: 0.5, layers: [{ shape: 'rect', at: [0, 0], size: [64, 64], fill: RED }, { shape: 'rect', at: [0, 0], size: [64, 64], fill: BLUE }] }]);
        expect(px(half, 30, 30)[0]).toBe(0);
        expect(px(half, 30, 30)[3]).toBeCloseTo(128, -1);
        const moved = draw([{ shape: 'group', transform: { translate: [30, 0] }, layers: [{ shape: 'rect', at: [0, 0], size: [10, 10], fill: RED }] }]);
        expect(px(moved, 35, 5)[3]).toBe(255);
        expect(px(moved, 5, 5)[3]).toBe(0);
    });
});

describe('effects', () => {
    const square = { shape: 'rect', at: [24, 24], size: [16, 16], fill: '#ffffff' };

    it('a shadow falls where it is put, softly, and under the shape', () => {
        const img = draw([{ ...square, effects: [{ type: 'shadow', x: 6, y: 6, blur: 2, color: '#000000' }] }]);
        expect(px(img, 32, 32)).toEqual([255, 255, 255, 255]);
        expect(px(img, 42, 42)[3]).toBeGreaterThan(100);
        expect(px(img, 21, 21)[3]).toBeLessThan(30);
        // Soft: there is a fall from solid to nothing.
        const a = [41, 44, 47, 50].map((x) => px(img, x, 34)[3]!);
        expect(a[0]!).toBeGreaterThan(a[3]!);
        expect(a.some((v) => v > 0 && v < 255)).toBe(true);
    });

    it('a glow goes out all round', () => {
        const img = draw([{ ...square, effects: [{ type: 'glow', blur: 4, color: '#ff0000' }] }]);
        for (const [x, y] of [[20, 32], [44, 32], [32, 20], [32, 44]]) {
            expect(px(img, x!, y!)[3]).toBeGreaterThan(20);
            expect(px(img, x!, y!)[0]).toBe(255);
        }
    });

    it('an inner shadow stays inside, on the side it is put', () => {
        const img = draw([{ shape: 'rect', at: [16, 16], size: [32, 32], fill: '#ffffff', effects: [{ type: 'innerShadow', y: 6, blur: 2, color: '#000000' }] }]);
        expect(px(img, 32, 18)[0]).toBeLessThan(120);
        expect(px(img, 32, 45)[0]).toBeGreaterThan(220);
        expect(px(img, 32, 10)[3]).toBe(0);
    });

    it('an inner glow lightens the edge', () => {
        const img = draw([{ shape: 'rect', at: [16, 16], size: [32, 32], fill: '#404040', effects: [{ type: 'innerGlow', blur: 3, color: '#ffffff' }] }]);
        expect(px(img, 17, 32)[0]).toBeGreaterThan(px(img, 32, 32)[0]! + 40);
    });
});

describe('pixels', () => {
    const palette = { r: RED, b: BLUE };

    it('draws hard squares, as big as fit, in the middle', () => {
        const img = draw([{ shape: 'pixels', palette, rows: ['r.', '.b'] }], 8);
        expect(px(img, 0, 0)).toEqual([255, 0, 0, 255]);
        expect(px(img, 3, 3)).toEqual([255, 0, 0, 255]);
        expect(px(img, 4, 0)[3]).toBe(0);
        expect(px(img, 4, 4)).toEqual([0, 0, 255, 255]);
        // No pixel in it is partly anything.
        for (let i = 0; i < 64; i++) expect([0, 255]).toContain(img.rgba[i * 4 + 3]);
    });

    it('takes a scale and a place', () => {
        const img = draw([{ shape: 'pixels', palette, rows: ['r'], scale: 3, at: [10, 10] }], 32);
        expect(px(img, 12, 12)[3]).toBe(255);
        expect(px(img, 13, 12)[3]).toBe(0);
    });

    it('takes effects like any layer', () => {
        const img = draw([{ shape: 'pixels', palette, rows: ['r'], scale: 8, at: [12, 12], effects: [{ type: 'shadow', x: 4, y: 4, blur: 0, color: '#000000' }] }], 32);
        expect(px(img, 22, 22)).toEqual([0, 0, 0, 255]);
    });

    it('says what is wrong with its rows, which a slip would otherwise shift', () => {
        expect(() => draw([{ shape: 'pixels', palette, rows: ['rr', 'r'] }])).toThrow(/row 1 is 1 wide and row 0 is 2/);
        expect(() => draw([{ shape: 'pixels', palette, rows: ['x'] }])).toThrow(/"x", which is not in the palette/);
        expect(() => draw([{ shape: 'pixels', palette: { ab: RED }, rows: ['a'] }])).toThrow(/one character/);
    });
});

describe('a picture', () => {
    it('is the same every time', () => {
        const layers = [{ shape: 'star', at: [32, 32], radius: 28, inner: 12, count: 7, fill: { type: 'radial', at: [32, 32], radius: 28, stops: [[0, '#fff'], [1, '#f00']] }, stroke: { color: '#000', width: 2 }, effects: [{ type: 'glow', color: '#0ff' }, { type: 'innerShadow', y: 3 }] }];
        expect(draw(layers).rgba).toEqual(draw(layers).rgba);
    });

    it('has a background, or is transparent, and a shape of its own', () => {
        expect(px(draw([], 8, '#123456'), 2, 2)).toEqual([0x12, 0x34, 0x56, 255]);
        expect(px(draw([], 8), 2, 2)[3]).toBe(0);
        const wide = draw([], [16, 4]);
        expect([wide.width, wide.height]).toEqual([16, 4]);
    });

    it('a colour does not go dark at a soft edge', () => {
        const img = draw([{ shape: 'circle', at: [32, 32], radius: 10.3, fill: '#ff8040' }]);
        let seen = 0;
        for (let i = 0; i < 64 * 64; i++) {
            const a = img.rgba[i * 4 + 3]!;
            if (a > 8 && a < 247) { seen++; expect(img.rgba[i * 4]).toBe(255); expect(Math.abs(img.rgba[i * 4 + 1]! - 0x80)).toBeLessThan(5); }
        }
        expect(seen).toBeGreaterThan(10);
    });
});

describe('the sheet to look at', () => {
    const img = draw([{ shape: 'rect', at: [0, 0], size: [64, 64], fill: '#ff000080' }]);

    it('shows a dark outline and a pale one alike on its ground', () => {
        const pic = draw([{ shape: 'circle', at: [32, 32], radius: 20, stroke: { color: '#1b1f2e', width: 6 } }, { shape: 'circle', at: [32, 32], radius: 8, fill: '#ffffff' }]);
        const sheet = imageSheet(pic, []);
        const sample = (x: number, y: number): number => sheet.rgba[(y * sheet.width + x) * 4 + 1]!;
        // 64 x 6 = 384 across; the ground, the dark ring and the white middle, each well apart.
        const [ground, ring, middle] = [sample(8 + 30, 8 + 30), sample(8 + 192, 8 + 72), sample(8 + 192, 8 + 192)];
        expect(ground - ring).toBeGreaterThan(50);
        expect(middle - ground).toBeGreaterThan(50);
    });

    it('is opaque, with the picture over two grounds and at small sizes', () => {
        const sheet = imageSheet(img, [32, 16]);
        for (let i = 3; i < sheet.rgba.length; i += 4) expect(sheet.rgba[i]).toBe(255);
        expect(sheet.width).toBeGreaterThan(img.width * 2);
        const k = Math.floor(384 / 64);
        const onDark = Array.from(sheet.rgba.subarray((20 * sheet.width + 20) * 4, (20 * sheet.width + 20) * 4 + 3));
        const onLight = Array.from(sheet.rgba.subarray((20 * sheet.width + 8 * 2 + 64 * k + 20) * 4, (20 * sheet.width + 8 * 2 + 64 * k + 20) * 4 + 3));
        expect(onLight[1]!).toBeGreaterThan(onDark[1]! + 60);
    });

    it('enlarges a small picture without blurring it', () => {
        const pixel = draw([{ shape: 'pixels', palette: { r: RED }, rows: ['r.', '.r'] }], 2);
        const sheet = imageSheet(pixel, []);
        const edge = Array.from(sheet.rgba.subarray((10 * sheet.width + 8 + 100) * 4, (10 * sheet.width + 8 + 100) * 4 + 3));
        expect(edge).toEqual([255, 0, 0]);
    });
});

describe('blur', () => {
    const dot: ImageLayer = { shape: 'rect', at: [24, 24], size: [16, 16], fill: RED };

    it('softens an edge and keeps how much there is', () => {
        const [sharp, soft] = [draw([dot]), draw([{ ...dot, blur: 4 }])];
        expect(px(sharp, 18, 32)[3]).toBe(0);
        expect(px(soft, 18, 32)[3]).toBeGreaterThan(5);
        expect(px(soft, 32, 32)[3]).toBeLessThan(255);
        const total = (img: ReturnType<typeof draw>): number => { let s = 0; for (let i = 3; i < img.rgba.length; i += 4) s += img.rgba[i]!; return s; };
        expect(Math.abs(total(sharp) - total(soft)) / total(sharp)).toBeLessThan(0.02);
    });

    it('does not bring black in round the edge', () => {
        const soft = draw([{ ...dot, blur: 4 }]);
        for (let x = 14; x < 24; x++) if (px(soft, x, 32)[3]! > 2) expect(px(soft, x, 32)[0]).toBeGreaterThan(245);
    });

    it('stays solid to the edge of the picture when the layer fills it', () => {
        expect(px(draw([{ shape: 'rect', at: [0, 0], size: [64, 64], fill: RED, blur: 6 }]), 0, 0)).toEqual([255, 0, 0, 255]);
    });

    it('softens a group as one thing, with its effects, and leaves what is outside it sharp', () => {
        const img = draw([
            { shape: 'group', blur: 3, opacity: 0.5, layers: [dot, { shape: 'rect', at: [40, 24], size: [8, 16], fill: BLUE }] },
            { shape: 'rect', at: [0, 0], size: [4, 4], fill: BLUE },
        ]);
        expect(px(img, 2, 2)).toEqual([0, 0, 255, 255]);
        expect(px(img, 4, 2)[3]).toBe(0);
        // Where the two meet the colours mix, and nothing is over half there.
        expect(px(img, 40, 32)[0]).toBeGreaterThan(40);
        expect(px(img, 40, 32)[2]).toBeGreaterThan(40);
        expect(px(img, 32, 32)[3]).toBeLessThanOrEqual(128);
        const shadowed = draw([{ ...dot, blur: 2, effects: [{ type: 'shadow', x: 10, blur: 0, opacity: 1 }] }]);
        expect(px(shadowed, 45, 32)[3]).toBeGreaterThan(200);
    });

    it('scales with the group it is in, keeps its clip and its blend', () => {
        const at = (scale: number): number => px(draw([{ shape: 'group', transform: { scale, origin: [32, 32] }, layers: [{ shape: 'rect', at: [24, 24], size: [16, 16], fill: RED, blur: 2 }] }]), 32 - Math.round(8 * scale) - 2 * scale, 32)[3]!;
        expect(Math.abs(at(1) - at(2))).toBeLessThan(40);
        const clipped = draw([{ id: 'c', shape: 'rect', at: [0, 0], size: [32, 64], fill: BLUE }, { ...dot, blur: 4, clip: 'c' }]);
        expect(px(clipped, 40, 32)[0]).toBe(0);
        const screened = draw([{ shape: 'rect', at: [0, 0], size: [64, 64], fill: '#808080' }, { shape: 'rect', at: [0, 0], size: [64, 64], fill: '#808080', blur: 2, blend: 'screen' }]);
        expect(px(screened, 32, 32)[0]).toBeGreaterThan(180);
    });

    it('lets a shape clip softly to it', () => {
        const img = draw([{ id: 's', shape: 'rect', at: [24, 24], size: [16, 16], fill: '#ffffff', blur: 4, opacity: 0 }, { shape: 'rect', at: [0, 0], size: [64, 64], fill: RED, clip: 's' }]);
        expect(px(img, 32, 32)[3]).toBeGreaterThan(px(img, 22, 32)[3]!);
        expect(px(img, 22, 32)[3]).toBeGreaterThan(0);
    });

    it('refuses what it cannot do', () => {
        const bad = (fields: object): unknown => validateImageSource({ size: 8, layers: [{ shape: 'circle', at: [4, 4], radius: 2, fill: RED, ...fields }] });
        expect(() => bad({ blur: -1 })).toThrow(/blur must be 0 or more/);
        expect(() => bad({ blur: 2, erase: true })).toThrow(/does not go with erase/);
    });
});

describe('noise', () => {
    const grey = (fields: object = {}): ImageLayer => ({ shape: 'rect', at: [0, 0], size: [64, 64], fill: { type: 'noise', stops: [[0, '#000000'], [1, '#ffffff']], ...fields } as never });
    const reds = (img: ReturnType<typeof draw>): number[] => Array.from({ length: 64 * 64 }, (_, i) => img.rgba[i * 4]!);

    it('is the same from the same seed, and differs from another', () => {
        expect(draw([grey({ seed: 5 })]).rgba).toEqual(draw([grey({ seed: 5 })]).rgba);
        expect(draw([grey({ seed: 5 })]).rgba).not.toEqual(draw([grey({ seed: 6 })]).rgba);
    });

    it('holds a value pinned here, so the picture cannot change between machines or versions unnoticed', () => {
        const img = draw([grey({ seed: 1 })]);
        let sum = 0;
        for (const v of reds(img)) sum = (Math.imul(sum, 31) + v) | 0;
        expect(sum).toBe(NOISE_PIN);
    });

    it('spends the whole range of its stops, about the middle', () => {
        for (const octaves of [1, 2, 4, 8]) {
            const v = reds(draw([grey({ octaves, scale: 8 })]));
            const mean = v.reduce((a, b) => a + b, 0) / v.length;
            expect(mean).toBeGreaterThan(90);
            expect(mean).toBeLessThan(165);
            expect(Math.max(...v) - Math.min(...v)).toBeGreaterThan(150);
        }
    });

    it('shows no boxes of its lattice in a large soft cloud', () => {
        // Along the lattice's own axis and across it the change is alike; value noise changes less along an axis.
        const img = draw([{ shape: 'rect', at: [0, 0], size: [256, 256], fill: { type: 'noise', scale: 40, octaves: 1, stops: [[0, '#000000'], [1, '#ffffff']] } }], [256, 256]);
        const change = (dx: number, dy: number): number => {
            let t = 0;
            for (let y = 8; y < 240; y++) for (let x = 8; x < 240; x++) t += Math.abs(px(img, x, y)[0]! - px(img, x + dx, y + dy)[0]!);
            return t;
        };
        const [along, diagonal] = [change(4, 0), change(3, 3)];
        expect(Math.abs(along - diagonal) / along).toBeLessThan(0.1);
    });

    it('has blobs of the size it is told', () => {
        const stepAlong = (scale: number): number => {
            const img = draw([grey({ scale, octaves: 1 })]);
            let total = 0;
            for (let x = 0; x < 63; x++) total += Math.abs(px(img, x, 20)[0]! - px(img, x + 1, 20)[0]!);
            return total;
        };
        expect(stepAlong(4)).toBeGreaterThan(stepAlong(32) * 3);
    });

    it('gives a different value to each pixel at size 1, for grain', () => {
        const img = draw([grey({ scale: 1, octaves: 1 })]);
        let moved = 0;
        for (let x = 0; x < 63; x++) if (Math.abs(px(img, x, 20)[0]! - px(img, x + 1, 20)[0]!) > 10) moved++;
        expect(moved).toBeGreaterThan(40);
    });

    it('fades through clear stops, and is cut by the shape', () => {
        const img = draw([{ shape: 'circle', at: [32, 32], radius: 16, fill: { type: 'noise', scale: 8, stops: [[0, '#ffffff00'], [1, '#ffffffff']] } }]);
        const alphas = new Set<number>();
        for (let x = 20; x < 44; x++) alphas.add(px(img, x, 32)[3]!);
        expect(alphas.size).toBeGreaterThan(5);
        expect(px(img, 2, 2)[3]).toBe(0);
    });

    it('stretches with the transform', () => {
        const img = draw([{ shape: 'rect', at: [-200, -200], size: [500, 500], transform: { scale: [8, 1], origin: [0, 0] }, fill: { type: 'noise', scale: 4, octaves: 1, stops: [[0, '#000000'], [1, '#ffffff']] } }]);
        const change = (dx: number, dy: number): number => {
            let t = 0;
            for (let i = 0; i < 50; i++) t += Math.abs(px(img, 5 + i * dx, 5 + i * dy)[0]! - px(img, 5 + (i + 1) * dx, 5 + (i + 1) * dy)[0]!);
            return t;
        };
        expect(change(0, 1)).toBeGreaterThan(change(1, 0) * 3);
    });

    it('works for a stroke, and refuses what is not one', () => {
        expect(px(draw([{ shape: 'line', points: [[0, 32], [64, 32]], stroke: { color: { type: 'noise', scale: 8, stops: [[0, '#ff0000'], [1, '#ff0000']] } as never, width: 4 } }]), 32, 32)).toEqual([255, 0, 0, 255]);
        const bad = (fill: object): unknown => validateImageSource({ size: 8, layers: [{ shape: 'rect', at: [0, 0], size: [8, 8], fill: { type: 'noise', stops: [[0, '#000'], [1, '#fff']], ...fill } }] });
        expect(() => bad({ scale: 0 })).toThrow(/scale must be a positive/);
        expect(() => bad({ octaves: 9 })).toThrow(/octaves must be/);
        expect(() => bad({ seed: 1.5 })).toThrow(/seed must be/);
        expect(() => validateImageSource({ size: 8, layers: [{ shape: 'rect', at: [0, 0], size: [8, 8], fill: { type: 'wavy', stops: [] } }] })).toThrow(/linear, radial, noise, form, image or grid/);
    });
});

describe('brushes', () => {
    const paint = (strokes: object[], extra: object = {}): ImageLayer => ({ id: 'p', shape: 'paint', strokes, ...extra } as never);
    const across = (fields: object = {}): object => ({ points: [[8, 32], [56, 32]], color: RED, size: 8, hardness: 1, ...fields });

    it('lays a line of its size between its points, and a dab at one', () => {
        const img = draw([paint([across()])]);
        expect(px(img, 32, 32)).toEqual([255, 0, 0, 255]);
        expect(px(img, 32, 20)[3]).toBe(0);
        const dab = draw([paint([{ points: [[32, 32]], color: BLUE, size: 10, hardness: 1 }])]);
        expect(px(dab, 32, 32)).toEqual([0, 0, 255, 255]);
        expect(px(dab, 32, 45)[3]).toBe(0);
    });

    it('draws a dab whatever its taper, as it has no length to taper along', () => {
        const dab = draw([paint([{ points: [[32, 32]], color: BLUE, size: 10, hardness: 1, taper: [0.1, 0.25] }])]);
        expect(px(dab, 32, 32)).toEqual([0, 0, 255, 255]);
    });

    it('passes through each point of a curve', () => {
        const img = draw([paint([{ points: [[8, 50], [32, 12], [56, 50]], color: RED, size: 6, hardness: 1 }])]);
        expect(px(img, 32, 12)[3]).toBe(255);
        expect(px(img, 32, 40)[3]).toBe(0);
    });

    it('does not build into beads: opacity is the stroke\'s, however it overlaps itself', () => {
        const img = draw([paint([across({ opacity: 0.5, points: [[8, 32], [56, 32], [8, 32]] })])]);
        const values = new Set<number>();
        for (let x = 14; x < 50; x++) values.add(px(img, x, 32)[3]!);
        expect(values.size).toBeLessThanOrEqual(2);
        expect(px(img, 32, 32)[3]).toBeGreaterThan(120);
        expect(px(img, 32, 32)[3]).toBeLessThan(135);
    });

    it('leaves no ripple of its stamps along a large soft stroke', () => {
        const img = draw([paint([{ points: [[-40, 90], [300, 90]], color: '#ffffff', size: 120, hardness: 0 }])], [256, 256]);
        for (const y of [90, 110, 130]) {
            const values: number[] = [];
            for (let x = 40; x < 216; x++) values.push(px(img, x, y)[3]!);
            expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(3);
        }
    });

    it('is softer the lower its hardness', () => {
        const edge = (hardness: number): number => px(draw([paint([across({ size: 24, hardness })])]), 32, 24)[3]!;
        expect(edge(1)).toBe(255);
        expect(edge(0)).toBeLessThan(200);
    });

    it('narrows to a point where it tapers, and with pressure', () => {
        const img = draw([paint([across({ size: 16, taper: [0, 0.6] })])]);
        const width = (x: number): number => { let n = 0; for (let y = 16; y < 48; y++) if (px(img, x, y)[3]! > 128) n++; return n; };
        expect(width(16)).toBeGreaterThan(width(50));
        expect(width(50)).toBeLessThan(6);
        const pressed = draw([paint([{ points: [[8, 32, 1], [56, 32, 0.1]], color: RED, size: 16, hardness: 1 }])]);
        expect(px(pressed, 12, 26)[3]).toBe(255);
        expect(px(pressed, 52, 26)[3]).toBe(0);
    });

    it('turns from one colour to the next', () => {
        const img = draw([paint([across({ to: BLUE })])]);
        expect(px(img, 12, 32)[0]).toBeGreaterThan(px(img, 12, 32)[2]!);
        expect(px(img, 52, 32)[2]).toBeGreaterThan(px(img, 52, 32)[0]!);
    });

    it('with bristles leaves separate hairs that meet where it narrows', () => {
        const hairs = draw([paint([across({ size: 40, bristles: 8, strand: 1, vary: 0, taper: [0, 0.3], seed: 2 })])], [64, 64]);
        let runs = 0, inside = false;
        for (let y = 8; y < 56; y++) {
            const on = px(hairs, 16, y)[3]! > 100;
            if (on && !inside) runs++;
            inside = on;
        }
        expect(runs).toBeGreaterThan(3);
        let far = 0;
        for (let y = 0; y < 64; y++) if (px(hairs, 50, y)[3]! > 60 && Math.abs(y - 32) > 12) far++;
        expect(far).toBe(0);
    });

    it('is the same from the same list, and bristles differ by seed', () => {
        const s = across({ size: 30, bristles: 12, vary: 0.3, wobble: 2, seed: 4 });
        expect(draw([paint([s])]).rgba).toEqual(draw([paint([s])]).rgba);
        expect(draw([paint([s])]).rgba).not.toEqual(draw([paint([{ ...s, seed: 5 }])]).rgba);
    });

    it('smudges what is on the layer along, and lays no colour of its own', () => {
        const base = { points: [[20, 10], [20, 54]], color: RED, size: 20, hardness: 1 };
        const before = draw([paint([base])]);
        const after = draw([paint([base, { points: [[20, 32], [56, 32]], size: 10, smudge: 0.9 }])]);
        expect(px(before, 40, 32)[3]).toBe(0);
        expect(px(after, 40, 32)[3]).toBeGreaterThan(20);
        expect(px(after, 40, 32)[0]).toBeGreaterThan(200);
    });

    it('rubs out, and paints by blend', () => {
        const rubbed = draw([paint([across({ size: 20 }), { points: [[32, 10], [32, 54]], size: 8, hardness: 1, erase: true }])]);
        expect(px(rubbed, 32, 32)[3]).toBe(0);
        expect(px(rubbed, 16, 32)[3]).toBe(255);
        const shaded = draw([paint([across({ size: 20 }), across({ color: '#808080', size: 6, blend: 'multiply' })])]);
        expect(px(shaded, 32, 32)[0]).toBeGreaterThan(110);
        expect(px(shaded, 32, 32)[0]).toBeLessThan(140);
    });

    it('starts from a fill, follows the transform, the clip and the layer\'s opacity, and is measured', () => {
        const filled = draw([paint([], { fill: BLUE })]);
        expect(px(filled, 3, 3)).toEqual([0, 0, 255, 255]);
        const moved = draw([paint([across()], { transform: { translate: [0, 20], origin: [0, 0] } })]);
        expect(px(moved, 32, 52)[3]).toBe(255);
        expect(moved.layerBounds.p![1]).toBeGreaterThanOrEqual(46);
        const clipped = draw([{ id: 'c', shape: 'rect', at: [0, 0], size: [32, 64], fill: BLUE }, paint([across()], { clip: 'c', opacity: 0.5 })]);
        expect(px(clipped, 40, 32)[0]).toBe(0);
        expect(px(clipped, 20, 32)[0]).toBeGreaterThan(110);
    });

    it('takes more strokes without restating the rest, and drops the last few', () => {
        const start = validateImageSource({ size: 64, layers: [paint([across()])] });
        const more = applyImageEdits(start, [{ op: 'paint', layer: 'p', strokes: [across({ color: BLUE }) as never] }]);
        expect(more.layers[0]!.strokes!.length).toBe(2);
        expect(applyImageEdits(more, [{ op: 'paint', layer: 'p', drop: 1 }]).layers[0]!.strokes!.length).toBe(1);
        expect(() => applyImageEdits(more, [{ op: 'paint', layer: 'p', drop: 3 }])).toThrow(/has 2 strokes/);
        expect(() => applyImageEdits(more, [{ op: 'paint', layer: 'p', strokes: [{ size: 3 } as never] }])).toThrow(/stroke 2 needs points/);
        const notPaint = validateImageSource({ size: 8, layers: [{ id: 'r', shape: 'rect', at: [0, 0], size: [2, 2], fill: RED }] });
        expect(() => applyImageEdits(notPaint, [{ op: 'paint', layer: 'r', strokes: [] }])).toThrow(/not paint/);
    });

    it('says which stroke is wrong, and how', () => {
        const bad = (s: object): unknown => validateImageSource({ size: 8, layers: [{ id: 'p', shape: 'paint', strokes: [{ points: [[1, 1]], size: 2, color: RED, ...s }] }] });
        expect(() => bad({ points: [] })).toThrow(/layer 0 "p".*stroke 0 needs points/);
        expect(() => bad({ size: 0 })).toThrow(/positive size/);
        expect(() => bad({ color: undefined })).toThrow(/needs a color/);
        expect(() => bad({ color: undefined, smudge: 0.5 })).not.toThrow();
        expect(() => bad({ bristles: 300 })).toThrow(/bristles must be/);
        expect(() => bad({ taper: [0, 2] })).toThrow(/taper must be/);
        expect(() => bad({ blur: 2 })).toThrow(/unknown field "blur"/);
    });
});

describe('marks that are many strokes', () => {
    const paint = (strokes: object[]): ImageLayer => ({ id: 'p', shape: 'paint', strokes } as never);
    const pair = [[[10, 10], [10, 110]], [[60, 10], [60, 110]]];
    const sweep = (fields: object = {}): object => ({ type: 'sweep', guides: pair, colors: [RED], count: 200, flyaway: 0, wobble: 0, seed: 3, ...fields });

    it('a sweep stays between its guides, and covers them', () => {
        const img = draw([paint([sweep({ gather: 0 })])], [128, 128]);
        expect(px(img, 35, 40)[3]).toBeGreaterThan(100);
        expect(px(img, 2, 40)[3]).toBe(0);
        expect(px(img, 70, 40)[3]).toBe(0);
        expect(px(img, 35, 124)[3]).toBe(0);
    });

    it('a sweep is as dense as its count', () => {
        const coverage = (count: number): number => { const img = draw([paint([sweep({ count, gather: 0 })])], [128, 128]); let n = 0; for (let x = 8; x < 62; x++) if (px(img, x, 40)[3]! > 60) n++; return n; };
        expect(coverage(300)).toBeGreaterThan(coverage(10) * 2);
    });

    it('gathers its hairs into locks toward the tips, and leaves them even without', () => {
        const gaps = (gather: number): number => {
            const img = draw([paint([sweep({ gather, clumps: 4, count: 300, size: 1.2, taper: [0, 0] })])], [128, 128]);
            let g = 0;
            for (let x = 12; x < 58; x++) if (px(img, x, 92)[3]! < 30) g++;
            return g;
        };
        expect(gaps(1)).toBeGreaterThan(gaps(0) + 6);
    });

    it('sends strays out past the mass only when asked', () => {
        const outside = (flyaway: number): number => {
            const img = draw([paint([sweep({ flyaway, gather: 0 })])], [128, 128]);
            let n = 0;
            for (let y = 60; y < 112; y++) for (let x = 0; x < 128; x++) if ((x < 6 || x > 66) && px(img, x, y)[3]! > 20) n++;
            return n;
        };
        expect(outside(0)).toBe(0);
        expect(outside(0.3)).toBeGreaterThan(10);
    });

    it('takes its colours across the guides, and turns to the tip colour', () => {
        const img = draw([paint([sweep({ colors: [RED, BLUE], gather: 0, vary: 0 })])], [128, 128]);
        expect(px(img, 14, 40)[0]).toBeGreaterThan(px(img, 14, 40)[2]!);
        expect(px(img, 56, 40)[2]).toBeGreaterThan(px(img, 56, 40)[0]!);
        const tipped = draw([paint([sweep({ tip: BLUE, gather: 0, vary: 0 })])], [128, 128]);
        expect(px(tipped, 35, 16)[0]).toBeGreaterThan(px(tipped, 35, 16)[2]!);
        expect(px(tipped, 35, 85)[2]).toBeGreaterThan(px(tipped, 35, 16)[2]!);
    });

    const region = 'M20 20 L100 20 L100 100 L20 100 Z';
    const field = (fields: object = {}): object => ({ type: 'field', region, tone: RED, size: 6, length: 12, angle: 0, spread: 0, seed: 2, ...fields });

    it('a field covers its region, and only runs a stroke\'s length past it', () => {
        const img = draw([paint([field()])], [128, 128]);
        let covered = 0;
        for (let y = 24; y < 96; y += 4) for (let x = 24; x < 96; x += 4) if (px(img, x, y)[3]! > 128) covered++;
        expect(covered).toBeGreaterThan(18 * 18 * 0.9);
        expect(px(img, 4, 60)[3]).toBe(0);
        expect(px(img, 60, 4)[3]).toBe(0);
    });

    it('a field runs along its flow: a line changes less along it than across it', () => {
        const stripes = (fields: object): { along: number; across: number } => {
            const img = draw([paint([field({ region: undefined, tone: { type: 'noise', scale: 1, octaves: 1, stops: [[0, '#000000'], [1, '#ffffff']] }, size: 3, length: 40, coverage: 3, ...fields })])], [128, 128]);
            let [along, across] = [0, 0];
            for (let i = 8; i < 118; i++) {
                along += Math.abs(px(img, i, 64)[0]! - px(img, i + 1, 64)[0]!);
                across += Math.abs(px(img, 64, i)[0]! - px(img, 64, i + 1)[0]!);
            }
            return { along, across };
        };
        const flat = stripes({ angle: 0 });
        expect(flat.across).toBeGreaterThan(flat.along * 1.5);
        const down = stripes({ angle: undefined, guides: [[[64, 0], [64, 128]]] });
        expect(down.along).toBeGreaterThan(down.across * 1.5);
    });

    it('a field takes each stroke\'s colour from its tone', () => {
        const img = draw([paint([field({ region: undefined, tone: { type: 'linear', from: [0, 0], to: [128, 0], stops: [[0, RED], [1, BLUE]] }, vary: 0 })])], [128, 128]);
        expect(px(img, 12, 64)[0]).toBeGreaterThan(px(img, 12, 64)[2]!);
        expect(px(img, 116, 64)[2]).toBeGreaterThan(px(img, 116, 64)[0]!);
    });

    it('is the same from the same seed, and another from another', () => {
        expect(draw([paint([field()])]).rgba).toEqual(draw([paint([field()])]).rgba);
        expect(draw([paint([sweep({ flyaway: 0.1 })])]).rgba).toEqual(draw([paint([sweep({ flyaway: 0.1 })])]).rgba);
        expect(draw([paint([sweep({ seed: 8, gather: 0.8 })])]).rgba).not.toEqual(draw([paint([sweep({ seed: 9, gather: 0.8 })])]).rgba);
    });

    it('says what is wrong with one', () => {
        const bad = (mark: object): unknown => validateImageSource({ size: 8, layers: [{ id: 'p', shape: 'paint', strokes: [mark] }] });
        expect(() => bad({ type: 'wash' })).toThrow(/stroke 0 has type "wash"; there are sweep, field and along/);
        expect(() => bad({ type: 'sweep', guides: [[[0, 0], [1, 1]]], colors: [RED], count: 3 })).toThrow(/two or more lines/);
        expect(() => bad(sweep({ colors: [] }))).toThrow(/needs colors/);
        expect(() => bad(sweep({ count: 0 }))).toThrow(/count must be/);
        expect(() => bad(sweep({ gather: 2 }))).toThrow(/gather must be 0..1/);
        expect(() => bad(sweep({ nope: 1 }))).toThrow(/unknown field "nope"/);
        expect(() => bad(field({ region: 'M0 0 A1 1 0 0 1 2 2' }))).toThrow(/region: path command A/);
        expect(() => bad(field({ tone: 'red' }))).toThrow(/tone/);
        expect(() => bad(field({ size: undefined }))).toThrow(/needs a positive size/);
    });
});

describe('working across the picture', () => {
    const halves: ImageLayer[] = [{ id: 'l', shape: 'rect', at: [0, 0], size: [32, 64], fill: RED }, { id: 'r', shape: 'rect', at: [32, 0], size: [32, 64], fill: BLUE }];
    const smear = { points: [[8, 32], [56, 32]], size: 12, smudge: 0.9 };

    it('a layer that starts from below drags colour from one layer across another', () => {
        const img = draw([...halves, { shape: 'paint', from: 'below', strokes: [smear] } as never]);
        expect(px(img, 42, 32)[0]).toBeGreaterThan(40);
        expect(px(img, 42, 4)).toEqual([0, 0, 255, 255]);
    });

    it('without it a smudge sees only its own layer', () => {
        const img = draw([...halves, { shape: 'paint', strokes: [smear] } as never]);
        expect(px(img, 42, 32)).toEqual([0, 0, 255, 255]);
    });

    it('leaves the picture exactly as it was until it does something', () => {
        const under = draw(halves);
        const same = draw([...halves, { shape: 'paint', from: 'below', strokes: [] } as never]);
        let worst = 0;
        for (let i = 0; i < under.rgba.length; i++) worst = Math.max(worst, Math.abs(under.rgba[i]! - same.rgba[i]!));
        expect(worst).toBeLessThanOrEqual(1);
    });

    it('does not thicken what is see-through, and keeps to its clip and opacity', () => {
        const clear = draw([{ shape: 'rect', at: [0, 0], size: [64, 64], fill: '#ff000080' }, { shape: 'paint', from: 'below', strokes: [] } as never]);
        expect(Math.abs(px(clear, 32, 32)[3]! - 128)).toBeLessThanOrEqual(1);
        const clipped = draw([...halves, { id: 'c', shape: 'rect', at: [0, 0], size: [64, 20], fill: '#ffffff00' }, { shape: 'paint', from: 'below', clip: 'c', strokes: [{ points: [[0, 32], [64, 32]], size: 12, color: '#ffffff' }] } as never]);
        expect(px(clipped, 10, 32)).toEqual([255, 0, 0, 255]);
        const half = draw([...halves, { shape: 'paint', from: 'below', opacity: 0.5, strokes: [{ points: [[0, 32], [64, 32]], size: 12, color: '#ffffff', hardness: 1 }] } as never]);
        expect(px(half, 10, 32)[1]).toBeGreaterThan(110);
        expect(px(half, 10, 32)[1]).toBeLessThan(140);
    });

    it('a field of smudges softens a hard edge, and takes no colour of its own', () => {
        const img = draw([...halves, { shape: 'paint', from: 'below', strokes: [{ type: 'field', smudge: 0.8, size: 10, length: 30, angle: 0, seed: 1 }] } as never]);
        const mixed = new Set<number>();
        for (let x = 22; x < 42; x++) mixed.add(px(img, x, 30)[0]!);
        expect(mixed.size).toBeGreaterThan(4);
        for (let i = 0; i < img.rgba.length; i += 4) expect(img.rgba[i + 1]).toBeLessThanOrEqual(1);
    });

    it('takes a region from a layer drawn before it, through a transform too', () => {
        const blob: ImageLayer = { id: 'b', shape: 'circle', at: [64, 64], radius: 30, fill: '#00000000' };
        const img = draw([blob, { shape: 'paint', strokes: [{ type: 'field', region: '@b', tone: RED, size: 3, length: 6, angle: 0, hardness: 1, opacity: 1, vary: 0, seed: 1 }] } as never], [128, 128]);
        expect(px(img, 64, 64)[0]).toBe(255);
        expect(px(img, 64, 20)[3]).toBe(0);
        const moved = draw([{ ...blob, fill: '#00000001' }, { shape: 'paint', transform: { translate: [40, 0], origin: [0, 0] }, strokes: [{ type: 'field', region: '@b', tone: RED, size: 3, length: 6, angle: 0, hardness: 1, opacity: 1, vary: 0, seed: 1 }] } as never], [128, 128]);
        expect(px(moved, 64, 64)[0]).toBe(255);
        const none = draw([{ shape: 'paint', strokes: [{ type: 'field', region: '@nope', tone: RED, size: 3 }] } as never]);
        expect(none.notes.join()).toMatch(/"@nope" names no layer/);
    });

    it('repeats strokes along a line, turned and sized to it, and reflected when asked', () => {
        const feather = { points: [[0, 0], [10, 0]], color: RED, size: 2, hardness: 1 };
        const along = (fields: object): ReturnType<typeof draw> => draw([{ shape: 'paint', strokes: [{ type: 'along', line: [[10, 32], [50, 32]], count: 5, strokes: [feather], ...fields }] } as never]);
        expect(px(along({}), 15, 32)[0]).toBe(255);
        const up = along({ turn: -90, count: 3 });
        expect(px(up, 30, 25)[0]).toBe(255);
        expect(px(up, 30, 39)[3]).toBe(0);
        expect(px(along({ turn: -90, count: 3, both: true }), 30, 39)[0]).toBe(255);
        expect(px(along({ turn: -90, count: 3, scale: [1, 3] }), 50, 8)[0]).toBe(255);
        expect(() => validateImageSource({ size: 8, layers: [{ shape: 'paint', strokes: [{ type: 'along', line: [[0, 0], [1, 1]], count: 2, strokes: [{ type: 'field', tone: RED, size: 2 }] }] }] })).toThrow(/plain stroke/);
    });

    it('says when a sweep will be a flat band, and is quiet when it will not', () => {
        const sweep = (guides: number[][][], count: number): string[] => draw([{ id: 's', shape: 'paint', strokes: [{ type: 'sweep', guides, colors: [RED], count }] } as never], [128, 128]).notes;
        expect(sweep([[[10, 10], [100, 10]], [[10, 11], [100, 11]]], 40).join()).toMatch(/flat band/);
        expect(sweep([[[10, 10], [10, 110]], [[90, 10], [90, 110]]], 160)).toEqual([]);
    });

    it('reports entries and strokes for each paint layer', () => {
        const img = draw([{ id: 'p', shape: 'paint', strokes: [{ points: [[1, 1], [9, 9]], color: RED, size: 1 }, { type: 'sweep', guides: [[[10, 10], [10, 50]], [[50, 10], [50, 50]]], colors: [RED], count: 40 }] } as never]);
        expect(img.painted.p).toEqual({ entries: 2, strokes: 41 });
    });

    it('refuses a gradient at one point, and a below layer with what it cannot take', () => {
        const bad = (l: object): unknown => validateImageSource({ size: 8, layers: [l] });
        expect(() => bad({ shape: 'rect', at: [0, 0], size: [8, 8], fill: { type: 'linear', from: [2, 2], to: [2, 2], stops: [[0, RED], [1, BLUE]] } })).toThrow(/from and to apart/);
        expect(() => bad({ shape: 'paint', from: 'below', fill: RED, strokes: [] })).toThrow(/takes no fill/);
        expect(() => bad({ shape: 'paint', from: 'above', strokes: [] })).toThrow(/from must be "below"/);
        expect(() => bad({ shape: 'circle', at: [1, 1], radius: 1, fill: RED, from: 'below' })).toThrow(/for a paint layer/);
        expect(() => bad({ shape: 'paint', strokes: [{ type: 'field', size: 3 }] })).toThrow(/needs a tone/);
    });

    it('shows lightness alone and reads a colour', () => {
        const pic = draw(halves);
        const v = valuesImage(pic);
        expect(px(v as never, 10, 10)[0]).toBe(px(v as never, 10, 10)[1]);
        expect(px(v as never, 10, 10)[0]).toBeGreaterThan(px(v as never, 50, 10)[0]!);
        expect(pickColors(pic, [[10, 10], [50, 10]])).toEqual([{ at: [10, 10], color: '#ff0000', value: 0.21 }, { at: [50, 10], color: '#0000ff', value: 0.07 }]);
        expect(() => pickColors(pic, [[90, 0]])).toThrow(/outside the picture/);
    });

    it('sees a large opaque picture large, and any other as before', () => {
        const big = renderImage(validateImageSource({ size: [800, 450], layers: [{ shape: 'rect', at: [0, 0], size: [800, 450], fill: RED }] }));
        expect(imageSheet(big).width).toBe(800 + 24 + 192);
        expect(imageSheet(big).height).toBe(450 + 16);
        const clear = renderImage(validateImageSource({ size: [800, 450], layers: [{ shape: 'circle', at: [400, 225], radius: 100, fill: RED }] }));
        expect(imageSheet(clear).width).toBeLessThan(1300);
        expect(imageSheet(clear).width).toBeGreaterThan(1000);
    });

    it('zooms what is large as far as it fits', () => {
        const big = renderImage(validateImageSource({ size: [960, 540], layers: [{ shape: 'rect', at: [0, 0], size: [960, 540], fill: RED }] }));
        expect(zoomImage(big, { x: 0, y: 0, w: 480, h: 270 }).width).toBe(960);
        expect(zoomImage(big, { x: 0, y: 0, w: 960, h: 540 }).width).toBe(960);
    });

    it('has most of its noise in the middle, as the text says', () => {
        const img = draw([{ shape: 'rect', at: [0, 0], size: [64, 64], fill: { type: 'noise', scale: 16, stops: [[0, '#000000'], [1, '#ffffff']] } as never }]);
        const v = Array.from({ length: 64 * 64 }, (_, i) => img.rgba[i * 4]! / 255).sort((a, b) => a - b);
        expect(v[Math.floor(v.length * 0.1)]).toBeGreaterThan(0.2);
        expect(v[Math.floor(v.length * 0.9)]).toBeLessThan(0.8);
    });
});

describe('a figure to draw over', () => {
    const LONG = 120000;
    const person = (fields: object = {}): ImageLayer => ({ id: 'f', shape: 'figure', at: [128, 240], height: 220, ...fields } as never);
    const look = (layers: ImageLayer[]): ReturnType<typeof renderImage> => renderImage(validateImageSource({ size: 256, layers }), { guides: true });
    const plain = (layers: ImageLayer[]): ReturnType<typeof renderImage> => renderImage(validateImageSource({ size: 256, layers }));

    it('is as tall as it is told, and stands on its place', () => {
        const box = plain([person()]).layerBounds.f!;
        expect(box[1] + box[3]).toBeGreaterThan(232);
        expect(box[1] + box[3]).toBeLessThanOrEqual(241);
        expect(box[3]).toBeGreaterThan(210);
        expect(box[3]).toBeLessThan(226);
    }, LONG);

    it('is seen when looking and is not in the picture', () => {
        const seen = look([person()]);
        expect(seen.rgba[(100 * 256 + 128) * 4 + 3]).toBeGreaterThan(200);
        const out = plain([person()]);
        for (let i = 3; i < out.rgba.length; i += 4) expect(out.rgba[i]).toBe(0);
    }, LONG);

    it('turns by yaw: toes to the picture right at 90, and left at -90', () => {
        const toe = (yaw: number): number => plain([person({ yaw })]).figures.f!['toeTip.R']![0];
        const ankle = (yaw: number): number => plain([person({ yaw })]).figures.f!['foot.R']![0];
        expect(toe(90)).toBeGreaterThan(ankle(90) + 8);
        expect(toe(-90)).toBeLessThan(ankle(-90) - 8);
        const front = plain([person()]).figures.f!;
        expect(front['hand.L']![0]).toBeGreaterThan(front['hand.R']![0]);
        expect(plain([person({ yaw: 90 })]).layerBounds.f![2]).toBeLessThan(plain([person()]).layerBounds.f![2]);
    }, LONG);

    it('reports joints that land on the body', () => {
        const out = plain([person()]);
        const m = out.figures.f!;
        expect(m.crown![1]).toBeLessThan(m.neck![1]!);
        expect(m.neck![1]).toBeLessThan(m.hips![1]!);
        expect(m['foot.L']![1]).toBeGreaterThan(m['shin.L']![1]!);
    }, LONG);

    it('puts a hand where it is asked in the picture, and the arm follows', () => {
        const m = plain([person({ pose: { reach: { 'hand.R': { at: [60, 60] } } } })]).figures.f!;
        expect(Math.hypot(m['hand.R']![0] - 60, m['hand.R']![1] - 60)).toBeLessThan(40);
        const near = plain([person({ pose: { reach: { 'hand.R': { at: [90, 110] } } } })]).figures.f!;
        expect(Math.hypot(near['hand.R']![0] - 90, near['hand.R']![1] - 110)).toBeLessThan(6);
    }, LONG);

    it('bows its head with a rotation about x', () => {
        const crownX = (x: number): number => plain([person({ yaw: 90, pose: { rotate: { neck: [x, 0, 0] } } })]).figures.f!.crown![0];
        expect(crownX(30)).toBeGreaterThan(crownX(0) + 5);
    }, LONG);

    it('makes each part a mask, while the guide itself stays out', () => {
        const painted = plain([person(), { shape: 'rect', at: [0, 0], size: [256, 256], fill: RED, clip: 'f.torso' }]);
        const box = painted.layerBounds['f.torso']!;
        expect(px(painted, box[0] + Math.floor(box[2] / 2), box[1] + Math.floor(box[3] / 2))[0]).toBe(255);
        expect(px(painted, 128, painted.figures.f!.crown![1] + 4)[3]).toBe(0);
        const field = plain([person(), { shape: 'paint', strokes: [{ type: 'field', region: '@f.leg', tone: BLUE, size: 3, length: 6, angle: 90, seed: 1, hardness: 1, opacity: 1, vary: 0 }] } as never]);
        const leg = field.layerBounds['f.leg']!;
        expect(px(field, 5, 5)[3]).toBe(0);
        expect(leg[3]).toBeGreaterThan(60);
    }, LONG);

    it('a form follows the surface: lighter toward the light, across one limb', () => {
        const lit = plain([person(), { shape: 'rect', at: [0, 0], size: [256, 256], clip: 'f', fill: { type: 'form', figure: 'f', light: [-1, 0, 0.2], stops: [[0, '#000000'], [1, '#ffffff']] } } as never]);
        const chest = lit.figures.f!.chest!;
        const [left, right] = [px(lit, chest[0] - 12, chest[1])[0]!, px(lit, chest[0] + 12, chest[1])[0]!];
        expect(left).toBeGreaterThan(right + 60);
    }, LONG);

    it('says what is wrong with one', () => {
        const bad = (l: object): unknown => validateImageSource({ size: 64, layers: [{ shape: 'figure', at: [4, 4], height: 40, ...l }] });
        expect(() => bad({ eyes: 'closed' })).toThrow(/unknown field "eyes"/);
        expect(() => bad({ height: undefined })).toThrow(/height must be pixels/);
        expect(() => bad({ build: { nose: 2 } })).toThrow(/build has unknown "nose"/);
        expect(() => bad({ pose: { twist: {} } })).toThrow(/pose has unknown "twist"/);
        expect(() => bad({ pose: { rotate: { neck: [1] } } })).toThrow(/rotate "neck" must be/);
        expect(() => renderImage(validateImageSource({ size: 64, layers: [{ shape: 'figure', at: [4, 4], height: 40, pose: { rotate: { tail: [1, 0, 0] } } }] }))).toThrow(/no joint "tail"/);
    }, LONG);
});

describe('bones and blocks, and no look', () => {
    const person = { id: 'f', shape: 'figure', at: [128, 240], height: 220 } as ImageLayer;
    const shown = (fields: object = {}): ReturnType<typeof renderImage> => renderImage(validateImageSource({ size: 256, layers: [{ ...person, ...fields }] }), { guides: true });

    it('has blocks and no face, hair or fingers to copy', () => {
        const out = shown();
        expect(Object.keys(out.layerBounds).sort()).toEqual(['f', 'f.arm', 'f.foot', 'f.hand', 'f.head', 'f.leg', 'f.neck', 'f.torso']);
    });

    it('takes no time to speak of, as it builds no surface', () => {
        const began = Date.now();
        shown({ yaw: 33, pose: { rotate: { neck: [20, 0, 0] } } });
        expect(Date.now() - began).toBeLessThan(1500);
    });

    it('stays in proportion, narrower through the waist than the shoulders, and takes a build', () => {
        const width = (fields: object, y: number): number => { const img = shown(fields); let n = 0; for (let x = 0; x < 256; x++) if (img.rgba[(y * 256 + x) * 4 + 3]! > 128) n++; return n; };
        const m = shown().figures.f!;
        expect(width({ pose: { rotate: { 'upperArm.L': [0, 0, 60], 'upperArm.R': [0, 0, -60] } } }, m.spine![1])).toBeLessThan(width({}, m.chest![1]) * 1.2);
        expect(width({ build: { waist: 1.6 } }, m.spine![1])).toBeGreaterThan(width({}, m.spine![1]));
        const big = shown({ build: { head: 1.4 } }).layerBounds['f.head']!;
        expect(big[2]).toBeGreaterThan(shown().layerBounds['f.head']![2]);
    });

    it('turns the cross on the head with the head', () => {
        const lit = (fields: object): Uint8Array => shown(fields).rgba;
        expect(lit({ pose: { rotate: { neck: [40, 0, 0] } } })).not.toEqual(lit({}));
    });

    it('lets a form carry on past the blocks, for cloth', () => {
        const img = renderImage(validateImageSource({ size: 256, layers: [person, { shape: 'rect', at: [0, 0], size: [256, 256], fill: { type: 'form', figure: 'f', light: [-1, 0, 0], stops: [[0, '#000000'], [1, '#ffffff']] } } as never] }));
        const m = img.figures.f!;
        const box = img.layerBounds['f.torso']!;
        const y = m.spine![1];
        expect(px(img as never, box[0] + 6, y)[0]).toBeGreaterThan(px(img as never, box[0] + box[2] - 6, y)[0]! + 30);
    });
});

describe('a picture to draw over', () => {
    const picture = { width: 2, height: 1, rgba: new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255]) };
    const image = { id: 'ref', shape: 'image', src: 'a.png', at: [0, 0], size: [64, 64] } as ImageLayer;
    const render = (layers: ImageLayer[], guides = false): ReturnType<typeof renderImage> => renderImage(validateImageSource({ size: 64, layers }), { guides, pictures: { 'a.png': picture } });

    it('is seen when looking and stays out of the picture, unless told', () => {
        expect(px(render([image], true), 4, 32)[0]).toBe(255);
        expect(px(render([image]), 4, 32)[3]).toBe(0);
        expect(px(render([{ ...image, guide: false }]), 4, 32)[0]).toBe(255);
    });

    it('scales to its size, smoothly', () => {
        const img = render([image], true);
        expect(px(img, 60, 32)[2]).toBe(255);
        expect(px(img, 32, 32)[0]).toBeGreaterThan(90);
        expect(px(img, 32, 32)[2]).toBeGreaterThan(90);
    });

    it('gives its colours to a fill and to a field', () => {
        const img = render([image, { shape: 'rect', at: [0, 0], size: [64, 64], fill: { type: 'image', image: 'ref' } } as never]);
        expect(px(img, 4, 32)[0]).toBe(255);
        expect(px(img, 60, 32)[2]).toBe(255);
        const field = render([image, { shape: 'paint', strokes: [{ type: 'field', tone: { type: 'image', image: 'ref' }, size: 4, length: 8, hardness: 1, opacity: 1, vary: 0, seed: 1 }] } as never]);
        expect(px(field, 10, 32)[0]).toBeGreaterThan(px(field, 10, 32)[2]!);
        expect(px(field, 54, 32)[2]).toBeGreaterThan(px(field, 54, 32)[0]!);
    });

    it('says when it is not there', () => {
        expect(() => renderImage(validateImageSource({ size: 8, layers: [{ shape: 'image', src: 'gone.png' }] }))).toThrow(/no picture at gone.png/);
        expect(() => validateImageSource({ size: 8, layers: [{ shape: 'image' }] })).toThrow(/src must be/);
    });
});

describe('words on a wall, and light spilling', () => {
    // Fonts are not here: a solid bar stands in for the words, drawn where it is told.
    const bar = (layer: ImageLayer, m: readonly number[], w: number, h: number): { fill: Float32Array; line: Float32Array | null } => {
        const fill = new Float32Array(w * h);
        const size = layer.fontSize as number;
        const [x, y] = [Math.round(layer.at![0] + m[4]!), Math.round(layer.at![1] + m[5]!)];
        for (let j = 0; j < size; j++) for (let i = 0; i < size * 3; i++) { const at = (y - j) * w + x + i; if (at >= 0 && at < fill.length) fill[at] = 1; }
        return { fill, line: null };
    };
    const onWall = { id: 't', shape: 'text', text: 'SIGN', quad: [[8, 8], [56, 20], [56, 44], [8, 56]], fill: RED } as ImageLayer;

    it('lays text on four corners: it fills them, and narrows to the far side', () => {
        const img = renderImage(validateImageSource({ size: 64, layers: [onWall] }), { text: bar });
        const tall = (x: number): number => { let n = 0; for (let y = 0; y < 64; y++) if (px(img as never, x, y)[3]! > 128) n++; return n; };
        expect(tall(12)).toBeGreaterThan(tall(52) + 8);
        expect(px(img as never, 32, 32)[0]).toBe(255);
        expect(px(img as never, 4, 32)[3]).toBe(0);
        expect(px(img as never, 60, 32)[3]).toBe(0);
    });

    it('needs no at or fontSize on corners, and still says what is wrong', () => {
        const bad = (l: object): unknown => validateImageSource({ size: 8, layers: [{ shape: 'text', text: 'a', fill: RED, ...l }] });
        expect(() => bad({ quad: [[0, 0], [1, 0], [1, 1], [0, 1]] })).not.toThrow();
        expect(() => bad({ quad: [[0, 0]] })).toThrow(/four \[x, y\]/);
        expect(() => bad({})).toThrow(/at must/);
    });

    const label = { id: 't', shape: 'text', text: 'A', at: [8, 40], fontSize: 16, fill: RED } as ImageLayer;
    const count = (img: ReturnType<typeof renderImage>): number => { let n = 0; for (let i = 3; i < img.rgba.length; i += 4) if (img.rgba[i]! > 128) n++; return n; };
    const render = (l: object): ReturnType<typeof renderImage> => renderImage(validateImageSource({ size: 64, layers: [{ ...label, ...l }] }), { text: bar });

    it('thins its letters by the pixels asked, for a core inside a tube', () => {
        const [whole, core] = [render({}), render({ thin: 2 })];
        expect(count(whole)).toBe(48 * 16);
        expect(count(core)).toBe(44 * 12);
        expect(px(core as never, 8, 32)[3]).toBe(0);
        expect(px(core as never, 20, 32)[3]).toBe(255);
    });

    it('wears its letters as told, the same every time', () => {
        expect(count(render({ grain: 0.8 }))).toBeLessThan(count(render({})) * 0.7);
        expect(count(render({ dry: 0.7 }))).toBeLessThan(count(render({})) * 0.9);
        expect(render({ grain: 0.8 }).rgba).toEqual(render({ grain: 0.8 }).rgba);
        expect(() => render({ grain: 2 })).toThrow(/grain must be 0..1/);
        expect(() => render({ thin: -1 })).toThrow(/thin must be/);
    });

    it('stacks: glow under, tube, then a thin core, all from the same words', () => {
        const stack = renderImage(validateImageSource({ size: 64, background: '#101018', layers: [
            { ...label, id: 'halo', fill: '#ff2080', blend: 'add', blur: 6, opacity: 0.6 },
            { ...label, id: 'tube', fill: '#ff2080' },
            { ...label, id: 'core', fill: '#fff0f6', thin: 2 },
        ] }), { text: bar });
        expect(px(stack as never, 20, 32)[1]).toBeGreaterThan(200);
        expect(px(stack as never, 9, 32)[1]).toBeLessThan(80);
        expect(px(stack as never, 4, 32)[0]).toBeGreaterThan(0x10 + 10);
    });

    const dot: ImageLayer = { shape: 'rect', at: [28, 28], size: [8, 8], fill: '#ffffff' };
    const ground: ImageLayer = { shape: 'rect', at: [0, 0], size: [64, 64], fill: '#202020' };

    it('spills what is bright over what is round it, falling away', () => {
        const [plain, lit] = [draw([ground, dot]), draw([ground, dot, { shape: 'bloom', radius: 6 } as never])];
        expect(px(lit, 24, 32)[0]).toBeGreaterThan(px(plain, 24, 32)[0]! + 15);
        expect(px(lit, 24, 32)[0]).toBeGreaterThan(px(lit, 8, 32)[0]!);
    });

    it('leaves what is below the threshold alone, and takes the colour of what shines', () => {
        const dim = draw([ground, { shape: 'bloom', threshold: 0.6 } as never]);
        expect(px(dim, 32, 32)[0]).toBe(0x20);
        const red = draw([ground, { ...dot, fill: RED }, { shape: 'bloom', radius: 6 } as never]);
        expect(px(red, 24, 32)[0]).toBeGreaterThan(px(red, 24, 32)[1]! + 15);
    });

    it('is stronger when told, and keeps to its clip', () => {
        const at = (strength: number): number => px(draw([ground, dot, { shape: 'bloom', radius: 6, strength } as never]), 24, 32)[0]!;
        expect(at(2)).toBeGreaterThan(at(0.5));
        const clipped = draw([ground, { id: 'c', shape: 'rect', at: [0, 0], size: [20, 64], fill: '#00000001' }, dot, { shape: 'bloom', radius: 8, clip: 'c' } as never]);
        expect(px(clipped, 24, 32)[0]).toBe(0x20);
    });

    it('says what is wrong with one', () => {
        const bad = (l: object): unknown => validateImageSource({ size: 8, layers: [{ shape: 'bloom', ...l }] });
        expect(() => bad({ threshold: 2 })).toThrow(/threshold must be 0..1/);
        expect(() => bad({ radius: 0 })).toThrow(/radius must be positive/);
    });
});

describe('drawing only what changed', () => {
    const layers: ImageLayer[] = [
        { id: 'a', shape: 'rect', at: [0, 0], size: [64, 64], fill: { type: 'noise', scale: 8, stops: [[0, '#000000'], [1, '#ffffff']] } },
        { id: 'b', shape: 'paint', clip: 'a', strokes: [{ type: 'field', tone: RED, size: 6, length: 20, angle: 20, seed: 2 }] } as never,
        { id: 'c', shape: 'circle', at: [32, 32], radius: 12, fill: BLUE },
    ];
    const source = (top: ImageLayer[]): ReturnType<typeof validateImageSource> => validateImageSource({ size: 64, layers: [...layers, ...top] });
    const fresh = (top: ImageLayer[]): ReturnType<typeof renderImage> => { imageCacheStats(true); return renderImage(source(top)); };
    const dot: ImageLayer = { id: 'd', shape: 'circle', at: [10, 10], radius: 4, fill: '#00ff00' };

    it('draws the same picture, measures and all, as drawing it all again', () => {
        imageCacheStats(true);
        renderImage(source([]));
        const continued = renderImage(source([dot]));
        const whole = fresh([dot]);
        expect(continued.rgba).toEqual(whole.rgba);
        expect(continued.layerBounds).toEqual(whole.layerBounds);
        expect(continued.painted).toEqual(whole.painted);
        expect(continued.notes).toEqual(whole.notes);
    });

    it('picks up where nothing has changed, and draws nothing for the same source', () => {
        imageCacheStats(true);
        renderImage(source([]));
        const before = imageCacheStats();
        renderImage(source([]));
        expect(imageCacheStats().drawn).toBe(before.drawn);
        renderImage(source([dot]));
        expect(imageCacheStats().drawn).toBe(before.drawn + 1);
    });

    it('is not fooled by a change lower down, a seed, a canvas size or showing guides', () => {
        imageCacheStats(true);
        const base = renderImage(source([]));
        const changed = validateImageSource({ size: 64, layers: [{ ...layers[0]!, fill: RED }, layers[1]!, layers[2]!] });
        expect(renderImage(changed).rgba).not.toEqual(base.rgba);
        const reseeded = validateImageSource({ size: 64, layers: [layers[0]!, { ...layers[1]!, strokes: [{ type: 'field', tone: RED, size: 6, length: 20, angle: 20, seed: 3 }] } as never, layers[2]!] });
        expect(renderImage(reseeded).rgba).not.toEqual(base.rgba);
        const guide = validateImageSource({ size: 64, layers: [{ id: 'g', shape: 'rect', at: [0, 0], size: [8, 8], fill: RED, guide: true }] });
        expect(renderImage(guide).rgba[3]).toBe(0);
        expect(renderImage(guide, { guides: true }).rgba[3]).toBe(255);
    });

    it('sees a picture changed under its own name', () => {
        imageCacheStats(true);
        const img = validateImageSource({ size: 8, layers: [{ shape: 'image', src: 'a.png', guide: false, size: [8, 8] }] });
        const red = { width: 1, height: 1, rgba: new Uint8Array([255, 0, 0, 255]) };
        const blue = { width: 1, height: 1, rgba: new Uint8Array([0, 0, 255, 255]) };
        expect(renderImage(img, { pictures: { 'a.png': red } }).rgba[0]).toBe(255);
        expect(renderImage(img, { pictures: { 'a.png': blue } }).rgba[0]).toBe(0);
    });

    it('does not let what comes after change what was kept', () => {
        imageCacheStats(true);
        const once = renderImage(source([]));
        renderImage(source([{ shape: 'rect', at: [0, 0], size: [64, 64], fill: '#ffffff' }]));
        expect(renderImage(source([])).rgba).toEqual(once.rgba);
    });
});

describe('repainting the picture so far', () => {
    const halves: ImageLayer[] = [
        { id: 'l', shape: 'rect', at: [0, 0], size: [64, 128], fill: RED },
        { id: 'r', shape: 'rect', at: [64, 0], size: [64, 128], fill: BLUE },
        { id: 'mark', shape: 'rect', at: [20, 20], size: [24, 24], fill: '#ffffff' },
    ];
    const paintOver = (fields: object = {}): ReturnType<typeof draw> => draw([...halves, { id: 'over', shape: 'repaint', ...fields } as never], [128, 128]);

    it('keeps the picture, its colours where they were, and is no longer the same pixels', () => {
        const before = draw(halves, [128, 128]);
        const after = paintOver();
        expect(px(after, 20, 90)[0]).toBeGreaterThan(200);
        expect(px(after, 110, 90)[2]).toBeGreaterThan(200);
        expect(px(after, 32, 32)[1]).toBeGreaterThan(160);
        expect(after.rgba).not.toEqual(before.rgba);
        expect(after.painted.over!.strokes).toBeGreaterThan(40);
    });

    it('breaks a hard edge into strokes', () => {
        const edgeOf = (img: ReturnType<typeof draw>): Set<number> => { const s = new Set<number>(); for (let y = 8; y < 120; y += 2) { let x = 0; while (x < 127 && px(img, x, y)[0]! > 128) x++; s.add(x); } return s; };
        expect(edgeOf(draw(halves.slice(0, 2), [128, 128])).size).toBe(1);
        expect(edgeOf(draw([...halves.slice(0, 2), { shape: 'repaint' } as never], [128, 128])).size).toBeGreaterThan(1);
    });

    it('takes more strokes as it goes finer, and more again where it is boosted', () => {
        const strokes = (fields: object): number => paintOver(fields).painted.over!.strokes;
        const scene: ImageLayer[] = [...halves, { id: 'noisy', shape: 'circle', at: [90, 90], radius: 24, fill: { type: 'noise', scale: 4, stops: [[0, '#000000'], [1, '#ffffff']] } }];
        const at = (fields: object): number => draw([...scene, { id: 'over', shape: 'repaint', ...fields } as never], [128, 128]).painted.over!.strokes;
        expect(at({ detail: 2 })).toBeGreaterThan(at({ detail: 0 }));
        expect(at({ detail: 0, boost: ['noisy'] })).toBeGreaterThan(at({ detail: 0 }));
        expect(strokes({})).toBeGreaterThan(0);
    });

    it('leaves what it is told to, exactly', () => {
        const kept = paintOver({ except: 'mark' });
        expect(px(kept, 22, 22)).toEqual([255, 255, 255, 255]);
        expect(px(kept, 42, 42)).toEqual([255, 255, 255, 255]);
    });

    it('takes the brush it is told, and is the same every time', () => {
        expect(paintOver({ brush: 'charcoal' }).rgba).not.toEqual(paintOver({ brush: 'oil' }).rgba);
        imageCacheStats(true);
        const a = paintOver({ seed: 4 }).rgba;
        imageCacheStats(true);
        expect(paintOver({ seed: 4 }).rgba).toEqual(a);
        expect(paintOver({ seed: 5 }).rgba).not.toEqual(a);
    });

    it('says what is wrong with one', () => {
        const bad = (l: object): unknown => validateImageSource({ size: 8, layers: [{ shape: 'repaint', ...l }] });
        expect(() => bad({ brush: 'crayon' })).toThrow(/brush "crayon" must be one of/);
        expect(() => bad({ detail: 3 })).toThrow(/detail must be 0, 1 or 2/);
        expect(() => bad({ boost: 'x' })).toThrow(/boost must be/);
        expect(paintOver({ boost: ['none'] }).notes.join()).toMatch(/boost "none" names no layer/);
    });
});

describe('working on a face', () => {
    const bar = (layer: ImageLayer, m: readonly number[], w: number, h: number): { fill: Float32Array; line: Float32Array | null } => {
        const fill = new Float32Array(w * h);
        const size = layer.fontSize as number;
        const [x, y] = [Math.round(layer.at![0] + m[4]!), Math.round(layer.at![1] + m[5]!)];
        for (let j = 0; j < size; j++) for (let i = 0; i < size * 3; i++) { const at = (y - j) * w + x + i; if (at >= 0 && at < fill.length) fill[at] = 1; }
        return { fill, line: null };
    };
    const wall = { id: 'b', shape: 'block', at: [10, 110], height: 100, vanish: [[200, 40]], depth: [0.5], faces: ['#202030'] } as ImageLayer;
    const render = (l: object[]): ReturnType<typeof renderImage> => renderImage(validateImageSource({ size: 128, layers: [wall, ...l] as never }), { text: bar });

    it('paints across a face in its own terms, the line toward the vanishing point by itself', () => {
        const img = render([{ shape: 'paint', face: 'b.a', strokes: [{ points: [[0, 0.5], [1, 0.5]], color: RED, size: 3, hardness: 1 }] }]);
        const q = img.blocks.b!.a!;
        const mid = (a: readonly number[], c: readonly number[]): number[] => [(a[0]! + c[0]!) / 2, (a[1]! + c[1]!) / 2];
        const [nearMid, farMid] = [mid(q[0]!, q[3]!), mid(q[1]!, q[2]!)];
        expect(px(img as never, Math.round(nearMid[0]!) + 2, Math.round(nearMid[1]!))[0]).toBe(255);
        expect(px(img as never, Math.round(farMid[0]!) - 2, Math.round(farMid[1]!))[0]).toBe(255);
    });

    it('lays words on part of a face, narrowing as it goes', () => {
        const img = render([{ id: 't', shape: 'text', text: 'AD', face: 'b.a', within: [0.1, 0.1, 0.9, 0.5], fill: RED }]);
        const box = img.layerBounds.t!;
        const tall = (x: number): number => { let n = 0; for (let y = 0; y < 128; y++) if (px(img as never, x, y)[0]! > 128) n++; return n; };
        expect(tall(box[0] + 2)).toBeGreaterThan(tall(box[0] + box[2] - 3));
        expect(box[2]).toBeLessThan(img.layerBounds['b.a']![2]);
    });

    it('puts a rect on part of a face, cornered as the face is', () => {
        const img = render([{ id: 'r', shape: 'rect', face: 'b.a', within: [0.2, 0.2, 0.8, 0.6], fill: RED }]);
        const box = img.layerBounds.r!;
        const tall = (x: number): number => { let n = 0; for (let y = 0; y < 128; y++) if (px(img as never, x, y)[0]! > 128) n++; return n; };
        expect(tall(box[0] + 1)).toBeGreaterThan(tall(box[0] + box[2] - 2) + 3);
        expect(() => validateImageSource({ size: 8, layers: [{ shape: 'rect', fill: RED }] })).toThrow(/at must/);
    });

    it('says when there is no such face', () => {
        const img = render([{ shape: 'paint', face: 'b.z', strokes: [] }, { shape: 'text', text: 'A', face: 'nope.a', fill: RED }]);
        expect(img.notes.join()).toMatch(/face "b.z" names no face/);
        expect(img.notes.join()).toMatch(/face "nope.a" names no face/);
    });
});

describe('a built world', () => {
    const windows = (fields: object): object => ({ type: 'grid', colors: [RED], ground: BLUE, ...fields });
    const rect = (fill: object): ImageLayer => ({ shape: 'rect', at: [0, 0], size: [64, 64], fill } as never);

    it('a grid repeats its marks by the pixel, on and off as told', () => {
        const img = draw([rect(windows({ cell: [16, 16], mark: [0.5, 0.5] }))]);
        expect(px(img, 8, 8)).toEqual([255, 0, 0, 255]);
        expect(px(img, 24, 8)).toEqual([255, 0, 0, 255]);
        expect(px(img, 1, 1)).toEqual([0, 0, 255, 255]);
        expect(px(img, 16, 8)).toEqual([0, 0, 255, 255]);
        const clear = draw([rect({ type: 'grid', colors: [RED], cell: [16, 16], mark: [0.5, 0.5] })]);
        expect(px(clear, 1, 1)[3]).toBe(0);
    });

    it('lights only some, the same ones every time, and shows what the rest show', () => {
        const count = (lit: number): number => { const img = draw([rect(windows({ cell: [8, 8], mark: [0.5, 0.5], lit, off: '#00ff00' }))]); let n = 0; for (let y = 4; y < 64; y += 8) for (let x = 4; x < 64; x += 8) if (px(img, x, y)[0] === 255) n++; return n; };
        expect(count(1)).toBe(64);
        expect(count(0)).toBe(0);
        expect(count(0.5)).toBeGreaterThan(20);
        expect(count(0.5)).toBeLessThan(44);
        expect(count(0.5)).toBe(count(0.5));
    });

    it('lies on four corners in perspective: rows crowd toward the far side', () => {
        const fill = windows({ cells: [8, 4], mark: [0.5, 1], quad: [[4, 4], [60, 24], [60, 40], [4, 60]] });
        const img = draw([rect(fill)]);
        const width = (x0: number, x1: number, y: number): number[] => { const runs: number[] = []; let run = 0; for (let x = x0; x < x1; x++) { if (px(img, x, y)[0]! > 128) run++; else if (run) { runs.push(run); run = 0; } } return runs; };
        const runs = width(0, 64, 32);
        expect(runs.length).toBeGreaterThan(4);
        expect(runs[0]!).toBeGreaterThan(runs[runs.length - 1]!);
        expect(px(img, 60, 10)[0]).toBe(0);
    });

    it('a block puts faces toward its vanishing points, each a layer, its corners reported', () => {
        const img = renderImage(validateImageSource({ size: 256, layers: [{ id: 'b', shape: 'block', at: [128, 200], height: 120, vanish: [[-200, 100], [500, 100]], depth: [0.2, 0.2], faces: [RED, BLUE] }] }));
        expect(px(img, 110, 150)[0]).toBe(255);
        expect(px(img, 146, 150)[2]).toBe(255);
        expect(Object.keys(img.layerBounds).sort()).toEqual(['b', 'b.a', 'b.b']);
        const a = img.blocks.b!.a!;
        expect(a).toHaveLength(4);
        // Toward a horizon above the foot, the far foot rises, and the far top too where the top is below it.
        expect(a[3]![1]).toBeLessThan(200);
        expect(a[0]![1]).toBeGreaterThan(a[1]![1]!);
    });

    it('a grid on a face lies on it unasked', () => {
        const img = renderImage(validateImageSource({ size: 128, layers: [{ shape: 'block', at: [20, 110], height: 90, vanish: [[120, 60]], depth: [0.6], faces: [{ type: 'grid', cells: [4, 8], colors: [RED], ground: BLUE }] }] }));
        let [red, blue] = [0, 0];
        for (let y = 20; y < 110; y++) for (let x = 20; x < 80; x++) { if (px(img, x, y)[0] === 255) red++; if (px(img, x, y)[2] === 255) blue++; }
        expect(red).toBeGreaterThan(200);
        expect(blue).toBeGreaterThan(200);
    });

    it('shows a roof only from above', () => {
        const block = (vy: number): ReturnType<typeof renderImage> => renderImage(validateImageSource({ size: 256, layers: [{ id: 'b', shape: 'block', at: [128, 200], height: 80, vanish: [[-200, vy], [500, vy]], depth: [0.2, 0.2], faces: [RED, BLUE], roof: '#00ff00' }] }));
        expect(block(20).blocks.b!.top).toBeDefined();
        expect(block(180).blocks.b!.top).toBeUndefined();
    });

    it('a perspective guide is seen when looking and is not in the picture', () => {
        const source = validateImageSource({ size: 64, layers: [{ shape: 'perspective', vanish: [[32, 20]] }] });
        expect(renderImage(source, { guides: true }).rgba.some((v, i) => i % 4 === 3 && v > 0)).toBe(true);
        expect(renderImage(source).rgba.every((v, i) => i % 4 !== 3 || v === 0)).toBe(true);
    });

    it('a reflection turns what is above a line over below it, and fades', () => {
        const scene: ImageLayer[] = [{ shape: 'rect', at: [10, 20], size: [10, 20], fill: RED }, { shape: 'reflect', y: 40, reach: 24, ripple: 0, smear: 0 } as never];
        const img = draw(scene);
        expect(px(img, 14, 44)[0]).toBe(255);
        expect(px(img, 14, 44)[3]).toBeGreaterThan(px(img, 14, 56)[3]!);
        expect(px(img, 40, 44)[3]).toBe(0);
        expect(px(img, 14, 10)[3]).toBe(0);
    });

    it('wavers when asked, stays inside its clip, and leaves what is above alone', () => {
        const stack = (ripple: number): ImageLayer[] => [{ id: 'g', shape: 'rect', at: [0, 40], size: [32, 24], fill: '#00000001' }, { shape: 'rect', at: [10, 10], size: [40, 30], fill: RED }, { shape: 'reflect', y: 40, reach: 24, ripple, smear: 0, clip: 'g' } as never];
        expect(px(draw(stack(0)), 40, 44)[0]).toBe(0);
        expect(draw(stack(4)).rgba).not.toEqual(draw(stack(0)).rgba);
        expect(px(draw(stack(0)), 20, 20)).toEqual([255, 0, 0, 255]);
    });

    it('a reflection turns over along where things stand, slanting with them', () => {
        const scene = (extra: object): ImageLayer[] => [{ shape: 'polygon', points: [[0, 10], [64, 10], [64, 20], [0, 40]], fill: RED }, { shape: 'reflect', reach: 40, ripple: 0, smear: 0, ...extra } as never];
        const img = draw(scene({ edge: [[0, 40], [64, 20]] }));
        // Below the slanted foot on both sides: the left as far under its foot as the right under its own.
        expect(px(img, 4, 44)[0]).toBe(255);
        expect(px(img, 60, 26)[0]).toBe(255);
        expect(px(img, 60, 10)[0]).toBe(255);
        expect(() => validateImageSource({ size: 8, layers: [{ shape: 'reflect', edge: [[0, 0]] }] })).toThrow(/edge two or more/);
    });

    it('text draws through whoever has fonts, fill and stroke, and says when there is none', () => {
        const drawer = (layer: ImageLayer, m: readonly number[], w: number, h: number): { fill: Float32Array; line: Float32Array | null } => {
            const fill = new Float32Array(w * h);
            const [x, y] = [Math.round(layer.at![0] * m[0]! + m[4]!), Math.round(layer.at![1] * m[3]! + m[5]!)];
            for (let j = 0; j < 8; j++) for (let i = 0; i < 20; i++) fill[(y - j) * w + x + i] = 1;
            return { fill, line: layer.stroke ? fill.map((v) => v) : null };
        };
        const label = { id: 't', shape: 'text', text: '东京', at: [10, 30], fontSize: 12, fill: RED } as ImageLayer;
        const img = renderImage(validateImageSource({ size: 64, layers: [label, { shape: 'rect', at: [0, 0], size: [64, 64], fill: BLUE, clip: 't' }] }), { text: drawer });
        expect(px(img as never, 14, 26)[2]).toBe(255);
        expect(img.layerBounds.t).toEqual([10, 23, 20, 8]);
        expect(() => renderImage(validateImageSource({ size: 64, layers: [label] }))).toThrow(/needs the editor's fonts/);
    });

    it('says what is wrong with each', () => {
        const bad = (l: object): unknown => validateImageSource({ size: 8, layers: [l] });
        expect(() => bad(rect({ type: 'grid', colors: [RED] }))).toThrow(/grid needs cell/);
        expect(() => bad(rect({ type: 'grid', cell: [2, 2], colors: [] }))).toThrow(/needs colors/);
        expect(() => bad(rect({ type: 'grid', cell: [2, 2], colors: [RED], quad: [[0, 0]] }))).toThrow(/quad must be four/);
        expect(() => bad(rect({ type: 'grid', cell: [2, 2], colors: [RED], quad: [[0, 0], [1, 0], [1, 1], [0, 1]] }))).toThrow(/counted in cells/);
        expect(() => bad({ shape: 'text', at: [0, 0], fontSize: 4, fill: RED })).toThrow(/text must say something/);
        expect(() => bad({ shape: 'text', text: 'a', at: [0, 0], fill: RED })).toThrow(/fontSize must be/);
        expect(() => bad({ shape: 'block', at: [0, 0], height: 4, vanish: [[1, 1]], depth: [2], faces: [RED] })).toThrow(/depth must/);
        expect(() => bad({ shape: 'block', at: [0, 0], height: 4, vanish: [[1, 1]], depth: [0.5], faces: [] })).toThrow(/faces must/);
        expect(() => bad({ shape: 'reflect' })).toThrow(/y must be/);
    });
});

describe('clipping to what was itself clipped', () => {
    const left: ImageLayer = { id: 'left', shape: 'rect', at: [0, 0], size: [32, 64], fill: BLUE };
    const strokes = [{ points: [[0, 32], [64, 32]], color: RED, size: 20, hardness: 1 }];

    it('a paint layer holds only what its clip let through', () => {
        const img = draw([left, { id: 'p', shape: 'paint', clip: 'left', strokes } as never, { shape: 'rect', at: [0, 0], size: [64, 64], fill: '#00ff00', clip: 'p' }]);
        expect(px(img, 10, 32)[1]).toBe(255);
        expect(px(img, 50, 32)[3]).toBe(0);
    });

    it('so does a figure, a picture and a blurred layer', () => {
        const blurred = draw([left, { id: 'p', shape: 'rect', at: [0, 22], size: [64, 20], fill: RED, clip: 'left', blur: 1 }, { shape: 'rect', at: [0, 0], size: [64, 64], fill: '#00ff00', clip: 'p' }]);
        expect(px(blurred, 50, 32)[3]).toBe(0);
        const fig = renderImage(validateImageSource({ size: 256, layers: [{ id: 'half', shape: 'rect', at: [0, 0], size: [128, 256], fill: BLUE }, { id: 'f', shape: 'figure', at: [128, 240], height: 220, clip: 'half' }, { shape: 'rect', at: [0, 0], size: [256, 256], fill: RED, clip: 'f' }] }));
        const m = fig.figures.f!;
        expect(px(fig as never, m.chest![0] + 12, m.chest![1])[0]).toBe(0);
    });

    it('and its reported box is what it holds', () => {
        const img = draw([left, { id: 'p', shape: 'paint', clip: 'left', strokes } as never]);
        expect(img.layerBounds.p![0] + img.layerBounds.p![2]).toBeLessThanOrEqual(33);
    });
});

describe('what the third trial tripped on', () => {
    const person = { id: 'f', shape: 'figure', at: [128, 240], height: 220 } as ImageLayer;
    const looking = (layers: object[]): ReturnType<typeof renderImage> => renderImage(validateImageSource({ size: 256, layers }), { guides: true });

    it('a figure at opacity 0 shows nothing at all, bones and joints included', () => {
        const img = looking([{ ...person, opacity: 0 }]);
        for (let i = 3; i < img.rgba.length; i += 4) expect(img.rgba[i]).toBe(0);
    });

    it('a figure hidden from sight still clips and lights what uses it, without a warning', () => {
        const uses = { shape: 'rect', at: [0, 0], size: [256, 256], clip: 'f', fill: { type: 'form', figure: 'f', light: [-1, 0, 0.2], stops: [[0, '#000000'], [1, '#ffffff']] } };
        const hidden = looking([{ ...person, visible: false }, uses]);
        const shown = renderImage(validateImageSource({ size: 256, layers: [person, uses] as never }));
        expect(hidden.notes).toEqual([]);
        expect(hidden.rgba).toEqual(shown.rgba);
    });

    it('anything else hidden is simply not there', () => {
        const img = draw([{ id: 'a', shape: 'rect', at: [0, 0], size: [8, 8], fill: RED, visible: false }, { shape: 'rect', at: [0, 0], size: [64, 64], fill: BLUE, clip: 'a' }]);
        expect(img.notes.join()).toMatch(/names no layer/);
    });

    it('a faint layer is still reported where it is', () => {
        const img = draw([{ id: 'faint', shape: 'paint', strokes: [{ points: [[10, 20], [50, 20]], color: RED, size: 8, opacity: 0.3, hardness: 1 }] } as never]);
        const box = img.layerBounds.faint!;
        expect(box[2]).toBeGreaterThan(30);
        expect(box[3]).toBeGreaterThan(5);
    });

    it('a sparse spray of large dabs shows as separate discs', () => {
        const img = draw([{ shape: 'paint', strokes: [{ points: [[0, 64], [256, 64]], color: '#ffffff', size: 80, dab: 0.25, scatter: 0.8, spacing: 2.5, hardness: 0.85, opacity: 0.6, seed: 2 }] } as never], [256, 128]);
        let runs = 0, on = false;
        for (let x = 0; x < 256; x++) { const lit = [40, 64, 90].some((y) => px(img, x, y)[3]! > 60); if (lit && !on) runs++; on = lit; }
        expect(runs).toBeGreaterThan(3);
    });
});

describe('what the second trial tripped on', () => {
    const halves: ImageLayer[] = [{ id: 'a', shape: 'rect', at: [0, 0], size: [32, 64], fill: BLUE }];
    it('takes a clip with @ as well, and a clip of nothing draws nothing', () => {
        const over: ImageLayer = { shape: 'rect', at: [0, 0], size: [64, 64], fill: RED };
        expect(px(draw([...halves, { ...over, clip: '@a' }]), 10, 10)[0]).toBe(255);
        expect(px(draw([...halves, { ...over, clip: '@a' }]), 50, 10)[3]).toBe(0);
        const lost = draw([{ ...over, clip: 'nothing' }]);
        expect(px(lost, 10, 10)[3]).toBe(0);
        expect(lost.notes.join()).toMatch(/so it drew nothing/);
    });

    it('draws everywhere except a layer, and inside a clip too', () => {
        const over: ImageLayer = { shape: 'rect', at: [0, 0], size: [64, 64], fill: RED, except: 'a' };
        const img = draw([...halves, over]);
        expect(px(img, 10, 10)[0]).toBe(0);
        expect(px(img, 50, 10)[0]).toBe(255);
        expect(draw([{ ...over, except: 'none' }]).notes.join()).toMatch(/except "none"/);
    });

    it('keeps a face out of a pass across the picture', () => {
        const under: ImageLayer[] = [{ id: 'l', shape: 'rect', at: [0, 0], size: [32, 64], fill: RED }, { id: 'r', shape: 'rect', at: [32, 0], size: [32, 64], fill: BLUE }, { id: 'kept', shape: 'rect', at: [36, 26], size: [12, 12], fill: '#00000000' }];
        const pass = { shape: 'paint', from: 'below', except: 'kept', strokes: [{ points: [[8, 32], [56, 32]], size: 12, smudge: 0.9 }] };
        const img = draw([...under, pass as never]);
        expect(px(img, 42, 32)).toEqual([0, 0, 255, 255]);
        expect(px(img, 54, 32)[0]).toBeGreaterThan(5);
    });

    it('changes one entry in the middle of a paint layer', () => {
        const dab = (x: number): object => ({ points: [[x, 5]], color: RED, size: 2 });
        const start = validateImageSource({ size: 64, layers: [{ id: 'p', shape: 'paint', strokes: [dab(1), dab(2), dab(3)] }] });
        const next = applyImageEdits(start, [{ op: 'paint', layer: 'p', at: 1, remove: 1, strokes: [dab(9) as never, dab(10) as never] }]);
        expect(next.layers[0]!.strokes!.map((s) => (s as unknown as { points: number[][] }).points[0]![0])).toEqual([1, 9, 10, 3]);
        expect(() => applyImageEdits(start, [{ op: 'paint', layer: 'p', at: 2, remove: 5 }])).toThrow(/cannot replace 5 at 2/);
    });
});

describe('what a brush is made of', () => {
    const paint = (strokes: object[], extra: object = {}): ImageLayer => ({ id: 'p', shape: 'paint', strokes, ...extra } as never);
    const line = (fields: object = {}): object => ({ points: [[8, 64], [120, 64]], color: RED, size: 30, hardness: 0.9, ...fields });
    const pic = (strokes: object[]): ReturnType<typeof draw> => draw([paint(strokes)], [128, 128]);
    /** How many pixels along a row inside the stroke are not fully painted. */
    const gaps = (img: ReturnType<typeof draw>, y = 64): number => { let n = 0; for (let x = 24; x < 104; x++) if (px(img, x, y)[3]! < 128) n++; return n; };

    it('a flat brush held at an angle goes thick and thin with its direction', () => {
        const span = (points: number[][], column: boolean): number => {
            const img = pic([{ points, color: RED, size: 30, hardness: 1, roundness: 0.15, angle: 0 }]);
            let n = 0;
            for (let i = 0; i < 128; i++) if ((column ? px(img, 64, i) : px(img, i, 64))[3]! > 128) n++;
            return n;
        };
        // Held flat along x: a stroke going down is as wide as the brush, one going along x as thin as its edge.
        expect(span([[64, 10], [64, 118]], false)).toBeGreaterThan(24);
        expect(span([[10, 64], [118, 64]], true)).toBeLessThan(10);
    });

    it('a flat brush with no angle turns with the stroke, and stays its full width', () => {
        const down = pic([{ points: [[64, 10], [64, 118]], color: RED, size: 30, hardness: 1, roundness: 0.15 }]);
        const along = pic([{ points: [[10, 64], [118, 64]], color: RED, size: 30, hardness: 1, roundness: 0.15 }]);
        let [a, b] = [0, 0];
        for (let i = 0; i < 128; i++) { if (px(down, i, 64)[3]! > 128) a++; if (px(along, 64, i)[3]! > 128) b++; }
        expect(Math.abs(a - b)).toBeLessThanOrEqual(2);
        expect(a).toBeGreaterThan(24);
    });

    it('grain breaks a stroke up in a texture fixed to the picture, the same under every stroke', () => {
        expect(gaps(pic([line()]))).toBe(0);
        const rough = pic([line({ grain: 0.8 })]);
        expect(gaps(rough)).toBeGreaterThan(10);
        expect(gaps(pic([line({ grain: 0.8 })]))).toBe(gaps(rough));
        const moved = pic([line({ grain: 0.8, points: [[8, 64], [100, 70], [120, 64]] })]);
        let same = 0, both = 0;
        for (let x = 24; x < 90; x++) { const [p, q] = [px(rough, x, 64)[3]! > 128, px(moved, x, 64)[3]! > 128]; if (p || q) both++; if (p && q) same++; }
        expect(same / both).toBeGreaterThan(0.6);
    });

    it('dry leaves streaks that run along the stroke and not across it', () => {
        const img = pic([line({ dry: 0.6 })]);
        let [along, across] = [0, 0];
        for (let i = 34; i < 94; i++) along += Math.abs(px(img, i, 64)[3]! - px(img, i + 1, 64)[3]!);
        for (let i = 54; i < 74; i++) across += Math.abs(px(img, 64, i)[3]! - px(img, 64, i + 1)[3]!);
        expect(across / 20).toBeGreaterThan((along / 60) * 2);
        expect(across).toBeGreaterThan(100);
    });

    it('wet picks up what is under it and carries it along, and dry paint does not', () => {
        const blue = { points: [[8, 64], [50, 64]], color: BLUE, size: 40, hardness: 1 };
        const over = (wet: number): ReturnType<typeof draw> => pic([blue, { points: [[10, 64], [118, 64]], color: RED, size: 16, hardness: 1, wet }]);
        expect(px(over(0), 30, 64)[2]).toBe(0);
        expect(px(over(0.8), 30, 64)[2]).toBeGreaterThan(60);
        // Out past the blue, still carrying some, and less the further it goes.
        expect(px(over(0.8), 80, 64)[2]).toBeGreaterThan(20);
        expect(px(over(0.8), 110, 64)[2]).toBeLessThan(px(over(0.8), 80, 64)[2]!);
        expect(px(over(0), 80, 64)[2]).toBe(0);
    });

    it('edge gathers pigment at the rim, darker than inside', () => {
        const img = pic([{ points: [[8, 64], [120, 64]], color: '#000000', size: 40, hardness: 0.3, opacity: 0.5, edge: 0.9 }]);
        let best = 0;
        for (let y = 40; y < 64; y++) best = Math.max(best, px(img, 64, y)[3]!);
        expect(best).toBeGreaterThan(px(img, 64, 64)[3]! + 10);
    });

    it('scatter and dab make a spray, spaced and off the line', () => {
        const img = pic([{ points: [[20, 64], [108, 64]], color: RED, size: 40, dab: 0.08, scatter: 1, spacing: 0.5, hardness: 1 }]);
        let dots = 0, far = 0;
        for (let y = 40; y < 90; y++) for (let x = 20; x < 108; x++) if (px(img, x, y)[3]! > 60) { dots++; if (Math.abs(y - 64) > 8) far++; }
        expect(far).toBeGreaterThan(20);
        expect(dots).toBeLessThan(88 * 50 * 0.9);
    });

    it('flow builds up over its own passes, as opacity does not', () => {
        const once = pic([{ points: [[8, 64], [120, 64]], color: RED, size: 30, hardness: 0.5, flow: 0.01 }]);
        const twice = pic([{ points: [[8, 64], [120, 64], [8, 64]], color: RED, size: 30, hardness: 0.5, flow: 0.01 }]);
        expect(px(twice, 64, 64)[3]).toBeGreaterThan(px(once, 64, 64)[3]! + 10);
    });

    it('fade thins it out at its ends, in strength and not in width', () => {
        const img = pic([line({ fade: [0, 0.5], hardness: 1 })]);
        expect(px(img, 30, 64)[3]).toBeGreaterThan(px(img, 100, 64)[3]! + 80);
        expect(px(img, 100, 70)[3]).toBeGreaterThan(0);
    });

    it('a named brush starts from its settings, and what is given overrides them', () => {
        const base = pic([line()]);
        const named = pic([line({ brush: 'charcoal', hardness: undefined })]);
        expect(named.rgba).not.toEqual(base.rgba);
        expect(gaps(named)).toBeGreaterThan(5);
        expect(gaps(pic([line({ brush: 'charcoal', grain: 0, dry: 0 })]))).toBe(0);
        for (const brush of Object.keys(IMAGE_BRUSHES)) expect(pic([line({ brush })]).notes).toEqual([]);
        expect(() => validateImageSource({ size: 8, layers: [paint([line({ brush: 'crayon' })])] })).toThrow(/brush "crayon" must be one of ink,/);
    });

    it('is carried by a field and by a sweep', () => {
        const field = (extra: object): ReturnType<typeof draw> => pic([{ type: 'field', tone: RED, size: 12, length: 40, angle: 0, seed: 1, coverage: 1, ...extra }]);
        expect(field({ brush: 'dry' }).rgba).not.toEqual(field({}).rgba);
        const sweep = (extra: object): ReturnType<typeof draw> => pic([{ type: 'sweep', guides: [[[10, 10], [10, 110]], [[60, 10], [60, 110]]], colors: [RED], count: 60, size: 3, seed: 1, ...extra }]);
        expect(sweep({ brush: 'pencil' }).rgba).not.toEqual(sweep({}).rgba);
    });

    it('is the same every time', () => {
        for (const brush of ['oil', 'watercolor', 'spray']) expect(pic([line({ brush })]).rgba).toEqual(pic([line({ brush })]).rgba);
    });

    it('says what is wrong with a setting', () => {
        const bad = (fields: object): unknown => validateImageSource({ size: 8, layers: [paint([line(fields)])] });
        expect(() => bad({ roundness: 0 })).toThrow(/roundness must be above 0/);
        expect(() => bad({ grain: 2 })).toThrow(/grain must be 0..1/);
        expect(() => bad({ fade: [0] })).toThrow(/fade must be/);
        expect(() => bad({ spacing: 0 })).toThrow(/spacing must be positive/);
        expect(() => bad({ angle: 'up' })).toThrow(/angle must be degrees/);
    });
});

describe('what it measures', () => {
    it('finds where the picture is solid and how much of it that is', () => {
        const img = draw([{ shape: 'rect', at: [10, 20], size: [16, 8], fill: RED }]);
        expect(img.bounds).toEqual([10, 20, 16, 8]);
        expect(img.covers).toBeCloseTo((16 * 8) / (64 * 64), 2);
        expect(draw([{ shape: 'rect', at: [10, 20], size: [16, 8], fill: '#ff000020' }]).bounds).toBeNull();
    });

    it('leaves a faint glow out of it', () => {
        const img = draw([{ shape: 'rect', at: [20, 20], size: [24, 24], fill: RED, effects: [{ type: 'glow', blur: 6 }] }]);
        const [x, , w] = img.bounds!;
        expect(x).toBeGreaterThanOrEqual(16);
        expect(w).toBeLessThanOrEqual(32);
    });

    it('gives each named layer its box after transforms, stroke in and effects out, at any depth', () => {
        const img = draw([
            { shape: 'group', id: 'g', transform: { translate: [10, 0] }, layers: [{ id: 'r', shape: 'rect', at: [0, 0], size: [10, 10], fill: RED, stroke: { color: BLUE, width: 2 } }] },
            { shape: 'circle', at: [50, 50], radius: 4, fill: RED },
            { id: 'off', shape: 'rect', at: [100, 100], size: [4, 4], fill: RED },
            { id: 'hidden', shape: 'rect', at: [0, 0], size: [4, 4], fill: RED, visible: false },
            { id: 'p', shape: 'pixels', at: [0, 40], scale: 2, palette: { r: RED }, rows: ['r.', '.r'] },
        ]);
        expect(img.layerBounds.r).toEqual([9, 0, 12, 11]);
        expect(img.layerBounds.g).toEqual(img.layerBounds.r);
        expect(img.layerBounds.p).toEqual([0, 40, 4, 4]);
        expect(Object.keys(img.layerBounds).sort()).toEqual(['g', 'p', 'r']);
    });
});

describe('a set and a close look', () => {
    const a = draw([{ shape: 'rect', at: [0, 0], size: [64, 64], fill: RED }]);
    const b = draw([{ shape: 'rect', at: [0, 0], size: [32, 64], fill: BLUE }], [32, 64]);

    it('lays pictures out in columns, in order, each whole, whatever its shape', () => {
        const sheet = setSheet([a, b], 128);
        expect(sheet.width).toBe(8 + (128 + 8) * 2);
        const at = (x: number, y: number): number[] => Array.from(sheet.rgba.subarray((y * sheet.width + x) * 4, (y * sheet.width + x) * 4 + 3));
        expect(at(8 + 64, 8 + 64)).toEqual([255, 0, 0]);
        expect(at(8 + 136 + 32, 8 + 64)).toEqual([0, 0, 255]);
        for (let i = 3; i < sheet.rgba.length; i += 4) expect(sheet.rgba[i]).toBe(255);
        expect(() => setSheet([])).toThrow(/at least one/);
    });

    it('goes on to another row past eight', () => {
        const sheet = setSheet(Array.from({ length: 9 }, () => a), 32);
        expect(sheet.height).toBe(setSheet([a], 32).height * 2);
    });

    it('enlarges a part with hard pixels, on the check where it is clear', () => {
        const half = draw([{ shape: 'rect', at: [10, 0], size: [54, 64], fill: RED }]);
        const big = zoomImage(half, { x: 8, y: 8, w: 4, h: 4 }, 640);
        expect(big.width).toBe(640);
        const at = (x: number, y: number): number[] => Array.from(big.rgba.subarray((y * big.width + x) * 4, (y * big.width + x) * 4 + 3));
        // Two pixels of nothing and two of red, each 160 wide, and no blur between.
        expect(at(321, 80)).toEqual([255, 0, 0]);
        expect(at(319, 80)[1]).toBeGreaterThan(200);
        expect(() => zoomImage(half, { x: 500, y: 0, w: 4, h: 4 })).toThrow(/outside the picture/);
    });
});

const NOISE_PIN = -1320521626;

describe('the source', () => {
    const ok = (layers: unknown[]): unknown => ({ size: 16, layers });

    it('names the layer and the field', () => {
        expect(() => validateImageSource({ layers: [] })).toThrow(/size/);
        expect(() => validateImageSource({ size: 0, layers: [] })).toThrow(/size/);
        expect(() => validateImageSource({ size: 9999, layers: [] })).toThrow(/size/);
        expect(() => validateImageSource({ size: 16 })).toThrow(/layers/);
        expect(() => validateImageSource({ size: 16, layers: [], extra: 1 })).toThrow(/unknown field "extra"/);
        expect(() => validateImageSource(ok([{ shape: 'blob' }]))).toThrow(/layer 0.*shape "blob"/);
        expect(() => validateImageSource(ok([{ shape: 'rect', at: [0, 0], size: [1, 1] }]))).toThrow(/needs a fill or a stroke/);
        expect(() => validateImageSource(ok([{ shape: 'rect', at: [0, 0], fill: RED }]))).toThrow(/size/);
        expect(() => validateImageSource(ok([{ shape: 'circle', at: [0, 0], radius: 1, fill: 'red' }]))).toThrow(/fill "red"/);
        expect(() => validateImageSource(ok([{ shape: 'circle', at: [0, 0], radius: 1, fill: RED, wobble: 1 }]))).toThrow(/unknown field "wobble"/);
        expect(() => validateImageSource(ok([{ shape: 'circle', at: [0, 0], radius: 1, fill: { type: 'linear', from: [0, 0], to: [1, 1], stops: [[0, RED]] } }]))).toThrow(/two stops/);
        expect(() => validateImageSource(ok([{ shape: 'ring', at: [0, 0], radius: 1, inner: 2, fill: RED }]))).toThrow(/inner must be less/);
        expect(() => validateImageSource(ok([{ shape: 'circle', at: [0, 0], radius: 1, fill: RED, effects: [{ type: 'bevel' }] }]))).toThrow(/bevel/);
        expect(() => validateImageSource(ok([{ id: 'a', shape: 'circle', at: [0, 0], radius: 1, fill: RED }, { id: 'a', shape: 'circle', at: [0, 0], radius: 1, fill: RED }]))).toThrow(/already used/);
        expect(() => validateImageSource(ok([{ shape: 'group', layers: [{ shape: 'blob' }] }]))).toThrow(/layers\[0\]/);
    });

    it('finds a bad path before it is drawn, in a hidden layer too, and names the layer', () => {
        expect(() => validateImageSource(ok([{ id: 'p', shape: 'path', d: 'M0 0 A5 5 0 0 1 9 9', fill: RED, visible: false }]))).toThrow(/layer 0 "p".*M L H V C S Q T Z/);
        expect(() => validateImageSource(ok([{ shape: 'group', layers: [{ shape: 'path', d: 'M0', fill: RED }] }]))).toThrow(/layers\[0\].*short of numbers/);
    });

    it('counts the stroke widths in it, at any depth', () => {
        const s = validateImageSource(ok([{ shape: 'circle', at: [1, 1], radius: 1, stroke: { color: RED, width: 4 } }, { shape: 'group', layers: [{ shape: 'circle', at: [1, 1], radius: 1, stroke: { color: RED, width: 4 } }, { shape: 'circle', at: [1, 1], radius: 1, stroke: { color: RED, width: 2 } }] }]));
        expect(strokeWidths(s)).toEqual({ 4: 2, 2: 1 });
    });
});

describe('edits', () => {
    const base = validateImageSource({ size: 16, layers: [{ id: 'a', shape: 'circle', at: [8, 8], radius: 4, fill: RED }, { id: 'g', shape: 'group', layers: [{ id: 'b', shape: 'circle', at: [8, 8], radius: 2, fill: BLUE }] }] });
    const ids = (layers: readonly ImageLayer[]): string[] => layers.map((l) => l.id!);

    it('sets a field, at any depth, and a null takes it away', () => {
        const next = applyImageEdits(base, [{ op: 'set', layer: 'b', fields: { radius: 3 } }, { op: 'set', layer: 'a', fields: { opacity: 0.5 } }, { op: 'set', layer: 'a', fields: { opacity: null } }]);
        expect(next.layers[1]!.layers![0]!.radius).toBe(3);
        expect(next.layers[0]!.opacity).toBeUndefined();
        expect(base.layers[1]!.layers![0]!.radius).toBe(2);
    });

    it('inserts where it is told', () => {
        const c = { id: 'c', shape: 'circle' as const, at: [1, 1] as const, radius: 1, fill: RED };
        expect(ids(applyImageEdits(base, [{ op: 'insert', layer: c }]).layers)).toEqual(['a', 'g', 'c']);
        expect(ids(applyImageEdits(base, [{ op: 'insert', layer: c, before: 'a' }]).layers)).toEqual(['c', 'a', 'g']);
        expect(ids(applyImageEdits(base, [{ op: 'insert', layer: c, after: 'a' }]).layers)).toEqual(['a', 'c', 'g']);
        expect(ids(applyImageEdits(base, [{ op: 'insert', layer: c, into: 'g' }]).layers[1]!.layers!)).toEqual(['b', 'c']);
    });

    it('removes, and changes the settings', () => {
        expect(ids(applyImageEdits(base, [{ op: 'remove', layer: 'a' }]).layers)).toEqual(['g']);
        expect(applyImageEdits(base, [{ op: 'settings', fields: { size: 32, background: '#000' } }]).size).toBe(32);
        expect(applyImageEdits(base, [{ op: 'settings', fields: { background: '#000' } }, { op: 'settings', fields: { background: null } }]).background).toBeUndefined();
    });

    const row = validateImageSource({ size: 16, layers: [1, 2, 3, 4].map((n) => ({ id: `l${n}`, shape: 'circle', at: [n, n], radius: 1, fill: RED })) });

    it('moves a layer where it is told', () => {
        expect(ids(applyImageEdits(row, [{ op: 'move', layer: 'l4', before: 'l1' }]).layers)).toEqual(['l4', 'l1', 'l2', 'l3']);
        expect(ids(applyImageEdits(row, [{ op: 'move', layer: 'l1', after: 'l3' }]).layers)).toEqual(['l2', 'l3', 'l1', 'l4']);
        expect(ids(applyImageEdits(row, [{ op: 'move', layer: 'l1' }]).layers)).toEqual(['l2', 'l3', 'l4', 'l1']);
        expect(ids(applyImageEdits(base, [{ op: 'move', layer: 'a', into: 'g' }]).layers)).toEqual(['g']);
        expect(ids(applyImageEdits(base, [{ op: 'move', layer: 'b', before: 'a' }]).layers)).toEqual(['b', 'a', 'g']);
    });

    it('will not move a group into itself', () => {
        expect(() => applyImageEdits(base, [{ op: 'move', layer: 'g', into: 'b' }])).toThrow(/itself or inside it/);
        expect(() => applyImageEdits(base, [{ op: 'move', layer: 'a', before: 'l9' }])).toThrow(/no layer "l9"/);
        expect(() => applyImageEdits(base, [{ op: 'move', layer: 'a', before: 'g', after: 'b' }])).toThrow(/one of/);
    });

    it('wraps layers into a group where the first was, in drawing order however they were named', () => {
        const next = applyImageEdits(row, [{ op: 'wrap', layers: ['l3', 'l2'], group: { id: 'g', transform: { rotate: 10 } } }]);
        expect(ids(next.layers)).toEqual(['l1', 'g', 'l4']);
        expect(ids(next.layers[1]!.layers!)).toEqual(['l2', 'l3']);
        expect(next.layers[1]!.transform?.rotate).toBe(10);
    });

    it('wrapping changes nothing drawn until the group is given something', () => {
        const before = renderImage(validateImageSource({ size: 32, layers: [{ id: 'a', shape: 'circle', at: [16, 16], radius: 9, fill: RED }, { id: 'b', shape: 'circle', at: [20, 16], radius: 9, fill: BLUE }] }));
        const after = renderImage(applyImageEdits(validateImageSource({ size: 32, layers: [{ id: 'a', shape: 'circle', at: [16, 16], radius: 9, fill: RED }, { id: 'b', shape: 'circle', at: [20, 16], radius: 9, fill: BLUE }] }), [{ op: 'wrap', layers: ['a', 'b'], group: { id: 'g' } }]));
        let worst = 0;
        for (let i = 0; i < before.rgba.length; i++) worst = Math.max(worst, Math.abs(before.rgba[i]! - after.rgba[i]!));
        expect(worst).toBeLessThanOrEqual(2);
    });

    it('wraps only what lies side by side', () => {
        expect(() => applyImageEdits(base, [{ op: 'wrap', layers: ['a', 'b'], group: {} }])).toThrow(/not all in one list/);
        expect(() => applyImageEdits(base, [{ op: 'wrap', layers: [], group: {} }])).toThrow(/needs layers/);
    });

    it('unwraps a group back into its place, and will not lose what it holds', () => {
        expect(ids(applyImageEdits(base, [{ op: 'unwrap', layer: 'g' }]).layers)).toEqual(['a', 'b']);
        const tilted = applyImageEdits(base, [{ op: 'set', layer: 'g', fields: { transform: { rotate: 5 } } }]);
        expect(() => applyImageEdits(tilted, [{ op: 'unwrap', layer: 'g' }])).toThrow(/transform, which its layers would lose/);
        expect(() => applyImageEdits(base, [{ op: 'unwrap', layer: 'a' }])).toThrow(/not a group/);
    });

    it('changes a pixel without restating the rows', () => {
        const art = validateImageSource({ size: 8, layers: [{ id: 'art', shape: 'pixels', palette: { r: RED, b: BLUE }, rows: ['rrrr', 'rrrr'] }] });
        expect(applyImageEdits(art, [{ op: 'pixels', layer: 'art', set: [{ row: 1, at: 2, text: 'bb' }, { row: 0, text: 'b' }] }]).layers[0]!.rows).toEqual(['brrr', 'rrbb']);
        expect(() => applyImageEdits(art, [{ op: 'pixels', layer: 'art', set: [{ row: 5, text: 'b' }] }])).toThrow(/rows 0\.\.1/);
        expect(() => applyImageEdits(art, [{ op: 'pixels', layer: 'art', set: [{ row: 0, at: 3, text: 'bb' }] }])).toThrow(/does not fit/);
        expect(() => applyImageEdits(art, [{ op: 'pixels', layer: 'art', set: [{ row: 0, text: 'x' }] }])).toThrow(/not in the palette/);
        expect(() => applyImageEdits(base, [{ op: 'pixels', layer: 'a', set: [] }])).toThrow(/not pixels/);
    });

    it('paints a column or an area, counting from 0', () => {
        const art = validateImageSource({ size: 8, layers: [{ id: 'art', shape: 'pixels', palette: { r: RED, b: BLUE }, rows: ['rrrr', 'rrrr', 'rrrr'] }] });
        expect(applyImageEdits(art, [{ op: 'pixels', layer: 'art', rect: [{ x: 1, y: 0, h: 3, text: 'b' }] }]).layers[0]!.rows).toEqual(['rbrr', 'rbrr', 'rbrr']);
        expect(applyImageEdits(art, [{ op: 'pixels', layer: 'art', rect: [{ x: 2, y: 1, w: 2, h: 2, text: '.' }] }]).layers[0]!.rows).toEqual(['rrrr', 'rr..', 'rr..']);
        expect(applyImageEdits(art, [{ op: 'pixels', layer: 'art', rect: [{ x: 3, y: 2, text: 'b' }] }]).layers[0]!.rows).toEqual(['rrrr', 'rrrr', 'rrrb']);
        expect(() => applyImageEdits(art, [{ op: 'pixels', layer: 'art', rect: [{ x: 3, y: 0, w: 2, text: 'b' }] }])).toThrow(/is 4 by 3.*does not fit/);
        expect(() => applyImageEdits(art, [{ op: 'pixels', layer: 'art', rect: [{ x: 0, y: 0, text: 'bb' }] }])).toThrow(/one character/);
        expect(() => applyImageEdits(art, [{ op: 'pixels', layer: 'art', rect: [{ x: 0, y: 0, text: 'x' }] }])).toThrow(/not in the palette/);
    });

    it('adds and removes a colour without restating the others', () => {
        const art = validateImageSource({ size: 8, layers: [{ id: 'art', shape: 'pixels', palette: { r: RED, b: BLUE }, rows: ['rr'] }] });
        const added = applyImageEdits(art, [{ op: 'pixels', layer: 'art', palette: { g: '#00ff00' }, rect: [{ x: 0, y: 0, text: 'g' }] }]).layers[0]!;
        expect(added.palette).toEqual({ r: RED, b: BLUE, g: '#00ff00' });
        expect(added.rows).toEqual(['gr']);
        expect(applyImageEdits(art, [{ op: 'pixels', layer: 'art', palette: { b: null } }]).layers[0]!.palette).toEqual({ r: RED });
        expect(() => applyImageEdits(art, [{ op: 'pixels', layer: 'art', palette: { r: null } }])).toThrow(/not in the palette/);
    });

    it('says what it could not find, and refuses what would not be valid', () => {
        expect(() => applyImageEdits(base, [{ op: 'remove', layer: 'zz' }])).toThrow(/no layer "zz"; ids: a, g, b/);
        expect(() => applyImageEdits(base, [{ op: 'insert', layer: {} as never, into: 'a' }])).toThrow(/not a group/);
        expect(() => applyImageEdits(base, [{ op: 'set', layer: 'a', fields: { radius: -1 } }])).toThrow(/radius/);
        expect(() => applyImageEdits(base, [{ op: 'spin' } as never])).toThrow(/set, insert, remove, move, paint, wrap, unwrap, pixels, settings/);
    });
});
