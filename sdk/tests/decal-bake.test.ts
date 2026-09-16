// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A projector over a floor: what comes out, and in whose space.
 *
 * The clip is tested on its own; this asks the part around it — that world
 * geometry arrives in the projector's space and comes back out through the very
 * transform that defined the box. A decal one transform off looks fine in a
 * screenshot taken from the angle it was authored at. Pure TS.
 */
import { describe, it, expect } from 'vitest';
import { bakeDecalMesh, receiverFromMesh, type DecalReceiver } from '../src/decal/bake';
import { CLIP_EPSILON } from '../src/decal/clip';
import { composeTRS } from '../src/math/mat4';
import { MeshChannel, MeshChannelType, type MeshData } from '../src/asset/meshFormat';

/** A big flat floor at world y = 0, facing up. */
function floor(extent = 500): DecalReceiver {
    return {
        positions: new Float32Array([
            -extent, 0, -extent, extent, 0, -extent, extent, 0, extent, -extent, 0, extent,
        ]),
        normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]),
        indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    };
}

/** A projector of `size` standing at `at`, throwing straight DOWN (-Y). */
function projectorAbove(at: [number, number, number], size: number): number[] {
    // Its own -Z must point down, so it is pitched a quarter turn: x stays, and
    // local +Z becomes world +Y.
    const half = Math.SQRT1_2;
    return composeTRS(
        { x: at[0], y: at[1], z: at[2] },
        { x: -half, y: 0, z: 0, w: half },   // -90° about X
        { x: size, y: size, z: size },
    );
}

const positionsOf = (m: { vertices: Uint8Array; vertexCount: number }): number[][] => {
    const f = new Float32Array(m.vertices.buffer);
    const out: number[][] = [];
    for (let i = 0; i < m.vertexCount; ++i) out.push([f[i * 8]!, f[i * 8 + 1]!, f[i * 8 + 2]!]);
    return out;
};
const uvsOf = (m: { vertices: Uint8Array; vertexCount: number }): number[][] => {
    const f = new Float32Array(m.vertices.buffer);
    const out: number[][] = [];
    for (let i = 0; i < m.vertexCount; ++i) out.push([f[i * 8 + 6]!, f[i * 8 + 7]!]);
    return out;
};

/** One quad as a `.esmesh` would carry it: position + normal, interleaved. */
function quadMesh(): MeshData {
    const v = new Float32Array([
        -1, 0, -1, 0, 1, 0, 1, 0, -1, 0, 1, 0,
        1, 0, 1, 0, 1, 0, -1, 0, 1, 0, 1, 0,
    ]);
    return {
        channels: [
            { semantic: MeshChannel.Position, components: 3, type: MeshChannelType.Float32, offset: 0 },
            { semantic: MeshChannel.Normal, components: 3, type: MeshChannelType.Float32, offset: 12 },
        ],
        vertexStride: 24,
        vertexCount: 4,
        vertices: new Uint8Array(v.buffer),
        indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
        aabbMin: [-1, 0, -1],
        aabbMax: [1, 0, 1],
    };
}

describe('receiverFromMesh', () => {
    it('places a mesh by its transform', () => {
        // Ten times bigger, moved 50 along +X.
        const r = receiverFromMesh(quadMesh(),
            composeTRS({ x: 50, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 },
                       { x: 10, y: 10, z: 10 }))!;
        expect(r.positions[0]).toBeCloseTo(40, 4);
        expect(r.positions[2]).toBeCloseTo(-10, 4);
        expect(r.indices).toHaveLength(6);
    });

    it('turns a normal by the INVERSE-transpose, not the transform', () => {
        // Flattened on Y: the position transform would tilt an up-facing normal
        // towards nothing; the inverse-transpose keeps it up.
        const r = receiverFromMesh(quadMesh(),
            composeTRS({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 },
                       { x: 10, y: 0.1, z: 10 }))!;
        expect(r.normals[1]).toBeCloseTo(1, 4);
        expect(Math.abs(r.normals[0]!)).toBeLessThan(1e-4);
    });

    it('gives geometry with no normals the viewer-facing one', () => {
        const noNormals = quadMesh();
        noNormals.channels = [noNormals.channels[0]!];
        const r = receiverFromMesh(noNormals, composeTRS(
            { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 }, { x: 1, y: 1, z: 1 }))!;
        expect(r.normals[2]).toBeCloseTo(1, 5);
    });

    it('refuses geometry with no positions', () => {
        const nothing = quadMesh();
        nothing.channels = [];
        expect(receiverFromMesh(nothing, composeTRS(
            { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 }, { x: 1, y: 1, z: 1 }))).toBeNull();
    });
});

