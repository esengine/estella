// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/** Shapes read out of a picture: the outline of what was pointed at, in the places it is, and the strongest edges as lines. */
import { describe, expect, it } from 'vitest';
import { colorOfPatch, differenceMask, drawLine, growRegion, maskEdgeOver, outlineOfMask, simplifyLine, traceEdgeLines, type PixelPoint } from '../src/look/trace';
import type { RgbaImage } from '../src/look/pictures';

type Shade = (x: number, y: number) => readonly [number, number, number];
function image(width: number, height: number, shade: Shade): RgbaImage {
    const rgba = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const c = shade(x, y);
            rgba.set([c[0], c[1], c[2], 255], (y * width + x) * 4);
        }
    }
    return { width, height, rgba };
}
const BG = [20, 40, 90] as const, FG = [200, 150, 130] as const;
const disc = (cx: number, cy: number, r: number): Shade => (x, y) => (Math.hypot(x - cx, y - cy) <= r ? FG : BG);
/** The area and the middle of a closed line. */
const measure = (line: readonly PixelPoint[]): { area: number; cx: number; cy: number } => {
    let [area, cx, cy] = [0, 0, 0];
    line.forEach((p, i) => {
        const q = line[(i + 1) % line.length]!;
        const cross = p[0] * q[1] - q[0] * p[1];
        area += cross; cx += (p[0] + q[0]) * cross; cy += (p[1] + q[1]) * cross;
    });
    return { area: Math.abs(area / 2), cx: cx / (3 * area), cy: cy / (3 * area) };
};
const fromMask = (mask: Uint8Array, w: number, h: number): PixelPoint[] => outlineOfMask(mask, w, h);

describe('growRegion and outlineOfMask', () => {
    it('finds what the seed is inside, in the place it is', () => {
        const pic = image(200, 160, disc(90, 70, 40));
        const line = fromMask(growRegion(pic, [[90, 70]]), 200, 160);
        const m = measure(line);
        expect(m.cx).toBeCloseTo(90, 0);
        expect(m.cy).toBeCloseTo(70, 0);
        // Walked along border pixels, so a little inside the true edge.
        expect(m.area).toBeGreaterThan(Math.PI * 38 * 38);
        expect(m.area).toBeLessThan(Math.PI * 41 * 41);
    });

    it('goes round a concave shape and into its notch', () => {
        const shape: Shade = (x, y) => (x >= 20 && x < 120 && y >= 20 && y < 100 && !(x >= 60 && x < 80 && y < 70) ? FG : BG);
        const line = fromMask(growRegion(image(140, 120, shape), [[40, 50]], { smooth: 0 }), 140, 120);
        expect(measure(line).area).toBeCloseTo(99 * 79 - 18 * 50, -3);
        // The floor of the notch is on the outline.
        expect(line.some(([x, y]) => x > 62 && x < 78 && Math.abs(y - 70) <= 1)).toBe(true);
    });

    it('stops at what is not joined to it: one seed, one of two discs', () => {
        const two: Shade = (x, y) => (Math.hypot(x - 50, y - 50) <= 30 || Math.hypot(x - 150, y - 50) <= 30 ? FG : BG);
        const mask = growRegion(image(200, 100, two), [[50, 50]]);
        expect(mask[50 * 200 + 150]).toBe(0);
        expect(mask[50 * 200 + 50]).toBe(1);
        // Two seeds, both.
        const both = growRegion(image(200, 100, two), [[50, 50], [150, 50]]);
        expect(both[50 * 200 + 150]).toBe(1);
    });

    it('takes shading across one thing, and a tolerance says how much', () => {
        const shaded: Shade = (x, y) => { const v = 130 + (x - 30) * 1.2; return Math.hypot(x - 80, y - 60) <= 50 ? [v, v * 0.8, v * 0.7] : BG; };
        const wide = growRegion(image(160, 120, shaded), [[80, 60]], { tolerance: 40 });
        const narrow = growRegion(image(160, 120, shaded), [[80, 60]], { tolerance: 5 });
        const count = (m: Uint8Array): number => m.reduce((sum, v) => sum + v, 0);
        expect(count(wide)).toBeGreaterThan(count(narrow) * 1.5);
    });

    it('fills what is inside: a face is one thing with an eye in it', () => {
        const eye: Shade = (x, y) => (Math.hypot(x - 60, y - 60) <= 5 ? [10, 10, 10] : disc(60, 60, 40)(x, y));
        const mask = growRegion(image(120, 120, eye), [[60, 35]]);
        expect(mask[60 * 120 + 60]).toBe(1);
    });

    it('is held back by a place known to be outside, where a colour alone would run on', () => {
        // Two colours that shade into each other, and no edge between: only `not` can part them.
        const ramp: Shade = (x) => [Math.round(100 + x), 100, 100];
        const free = growRegion(image(120, 40, ramp), [[10, 20]], { tolerance: 60 });
        const held = growRegion(image(120, 40, ramp), [[10, 20]], { tolerance: 60, not: [[110, 20]] });
        const right = (m: Uint8Array): number => m[20 * 120 + 100]!;
        expect(right(free)).toBe(1);
        expect(right(held)).toBe(0);
        expect(held[20 * 120 + 10]).toBe(1);
    });

    it('keeps a part the edge of the crop cuts: it is not eaten from there', () => {
        const half: Shade = (x) => (x < 50 ? FG : BG);
        const mask = growRegion(image(100, 60, half), [[20, 30]]);
        expect(mask[30 * 100]).toBe(1);
        expect(mask[0]).toBe(1);
    });

    it('survives a speck of noise inside and a thin spur outside', () => {
        const rough: Shade = (x, y) => {
            if (x === 60 && y === 60) return BG;
            if (y === 60 && x > 80 && x < 110) return FG;
            return disc(60, 60, 25)(x, y);
        };
        const mask = growRegion(image(120, 120, rough), [[50, 50]]);
        expect(mask[60 * 120 + 60]).toBe(1);
        expect(mask[60 * 120 + 100]).toBe(0);
    });

    it('says what is wrong', () => {
        const pic = image(20, 20, () => BG);
        expect(() => growRegion(pic, [])).toThrow(/at least one/);
        expect(() => growRegion(pic, [[30, 5]])).toThrow(/off the picture/);
        expect(() => growRegion(pic, [[5, 5]], { tolerance: 0 })).toThrow(/positive/);
    });

    it('walks a mask of one piece closed, and takes the largest of several', () => {
        const mask = new Uint8Array(100);
        for (const i of [11, 12, 13, 21, 22, 23, 31, 32, 33, 77]) mask[i] = 1;
        const line = outlineOfMask(mask, 10, 10);
        expect(new Set(line.map((p) => p.join())).size).toBe(8);
        expect(line.some(([x, y]) => x === 7 && y === 7)).toBe(false);
        const [a, b] = [line[0]!, line[line.length - 1]!];
        expect(Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]))).toBe(1);
        expect(outlineOfMask(new Uint8Array(4), 2, 2)).toEqual([]);
    });
});

