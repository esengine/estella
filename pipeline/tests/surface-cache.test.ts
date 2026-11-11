// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    surface-cache.test.ts
 * @brief   Mesh cards baked from a box, lit by a sun with the scene distance field for shadows, against the Lambert values the maths gives.
 */
import { describe, it, expect } from 'vitest';
import { MeshChannel, MeshChannelType, type MeshData } from 'esengine';
import { bakeMeshCards } from '../src/assets/meshCards';
import { bakeMeshSdf } from '../src/assets/meshSdf';
import { decodeMeshCards, encodeMeshCards } from '../../sdk/src/gi/cardFormat';
import { GlobalSdf } from '../../sdk/src/gi/globalSdf';
import { SurfaceCache } from '../../sdk/src/gi/surfaceCache';

function meshOf(positions: number[], indices: number[]): MeshData {
    const vertexCount = positions.length / 3, vertices = new Uint8Array(vertexCount * 12), view = new DataView(vertices.buffer);
    positions.forEach((v, i) => view.setFloat32(i * 4, v, true));
    const min = [Infinity, Infinity, Infinity] as [number, number, number], max = [-Infinity, -Infinity, -Infinity] as [number, number, number];
    for (let v = 0; v < vertexCount; v++) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], positions[v * 3 + k]!); max[k] = Math.max(max[k], positions[v * 3 + k]!); }
    return { channels: [{ semantic: MeshChannel.Position, components: 3, type: MeshChannelType.Float32, offset: 0 }], vertexStride: 12, vertexCount,
        vertices, indices: new Uint32Array(indices), aabbMin: min, aabbMax: max };
}

function box(h: [number, number, number]): MeshData {
    const p: number[] = [];
    for (let i = 0; i < 8; i++) p.push((i & 1 ? 1 : -1) * h[0], (i & 2 ? 1 : -1) * h[1], (i & 4 ? 1 : -1) * h[2]);
    const idx: number[] = [];
    for (const [a, b, c, d] of [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]] as [number, number, number, number][]) {
        const pa = p.slice(a * 3, a * 3 + 3), pb = p.slice(b * 3, b * 3 + 3), pc = p.slice(c * 3, c * 3 + 3);
        const u = pb.map((v, k) => v - pa[k]!), w = pc.map((v, k) => v - pa[k]!);
        const n = [u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!];
        idx.push(...(n[0]! * pa[0]! + n[1]! * pa[1]! + n[2]! * pa[2]! > 0 ? [a, b, c, a, c, d] : [a, c, b, a, d, c]));
    }
    return meshOf(p, idx);
}

const matrix = (t: [number, number, number], s = 1): number[] => [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, t[0], t[1], t[2], 1];
const ALBEDO = [0.8, 0.4, 0.2] as const;
// Faces: 0 +x, 1 -x, 2 +y, 3 -y, 4 +z, 5 -z.
const TOP = 2, SIDE = 0, BOTTOM = 3;

describe('mesh cards', () => {
    const cards = bakeMeshCards(box([1, 1, 1]), { cell: 0.25, baseColor: ALBEDO })!;

    it('are six views of a box, each filled edge to edge with the face that looks out', () => {
        expect(cards.cards.length).toBe(6);
        for (const card of cards.cards) {
            expect(card.width).toBe(8);
            expect(card.height).toBe(8);
            expect(card.depth.every((d) => d === 0)).toBe(true);
        }
        const top = cards.cards[TOP]!;
        expect(Array.from(top.normal.slice(0, 3))).toEqual([0, 127, 0]);
        expect(Array.from(top.albedo.slice(0, 3))).toEqual(ALBEDO.map((c) => Math.round(c * 255)));
    });

    it('read back as written', () => {
        const back = decodeMeshCards(encodeMeshCards(cards));
        expect(back.cell).toBeCloseTo(cards.cell, 6);
        expect(back.cards[SIDE]!.albedo).toEqual(cards.cards[SIDE]!.albedo);
        expect(back.cards[TOP]!.depth).toEqual(cards.cards[TOP]!.depth);
        expect(() => decodeMeshCards(new Uint8Array(100))).toThrow();
    });

    it('record the depth of a surface set back from the box face', () => {
        // A flat plate at y = 0.5 inside a box of height 1: seen from +y it is 0.5 down from the top of the box, seen from -y it faces away.
        const plate = meshOf([-1, 0.5, -1, 1, 0.5, -1, 1, 0.5, 1, -1, 0.5, 1, 0, 1, 0, 0, -1, 0], [0, 2, 1, 0, 3, 2]);
        const c = bakeMeshCards(plate, { cell: 0.5 })!;
        const top = c.cards[TOP]!;
        expect(top.depth[0]).toBeGreaterThan(0);
        expect(Math.abs((top.depth[0]! / 65534) * 2 - 0.5)).toBeLessThan(0.01);
        expect(c.cards[BOTTOM]!.depth[0]).toBe(65535);
    });
});

