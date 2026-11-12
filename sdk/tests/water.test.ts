// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { WAVE_SET, waveBend, waveFade, waveHeight, waveSlope, type WaveParams } from '../src/water/waves';
import { WATER_SHADER_TEMPLATE } from '../src/water/waterShader';
import { buildOceanMesh, oceanReach, oceanSnap } from '../src/water/waterMesh';
import { MeshChannel } from '../src/asset/meshFormat';
import type { MeshData } from '../src/asset/meshFormat';

const params: WaveParams = { height: 0.8, length: 14, speed: 1, direction: 30 };

function positions(mesh: MeshData): Float32Array {
    const channel = mesh.channels.find((c) => c.semantic === MeshChannel.Position)!;
    const view = new DataView(mesh.vertices.buffer, mesh.vertices.byteOffset);
    const out = new Float32Array(mesh.vertexCount * 3);
    for (let i = 0; i < mesh.vertexCount; i++) {
        for (let k = 0; k < 3; k++) out[i * 3 + k] = view.getFloat32(i * mesh.vertexStride + channel.offset + k * 4, true);
    }
    return out;
}

function colorRed(mesh: MeshData, i: number): number {
    const channel = mesh.channels.find((c) => c.semantic === MeshChannel.Color)!;
    return mesh.vertices[i * mesh.vertexStride + channel.offset]! / 255;
}

/** Twice the signed area of a triangle on the xz plane, and the sign of its normal's y: positive faces up. */
function facing(p: Float32Array, a: number, b: number, c: number): number {
    const ux = p[b * 3]! - p[a * 3]!, uz = p[b * 3 + 2]! - p[a * 3 + 2]!;
    const vx = p[c * 3]! - p[a * 3]!, vz = p[c * 3 + 2]! - p[a * 3 + 2]!;
    return uz * vx - ux * vz;
}

describe('the waves', () => {
    it('is the sum of the set\'s peaked sines', () => {
        const t = 1.3;
        const [x, z] = waveBend(3.7, -2.2, params.length);
        let expected = 0;
        for (const [heading, lengthShare, heightShare, speedShare] of WAVE_SET) {
            const k = 2 * Math.PI / (params.length * lengthShare);
            const a = (params.direction + heading) * Math.PI / 180;
            const theta = k * (Math.sin(a) * x + Math.cos(a) * z) - Math.sqrt(9.8 * k) * params.speed * speedShare * t;
            expected += params.height * heightShare * Math.exp(Math.sin(theta) - 1);
        }
        expect(waveHeight(params, 3.7, -2.2, t)).toBeCloseTo(expected, 10);
    });

    it("bends its crests: one wave's crest is no straight line", () => {
        // Walk along the first wave's crest line as a straight sine would have it, and read how far the phase moves off it.
        const a = params.direction * Math.PI / 180;
        const along = [Math.cos(a), -Math.sin(a)];
        const k = 2 * Math.PI / params.length;
        const phases: number[] = [];
        for (let s = 0; s <= 40; ++s) {
            const [bx, bz] = waveBend(along[0]! * s * params.length, along[1]! * s * params.length, params.length);
            phases.push(k * (Math.sin(a) * bx + Math.cos(a) * bz));
        }
        expect(Math.max(...phases) - Math.min(...phases)).toBeGreaterThan(Math.PI);
    });

    it('bends by no more than keeps the surface from folding over itself', () => {
        for (let u = -50; u < 50; u += 0.37) {
            const [, , xAlongZ, zAlongX] = waveBend(u * params.length, -u * 1.7 * params.length, params.length);
            expect(Math.abs(xAlongZ)).toBeLessThan(0.4);
            expect(Math.abs(zAlongX)).toBeLessThan(0.4);
        }
    });

    it('is bent by the same numbers in the shader, in both languages and both stages', () => {
        const source = JSON.stringify(WATER_SHADER_TEMPLATE);
        for (const term of ['span * 0.45 * sin(q.y * 0.73 + 1.3)', 'span * 0.45 * sin(q.x * 0.61 + 2.7)', '0.3285 * cos(q.y * 0.73 + 1.3)', '0.2745 * cos(q.x * 0.61 + 2.7)']) {
            expect(source.split(term).length - 1, term).toBeGreaterThanOrEqual(4);
        }
        expect(source.split('vec4 waterBend(').length - 1).toBe(2);
        expect(source.split('fn waterBend(').length - 1).toBe(2);
    });

    it('has its waves written into the shader as the numbers the set gives, in both languages', () => {
        const source = JSON.stringify(WATER_SHADER_TEMPLATE);
        WAVE_SET.forEach(([heading, lengthShare, heightShare, speedShare]) => {
            const radians = heading * Math.PI / 180;
            const numbers = [Math.cos(radians), Math.sin(radians), 1 / lengthShare, speedShare / Math.sqrt(lengthShare)].map((n) => n.toFixed(6));
            const call = `run, far, ${numbers.join(', ')}, ${heightShare.toFixed(6)})`;
            expect(source.split(call).length - 1, call).toBe(2);
        });
    });

    it('has a slope that is the derivative of its height', () => {
        const e = 1e-4;
        for (const [x, z, t] of [[0, 0, 0], [5.5, -3.1, 2.4], [-12, 9, 7.7]] as const) {
            const [sx, sz] = waveSlope(params, x, z, t);
            expect(sx).toBeCloseTo((waveHeight(params, x + e, z, t) - waveHeight(params, x - e, z, t)) / (2 * e), 4);
            expect(sz).toBeCloseTo((waveHeight(params, x, z + e, t) - waveHeight(params, x, z - e, t)) / (2 * e), 4);
        }
    });

    it('moves with time and is calm without height', () => {
        expect(waveHeight(params, 1, 1, 0)).not.toBeCloseTo(waveHeight(params, 1, 1, 3), 3);
        expect(waveHeight({ ...params, height: 0 }, 1, 1, 5)).toBe(0);
    });

    it('leaves out the waves a coarse cell cannot draw', () => {
        expect(waveFade(14, 0)).toBe(1);
        expect(waveFade(14, 1)).toBe(1);
        expect(waveFade(14, 14 / 3)).toBe(0);
        expect(waveFade(14, 14 / 4.5)).toBeCloseTo(0.5, 10);
        const fine = waveHeight(params, 2, 3, 1, 0);
        const coarse = waveHeight(params, 2, 3, 1, 8);
        expect(coarse).not.toBeCloseTo(fine, 3);
    });
});

