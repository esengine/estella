// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * The organic step, held to its sums: a skin that closes and points out, the volume
 * a shape must enclose, and refusals that say what to change.
 */
import { describe, expect, it } from 'vitest';
import { MeshChannel } from 'esengine';
import { bakeModel, renderModelSheet, validateModelSource, type BakedModel, type OrganicPart } from '../src/modeling';

const body = (parts: OrganicPart[], extra: Record<string, unknown> = {}): BakedModel =>
    bakeModel({ version: 1, steps: [{ op: 'organic', resolution: 48, parts, ...extra }] });

function volume(m: BakedModel): number {
    let v = 0;
    for (const { v: [a, b, c] } of m.triangles) {
        const [p, q, r] = [m.poly.positions[a]!, m.poly.positions[b]!, m.poly.positions[c]!];
        v += p[0] * (q[1] * r[2] - q[2] * r[1]) + p[1] * (q[2] * r[0] - q[0] * r[2]) + p[2] * (q[0] * r[1] - q[1] * r[0]);
    }
    return v / 6;
}

function expectClosed(m: BakedModel): void {
    expect(m.report.openEdges).toBe(0);
    expect(m.report.insideOutShells).toBe(0);
    expect(m.report.shells).toBe(1);
}

const sphereVolume = (r: number): number => (4 / 3) * Math.PI * r ** 3;

describe('shapes', () => {
    it.each<[string, OrganicPart, number]>([
        ['sphere', { shape: 'sphere', radius: 1 }, sphereVolume(1)],
        ['ellipsoid', { shape: 'ellipsoid', radii: [1, 0.5, 0.75] }, (4 / 3) * Math.PI * 1 * 0.5 * 0.75],
        ['box', { shape: 'box', size: [2, 1, 1] }, 2],
        ['torus', { shape: 'torus', radius: 1, tube: 0.3 }, 2 * Math.PI ** 2 * 1 * 0.3 ** 2],
        // A capsule: the cylinder and the two ends of a uniform chain.
        ['chain', { shape: 'chain', points: [[0, 0, 0, 0.5], [0, 2, 0, 0.5]] }, Math.PI * 0.25 * 2 + sphereVolume(0.5)],
    ])('%s closes, points out and holds the right volume', (_, part, expected) => {
        const m = body([part], { resolution: 64 });
        expectClosed(m);
        expect(Math.abs(volume(m) - expected) / expected).toBeLessThan(0.02);
    });

    it('rotates a part about its own centre', () => {
        const m = body([{ shape: 'box', size: [2, 0.5, 0.5], at: [3, 0, 0], rotate: [0, 0, 90] }]);
        expect(m.report.bounds.size[1]).toBeGreaterThan(1.9);
        expect(m.report.bounds.size[0]).toBeLessThan(0.6);
        expect(m.report.bounds.center[0]).toBeCloseTo(3, 1);
    });

    it('a rotation on a shape that has none to give is a mistake', () => {
        expect(() => body([{ shape: 'sphere', radius: 1, rotate: [0, 45, 0] }])).toThrow(/rotate means nothing on a sphere/);
    });
});

