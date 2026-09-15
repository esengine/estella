// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * The claim a bake exists to make: light that a frame cannot carry still reaches
 * the picture. Sixteen lights is the engine's ceiling, so the cases here run
 * past it — and the shadows, the bounce and the atlas layout are what make the
 * result worth reading rather than a flat wash.
 */
import { describe, it, expect } from 'vitest';
import { unwrapLightmapUV, bakeLightmap, type BakeSurface, type BakeLight } from '../src/lightmap';
import { MeshChannel, MeshChannelType, type MeshData } from '../src/asset/meshFormat';

const IDENTITY = Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

function translated(x: number, y: number, z: number): Float32Array {
    const m = IDENTITY.slice();
    m[12] = x; m[13] = y; m[14] = z;
    return m;
}

/** A quad on the XZ plane facing +Y, `half` units out from its centre. */
function floor(half: number): MeshData {
    const p = [[-half, 0, -half], [half, 0, -half], [half, 0, half], [-half, 0, half]];
    const stride = 24;
    const vertices = new Uint8Array(p.length * stride);
    const view = new DataView(vertices.buffer);
    p.forEach((q, i) => {
        for (let k = 0; k < 3; k++) view.setFloat32(i * stride + k * 4, q[k], true);
        view.setFloat32(i * stride + 12, 0, true);
        view.setFloat32(i * stride + 16, 1, true);
        view.setFloat32(i * stride + 20, 0, true);
    });
    return {
        channels: [
            { semantic: MeshChannel.Position, components: 3, type: MeshChannelType.Float32, offset: 0 },
            { semantic: MeshChannel.Normal, components: 3, type: MeshChannelType.Float32, offset: 12 },
        ],
        vertexStride: stride,
        vertexCount: 4,
        vertices,
        indices: Uint32Array.from([0, 2, 1, 0, 3, 2]),
        aabbMin: [-half, 0, -half],
        aabbMax: [half, 0, half],
    };
}

/** A quad on the XZ plane facing DOWN — the side a lamp above it cannot reach. */
function ceiling(half: number): MeshData {
    const flat = floor(half);
    const view = new DataView(flat.vertices.buffer);
    for (let i = 0; i < flat.vertexCount; i++) view.setFloat32(i * flat.vertexStride + 16, -1, true);
    return { ...flat, indices: Uint32Array.from([0, 1, 2, 0, 2, 3]) };
}

/** A wall on the XY plane facing +Z, standing at the origin. */
function wall(half: number, height: number): MeshData {
    const p = [[-half, 0, 0], [half, 0, 0], [half, height, 0], [-half, height, 0]];
    const stride = 24;
    const vertices = new Uint8Array(p.length * stride);
    const view = new DataView(vertices.buffer);
    p.forEach((q, i) => {
        for (let k = 0; k < 3; k++) view.setFloat32(i * stride + k * 4, q[k], true);
        view.setFloat32(i * stride + 12, 0, true);
        view.setFloat32(i * stride + 16, 0, true);
        view.setFloat32(i * stride + 20, 1, true);
    });
    return {
        channels: [
            { semantic: MeshChannel.Position, components: 3, type: MeshChannelType.Float32, offset: 0 },
            { semantic: MeshChannel.Normal, components: 3, type: MeshChannelType.Float32, offset: 12 },
        ],
        vertexStride: stride,
        vertexCount: 4,
        vertices,
        indices: Uint32Array.from([0, 1, 2, 0, 2, 3]),
        aabbMin: [-half, 0, 0],
        aabbMax: [half, height, 0],
    };
}

/** The unwrap's own output, which is also what an import would hand a bake. */
const baked = (mesh: MeshData): MeshData => unwrapLightmapUV(mesh).mesh;

/** Brightness of the texel a world point lands on. */
function brightnessAt(result: ReturnType<typeof bakeLightmap>, surface: number,
                      u: number, v: number): number {
    const [su, sv, ou, ov] = result.scaleOffset[surface];
    const x = Math.floor((ou + u * su) * result.size);
    const y = Math.floor((ov + v * sv) * result.size);
    const at = (y * result.size + x) * 4;
    return (result.pixels[at] + result.pixels[at + 1] + result.pixels[at + 2]) / 3;
}

/**
 * The lightmap UV of a world point, found by the triangle it lands in.
 *
 * Looked up and not derived: an unwrap splits and reorders vertices, so a case
 * that assumed corner 0 stayed corner 0 would be asserting about the wrong
 * texel and could pass on a bake that lit nothing.
 */
