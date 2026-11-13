// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { MeshChannel, MeshChannelType, packChannels, type MeshData } from '../src/asset/meshFormat';
import { buildBillboardMesh, buildGrassMesh, buildInstancedMesh, buildPlacedMesh, softenNormals, thinPlants, rng, scatterCell, type Ground, type Plant } from '../src/foliage/builder';

const flat: Ground = () => ({ y: 2, up: 1 });
const params = {
    centerX: 100, centerZ: -40, size: 20, count: 50, seed: 3, cellKey: 7,
    minScale: 0.8, maxScale: 1.2, minUp: 0.7, heightMin: -1e5, heightMax: 1e5,
};

function colorOf(mesh: ReturnType<typeof buildGrassMesh>, v: number): number[] {
    const c = mesh.channels.find((x) => x.semantic === MeshChannel.Color)!;
    return [...mesh.vertices.slice(v * mesh.vertexStride + c.offset, v * mesh.vertexStride + c.offset + 4)];
}
function positionOf(mesh: ReturnType<typeof buildGrassMesh>, v: number): number[] {
    const c = mesh.channels.find((x) => x.semantic === MeshChannel.Position)!;
    const view = new DataView(mesh.vertices.buffer);
    const at = v * mesh.vertexStride + c.offset;
    return [view.getFloat32(at, true), view.getFloat32(at + 4, true), view.getFloat32(at + 8, true)];
}

describe('scattering', () => {
    it('is the same on every run and different for another seed or cell', () => {
        const a = scatterCell(params, flat), b = scatterCell(params, flat);
        expect(a).toEqual(b);
        expect(scatterCell({ ...params, seed: 4 }, flat)).not.toEqual(a);
        expect(scatterCell({ ...params, cellKey: 8 }, flat)).not.toEqual(a);
        const r = rng(5);
        expect(r()).not.toBe(r());
    });

    it('keeps every plant inside its cell, relative to its centre, at the ground\'s height', () => {
        for (const p of scatterCell(params, flat)) {
            expect(Math.abs(p.x)).toBeLessThanOrEqual(10);
            expect(Math.abs(p.z)).toBeLessThanOrEqual(10);
            expect(p.y).toBe(2);
            expect(p.scale).toBeGreaterThanOrEqual(0.8);
            expect(p.scale).toBeLessThanOrEqual(1.2);
        }
    });

    it('leaves out steep ground, ground outside the height band and places with no ground', () => {
        expect(scatterCell(params, () => ({ y: 0, up: 0.3 }))).toHaveLength(0);
        expect(scatterCell({ ...params, heightMax: 1 }, flat)).toHaveLength(0);
        expect(scatterCell(params, () => null)).toHaveLength(0);
        const half = scatterCell(params, (x) => (x > 100 ? { y: 0, up: 1 } : null));
        expect(half.length).toBeGreaterThan(0);
        expect(half.length).toBeLessThan(50);
    });
});