describe('how parts combine', () => {
    const a: OrganicPart = { shape: 'sphere', radius: 1, at: [-0.8, 0, 0] };
    const b: OrganicPart = { shape: 'sphere', radius: 1, at: [0.8, 0, 0] };

    it('blend fills the join: more volume than the hard union, and still one piece', () => {
        const hard = volume(body([a, b], { resolution: 64 }));
        const soft = volume(body([a, { ...b, blend: 0.6 }], { resolution: 64 }));
        expect(soft).toBeGreaterThan(hard * 1.02);
        expect(hard).toBeLessThan(2 * sphereVolume(1));
    });

    it('two parts apart stay two shells', () => {
        const m = body([{ ...a, at: [-3, 0, 0] }, { ...b, at: [3, 0, 0] }]);
        expect(m.report.shells).toBe(2);
    });

    it('subtract carves, and a colour on it paints the cut', () => {
        const whole = body([{ shape: 'sphere', radius: 1 }], { resolution: 64 });
        const carved = body([
            { shape: 'sphere', radius: 1, color: [1, 1, 1] },
            { shape: 'sphere', radius: 0.5, at: [0, 0, 1], subtract: true, color: [1, 0, 0], tag: 'mouth' },
        ], { resolution: 64 });
        expectClosed(carved);
        expect(volume(carved)).toBeLessThan(volume(whole) * 0.97);
        expect(carved.report.tags.mouth).toBeGreaterThan(0);
        const red = carved.poly.faces.filter((f) => f.tag === 'mouth');
        expect(red.every((f) => f.color![1]! < 0.5)).toBe(true);
    });

    it('a first part cannot subtract: there is nothing to carve', () => {
        expect(() => body([{ shape: 'sphere', radius: 1, subtract: true }])).toThrow(/first part cannot subtract/);
    });

    it('carving everything away is said, not baked to nothing', () => {
        expect(() => body([{ shape: 'sphere', radius: 1 }, { shape: 'sphere', radius: 3, subtract: true }])).toThrow(/carved away/);
    });

    it('mirror makes the other side, exactly', () => {
        const m = body([
            { shape: 'sphere', radius: 1 },
            { shape: 'chain', mirror: 'x', points: [[0.8, 0, 0, 0.3], [2, 0, 0, 0.2]], tag: 'arm' },
        ], { blend: 0.1 });
        expectClosed(m);
        expect(m.report.bounds.min[0]).toBeCloseTo(-m.report.bounds.max[0], 1);
        expect(m.report.bounds.max[0]).toBeGreaterThan(2.1);
    });
});

describe('what the skin carries', () => {
    const creature = body([
        { shape: 'sphere', radius: 1, tag: 'torso', color: [0, 1, 0] },
        { shape: 'sphere', radius: 0.5, at: [0, 1.3, 0], tag: 'head', color: [1, 0, 0], blend: 0.05 },
    ], { blend: 0.2 });

    it('each face takes the tag and colour of the part nearest it', () => {
        expect(creature.report.tags.torso).toBeGreaterThan(creature.report.tags.head!);
        const faces = creature.poly.faces;
        const top = faces.filter((f) => f.tag === 'head');
        expect(top.every((f) => f.color![0]! > f.color![1]!)).toBe(true);
    });

    it('a later step can act on a part by its tag', () => {
        const m = bakeModel({ version: 1, steps: [
            { op: 'organic', resolution: 32, parts: [{ shape: 'sphere', radius: 1, tag: 'a' }, { shape: 'sphere', radius: 1, at: [5, 0, 0], tag: 'b' }] },
            { op: 'paint', faces: 'b', color: [0, 0, 1] },
        ] });
        expect(m.poly.faces.filter((f) => f.color).every((f) => f.tag === 'b')).toBe(true);
    });

    it('is shaded smooth: a normal per vertex position, whatever the source angle', () => {
        const at = creature.data.channels.find((c) => c.semantic === MeshChannel.Normal)!.offset;
        const posAt = creature.data.channels.find((c) => c.semantic === MeshChannel.Position)!.offset;
        const view = new DataView(creature.data.vertices.buffer);
        const seen = new Map<string, Set<string>>();
        for (let i = 0; i < creature.data.vertexCount; i++) {
            const base = i * creature.data.vertexStride;
            const p = [0, 1, 2].map((k) => view.getFloat32(base + posAt + k * 4, true).toFixed(4)).join();
            const n = [0, 1, 2].map((k) => view.getFloat32(base + at + k * 4, true).toFixed(2)).join();
            const set = seen.get(p) ?? new Set();
            set.add(n);
            seen.set(p, set);
        }
        expect(Math.max(...[...seen.values()].map((s) => s.size))).toBeLessThanOrEqual(2); // rounding only
    });

    it('survives in a source alongside polygon steps and hard shells', () => {
        const m = bakeModel({ version: 1, steps: [
            { op: 'box', size: 1, at: [5, 0, 0], tag: 'crate' },
            { op: 'organic', resolution: 32, parts: [{ shape: 'sphere', radius: 1 }] },
        ] });
        expect(m.report.shells).toBe(2);
        expect(m.poly.faces.filter((f) => f.smooth).length).toBeGreaterThan(100);
        expect(m.poly.faces.filter((f) => !f.smooth).length).toBe(6);
    });
});

