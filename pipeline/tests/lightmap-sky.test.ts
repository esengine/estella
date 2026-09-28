// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * The claim: where nothing stands in the way, a bake lit by an environment gives
 * a surface what the frame would have given it — the same nine coefficients,
 * turned and tinted the same way — so baking changes only what is covered.
 */
import { describe, it, expect } from 'vitest';
import { bakeLightmap, unwrapLightmapUV, decodeLightmap, evalIrradianceSH,
         MeshChannel, MeshChannelType, type MeshData } from 'esengine';
import { irradianceSky, type BakeEnvironment } from '../src/assets/reflectionBake';

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** A quad facing `n`, spanning the two axes it does not face along. */
function quad(n: [number, number, number]): MeshData {
    const axis = n.findIndex((v) => v !== 0);
    const [u, v] = [0, 1, 2].filter((k) => k !== axis);
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const stride = 24;
    const vertices = new Uint8Array(4 * stride);
    const view = new DataView(vertices.buffer);
    corners.forEach(([a, b], i) => {
        const p = [0, 0, 0];
        p[u] = a; p[v] = b;
        for (let k = 0; k < 3; k++) {
            view.setFloat32(i * stride + k * 4, p[k], true);
            view.setFloat32(i * stride + 12 + k * 4, n[k], true);
        }
    });
    // Wound so the face's own normal agrees with the declared one.
    const cross = (u + 1) % 3 === v ? n[axis] > 0 : n[axis] < 0;
    return unwrapLightmapUV({
        channels: [
            { semantic: MeshChannel.Position, components: 3, type: MeshChannelType.Float32, offset: 0 },
            { semantic: MeshChannel.Normal, components: 3, type: MeshChannelType.Float32, offset: 12 },
        ],
        vertexStride: stride, vertexCount: 4, vertices,
        indices: Uint32Array.from(cross ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]),
        aabbMin: [-1, -1, -1], aabbMax: [1, 1, 1],
    }).mesh;
}

/** Brighter overhead and toward +X, and positive everywhere so no clamp bends it. */
const IRRADIANCE = [
    2.0, 1.8, 1.5,
    0.4, 0.4, 0.4,
    0, 0, 0,
    0.3, 0.2, 0.1,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
];
const TINT: [number, number, number] = [1.2, 1, 0.8];

function environment(rotation: number): BakeEnvironment {
    return {
        document: { version: 1, irradiance: IRRADIANCE } as BakeEnvironment['document'],
        atlasPng: new Uint8Array(), rotation,
    };
}

/** What the frame's shader reads at world normal `n`: envDirection, then shIrradiance. */
function frameReads(n: [number, number, number], rotation: number): number[] {
    const a = -(rotation * Math.PI) / 180;
    const c = Math.cos(a), s = Math.sin(a);
    const d = [c * n[0] + s * n[2], n[1], -s * n[0] + c * n[2]];
    return evalIrradianceSH(IRRADIANCE, d[0]!, d[1]!, d[2]!).map((v, k) => v * TINT[k]!);
}

function baked(n: [number, number, number], rotation: number): number[] {
    const result = bakeLightmap([{ mesh: quad(n), transform: IDENTITY }], [], {
        atlasSize: 64, texelsPerUnit: 8, bounces: 0, samples: 256, dilate: 0,
        sky: irradianceSky(environment(rotation), TINT),
    });
    const [su, sv, ou, ov] = result.scaleOffset[0]!;
    const x = Math.floor((ou + su / 2) * result.size);
    const y = Math.floor((ov + sv / 2) * result.size);
    return decodeLightmap(result.pixels, y * result.size + x);
}

describe('an environment, baked', () => {
    for (const [name, n] of [['a floor', [0, 1, 0]], ['a wall facing +X', [1, 0, 0]],
                             ['a wall facing -Z', [0, 0, -1]]] as const) {
        for (const rotation of [0, 90]) {
            it(`gives ${name} what the frame reads there, turned ${rotation} degrees`, () => {
                const want = frameReads(n as [number, number, number], rotation);
                const got = baked(n as [number, number, number], rotation);
                for (let k = 0; k < 3; k++) expect(got[k]).toBeCloseTo(want[k]!, 1);
            });
        }
    }
});