describe('simplifyLine', () => {
    it('leaves the corners of what was straight', () => {
        const run: PixelPoint[] = [];
        for (let i = 0; i <= 50; i++) run.push([i, 0]);
        for (let i = 1; i <= 50; i++) run.push([50, i]);
        expect(simplifyLine(run, 0.5)).toEqual([[0, 0], [50, 0], [50, 50]]);
    });

    it('never strays from the line by more than asked', () => {
        const curve: PixelPoint[] = Array.from({ length: 200 }, (_, i) => [i, 40 * Math.sin(i / 30)]);
        const kept = simplifyLine(curve, 1);
        expect(kept.length).toBeLessThan(40);
        for (const p of curve) {
            let best = Infinity;
            for (let i = 1; i < kept.length; i++) {
                const [a, b] = [kept[i - 1]!, kept[i]!];
                const [ex, ey] = [b[0] - a[0], b[1] - a[1]];
                const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / (ex * ex + ey * ey)));
                best = Math.min(best, Math.hypot(p[0] - a[0] - ex * t, p[1] - a[1] - ey * t));
            }
            expect(best).toBeLessThanOrEqual(1.001);
        }
    });

    it('closes a closed line with no point given twice', () => {
        const ring: PixelPoint[] = Array.from({ length: 100 }, (_, i) => [50 + 40 * Math.cos((i / 100) * Math.PI * 2), 50 + 40 * Math.sin((i / 100) * Math.PI * 2)]);
        const kept = simplifyLine(ring, 1, true);
        expect(kept.length).toBeLessThan(30);
        expect(kept.length).toBeGreaterThan(6);
        expect(new Set(kept.map((p) => p.join())).size).toBe(kept.length);
        expect(measure(kept).area).toBeGreaterThan(Math.PI * 40 * 40 * 0.92);
    });
});