function uvAtWorld(mesh: MeshData, wx: number, wy: number, wz: number): [number, number] | null {
    const pos = mesh.channels.find((c) => c.semantic === MeshChannel.Position)!;
    const uvc = mesh.channels.find((c) => c.semantic === MeshChannel.TexCoord1)!;
    const view = new DataView(mesh.vertices.buffer, mesh.vertices.byteOffset, mesh.vertices.byteLength);
    const at = (v: number, c: { offset: number }, k: number): number =>
        view.getFloat32(v * mesh.vertexStride + c.offset + k * 4, true);
    for (let i = 0; i + 2 < mesh.indices.length; i += 3) {
        const v = [0, 1, 2].map((k) => mesh.indices[i + k]);
        const p = v.map((x) => [at(x, pos, 0), at(x, pos, 1), at(x, pos, 2)]);
        const e1 = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]];
        const e2 = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
        const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2],
                   e1[0] * e2[1] - e1[1] * e2[0]];
        const area2 = Math.hypot(n[0], n[1], n[2]);
        if (area2 < 1e-12) continue;
        const d = [wx - p[0][0], wy - p[0][1], wz - p[0][2]];
        if (Math.abs((d[0] * n[0] + d[1] * n[1] + d[2] * n[2]) / area2) > 1e-4) continue;
        const cross = (a: number[], b: number[]): number[] =>
            [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
        const dot = (a: number[], b: number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
        const u = dot(cross(d, e2), n) / (area2 * area2);
        const w = dot(cross(e1, d), n) / (area2 * area2);
        if (u < -1e-6 || w < -1e-6 || u + w > 1 + 1e-6) continue;
        const b0 = 1 - u - w;
        return [
            b0 * at(v[0], uvc, 0) + u * at(v[1], uvc, 0) + w * at(v[2], uvc, 0),
            b0 * at(v[0], uvc, 1) + u * at(v[1], uvc, 1) + w * at(v[2], uvc, 1),
        ];
    }
    return null;
}

const LIT = { atlasSize: 256, texelsPerUnit: 3, bounces: 0, samples: 16, dilate: 0 };

describe('a baked lightmap', () => {
    it('carries more lights than a frame can', () => {
        // Twenty, where the renderer stops at sixteen and drops the rest by
        // brightness. Each is small and directly over its own patch of floor, so
        // twenty separate bright spots is the whole claim.
        const ground = baked(floor(20));
        const surfaces: BakeSurface[] = [{ mesh: ground, transform: IDENTITY }];
        const lights: BakeLight[] = [];
        for (let i = 0; i < 20; i++) {
            const t = (i + 0.5) / 20;
            lights.push({
                kind: 'point',
                position: [-18 + 36 * t, 1.5, 0],
                color: [1, 1, 1], intensity: 1, radius: 3,
            });
        }
        const result = bakeLightmap(surfaces, lights, { ...LIT, texelsPerUnit: 2 });
        expect(result.lumels).toBeGreaterThan(1000);

        let brightSpots = 0;
        for (let i = 0; i < 20; i++) {
            const x = -18 + 36 * ((i + 0.5) / 20);
            const uv = uvAtWorld(ground, x, 0, 0);
            expect(uv).not.toBeNull();
            if (brightnessAt(result, 0, uv![0], uv![1]) > 20) brightSpots++;
        }
        expect(brightSpots).toBe(20);
    });

    it('leaves a shadow where something stands in the way', () => {
        const ground = baked(floor(8));
        const blocker = baked(wall(8, 4));
        const result = bakeLightmap(
            [{ mesh: ground, transform: IDENTITY }, { mesh: blocker, transform: translated(0, 0, 0) }],
            [{ kind: 'point', position: [0, 3, -6], color: [1, 1, 1], intensity: 4, radius: 40 }],
            LIT,
        );
        // The wall stands on z = 0 and the light is behind it, so the floor in
        // front is in shadow and the floor behind is not.
        const lightSide = sampleFloor(result, ground, -4);
        const shadowed = sampleFloor(result, ground, 4);
        expect(lightSide).toBeGreaterThan(20);
        expect(shadowed).toBeLessThan(lightSide / 3);
    });

    it('reaches what no light points at, once light is allowed to bounce', () => {
        // The panel faces DOWN and the lamp is above it, so its lit side is the
        // one no light points at. Everything it gets is what the floor sends up —
        // the term a real-time frame here has no way to compute at all.
        const ground = baked(floor(8));
        const panel = baked(ceiling(2));
        const surfaces: BakeSurface[] = [
            { mesh: ground, transform: IDENTITY, albedo: [1, 1, 1] },
            { mesh: panel, transform: translated(0, 3, 0), albedo: [1, 1, 1] },
        ];
        const lights: BakeLight[] = [
            { kind: 'point', position: [0, 6, 0], color: [1, 1, 1], intensity: 8, radius: 40 },
        ];
        const dark = bakeLightmap(surfaces, lights, { ...LIT, bounces: 0 });
        const lit = bakeLightmap(surfaces, lights, { ...LIT, bounces: 2, samples: 64 });
        expect(brightestOf(dark, 1)).toBe(0);
        expect(brightestOf(lit, 1)).toBeGreaterThan(0);
    });

    it('carries the colour of what the light bounced off', () => {
        // The reason a bounce takes an albedo at all. A white panel over a red
        // floor comes back red, and over a white floor it does not — colour
        // bleeding is most of what separates a bounce from a flat ambient term.
        const ground = baked(floor(8));
        const panel = baked(ceiling(2));
        const lights: BakeLight[] = [
            { kind: 'point', position: [0, 6, 0], color: [1, 1, 1], intensity: 8, radius: 40 },
        ];
        const under = (albedo: [number, number, number]): [number, number, number] => {
            const r = bakeLightmap([
                { mesh: ground, transform: IDENTITY, albedo },
                { mesh: panel, transform: translated(0, 3, 0), albedo: [1, 1, 1] },
            ], lights, { ...LIT, bounces: 1, samples: 64 });
            return brightestChannels(r, 1);
        };
        const [rr, rg] = under([1, 0.1, 0.1]);
        const [wr, wg] = under([1, 1, 1]);
        expect(rr).toBeGreaterThan(0);
        expect(rr / Math.max(rg, 1)).toBeGreaterThan(3);
        expect(wr / Math.max(wg, 1)).toBeLessThan(1.2);
    });

    it('gives each object its own patch of the atlas', () => {
        const a = baked(floor(4));
        const b = baked(floor(4));
        const result = bakeLightmap(
            [{ mesh: a, transform: translated(-6, 0, 0) }, { mesh: b, transform: translated(6, 0, 0) }],
            [{ kind: 'directional', direction: [0, -1, 0], color: [1, 1, 1], intensity: 1 }],
            LIT,
        );
        expect(result.scaleOffset).toHaveLength(2);
        const [, , ax, ay] = result.scaleOffset[0];
        const [, , bx, by] = result.scaleOffset[1];
        expect(ax === bx && ay === by).toBe(false);
    });

    it('answers the same twice', () => {
        // A bake that differs between runs cannot be told from one that is wrong
        // once. The scene has to BOUNCE for this to be about the sample set: over
        // a lone plane every ray misses and a random hemisphere passes too.
        const ground = baked(floor(8));
        const panel = baked(ceiling(2));
        const args: [BakeSurface[], BakeLight[]] = [
            [{ mesh: ground, transform: IDENTITY, albedo: [1, 1, 1] },
             { mesh: panel, transform: translated(0, 3, 0), albedo: [1, 1, 1] }],
            [{ kind: 'point', position: [0, 6, 0], color: [1, 0.5, 0.25], intensity: 8, radius: 40 }],
        ];
        const first = bakeLightmap(...args, { ...LIT, bounces: 1, samples: 32 });
        const second = bakeLightmap(...args, { ...LIT, bounces: 1, samples: 32 });
        expect(brightestOf(first, 1)).toBeGreaterThan(0);
        expect(Array.from(first.pixels)).toEqual(Array.from(second.pixels));
    });
});