describe('the surface cache', () => {
    const cards = bakeMeshCards(box([1, 1, 1]), { cell: 0.25, baseColor: ALBEDO, emissive: [0.5, 0, 0] })!;
    const lit = (toLight: [number, number, number], extra?: (cache: SurfaceCache, sdf: GlobalSdf) => void, ownSdf = false) => {
        const sdf = new GlobalSdf([{ dim: 64, cell: 0.25 }, { dim: 64, cell: 1 }]);
        sdf.setCenter([0, 0, 0]);
        const cache = new SurfaceCache();
        cache.add({ id: 1, cards, worldFromLocal: matrix([0, 0, 0]) });
        if (ownSdf) sdf.update({ id: 1, sdf: bakeMeshSdf(box([1, 1, 1]), { cellSize: 0.1 })!, worldFromLocal: matrix([0, 0, 0]) });
        extra?.(cache, sdf);
        cache.light({ sun: { toLight, radiance: [1, 1, 1] }, sdf, bias: 0.4 });
        return { cache, sdf };
    };

    it('lights a face by albedo times the sun times the cosine, and adds what the surface emits', () => {
        const dir = [0.6, 0.8, 0] as [number, number, number];
        const { cache } = lit(dir);
        const top = cache.radianceAt(1, TOP, 3, 3)!, side = cache.radianceAt(1, SIDE, 3, 3)!, bottom = cache.radianceAt(1, BOTTOM, 3, 3)!;
        for (let k = 0; k < 3; k++) {
            expect(top[k]!).toBeCloseTo(ALBEDO[k]! * 0.8 + (k === 0 ? 0.5 : 0), 2);
            expect(side[k]!).toBeCloseTo(ALBEDO[k]! * 0.6 + (k === 0 ? 0.5 : 0), 2);
            expect(bottom[k]!).toBeCloseTo(k === 0 ? 0.5 : 0, 2);  // facing away: emission only
        }
    });

    it('shadows a face the distance field says is behind something, and only that face', () => {
        const plate = box([3, 0.2, 3]);
        const { cache } = lit([0, 1, 0], (_cache, sdf) => {
            sdf.update({ id: 2, sdf: bakeMeshSdf(plate, { cellSize: 0.1 })!, worldFromLocal: matrix([0, 3, 0]) });
        });
        // The plate is a body in the field and not in the cache: its shadow falls on the box under it.
        expect(cache.radianceAt(1, TOP, 3, 3)![1]!).toBeCloseTo(0, 2);
        const open = lit([0, 1, 0]).cache.radianceAt(1, TOP, 3, 3)!;
        expect(open[1]!).toBeCloseTo(ALBEDO[1]!, 2);
    });

    it('is not shadowed by its own mesh', () => {
        const { cache } = lit([0, 1, 0], undefined, true);
        expect(cache.radianceAt(1, TOP, 3, 3)![1]!).toBeCloseTo(ALBEDO[1]!, 2);
    });

    it('answers a ray with the face it looks at: the top from above, the side from the side, nothing from open air', () => {
        const { cache } = lit([0, 1, 0]);
        const fromAbove = cache.lookup([0.3, 1, 0.2], [0, -1, 0], 0.3)!;
        expect(fromAbove[1]!).toBeCloseTo(ALBEDO[1]!, 2);
        const fromSide = cache.lookup([1, 0.2, 0.1], [-1, 0, 0], 0.3)!;
        expect(fromSide[1]!).toBeCloseTo(0, 2);  // the side is not toward the sun
        expect(cache.lookup([0.3, 2.5, 0.2], [0, -1, 0], 0.3)).toBeNull();
        expect(cache.lookup([9, 9, 9], [0, -1, 0], 0.3)).toBeNull();
    });

    it('blends the faces a slanted ray sees by how squarely it looks at each', () => {
        const { cache } = lit([0, 1, 0]);
        const r = cache.lookup([1, 1, 0.1], [-Math.SQRT1_2, -Math.SQRT1_2, 0], 0.3)!;
        // Half top (lit: albedo), half side (dark): about half the albedo.
        expect(r[1]!).toBeCloseTo(ALBEDO[1]! / 2, 1);
    });

    it('feeds an indirect term through the albedo', () => {
        const sdf = new GlobalSdf([{ dim: 32, cell: 0.5 }]);
        const cache = new SurfaceCache();
        cache.add({ id: 1, cards, worldFromLocal: matrix([0, 0, 0]) });
        cache.light({ sdf, indirect: () => [0.5, 0.5, 0.5] });
        const r = cache.radianceAt(1, BOTTOM, 2, 2)!;
        expect(r[1]!).toBeCloseTo(ALBEDO[1]! * 0.5, 2);
    });

    it('follows an instance that is moved and scaled', () => {
        const cache = new SurfaceCache();
        cache.add({ id: 1, cards, worldFromLocal: matrix([10, 0, 0], 2) });
        cache.light({ sun: { toLight: [0, 1, 0], radiance: [1, 1, 1] } });
        // Scaled by 2 about its centre, the top is at y = 2.
        const r = cache.lookup([10.5, 2, 0.5], [0, -1, 0], 0.3)!;
        expect(r[1]!).toBeCloseTo(ALBEDO[1]!, 2);
        expect(cache.lookup([0.5, 1, 0.5], [0, -1, 0], 0.3)).toBeNull();
    });
});

