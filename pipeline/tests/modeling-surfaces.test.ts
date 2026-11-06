// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/** Lathe and loft, held to the volume a shape must enclose and a surface that closes and faces out. */
import { beforeAll, describe, expect, it } from 'vitest';
import { bakeModel, prepareModeling, renderModelSheet, validateModelSource, type BakedModel, type ModelStep } from '../src/modeling';

beforeAll(() => prepareModeling());

const model = (...steps: ModelStep[]): BakedModel => bakeModel({ version: 1, steps });

function volume(m: BakedModel): number {
    let v = 0;
    for (const { v: [a, b, c] } of m.triangles) {
        const [p, q, r] = [m.poly.positions[a]!, m.poly.positions[b]!, m.poly.positions[c]!];
        v += p[0] * (q[1] * r[2] - q[2] * r[1]) + p[1] * (q[2] * r[0] - q[0] * r[2]) + p[2] * (q[0] * r[1] - q[1] * r[0]);
    }
    return v / 6;
}

function sound(m: BakedModel): void {
    expect(m.report.openEdges).toBe(0);
    expect(m.report.nonManifoldEdges).toBe(0);
    expect(m.report.flippedEdges).toBe(0);
    expect(m.report.insideOutShells).toBe(0);
    expect(m.report.degenerateFaces).toBe(0);
    expect(m.report.warnings).toEqual([]);
}

/** The area of a regular n-gon of radius r: what a turned circle really encloses. */
const ngon = (r: number, n: number): number => (n / 2) * r * r * Math.sin((2 * Math.PI) / n);