describe('grass', () => {
    const plants: Plant[] = [
        { x: 0, y: 0, z: 0, yaw: 0, scale: 1, phase: 0.5, shade: 1 },
        { x: 5, y: 0, z: 5, yaw: 1, scale: 1, phase: 0.25, shade: 0.8 },
        { x: -5, y: 0, z: 5, yaw: 2, scale: 1, phase: 0.75, shade: 0.9 },
    ];

    it('has 2s+1 vertices and 2s-1 triangles a blade', () => {
        const mesh = buildGrassMesh(plants, { height: 10, width: 2, segments: 3, thin: 1 });
        expect(mesh.vertexCount).toBe(3 * 7);
        expect(mesh.indices.length / 3).toBe(3 * 5);
    });

    it('draws every n-th blade, broader, so the far version costs a share of the near one', () => {
        const near = buildGrassMesh(plants, { height: 10, width: 2, segments: 3, thin: 1 });
        const far = buildGrassMesh(plants, { height: 10, width: 2, segments: 1, thin: 3 });
        expect(far.indices.length).toBeLessThan(near.indices.length / 4);
        const wide = (m: typeof near): number => positionOf(m, 1)[0]! - positionOf(m, 0)[0]!;
        expect(Math.abs(wide(far))).toBeGreaterThan(Math.abs(wide(near)));
    });

    it('paints the wind\'s weights: red from the root up, green the plant\'s phase', () => {
        const mesh = buildGrassMesh(plants, { height: 10, width: 2, segments: 3, thin: 1 });
        const root = colorOf(mesh, 0), tip = colorOf(mesh, 6);
        expect(root[0]).toBe(0);
        expect(tip[0]).toBe(255);
        expect(root[1]).toBe(Math.round(0.5 * 255));
        expect(root[2]!).toBeLessThan(tip[2]!);
        expect(positionOf(mesh, 6)[1]).toBeCloseTo(10, 4);
    });

    it('paints a colour instead when it has no material to read the weights', () => {
        const mesh = buildGrassMesh(plants, { height: 10, width: 2, segments: 3, thin: 1, paint: { base: [0, 0.2, 0], tip: [0.5, 1, 0] } });
        const tip = colorOf(mesh, 6);
        expect(tip[1]).toBeGreaterThan(tip[2]!);
    });
});