describe('noise', () => {
    const rock = (seed: number): BakedModel => body([{ shape: 'sphere', radius: 1 }], { noise: { amplitude: 0.1, scale: 0.4, seed } });

    it('roughens the surface, the same way every time, and differently per seed', () => {
        const r = (m: BakedModel): number[] => m.poly.positions.map((p) => Math.hypot(p[0], p[1], p[2]));
        const radii = r(rock(1));
        expect(Math.max(...radii) - Math.min(...radii)).toBeGreaterThan(0.05);
        expect(rock(1).poly.positions).toEqual(rock(1).poly.positions);
        expect(rock(2).poly.positions).not.toEqual(rock(1).poly.positions);
    });

    it('on one part leaves the others smooth', () => {
        const m = body([
            { shape: 'sphere', radius: 1, tag: 'smooth' },
            { shape: 'sphere', radius: 1, at: [3, 0, 0], tag: 'rough', noise: { amplitude: 0.1, scale: 0.3 } },
        ]);
        const radii = m.poly.faces.filter((f) => f.tag === 'smooth').flatMap((f) => f.v).map((i) => Math.hypot(...m.poly.positions[i]!));
        expect(Math.max(...radii) - Math.min(...radii)).toBeLessThan(0.01);
    });
});

describe('refusals name what to change', () => {
    it('a part the grid cannot see', () => {
        expect(() => body([{ shape: 'sphere', radius: 1 }, { shape: 'sphere', radius: 0.01, at: [1, 0, 0], tag: 'wart' }])).toThrow(/part "wart" .*too thin.*raise resolution to at least \d+/);
    });

    it('past the most resolution there is', () => {
        expect(() => body([{ shape: 'sphere', radius: 10 }, { shape: 'sphere', radius: 0.01, tag: 'wart' }])).toThrow(/part "wart" .*make it at least/);
    });

    it('a tapering limb is judged by its widest, not its tip', () => {
        expect(() => body([{ shape: 'chain', points: [[0, 0, 0, 0.5], [0, 3, 0, 0.001]] }])).not.toThrow();
    });

    it('the tip of a taper past the grid leaves no floating specks', () => {
        const m = body([{ shape: 'chain', points: [[0, 0, 0, 0.4], [0, 3, 0, 0.05], [0, 5, 0, 0.002]] }], {
            noise: { amplitude: 0.03, scale: 0.1, seed: 4 }, resolution: 40,
        });
        expect(m.report.shells).toBe(1);
    });

    it('a misspelt field in a part, listing the ones it takes', () => {
        expect(() => validateModelSource({ steps: [{ op: 'organic', parts: [{ shape: 'sphere', radious: 1 }] }] })).toThrow(/\[0\] has an unknown field "radious"; a part takes shape/);
    });

    it('a shape without what it needs, and a shape there is not', () => {
        expect(() => body([{ shape: 'ellipsoid' }])).toThrow(/part 0: a ellipsoid part needs `radii`/);
        expect(() => validateModelSource({ steps: [{ op: 'organic', parts: [{ shape: 'blob' }] }] })).toThrow(/shape must be sphere/);
    });

    it('a resolution out of range', () => {
        expect(() => body([{ shape: 'sphere', radius: 1 }], { resolution: 500 })).toThrow(/resolution 500 must be/);
    });
});

describe('looking at one', () => {
    const m = body([
        { shape: 'sphere', radius: 1, tag: 'body' },
        { shape: 'sphere', radius: 0.15, at: [0, 1.05, 0], tag: 'knob', blend: 0.02 },
    ], { resolution: 64 });

    it('focus fills the panel with that part, by the selector steps use', () => {
        const whole = renderModelSheet(m, ['front'], 128);
        const close = renderModelSheet(m, ['front'], 128, 'knob');
        expect(close.unitsPerPixel).toBeLessThan(whole.unitsPerPixel / 3);
    });

    it('refuses a focus that names nothing', () => {
        expect(() => renderModelSheet(m, ['front'], 64, 'nope')).toThrow(/focus "nope" matched no face/);
    });

    it('draws no wire over a skin: the form is what is being judged', () => {
        const s = renderModelSheet(m, ['front'], 128);
        let dark = 0;
        for (let y = 0; y < 128; y++) {
            for (let x = 0; x < 128; x++) {
                if (s.rgba[(y * s.width + x) * 4]! < 45) dark++;
            }
        }
        expect(dark).toBe(0);
    });
});