describe('an ocean\'s apron', () => {
    it('runs from the rings to the horizon, facing up, with no gap and no overlap', () => {
        const cells = 16, rings = 3, cell = 1, far = 1000;
        const plain = buildOceanMesh(cells, rings, cell), mesh = buildOceanMesh(cells, rings, cell, far);
        const p = positions(mesh), reach = oceanReach(cells, rings, cell);
        expect(mesh.aabbMax[0]).toBeCloseTo(far, 3);
        expect(mesh.aabbMin[2]).toBeCloseTo(-far, 3);
        let area = 0;
        for (let t = plain.indices.length; t < mesh.indices.length; t += 3) {
            const f = facing(p, mesh.indices[t]!, mesh.indices[t + 1]!, mesh.indices[t + 2]!);
            expect(f).toBeGreaterThan(0);
            area += f / 2;
        }
        expect(area).toBeCloseTo((2 * far) ** 2 - (2 * reach) ** 2, 1);
    });

    it('is not there when it would end inside the rings', () => {
        expect(buildOceanMesh(16, 3, 1, 10).indices.length).toBe(buildOceanMesh(16, 3, 1).indices.length);
    });
});

describe('the surface\'s mesh', () => {
    const cells = 16, rings = 4, cell = 1;
    const mesh = buildOceanMesh(cells, rings, cell);
    const p = positions(mesh);

    it('reaches as far as it says and tiles its square exactly once', () => {
        const reach = oceanReach(cells, rings, cell);
        expect(reach).toBe(64);
        expect(mesh.aabbMax[0]).toBe(reach);
        let area = 0;
        for (let t = 0; t < mesh.indices.length; t += 3) {
            const f = facing(p, mesh.indices[t]!, mesh.indices[t + 1]!, mesh.indices[t + 2]!);
            expect(f).toBeGreaterThan(0);
            area += f / 2;
        }
        expect(area).toBeCloseTo((2 * reach) ** 2, 3);
    });

    it('marks each vertex with its ring, which the shader turns into a cell size', () => {
        const reds = new Set<number>();
        for (let i = 0; i < mesh.vertexCount; i++) reds.add(Math.round(colorRed(mesh, i) * 7));
        expect([...reds].sort()).toEqual([0, 1, 2, 3]);
    });

    it('snaps to the lattice its coarsest ring lines up on', () => {
        expect(oceanSnap(rings, cell)).toBe(8);
    });
});
