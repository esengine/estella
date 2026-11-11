// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    gpu-scene.test.ts
 * @brief   The scene the dynamic GI feeds the engine: which renderers become instances, and the arrays packed for the compute passes.
 */
import { describe, it, expect } from 'vitest';
import { MeshChannel, MeshChannelType, type MeshData } from 'esengine';
import { bakeMeshCards } from '../src/assets/meshCards';
import { bakeMeshSdf } from '../src/assets/meshSdf';
import { buildInstances, type GIEntry } from '../../sdk/src/gi/dynamicGISystem';
import { packGPUScene, GI_HEADER_FLOATS, GI_INSTANCE_FLOATS } from '../../sdk/src/gi/gpuScene';
import { GlobalSdf } from '../../sdk/src/gi/globalSdf';

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
    const vertices = new Uint8Array(8 * 12), view = new DataView(vertices.buffer);
    p.forEach((v, i) => view.setFloat32(i * 4, v, true));
    return { channels: [{ semantic: MeshChannel.Position, components: 3, type: MeshChannelType.Float32, offset: 0 }], vertexStride: 12, vertexCount: 8, vertices,
        indices: new Uint32Array(idx), aabbMin: [-h[0], -h[1], -h[2]], aabbMax: h };
}

const transform = (position: [number, number, number], scale: [number, number, number] = [1, 1, 1], rotation = { x: 0, y: 0, z: 0, w: 1 }) => ({
    position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 },
    worldPosition: { x: position[0], y: position[1], z: position[2] }, worldRotation: rotation, worldScale: { x: scale[0], y: scale[1], z: scale[2] },
});
const entry = (mesh: number, t: ReturnType<typeof transform>, path: string | null = null, emissive: [number, number, number] = [0, 0, 0]): GIEntry =>
    ({ mesh, transform: t, colour: [0.5, 0.5, 0.5], emissive, path });

const CUBE = 7;
const mesh = box([50, 50, 50]);
const baked = { sdf: bakeMeshSdf(mesh, { cellSize: 10 })!, cards: bakeMeshCards(mesh, { cell: 25, baseColor: [0.2, 0.4, 0.6], emissive: [0, 1, 0] })! };

describe('which renderers become instances', () => {
    it('takes a built-in cube as a box of its world scale, and a baked mesh with its files placed by its transform', () => {
        const { instances } = buildInstances([
            entry(CUBE, transform([0, 0, 0], [4, 1, 1])),
            entry(9, transform([300, 0, 0], [2, 2, 2]), 'assets/rock.esmesh'),
        ], CUBE, (p) => (p === 'assets/rock.esmesh' ? baked : null));
        expect(instances.length).toBe(2);
        expect(instances[0]!.cards.aabbMax).toEqual([200, 50, 50]);
        // The baked mesh is scaled by 2 about its own origin and moved to x = 300.
        const m = instances[1]!.worldFromLocal;
        expect([m[0], m[5], m[10], m[12]]).toEqual([2, 2, 2, 300]);
        expect(instances[1]!.cards).toBe(baked.cards);
    });

    it('leaves out a mesh with no baked files, one scaled unevenly, and anything that is not drawn by a mesh', () => {
        const { instances } = buildInstances([
            entry(9, transform([0, 0, 0]), 'assets/none.esmesh'),
            entry(9, transform([0, 0, 0], [1, 2, 1]), 'assets/rock.esmesh'),
            entry(9, transform([0, 0, 0]), null),
        ], CUBE, (p) => (p === 'assets/rock.esmesh' ? baked : null));
        expect(instances.length).toBe(0);
    });

    it('carries a material emissive colour onto the cards of a cube, and rotates it with the entity', () => {
        const turn = { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 };  // 90 degrees about y
        const { instances } = buildInstances([entry(CUBE, transform([10, 0, 0], [1, 1, 1], turn), null, [4, 2, 0])], CUBE, () => null);
        expect(instances[0]!.cards.emissiveScale).toBe(4);
        expect(Array.from(instances[0]!.cards.cards[2]!.emissive.slice(0, 3))).toEqual([255, 128, 0]);
        const m = instances[0]!.worldFromLocal;
        expect(Math.abs(m[2]! + 1)).toBeLessThan(1e-6);  // local x now points along world -z
    });

    it('changes its key when anything that matters moves, and not when nothing does', () => {
        const a = buildInstances([entry(CUBE, transform([0, 0, 0]))], CUBE, () => null).key;
        expect(buildInstances([entry(CUBE, transform([0, 0, 0]))], CUBE, () => null).key).toBe(a);
        expect(buildInstances([entry(CUBE, transform([1, 0, 0]))], CUBE, () => null).key).not.toBe(a);
        expect(buildInstances([entry(CUBE, transform([0, 0, 0]), null, [1, 0, 0])], CUBE, () => null).key).not.toBe(a);
    });
});