describe('instanced meshes and billboards', () => {
    const quad = buildGrassMesh([{ x: 0, y: 0, z: 0, yaw: 0, scale: 1, phase: 0, shade: 1 }], { height: 10, width: 2, segments: 1, thin: 1 });

    it('copies a mesh once a plant, placed and scaled, with its weights painted by height on its own copy', () => {
        const plants: Plant[] = [
            { x: 10, y: 1, z: 0, yaw: 0, scale: 2, phase: 0.3, shade: 1 },
            { x: -10, y: 0, z: 0, yaw: Math.PI / 2, scale: 1, phase: 0.6, shade: 1 },
        ];
        const mesh = buildInstancedMesh(quad, plants);
        expect(mesh.vertexCount).toBe(quad.vertexCount * 2);
        expect(mesh.indices.length).toBe(quad.indices.length * 2);
        // The tip of the first copy is twice as tall, a metre up, ten along.
        const tip = positionOf(mesh, 2);
        expect(tip[1]).toBeCloseTo(1 + 20, 3);
        expect(colorOf(mesh, 0)[0]).toBe(0);
        expect(colorOf(mesh, 2)[0]).toBe(255);
    });

    // A field with no material is painted. A mesh with colours of its own was painted the stock green of grass all the same, from
    // root to tip: a grey rock scattered by a field came out a green one, and a dark spruce a pale one.
    it('paints a mesh with no material in the mesh\'s own colours, each plant by its shade', () => {
        const grey = buildGrassMesh([{ x: 0, y: 0, z: 0, yaw: 0, scale: 1, phase: 0, shade: 1 }],
            { height: 10, width: 2, segments: 1, thin: 1, paint: { base: [0.4, 0.4, 0.4], tip: [0.4, 0.4, 0.4] } });
        const stock = { base: [0.14, 0.3, 0.08], tip: [0.55, 0.72, 0.25] } as const;
        const was = colorOf(grey, 2);
        const mesh = buildInstancedMesh(grey, [{ x: 0, y: 0, z: 0, yaw: 0, scale: 1, phase: 0, shade: 0.5 }], { base: [...stock.base], tip: [...stock.tip] });
        const now = colorOf(mesh, 2);
        // Its own grey, half as light for a plant of half the shade: not green.
        expect(now[0]).toBe(now[1]);
        expect(now[1]).toBe(now[2]);
        expect(Math.abs(now[0]! - was[0]! * 0.5)).toBeLessThanOrEqual(1);
        // And a mesh that has no colours to keep (white throughout) is still painted as a plant is.
        const white = buildGrassMesh([{ x: 0, y: 0, z: 0, yaw: 0, scale: 1, phase: 0, shade: 1 }],
            { height: 10, width: 2, segments: 1, thin: 1, paint: { base: [1, 1, 1], tip: [1, 1, 1] } });
        for (let v = 0; v < white.vertexCount; v++) {
            const view = new DataView(white.vertices.buffer, white.vertices.byteOffset, white.vertices.byteLength);
            const at = v * white.vertexStride + white.channels.find((c) => c.semantic === 1)!.offset;
            for (let k = 0; k < 3; k++) view.setUint8(at + k, 255);
        }
        const painted = colorOf(buildInstancedMesh(white, [{ x: 0, y: 0, z: 0, yaw: 0, scale: 1, phase: 0, shade: 1 }], { base: [...stock.base], tip: [...stock.tip] }), 2);
        expect(painted[1]).toBeGreaterThan(painted[0]!);
        expect(painted[1]).toBeGreaterThan(painted[2]!);
    });

    it('makes two crossed cards a plant showing the rectangle it is given', () => {
        const mesh = buildBillboardMesh([{ x: 0, y: 0, z: 0, yaw: 0, scale: 1, phase: 0, shade: 1 }], 4, 8, { u0: 0.25, v0: 0, u1: 0.75, v1: 0.5 });
        expect(mesh.vertexCount).toBe(8);
        expect(mesh.indices.length / 3).toBe(4);
        expect(mesh.aabbMax[1]).toBeCloseTo(8, 4);
        const uv = mesh.channels.find((c) => c.semantic === MeshChannel.TexCoord0)!;
        const view = new DataView(mesh.vertices.buffer);
        expect(view.getFloat32(uv.offset, true)).toBeCloseTo(0.25, 5);
        expect(view.getFloat32(2 * mesh.vertexStride + uv.offset + 4, true)).toBeCloseTo(0.5, 5);
    });

    it('draws a tent, one triangle a card, when asked', () => {
        const plant: Plant = { x: 0, y: 0, z: 0, yaw: 0, scale: 1, phase: 0, shade: 1 };
        const tent = buildBillboardMesh([plant], 4, 8, { u0: 0, v0: 0, u1: 1, v1: 1 }, null, true);
        expect(tent.vertexCount).toBe(6);
        expect(tent.indices.length / 3).toBe(2);
        expect(tent.aabbMax[1]).toBeCloseTo(8, 4);
        expect(tent.aabbMin[1]).toBeCloseTo(0.8, 4);
    });

    it('is an empty mesh, not a crash, for a cell with no plants', () => {
        const mesh = buildGrassMesh([], { height: 10, width: 2, segments: 3, thin: 1 });
        expect(mesh.vertexCount).toBe(0);
        expect(mesh.indices.length).toBe(0);
    });
});

