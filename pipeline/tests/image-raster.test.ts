// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/** A picture from layers: each draws what it says and where, edges are antialiased, and what is wrong with a source is said before anything is drawn. */
import { describe, expect, it } from 'vitest';
import { imageSheet, parseColor, parsePath, renderImage, setSheet, zoomImage } from '../src/image/imageRaster';
import { applyImageEdits, strokeWidths, validateImageSource, type ImageLayer } from '../src/image/imageSource';

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
        expect(() => validateImageSource({ size: 8, layers: [{ shape: 'rect', at: [0, 0], size: [8, 8], fill: { type: 'wavy', stops: [] } }] })).toThrow(/linear, radial or noise/);
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
        const big = zoomImage(half, { x: 8, y: 8, w: 4, h: 4 });
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