describe('traceEdgeLines', () => {
    it('finds a long edge as one line, where it is', () => {
        const step: Shade = (x, y) => (y < 0.4 * x + 30 ? [40, 60, 110] : [190, 190, 200]);
        const lines = traceEdgeLines(image(200, 160, step), { minLength: 20 });
        expect(lines.length).toBeGreaterThan(0);
        const longest = lines[0]!;
        const span = Math.hypot(longest[longest.length - 1]![0] - longest[0]![0], longest[longest.length - 1]![1] - longest[0]![1]);
        expect(span).toBeGreaterThan(150);
        for (const [x, y] of longest) expect(Math.abs(y - (0.4 * x + 30))).toBeLessThan(3);
        // A straight edge simplified is a few points and not every pixel.
        expect(longest.length).toBeLessThan(12);
    });

    it('finds nothing in a flat picture, and leaves out what is short', () => {
        expect(traceEdgeLines(image(60, 60, () => BG))).toEqual([]);
        expect(traceEdgeLines(image(100, 100, disc(50, 50, 4)), { minLength: 200 })).toEqual([]);
    });

    it('longest first, and no more than asked', () => {
        const two: Shade = (x, y) => ((y > 30 && y < 40 && x > 10 && x < 190) || (y > 100 && y < 110 && x > 60 && x < 130) ? [220, 220, 220] : [20, 20, 20]);
        const lines = traceEdgeLines(image(200, 140, two), { minLength: 10 });
        const reach = (l: readonly PixelPoint[]): number => Math.max(...l.map((p) => p[0])) - Math.min(...l.map((p) => p[0]));
        expect(reach(lines[0]!)).toBeGreaterThan(reach(lines[lines.length - 1]!));
        expect(traceEdgeLines(image(200, 140, two), { minLength: 10, most: 1 })).toHaveLength(1);
    });

    it('does the same every time', () => {
        const pic = image(120, 120, disc(60, 60, 40));
        expect(traceEdgeLines(pic)).toEqual(traceEdgeLines(pic));
    });
});

describe('colorOfPatch', () => {
    it('reads the colour there, in hex and in linear', () => {
        const pic = image(40, 40, (x) => (x < 20 ? [255, 0, 0] : [0, 0, 255]));
        expect(colorOfPatch(pic, 5, 20, 2)).toEqual({ hex: '#ff0000', linear: [1, 0, 0] });
        expect(colorOfPatch(pic, 35, 20, 2).hex).toBe('#0000ff');
    });

    it('averages in light: half black and half white is not 128', () => {
        const pic = image(40, 40, (x) => (x < 20 ? [0, 0, 0] : [255, 255, 255]));
        const c = colorOfPatch(pic, 20, 20, 6);
        expect(c.linear[0]).toBeGreaterThan(0.4);
        expect(c.linear[0]).toBeLessThan(0.65);
        expect(parseInt(c.hex.slice(1, 3), 16)).toBeGreaterThan(170);
    });

    it('says when a place is off the picture', () => {
        expect(() => colorOfPatch(image(10, 10, () => BG), 50, 5, 1)).toThrow(/off the picture/);
    });
});

describe('drawing on a picture', () => {
    it('draws a line in place, leaving the rest', () => {
        const pic = image(20, 20, () => BG);
        drawLine(pic, [[2, 10], [17, 10]], [255, 0, 255]);
        expect(Array.from(pic.rgba.subarray((10 * 20 + 10) * 4, (10 * 20 + 10) * 4 + 3))).toEqual([255, 0, 255]);
        expect(Array.from(pic.rgba.subarray((2 * 20 + 2) * 4, (2 * 20 + 2) * 4 + 3))).toEqual([...BG]);
    });

    it('a closed line returns to its start', () => {
        const pic = image(20, 20, () => BG);
        drawLine(pic, [[2, 2], [15, 2], [15, 15]], [255, 0, 255], true);
        expect(pic.rgba[(8 * 20 + 8) * 4]).toBe(255);
    });

    it('finds what two pictures differ by, ignoring what is barely different', () => {
        const a = image(10, 10, () => [100, 100, 100]);
        const b = image(10, 10, (x) => (x < 5 ? [100, 100, 100] : x < 8 ? [101, 101, 101] : [200, 100, 100]));
        const mask = differenceMask(a, b);
        expect(mask[0]).toBe(0);
        expect(mask[6]).toBe(0);
        expect(mask[9]).toBe(1);
    });

    it('draws the border of a mask at another size, and only the border', () => {
        const mask = new Uint8Array(100);
        for (let y = 3; y < 7; y++) for (let x = 3; x < 7; x++) mask[y * 10 + x] = 1;
        const over = maskEdgeOver(image(100, 100, () => BG), mask, 10, 10, [0, 255, 255]);
        const px = (x: number, y: number): number[] => Array.from(over.rgba.subarray((y * 100 + x) * 4, (y * 100 + x) * 4 + 3));
        expect(px(50, 30)).toEqual([0, 255, 255]);
        expect(px(50, 50)).toEqual([...BG]);
        expect(px(10, 10)).toEqual([...BG]);
    });
});