describe('point and spot lights in the surface cache', () => {
    const plate = bakeMeshCards(box([200, 5, 200]), { cell: 50, baseColor: [0.5, 0.5, 0.5] })!;
    const cache = (placeAt: [number, number, number] = [0, 0, 0]) => {
        const c = new SurfaceCache();
        c.add({ id: 1, cards: plate, worldFromLocal: matrix(placeAt) });
        return c;
    };
    // The plate's top card is 8 x 8 pixels of 50: the pixel centre at (25, 25) is where a lamp straight above it is 100 away at a right angle.
    const topCentre = (c: SurfaceCache) => c.lookup([25, 5, 25], [0, -1, 0], 1)![0]!;

    it('lights a surface under a lamp by the lamp, the falloff and the cosine', () => {
        const c = cache();
        const lamp = { position: [25, 105, 25] as [number, number, number], radiance: [2, 2, 2] as [number, number, number], reach: 400, innerRadius: 0, falloff: 1 };
        c.light({ lights: [lamp] });
        // 100 above, straight down: the ramp is (400 - 100) / 400 = 0.75, the cosine 1, albedo 0.5.
        expect(topCentre(c)).toBeCloseTo(0.5 * 2 * 0.75, 2);
    });

    it('follows the frame inverse-square falloff, let go over the reach', () => {
        const c = cache();
        const lamp = { position: [25, 105, 25] as [number, number, number], radiance: [1, 1, 1] as [number, number, number], reach: 400, metre: 100 };
        c.light({ lights: [lamp] });
        const q = 100 / 400, w = (1 - q ** 4) ** 2;
        expect(topCentre(c)).toBeCloseTo(0.5 * w / 1, 2);
    });

    it('lights nothing past its reach, or from behind the surface', () => {
        const c = cache();
        c.light({ lights: [{ position: [25, 605, 25], radiance: [1, 1, 1], reach: 400 }] });
        expect(topCentre(c)).toBe(0);
        const d = cache();
        d.light({ lights: [{ position: [25, -95, 25], radiance: [1, 1, 1], reach: 400 }] });
        expect(topCentre(d)).toBe(0);
    });

    it('cuts a spot to its cone', () => {
        const spot = (aim: [number, number, number]) => ({ position: [25, 105, 25] as [number, number, number], radiance: [1, 1, 1] as [number, number, number], reach: 400, falloff: 1,
            spot: { axis: aim, innerCos: Math.cos(0.3), outerCos: Math.cos(0.5) } });
        const on = cache(), off = cache();
        on.light({ lights: [spot([0, -1, 0])] });
        off.light({ lights: [spot([1, 0, 0])] });
        expect(topCentre(on)).toBeGreaterThan(0.3);
        expect(topCentre(off)).toBe(0);
    });

    it('is shadowed by a body between the surface and the lamp', () => {
        const c = cache();
        const sdf = new GlobalSdf([{ dim: 64, cell: 8 }]);
        sdf.setCenter([0, 100, 0]);
        sdf.update({ id: 2, sdf: bakeMeshSdf(box([40, 5, 40]), { cellSize: 8 })!, worldFromLocal: matrix([25, 60, 25]) });
        c.light({ lights: [{ position: [25, 140, 25], radiance: [1, 1, 1], reach: 400 }], sdf, bias: 12 });
        expect(topCentre(c)).toBe(0);
        const lit = cache();
        lit.light({ lights: [{ position: [25, 140, 25], radiance: [1, 1, 1], reach: 400 }] });
        expect(topCentre(lit)).toBeGreaterThan(0);
    });
});