describe('lathe', () => {
    it('a straight outline off the axis is a cylinder with flat ends', () => {
        const m = model({ op: 'lathe', profile: [[1, 0], [1, 2]], sides: 16 });
        sound(m);
        expect(volume(m)).toBeCloseTo(ngon(1, 16) * 2, 5);
        expect(m.report.bounds.min[1]).toBe(0);
        expect(m.report.bounds.max[1]).toBe(2);
    });

    it('an end on the axis closes to a point: a cone', () => {
        const m = model({ op: 'lathe', profile: [[1, 0], [0, 3]], sides: 16 });
        sound(m);
        expect(volume(m)).toBeCloseTo((ngon(1, 16) * 3) / 3, 5);
    });

    it('both ends on the axis make a solid with no caps: a double cone', () => {
        const m = model({ op: 'lathe', profile: [[0, 0], [1, 1], [0, 2]], sides: 16 });
        sound(m);
        expect(volume(m)).toBeCloseTo((ngon(1, 16) * 2) / 3, 5);
    });

    it('faces out whichever way the outline was walked', () => {
        const up = model({ op: 'lathe', profile: [[1, 0], [1, 2]], sides: 16 });
        const down = model({ op: 'lathe', profile: [[1, 2], [1, 0]], sides: 16 });
        sound(down);
        expect(volume(down)).toBeCloseTo(volume(up), 6);
    });

    it('a cup: up the outside and back down the inside holds only its walls', () => {
        const m = model({ op: 'lathe', sides: 32, profile: [[0, 0], [1, 0], [1, 2], [0.9, 2], [0.9, 0.1], [0, 0.1]] });
        sound(m);
        const area = (r: number): number => ngon(r, 32);
        expect(volume(m)).toBeCloseTo(area(1) * 2 - area(0.9) * 1.9, 4);
    });

    it('a closed outline is a ring, with a hole down the axis', () => {
        const m = model({ op: 'lathe', closed: true, sides: 64, curve: 8, profile: [[1.3, 0], [1, 0.3], [0.7, 0], [1, -0.3]] });
        sound(m);
        expect(m.report.bounds.min[0]).toBeLessThan(-1.2);
        expect(volume(m)).toBeGreaterThan(0);
        // Nothing near the axis: it is a hole.
        expect(Math.min(...m.poly.positions.map((p) => Math.hypot(p[0], p[2])))).toBeGreaterThan(0.6);
    });

    it('part of a turn closes its two cut faces', () => {
        const half = model({ op: 'lathe', arc: 180, sides: 32, profile: [[1, 0], [1, 2]] });
        sound(half);
        expect(volume(half)).toBeCloseTo((32 / 2) * Math.sin(Math.PI / 32) * 2, 4);
    });

    it('part of a turn of a closed outline too', () => {
        const m = model({ op: 'lathe', arc: 90, sides: 16, closed: true, profile: [[2, 0], [3, 0], [3, 1], [2, 1]] });
        sound(m);
        expect(volume(m)).toBeGreaterThan(0);
    });

    it('curve rounds through the given points, exactly', () => {
        const profile: [number, number][] = [[0, 0], [1, 0.5], [0.4, 1.5], [0.6, 2.5], [0, 3]];
        const m = model({ op: 'lathe', profile, curve: 8, sides: 32 });
        sound(m);
        for (const [r, h] of profile) {
            const hit = m.poly.positions.some((p) => Math.abs(Math.hypot(p[0], p[2]) - r) < 1e-6 && Math.abs(p[1] - h) < 1e-6);
            expect(hit, `[${r}, ${h}]`).toBe(true);
        }
        expect(m.report.faces).toBeGreaterThan(32 * 16);
    });

    it('a point given twice keeps a corner under curve', () => {
        const sharp = model({ op: 'lathe', curve: 8, sides: 16, profile: [[0, 0], [1, 0], [1, 0], [1, 1], [0, 1]] });
        sound(sharp);
        // The curve stops at the corner rather than rounding it off: the point is on the surface, and the bottom stays flat.
        expect(sharp.poly.positions.some((p) => Math.abs(Math.hypot(p[0], p[2]) - 1) < 1e-6 && Math.abs(p[1]) < 1e-6)).toBe(true);
        expect(sharp.report.bounds.min[1]).toBeCloseTo(0, 5);
    });

    it('stands on any axis, without turning inside out', () => {
        for (const axis of ['x', 'z']) {
            const m = model({ op: 'lathe', profile: [[1, 0], [1, 2]], sides: 16, axis });
            sound(m);
            expect(volume(m)).toBeCloseTo(ngon(1, 16) * 2, 5);
        }
        expect(model({ op: 'lathe', profile: [[1, 0], [1, 2]], axis: 'x' }).report.bounds.size[0]).toBeCloseTo(2, 5);
        expect(model({ op: 'lathe', profile: [[1, 0], [1, 2]], axis: 'z' }).report.bounds.size[2]).toBeCloseTo(2, 5);
    });

    it('shades a round wall smooth and keeps a rim hard', () => {
        const m = model({ op: 'lathe', profile: [[1, 0], [1, 2]], sides: 32 });
        expect(m.data.vertexCount).toBeLessThan(32 * 8 + 80);
    });

    it('refuses what it cannot turn, saying why', () => {
        expect(() => model({ op: 'lathe', profile: [[1, 0]] })).toThrow(/at least 2 points/);
        expect(() => model({ op: 'lathe', profile: [[-1, 0], [1, 1]] })).toThrow(/negative distance/);
        expect(() => model({ op: 'lathe', profile: [[1, 0], [0, 1], [1, 2]] })).toThrow(/only the two ends .* can touch the axis/);
        expect(() => model({ op: 'lathe', profile: [[0, 0], [0, 2]] })).toThrow(/along the axis/);
        expect(() => model({ op: 'lathe', closed: true, profile: [[0, 0], [1, 0], [1, 1]] })).toThrow(/closed profile cannot touch/);
        expect(() => model({ op: 'lathe', profile: [[1, 0], [1, 1]], arc: 400 })).toThrow(/arc 400/);
        expect(() => validateModelSource({ steps: [{ op: 'lathe', profile: [[1, 0], [1, 1]], curv: 3 }] })).toThrow(/unknown field "curv"/);
    });
});