describe('placed meshes', () => {
    // One triangle with every channel an authored plant has: position, uv, colour, normal and a tangent.
    const { channels, vertexStride } = packChannels([
        { semantic: MeshChannel.Position, components: 3, type: MeshChannelType.Float32 },
        { semantic: MeshChannel.TexCoord0, components: 2, type: MeshChannelType.Float32 },
        { semantic: MeshChannel.Color, components: 4, type: MeshChannelType.UNorm8 },
        { semantic: MeshChannel.Normal, components: 3, type: MeshChannelType.Float32 },
        { semantic: MeshChannel.Tangent, components: 4, type: MeshChannelType.Float32 },
    ]);
    const vertices = new Uint8Array(3 * vertexStride);
    const view = new DataView(vertices.buffer);
    const at = (s: number) => channels.find((c) => c.semantic === s)!.offset;
    [[1, 0, 0], [0, 2, 0], [0, 0, 1]].forEach((p, v) => {
        p.forEach((x, k) => view.setFloat32(v * vertexStride + at(MeshChannel.Position) + k * 4, x, true));
        view.setFloat32(v * vertexStride + at(MeshChannel.Normal), 1, true);
        view.setFloat32(v * vertexStride + at(MeshChannel.Tangent), 1, true);
        view.setFloat32(v * vertexStride + at(MeshChannel.Tangent) + 12, -1, true);
        view.setFloat32(v * vertexStride + at(MeshChannel.TexCoord0), 0.25 * (v + 1), true);
        vertices.set([10, 20, 30, 255], v * vertexStride + at(MeshChannel.Color));
    });
    const source: MeshData = { channels, vertexStride, vertexCount: 3, vertices, indices: new Uint32Array([0, 1, 2]), aabbMin: [0, 0, 0], aabbMax: [1, 2, 1] };
    const readF = (m: MeshData, v: number, semantic: number, k: number) =>
        new DataView(m.vertices.buffer).getFloat32(v * m.vertexStride + m.channels.find((c) => c.semantic === semantic)!.offset + k * 4, true);

    it('keeps every channel and places, turns and scales a copy a plant', () => {
        const plants: Plant[] = [
            { x: 5, y: 1, z: 0, yaw: 0, scale: 2, phase: 0, shade: 1 },
            { x: 0, y: 0, z: 0, yaw: Math.PI / 2, scale: 1, phase: 0, shade: 1 },
        ];
        const m = buildPlacedMesh(source, plants);
        expect(m.channels).toEqual(source.channels);
        expect(m.vertexCount).toBe(6);
        expect([...m.indices]).toEqual([0, 1, 2, 3, 4, 5]);
        // First copy: the point (1, 0, 0) scaled by two, then moved by (5, 1, 0).
        expect(positionOf(m, 0)).toEqual([7, 1, 0]);
        // Second copy: a quarter turn about the vertical takes (1, 0, 0) to (0, 0, -1).
        const p = positionOf(m, 3);
        expect(p[0]).toBeCloseTo(0, 5);
        expect(p[2]).toBeCloseTo(-1, 5);
        // The normal and the tangent turn with it, the tangent's handedness and the uv and colour are copied as they are.
        expect(readF(m, 3, MeshChannel.Normal, 2)).toBeCloseTo(-1, 5);
        expect(readF(m, 3, MeshChannel.Tangent, 2)).toBeCloseTo(-1, 5);
        expect(readF(m, 3, MeshChannel.Tangent, 3)).toBe(-1);
        expect(readF(m, 4, MeshChannel.TexCoord0, 0)).toBeCloseTo(0.5, 5);
        expect(colorOf(m as never, 5)).toEqual([10, 20, 30, 255]);
    });

    it('leans a copy with the ground it stands on, its normal and tangent with it, and leaves an upright one as it is', () => {
        const m = buildPlacedMesh(source, [
            { x: 3, y: 0, z: 0, yaw: 0, scale: 1, phase: 0, shade: 1, up: [1, 0, 0] },
            { x: 3, y: 0, z: 0, yaw: 0, scale: 1, phase: 0, shade: 1, up: [0, 1, 0] },
        ]);
        // Up turned to the east takes (1, 0, 0), which points east, to point down; the normal and the tangent go with it.
        const leaned = positionOf(m, 0);
        expect(leaned[0]).toBeCloseTo(3, 5);
        expect(leaned[1]).toBeCloseTo(-1, 5);
        expect(readF(m, 0, MeshChannel.Normal, 0)).toBeCloseTo(0, 5);
        expect(readF(m, 0, MeshChannel.Normal, 1)).toBeCloseTo(-1, 5);
        expect(readF(m, 0, MeshChannel.Tangent, 1)).toBeCloseTo(-1, 5);
        expect(positionOf(m, 3)).toEqual([4, 0, 0]);
    });

    it('bounds what it placed, and is an empty mesh for no plants', () => {
        const m = buildPlacedMesh(source, [{ x: 5, y: 1, z: 0, yaw: 0, scale: 2, phase: 0, shade: 1 }]);
        expect(m.aabbMin).toEqual([5, 1, 0]);
        expect(m.aabbMax).toEqual([7, 5, 2]);
        const none = buildPlacedMesh(source, []);
        expect(none.vertexCount).toBe(0);
        expect(none.indices.length).toBe(0);
    });
});