describe('the packed scene', () => {
    const { instances } = buildInstances([entry(CUBE, transform([0, 150, 0], [4, 3, 5])), entry(CUBE, transform([300, 0, 0]))], CUBE, () => null);
    const scene = packGPUScene(instances, { toLight: [0, 1, 0], radiance: [1, 1, 1] })!;

    it('lays the header, the field, the instances and the card pixels out as the engine reads them', () => {
        expect(scene.header.length).toBe(GI_HEADER_FLOATS);
        const [dim, cell, , , , reach, count, pixels] = scene.header;
        expect(dim).toBe(128);
        expect(scene.sdf.length).toBe(128 ** 3 * 1.25);  // the field, then the nearest instance of each cell, four to a word
        expect(reach).toBeCloseTo(cell! * 6, 4);
        expect(count).toBe(2);
        expect(scene.instances.length).toBe(2 * GI_INSTANCE_FLOATS);
        expect(scene.pixels.length).toBe(pixels! * 4);
        expect(Array.from(scene.header.slice(8, 12))).toEqual([0, 1, 0, 1]);
    });

    it('numbers the faces of each instance one after the other through the pixel array', () => {
        let expected = 0;
        for (let i = 0; i < 2; i++) for (let face = 0; face < 6; face++) {
            const at = i * GI_INSTANCE_FLOATS + 44 + face * 4;
            expect(scene.instances[at + 2]).toBe(expected);
            expected += scene.instances[at]! * scene.instances[at + 1]!;
        }
        expect(expected).toBe(scene.header[7]);
        // Every pixel names its instance and face (word 3).
        const w3 = scene.pixels[3]!;
        expect([w3 >> 3, w3 & 7]).toEqual([0, 0]);
        const last = scene.pixels[(scene.header[7]! - 1) * 4 + 3]!;
        expect([last >> 3, last & 7]).toEqual([1, 5]);
    });

    it('stores the world box and the scale where the kernels look for them, and the inverse that undoes the placement', () => {
        const b = 0;
        expect(Array.from(scene.instances.slice(b + 28, b + 31))).toEqual([-200, 0, -250]);
        expect(Array.from(scene.instances.slice(b + 32, b + 35))).toEqual([200, 300, 250]);
        expect(scene.instances[b + 31]).toBe(1);
        // World to local at the entity's centre is the origin: row . (0, 150, 0) + w = 0 for the y row.
        expect(scene.instances[b + 16 + 4 + 1]! * 150 + scene.instances[b + 16 + 4 + 3]!).toBeCloseTo(0, 5);
    });

    it('packs a normal and a colour into the words the kernels unpack', () => {
        // Pixel 0 is face 0 (+x) of the first box: normal (127, 0, 0), albedo 0.5 grey.
        const w0 = scene.pixels[0]!, w1 = scene.pixels[1]!;
        expect([w0 & 0xffff, (w0 >> 16) & 255, (w0 >> 24) & 255, w1 & 255]).toEqual([0, 127, 0, 0]);
        expect([(w1 >> 8) & 255, (w1 >> 16) & 255, (w1 >>> 24) & 255]).toEqual([128, 128, 128]);
    });

    it('is nothing for a scene with nothing in it', () => {
        expect(packGPUScene([], null)).toBeNull();
    });
});

