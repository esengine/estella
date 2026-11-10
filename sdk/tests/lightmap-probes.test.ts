// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * What a probe answers where a lightmap cannot: a point in the air. The cases
 * here are the ones a pixel gate cannot state — whether the nine coefficients
 * mean what an `.esenv`'s do, whether they carry a direction, and where in its
 * box a probe actually sits.
 */
import { describe, it, expect } from 'vitest';
import { bakeLightmap, evalIrradianceSH, probeAt, type BakeSurface, type BakeLight, type ProbeGrid }
    from '../src/lightmap';
import { MeshChannel, MeshChannelType, type MeshData } from '../src/asset/meshFormat';
import { unwrapLightmapUV } from '../src/lightmap';

const IDENTITY = Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

function translated(x: number, y: number, z: number): Float32Array {
    const m = IDENTITY.slice();
    m[12] = x; m[13] = y; m[14] = z;
    return m;
}

/** A quad on the YZ plane facing -X, so it looks back at the origin from +X. */
function facingBack(half: number): MeshData {
    const p = [[0, -half, -half], [0, -half, half], [0, half, half], [0, half, -half]];
    const stride = 24;
    const vertices = new Uint8Array(p.length * stride);
    const view = new DataView(vertices.buffer);
    p.forEach((q, i) => {
        for (let k = 0; k < 3; k++) view.setFloat32(i * stride + k * 4, q[k]!, true);
        view.setFloat32(i * stride + 12, -1, true);
        view.setFloat32(i * stride + 16, 0, true);
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
        indices: Uint32Array.from([0, 1, 2, 0, 2, 3]),
        aabbMin: [0, -half, -half],
        aabbMax: [0, half, half],
    };
}

const baked = (mesh: MeshData): MeshData => unwrapLightmapUV(mesh).mesh;

/** One probe at the centre of a box that holds nothing. */
const ONE: ProbeGrid = { min: [-50, -50, -50], max: [50, 50, 50], resolution: [1, 1, 1] };

/** Nine scalar coefficients at `d`, the shaders' skyOcclusion without its clamp. */
function visibilityAt(v: Float32Array, d: readonly number[], at = 0): number {
    const [r] = evalIrradianceSH(Float32Array.from([...v.slice(at, at + 9)].flatMap((c) => [c, c, c])), d[0]!, d[1]!, d[2]!);
    return r;
}

describe('a probe grid baked with sky occlusion', () => {
    it('holds no sky, and sees all of it where nothing stands', () => {
        const result = bakeLightmap([], [], {
            ambient: [0.25, 0.5, 0.75], probeGrids: [ONE], probeSamples: 256, skyOcclusion: true,
        });
        const sh = result.probes[0]!;
        const sky = result.probeSkyVisibility[0]!;
        expect(sky.length).toBe(9);
        for (const d of [[0, 1, 0], [1, 0, 0], [0, -1, 0]]) {
            expect(evalIrradianceSH(sh, d[0]!, d[1]!, d[2]!).every((c) => Math.abs(c) < 1e-6)).toBe(true);
            expect(visibilityAt(sky, d)).toBeCloseTo(1, 1);
        }
    });

    it('sees less sky toward a wall than away from it', () => {
        const wall: BakeSurface = { mesh: baked(facingBack(400)), transform: translated(20, 0, 0), albedo: [0.5, 0.5, 0.5] };
        const result = bakeLightmap([wall], [], {
            ambient: [1, 1, 1], probeGrids: [ONE], probeSamples: 512, skyOcclusion: true, bounces: 0,
        });
        const sky = result.probeSkyVisibility[0]!;
        expect(visibilityAt(sky, [1, 0, 0])).toBeLessThan(0.4);
        expect(visibilityAt(sky, [-1, 0, 0])).toBeGreaterThan(0.85);
    });

    it('is hidden by geometry that holds no baked light of its own (an occluder)', () => {
        // The same wall with no lightmap UV set: it receives nothing, and still stands between the probe and the sky.
        const wall: BakeSurface = { mesh: facingBack(400), transform: translated(20, 0, 0), albedo: [0.5, 0.5, 0.5] };
        const result = bakeLightmap([], [], {
            ambient: [1, 1, 1], probeGrids: [ONE], probeSamples: 512, skyOcclusion: true, occluders: [wall],
        });
        const sky = result.probeSkyVisibility[0]!;
        expect(visibilityAt(sky, [1, 0, 0])).toBeLessThan(0.4);
        expect(visibilityAt(sky, [-1, 0, 0])).toBeGreaterThan(0.85);
    });

    it('is not baked unless asked for', () => {
        const result = bakeLightmap([], [], { ambient: [1, 1, 1], probeGrids: [ONE], probeSamples: 64 });
        expect(result.probeSkyVisibility).toEqual([]);
        expect(evalIrradianceSH(result.probes[0]!, 0, 1, 0)[0]).toBeCloseTo(1, 1);
    });
});

describe('a probe grid', () => {
    it('reads back an ambient field as itself', () => {
        // The whole SH convention in one claim: project, convolve, over pi. A
        // uniform radiance c must come back as c at every normal — which is what
        // makes an `.esenv` and a volume interchangeable to a shader.
        const result = bakeLightmap([], [], {
            ambient: [0.25, 0.5, 0.75], probeGrids: [ONE], probeSamples: 256,
        });
        const sh = result.probes[0]!;
        for (const d of [[0, 1, 0], [1, 0, 0], [0, 0, -1], [-0.577, 0.577, 0.577]]) {
            const [r, g, b] = evalIrradianceSH(sh, d[0]!, d[1]!, d[2]!);
            expect(r).toBeCloseTo(0.25, 1);
            expect(g).toBeCloseTo(0.5, 1);
            expect(b).toBeCloseTo(0.75, 1);
        }
    });

    it('carries WHERE the light came from, not only how much', () => {
        // A red wall off to +X, lit head-on. Coefficients collapsed to their
        // constant term would answer the same in both directions, and a
        // character would not darken as it turned away from the wall.
        const surface: BakeSurface = {
            mesh: baked(facingBack(200)),
            transform: translated(100, 0, 0),
            albedo: [1, 0, 0],
        };
        const light: BakeLight = {
            kind: 'directional', direction: [1, 0, 0], color: [1, 1, 1], intensity: 1,
        };
        const result = bakeLightmap([surface], [light], {
            atlasSize: 128, texelsPerUnit: 0.1, bounces: 0,
            probeGrids: [ONE], probeSamples: 512,
        });
        const sh = result.probes[0]!;
        const towards = evalIrradianceSH(sh, 1, 0, 0);
        const away = evalIrradianceSH(sh, -1, 0, 0);
        expect(towards[0]).toBeGreaterThan(away[0] + 0.05);
        // And it is the wall's colour that arrived, not a grey of the same size.
        expect(towards[0]).toBeGreaterThan(towards[2] + 0.05);
    });

    it('puts its probes on the corners, and a lone one at the centre', () => {
        // The contract ProbeStore's trilinear read assumes: probe 0 at min, the
        // last at max, so a volume's own bounds are covered by its own probes.
        // An axis of one is a constant along it, which is the middle.
        expect(probeAt(-10, 30, 0, 3)).toBeCloseTo(-10);
        expect(probeAt(-10, 30, 1, 3)).toBeCloseTo(10);
        expect(probeAt(-10, 30, 2, 3)).toBeCloseTo(30);
        expect(probeAt(-10, 30, 0, 1)).toBeCloseTo(10);
    });

    it('is darker where something stands between it and the light', () => {
        // Two probes either side of a lit wall. Occlusion is the reason a grid
        // beats one environment at all: without it both would read alike, and a
        // character behind a wall would be lit by what the wall is hiding.
        const surface: BakeSurface = {
            mesh: baked(facingBack(200)),
            transform: translated(0, 0, 0),
            albedo: [1, 1, 1],
        };
        const light: BakeLight = {
            kind: 'directional', direction: [1, 0, 0], color: [1, 1, 1], intensity: 1,
        };
        const grid: ProbeGrid = { min: [-60, 0, 0], max: [60, 0, 0], resolution: [2, 1, 1] };
        const result = bakeLightmap([surface], [light], {
            atlasSize: 128, texelsPerUnit: 0.1, bounces: 0,
            ambient: [0.1, 0.1, 0.1], probeGrids: [grid], probeSamples: 512,
        });
        const sh = result.probes[0]!;
        const lit = evalIrradianceSH(sh, 1, 0, 0, 0)[0];
        const behind = evalIrradianceSH(sh, -1, 0, 0, 27)[0];
        expect(lit).toBeGreaterThan(behind + 0.05);
    });

    it('answers the same twice', () => {
        // The gate that keeps a baked corpus from rotting compares committed
        // bytes to a fresh bake, which only a deterministic solve can support.
        const opts = { ambient: [0.3, 0.2, 0.1] as [number, number, number], probeGrids: [ONE] };
        const a = bakeLightmap([], [], opts).probes[0]!;
        const b = bakeLightmap([], [], opts).probes[0]!;
        expect(Array.from(a)).toEqual(Array.from(b));
    });
});