describe('softening a card\'s normals', () => {
    const channels = packChannels([
        { semantic: MeshChannel.Position, type: MeshChannelType.Float32, components: 3 },
        { semantic: MeshChannel.Normal, type: MeshChannelType.Float32, components: 3 },
    ]).channels;
    const stride = 24;
    const make = (normal: number[]): MeshData => {
        const vertices = new Uint8Array(stride);
        new Float32Array(vertices.buffer).set([0, 0, 0, ...normal]);
        return { channels, vertexStride: stride, vertexCount: 1, vertices, indices: new Uint32Array([0, 0, 0]), aabbMin: [0, 0, 0], aabbMax: [0, 0, 0] };
    };
    const normalOf = (m: MeshData) => [...new Float32Array(m.vertices.buffer, 12, 3)];

    it('turns a normal toward up by the amount, to a unit vector, and copies rather than changes the source', () => {
        const source = make([1, 0, 0]);
        const half = normalOf(softenNormals(source, 0.5));
        expect(Math.hypot(...half)).toBeCloseTo(1, 5);
        expect(half[1]).toBeGreaterThan(0.6);
        expect(half[0]).toBeGreaterThan(0.6);
        expect(normalOf(softenNormals(source, 1))).toEqual([0, 1, 0]);
        expect(normalOf(source)).toEqual([1, 0, 0]);
    });

    it('leaves a mesh as it is for none, or for a mesh with no normals', () => {
        const source = make([1, 0, 0]);
        expect(softenNormals(source, 0)).toBe(source);
        const flat: MeshData = { ...source, channels: channels.slice(0, 1) };
        expect(softenNormals(flat, 1)).toBe(flat);
    });
});

describe('thinning plants for a far version', () => {
    const plants: Plant[] = Array.from({ length: 12 }, (_, i) => ({ x: i, y: 0, z: 0, yaw: 0, scale: 1, phase: 0, shade: 1 }));

    it('keeps every plant when it keeps them all', () => {
        expect(thinPlants(plants, 1)).toBe(plants);
        expect(thinPlants(plants, 2)).toBe(plants);
    });

    it('keeps every n-th for a share of 1 / n, grown to cover what the others did', () => {
        const quarter = thinPlants(plants, 0.25);
        expect(quarter.map((p) => p.x)).toEqual([0, 4, 8]);
        expect(quarter[0]!.scale).toBeCloseTo(2);
        const third = thinPlants(plants, 1 / 3);
        expect(third.map((p) => p.x)).toEqual([0, 3, 6, 9]);
        expect(third[0]!.scale).toBeCloseTo(Math.sqrt(3));
    });

    it('is the same plants every time, grows them at most twofold, and leaves the ones given alone', () => {
        expect(thinPlants(plants, 0.1).map((p) => p.x)).toEqual(thinPlants(plants, 0.1).map((p) => p.x));
        expect(thinPlants(plants, 0.05)[0]!.scale).toBe(2);
        expect(plants[0]!.scale).toBe(1);
    });

    it('does not thin again what was planned thinner already, and still grows them for the share kept', () => {
        // A quarter kept, planned four times thinner: every plant is kept, grown as a quarter's would be.
        const planned = thinPlants(plants, 0.25, 4);
        expect(planned.map((p) => p.x)).toEqual(plants.map((p) => p.x));
        expect(planned[0]!.scale).toBeCloseTo(2);
        // Planned twice as thin, a quarter wanted: every second of what is left.
        expect(thinPlants(plants, 0.25, 2).map((p) => p.x)).toEqual([0, 2, 4, 6, 8, 10]);
    });
});