describe('loft', () => {
    it('two rectangles are a box, exactly', () => {
        const m = model({ op: 'loft', sections: [{ at: [0, 0, 0], size: [2, 1] }, { at: [0, 0, 3], size: [2, 1] }] });
        sound(m);
        expect(volume(m)).toBeCloseTo(6, 6);
        expect(m.report.faces).toBe(6);
    });

    it('a straight pipe holds its n-gon times its length, along any direction', () => {
        for (const end of [[0, 3, 0], [3, 0, 0], [0, 0, 3], [2, 2, 1]] as const) {
            const m = model({ op: 'loft', path: [[0, 0, 0], end as never], section: { radius: 0.5 }, sides: 24 });
            sound(m);
            expect(volume(m)).toBeCloseTo(ngon(0.5, 24) * Math.hypot(...end), 5);
        }
    });

    it('a taper is a frustum', () => {
        const m = model({ op: 'loft', path: [[0, 0, 0], [0, 2, 0]], section: { size: [2, 2] }, scales: [1, 0.5] });
        sound(m);
        expect(volume(m)).toBeCloseTo((2 * (4 + 1 + 2)) / 3, 5);
    });

    it('a section differing from the next is joined without a wring', () => {
        const m = model({ op: 'loft', sides: 32, sections: [{ at: [0, 0, 0], radius: 1 }, { at: [0, 2, 0], size: [2, 2] }] });
        sound(m);
        // The walls run nearly straight up: a wrung join would have them lean far round the axis.
        const pos = m.poly.positions;
        for (const face of m.poly.faces.filter((f) => f.v.length === 4)) {
            for (let i = 0; i < 4; i++) {
                const a = pos[face.v[i]!]!, b = pos[face.v[(i + 1) % 4]!]!;
                if (Math.abs(a[1] - b[1]) > 1) expect(Math.hypot(a[0] - b[0], a[2] - b[2])).toBeLessThan(0.5);
            }
        }
    });

    it('a pipe round a bend closes and keeps its section', () => {
        const m = model({ op: 'loft', path: [[0, 0, 0], [0, 2, 0], [2, 2, 0], [2, 2, 2]], section: { radius: 0.2 }, curve: 8, sides: 16 });
        sound(m);
        expect(m.report.shells).toBe(1);
    });

    it('a frame carried along a path does not spin the section: a ribbon stays a ribbon', () => {
        const m = model({ op: 'loft', path: [[0, 0, 0], [0, 0, 1], [0, 0, 2], [0, 0, 3]], section: { size: [2, 0.2] } });
        expect(m.report.bounds.size[0]).toBeCloseTo(2, 5);
        expect(m.report.bounds.size[1]).toBeCloseTo(0.2, 5);
    });

    it('twist turns a section about the path', () => {
        const m = model({ op: 'loft', sections: [{ at: [0, 0, 0], size: [2, 0.2] }, { at: [0, 0, 1], size: [2, 0.2], twist: 90 }] });
        sound(m);
        expect(m.report.bounds.size[0]).toBeCloseTo(2, 5);
        expect(m.report.bounds.size[1]).toBeCloseTo(2, 5);
    });

    it('closed joins the end to the start: a ring, with no caps', () => {
        const path: [number, number, number][] = Array.from({ length: 8 }, (_, i) => [Math.cos((i * Math.PI) / 4) * 2, 0, Math.sin((i * Math.PI) / 4) * 2]);
        const m = model({ op: 'loft', path, section: { radius: 0.3 }, closed: true, curve: 4, sides: 16 });
        sound(m);
        expect(m.report.faces).toBe(8 * 4 * 16);
        expect(Math.abs(volume(m) - 2 * Math.PI ** 2 * 2 * 0.3 ** 2)).toBeLessThan(0.15);
    });

    it('any outline can be carried, walked either way', () => {
        const l: [number, number][] = [[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]];
        const m = model({ op: 'loft', path: [[0, 0, 0], [0, 0, 2]], section: { points: l } });
        sound(m);
        expect(volume(m)).toBeCloseTo(6, 5);
        const back = model({ op: 'loft', path: [[0, 0, 0], [0, 0, 2]], section: { points: [...l].reverse() } });
        sound(back);
        expect(volume(back)).toBeCloseTo(6, 5);
    });

    it('curve passes through the sections it was given', () => {
        const m = model({ op: 'loft', sections: [{ at: [0, 0, 0], radius: 1 }, { at: [0, 1, 0], radius: 0.4 }, { at: [0, 2, 0], radius: 0.8 }], curve: 6, sides: 16 });
        sound(m);
        const at = (h: number): number => Math.max(...m.poly.positions.filter((p) => Math.abs(p[1] - h) < 1e-6).map((p) => Math.hypot(p[0], p[2])));
        expect(at(1)).toBeCloseTo(0.4, 4);
        expect(at(2)).toBeCloseTo(0.8, 4);
    });

    it('a later boolean can cut what it made, and a uv can wrap it', () => {
        const m = model(
            { op: 'loft', path: [[0, 0, 0], [0, 3, 0]], section: { radius: 1 }, sides: 24, tag: 'tube' },
            { op: 'box', size: [0.5, 0.5, 4], at: [0, 1.5, 0], tag: 'cut' },
            { op: 'boolean', operation: 'subtract', with: 'cut', from: 'tube' },
            { op: 'uv', faces: 'tube', mode: 'cylinder', axis: 'y' },
        );
        expect(m.report.openEdges).toBe(0);
        expect(volume(m)).toBeLessThan(ngon(1, 24) * 3);
    });

    it('a silhouette shows the bend it was given', () => {
        const panel = 96;
        const m = model({ op: 'loft', path: [[-2, 0, 0], [0, 2, 0], [2, 0, 0]], section: { radius: 0.2 }, curve: 8 });
        const s = renderModelSheet(m, ['front'], panel);
        const dark = (x: number, y: number): boolean => s.rgba[((panel + 1 + y) * s.width + x) * 4]! < 60;
        // An arch: filled over the middle at the top, empty under it.
        let top = -1;
        for (let y = 0; y < panel && top < 0; y++) if (dark(panel >> 1, y)) top = y;
        expect(top).toBeGreaterThan(0);
        expect(dark(panel >> 1, panel - 25)).toBe(false);
    });

    it('the sheet draws hard edges and leaves a curved wall clean, with every polygon on request', () => {
        const panel = 128;
        const m = model({ op: 'lathe', profile: [[1, 0], [1, 2]], sides: 48 }, { op: 'slice', axis: 'y', at: 1 });
        const lines = (wire: boolean): number => {
            const s = renderModelSheet(m, ['front'], panel, undefined, wire);
            let n = 0;
            for (let i = 0; i < panel * panel; i++) {
                const y = Math.floor(i / panel), x = i % panel;
                if (s.rgba[(y * s.width + x) * 4]! < 45) n++;
            }
            return n;
        };
        expect(lines(true)).toBeGreaterThan(lines(false) * 3);
    });

    it('refuses what it cannot join, saying why', () => {
        expect(() => model({ op: 'loft', sections: [{ at: [0, 0, 0], radius: 1 }] })).toThrow(/at least 2 sections/);
        expect(() => model({ op: 'loft' })).toThrow(/at least 2 sections/);
        expect(() => model({ op: 'loft', sections: [{ radius: 1 }, { at: [0, 1, 0], radius: 1 }] })).toThrow(/section 0 has no `at`/);
        expect(() => model({ op: 'loft', sections: [{ at: [0, 0, 0] }, { at: [0, 1, 0], radius: 1 }] })).toThrow(/section 0: .*exactly one of radius/);
        expect(() => model({ op: 'loft', sections: [{ at: [0, 0, 0], radius: 1, size: [1, 1] }, { at: [0, 1, 0], radius: 1 }] })).toThrow(/this one has 2/);
        expect(() => model({ op: 'loft', sections: [{ at: [0, 1, 0], radius: 1 }, { at: [0, 1, 0], radius: 1 }] })).toThrow(/at the same place/);
        expect(() => model({ op: 'loft', path: [[0, 0, 0], [0, 1, 0]] })).toThrow(/`path` carries a `section`/);
        expect(() => model({ op: 'loft', path: [[0, 0, 0], [0, 1, 0]], section: { radius: 1 }, scales: [1] })).toThrow(/one for each/);
        expect(() => model({ op: 'loft', closed: true, sections: [{ at: [0, 0, 0], radius: 1 }, { at: [0, 1, 0], radius: 1 }] })).toThrow(/closed loft needs at least 3/);
        expect(() => validateModelSource({ steps: [{ op: 'loft', sections: [{ at: [0, 0, 0], radus: 1 }] }] })).toThrow(/\[0\] has an unknown field "radus"; a section takes/);
    });
});