describe('decal bake', () => {
    it('cuts a patch of floor the size of the projector', () => {
        const mesh = bakeDecalMesh([floor()], projectorAbove([0, 100, 0], 200));
        expect(mesh).not.toBeNull();
        // Whole triangles, and no more than the receiver could contribute: the
        // cut fans polygons, so a count is a range, not a number.
        expect(mesh!.vertexCount % 3).toBe(0);
        expect(mesh!.vertexCount).toBeGreaterThanOrEqual(6);
        expect(mesh!.vertexCount).toBeLessThanOrEqual(24);
        expect(mesh!.channels.map((c) => c.semantic))
            .toEqual([MeshChannel.Position, MeshChannel.Normal, MeshChannel.TexCoord0]);
    });

    it('puts the geometry in the PROJECTOR\'s space, inside the unit box', () => {
        const mesh = bakeDecalMesh([floor()], projectorAbove([300, 100, -120], 200))!;
        // The clip's own tolerance, plus what storing the result as float32
        // costs: a mesh file carries single precision and nothing else.
        const bound = 0.5 + CLIP_EPSILON + 1e-6;
        for (const p of positionsOf(mesh)) {
            for (const k of [0, 1, 2]) expect(Math.abs(p[k]!)).toBeLessThanOrEqual(bound);
        }
        // And its bounds say the same, which is what culling will read.
        expect(mesh.aabbMax[0]).toBeLessThanOrEqual(bound);
        expect(mesh.aabbMin[0]).toBeGreaterThanOrEqual(-bound);
    });

    it('spreads the texture across the whole box', () => {
        const uvs = uvsOf(bakeDecalMesh([floor()], projectorAbove([0, 100, 0], 200))!);
        const us = uvs.map((uv) => uv[0]!);
        const vs = uvs.map((uv) => uv[1]!);
        expect(Math.min(...us)).toBeCloseTo(0, 4);
        expect(Math.max(...us)).toBeCloseTo(1, 4);
        expect(Math.min(...vs)).toBeCloseTo(0, 4);
        expect(Math.max(...vs)).toBeCloseTo(1, 4);
    });

    it('prints nothing where there is nothing under it', () => {
        expect(bakeDecalMesh([floor(50)], projectorAbove([5000, 100, 0], 200))).toBeNull();
        expect(bakeDecalMesh([], projectorAbove([0, 100, 0], 200))).toBeNull();
    });

    it('refuses a floor it is edge-on to', () => {
        // Throwing sideways (-X) at a floor facing up: nothing to print on.
        const sideways = composeTRS({ x: 0, y: 100, z: 0 },
                                    { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 },
                                    { x: 200, y: 200, z: 200 });
        expect(bakeDecalMesh([floor()], sideways)).toBeNull();
    });

    it('carries a normal that comes BACK to the world one it was cut from', () => {
        // Stored as the transpose of the projector's 3x3, so the engine's normal
        // matrix (the inverse-transpose of the model matrix) restores world +Y.
        const world = projectorAbove([0, 100, 0], 200);
        const mesh = bakeDecalMesh([floor()], world)!;
        const f = new Float32Array(mesh.vertices.buffer);
        const n: [number, number, number] = [f[3]!, f[4]!, f[5]!];
        // The projector's -90°-about-X turn maps world +Y to local +Z.
        expect(n[2]).toBeCloseTo(1, 4);
        expect(Math.abs(n[1]!)).toBeLessThan(1e-4);
    });

    it('cuts a tilted receiver too, and keeps its tilt', () => {
        const tilt = Math.SQRT1_2;
        const ramp: DecalReceiver = {
            positions: new Float32Array([
                -500, 0, 0, 500, 0, 0, 500, 500, 500, -500, 500, 500,
            ]),
            normals: new Float32Array([
                0, tilt, -tilt, 0, tilt, -tilt, 0, tilt, -tilt, 0, tilt, -tilt,
            ]),
            indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
        };
        const mesh = bakeDecalMesh([ramp], projectorAbove([0, 100, 100], 200));
        expect(mesh).not.toBeNull();
        const f = new Float32Array(mesh!.vertices.buffer);
        // Not the box's own facing: the ramp's tilt survived the cut.
        expect(Math.abs(f[4]!)).toBeGreaterThan(1e-3);
    });
});