/** Brightest texel in one surface's patch of the atlas. */
function brightestOf(result: ReturnType<typeof bakeLightmap>, surface: number): number {
    const [su, sv, ou, ov] = result.scaleOffset[surface];
    let best = 0;
    const x0 = Math.floor(ou * result.size), x1 = Math.ceil((ou + su) * result.size);
    const y0 = Math.floor(ov * result.size), y1 = Math.ceil((ov + sv) * result.size);
    for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
            const at = (y * result.size + x) * 4;
            best = Math.max(best, (result.pixels[at] + result.pixels[at + 1] + result.pixels[at + 2]) / 3);
        }
    }
    return best;
}

/** The channels of the brightest texel in one surface's patch. */
function brightestChannels(result: ReturnType<typeof bakeLightmap>,
                           surface: number): [number, number, number] {
    const [su, sv, ou, ov] = result.scaleOffset[surface];
    let best = -1;
    let out: [number, number, number] = [0, 0, 0];
    const x0 = Math.floor(ou * result.size), x1 = Math.ceil((ou + su) * result.size);
    const y0 = Math.floor(ov * result.size), y1 = Math.ceil((ov + sv) * result.size);
    for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
            const at = (y * result.size + x) * 4;
            const sum = result.pixels[at] + result.pixels[at + 1] + result.pixels[at + 2];
            if (sum > best) {
                best = sum;
                out = [result.pixels[at], result.pixels[at + 1], result.pixels[at + 2]];
            }
        }
    }
    return out;
}

/** Brightness of the floor at world z, on its centre line. */
function sampleFloor(result: ReturnType<typeof bakeLightmap>, mesh: MeshData, z: number): number {
    const uv = uvAtWorld(mesh, 0, 0, z);
    if (!uv) throw new Error(`no floor triangle at z=${z}`);
    return brightnessAt(result, 0, uv[0], uv[1]);
}