describe('a field that follows the camera', () => {
    const boxes = [entry(CUBE, transform([0, 0, 0], [8, 1, 8])), entry(CUBE, transform([600, 50, 0], [2, 2, 2])), entry(CUBE, transform([-2500, 0, 0], [20, 4, 20]))];
    const { instances } = buildInstances(boxes, CUBE, () => null);

    it('packs three levels, each four times the last, with their windows and where their fields start', () => {
        const sdf = new GlobalSdf([{ dim: 128, cell: 5 }, { dim: 128, cell: 20 }, { dim: 128, cell: 80 }]);
        sdf.setCenter([0, 0, 0]);
        instances.forEach((inst, id) => sdf.update({ id, sdf: inst.sdf, worldFromLocal: inst.worldFromLocal }));
        const scene = packGPUScene(instances, null, { sdf })!;
        const h = scene.header, cells = 128 ** 3, stride = cells + cells / 4;
        expect(h[22]).toBe(3);
        expect(scene.sdf.length).toBe(3 * stride);
        // Level 1 and 2: dim, cell, origin, reach, field offset, owner offset.
        expect([h[24], h[25], h[30], h[31]]).toEqual([128, 20, stride, stride + cells]);
        expect([h[32], h[33], h[38], h[39]]).toEqual([128, 80, 2 * stride, 2 * stride + cells]);
        // The finest window is centred on the camera: 64 cells of 5 either side.
        expect(h[2]).toBe(-64);
    });

    it('hands a ray over to a coarser level where the finer window ends, and finds the far box there', () => {
        const sdf = new GlobalSdf([{ dim: 128, cell: 5 }, { dim: 128, cell: 20 }, { dim: 128, cell: 80 }]);
        sdf.setCenter([0, 0, 0]);
        instances.forEach((inst, id) => sdf.update({ id, sdf: inst.sdf, worldFromLocal: inst.worldFromLocal }));
        const levelOf = (p: [number, number, number]) => sdf.levels.indexOf(sdf.levelAt(p)!);
        // The windows are 640, 2560 and 10240 across: 100 is in the first, 1000 in the second, 2000 only in the third.
        expect([levelOf([100, 0, 0]), levelOf([-1000, 0, 0]), levelOf([-2000, 0, 0])]).toEqual([0, 1, 2]);
        // From beside the near box toward the far one (its face is at x = -1500, 1050 away): the ray crosses all three levels and stops at it.
        const t = sdf.sphereTrace([-450, 0, 0], [-1, 0, 0], 4000)!;
        expect(t).toBeGreaterThan(950);
        expect(t).toBeLessThan(1100);
        // Straight past it, at a height the box does not reach, nothing is in the way.
        expect(sdf.sphereTrace([-450, 900, 0], [-1, 0, 0], 4000)).toBeNull();
    });
});

describe('lights in the packed scene', () => {
    const { instances } = buildInstances([entry(CUBE, transform([0, 0, 0], [4, 1, 4]))], CUBE, () => null);

    it('packs a lamp and a spot as the sixteen floats the kernels read', () => {
        const scene = packGPUScene(instances, null, { lights: [
            { position: [1, 2, 3], radiance: [0.3, 0.4, 0.5], reach: 600, innerRadius: 50, falloff: 2 },
            { position: [4, 5, 6], radiance: [1, 1, 1], reach: 300, metre: 100, spot: { axis: [0, -2, 0], innerCos: 0.9, outerCos: 0.7 } },
        ] })!;
        const h = scene.header, f = (i: number, n: number) => Array.from(h.slice(40 + i * 16, 40 + i * 16 + n)).map((v) => +v.toFixed(4));
        expect(h[23]).toBe(2);
        expect(f(0, 16)).toEqual([1, 2, 3, 600, 0.3, 0.4, 0.5, 0, 0, -1, 0, 2, 50, 1, 0, 0]);
        // The spot: kind 2, its aim normalised, an inverse-square falloff written as minus the units to a metre, then the cone cosines.
        expect(f(1, 16)).toEqual([4, 5, 6, 300, 1, 1, 1, 2, 0, -1, 0, -100, 0, 0.9, 0.7, 0]);
    });

    it('takes no more lights than the kernels have room for', () => {
        const many = Array.from({ length: 12 }, (_, i) => ({ position: [i, 0, 0] as [number, number, number], radiance: [1, 1, 1] as [number, number, number], reach: 100 }));
        expect(packGPUScene(instances, null, { lights: many })!.header[23]).toBe(8);
    });
});
