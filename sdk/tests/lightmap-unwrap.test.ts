// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * The claim: a bake can be read through what this produces.
 *
 * That is one property and not a resemblance — NO TWO SURFACES SHARE A TEXEL —
 * so it is checked the way a bake would use it: rasterise every triangle into a
 * grid of lumels and look for one covered twice.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { unwrapLightmapUV } from '../src/lightmap';
import { decodeMesh, MeshChannel, MeshChannelType, type MeshData, type MeshChannelDesc } from '../src/asset/meshFormat';

const chan = (m: MeshData, s: number): MeshChannelDesc =>
    m.channels.find((c) => c.semantic === s) as MeshChannelDesc;

function readVec(m: MeshData, semantic: number, v: number, n: number): number[] {
    const c = chan(m, semantic);
    const view = new DataView(m.vertices.buffer, m.vertices.byteOffset, m.vertices.byteLength);
    const at = v * m.vertexStride + c.offset;
    return Array.from({ length: n }, (_, i) => view.getFloat32(at + i * 4, true));
}

/** A unit cube: six faces at right angles, so a 60-degree chart angle must cut it
 *  into six pieces and split all eight of its corners three ways. */
function cube(): MeshData {
    const corners = [
        [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
        [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
    ];
    const faces = [
        [0, 1, 2, 3], [5, 4, 7, 6], [4, 0, 3, 7],
        [1, 5, 6, 2], [4, 5, 1, 0], [3, 2, 6, 7],
    ];
    const stride = 12;
    const vertices = new Uint8Array(corners.length * stride);
    const view = new DataView(vertices.buffer);
    corners.forEach((p, i) => {
        for (let k = 0; k < 3; k++) view.setFloat32(i * stride + k * 4, p[k], true);
    });
    const indices: number[] = [];
    for (const [a, b, c, d] of faces) indices.push(a, b, c, a, c, d);
    return {
        channels: [{ semantic: MeshChannel.Position, components: 3, type: MeshChannelType.Float32, offset: 0 }],
        vertexStride: stride,
        vertexCount: corners.length,
        vertices,
        indices: Uint32Array.from(indices),
        aabbMin: [-1, -1, -1],
        aabbMax: [1, 1, 1],
    };
}

/**
 * How many times each lumel of an `n`-by-`n` atlas is covered.
 *
 * A texel centre inside two triangles is the failure a lightmap cannot survive:
 * one surface's light is written over the other's, and which one wins depends on
 * the order the bake happened to visit them in.
 */
function coverage(mesh: MeshData, n: number): { max: number; touched: number } {
    const count = new Uint16Array(n * n);
    const uvOf = (v: number): [number, number] => readVec(mesh, MeshChannel.TexCoord1, v, 2) as [number, number];
    for (let i = 0; i + 2 < mesh.indices.length; i += 3) {
        const p = [uvOf(mesh.indices[i]), uvOf(mesh.indices[i + 1]), uvOf(mesh.indices[i + 2])];
        const minX = Math.max(0, Math.floor(Math.min(...p.map((q) => q[0])) * n));
        const maxX = Math.min(n - 1, Math.ceil(Math.max(...p.map((q) => q[0])) * n));
        const minY = Math.max(0, Math.floor(Math.min(...p.map((q) => q[1])) * n));
        const maxY = Math.min(n - 1, Math.ceil(Math.max(...p.map((q) => q[1])) * n));
        const area = (p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) - (p[2][0] - p[0][0]) * (p[1][1] - p[0][1]);
        if (Math.abs(area) < 1e-12) continue;
        for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
                const cx = (x + 0.5) / n, cy = (y + 0.5) / n;
                const w0 = ((p[1][0] - cx) * (p[2][1] - cy) - (p[2][0] - cx) * (p[1][1] - cy)) / area;
                const w1 = ((p[2][0] - cx) * (p[0][1] - cy) - (p[0][0] - cx) * (p[2][1] - cy)) / area;
                const w2 = 1 - w0 - w1;
                if (w0 >= 0 && w1 >= 0 && w2 >= 0) count[y * n + x]++;
            }
        }
    }
    let max = 0, touched = 0;
    for (const c of count) { if (c > max) max = c; if (c > 0) touched++; }
    return { max, touched };
}

/** World area of every triangle, by index, from the positions. */
function worldAreas(mesh: MeshData): number[] {
    const out: number[] = [];
    for (let i = 0; i + 2 < mesh.indices.length; i += 3) {
        const [a, b, c] = [0, 1, 2].map((k) => readVec(mesh, MeshChannel.Position, mesh.indices[i + k], 3));
        const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        out.push(Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2);
    }
    return out;
}

function uvAreas(mesh: MeshData): number[] {
    const out: number[] = [];
    for (let i = 0; i + 2 < mesh.indices.length; i += 3) {
        const [a, b, c] = [0, 1, 2].map((k) => readVec(mesh, MeshChannel.TexCoord1, mesh.indices[i + k], 2));
        out.push(Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2);
    }
    return out;
}

describe('a lightmap UV set', () => {
    it('gives a cube six charts and splits every corner three ways', () => {
        const { mesh, charts } = unwrapLightmapUV(cube());
        expect(charts).toBe(6);
        // Eight corners, each used by three faces that are three charts.
        expect(mesh.vertexCount).toBe(24);
        expect(mesh.indices.length).toBe(36);
    });

    it('never covers one lumel twice', () => {
        const { mesh } = unwrapLightmapUV(cube());
        const { max, touched } = coverage(mesh, 128);
        expect(touched).toBeGreaterThan(0);
        expect(max).toBe(1);
    });

    it('stays inside the unit square', () => {
        const { mesh } = unwrapLightmapUV(cube());
        for (let v = 0; v < mesh.vertexCount; v++) {
            const [u, w] = readVec(mesh, MeshChannel.TexCoord1, v, 2);
            expect(u).toBeGreaterThanOrEqual(0);
            expect(w).toBeGreaterThanOrEqual(0);
            expect(u).toBeLessThanOrEqual(1);
            expect(w).toBeLessThanOrEqual(1);
        }
    });

    it('lights every face at the same resolution', () => {
        // ONE world-to-texel ratio, which is what stops a wall being sharper than
        // the floor it meets. Per triangle the ratio is uv area over world area.
        const { mesh } = unwrapLightmapUV(cube());
        const ratios = uvAreas(mesh).map((uv, i) => uv / worldAreas(mesh)[i]);
        const lo = Math.min(...ratios), hi = Math.max(...ratios);
        expect(hi / lo).toBeLessThan(1.0001);
    });

    it('does not move a single vertex', () => {
        const before = cube();
        const { mesh } = unwrapLightmapUV(before);
        const tri = (m: MeshData, i: number): string =>
            [0, 1, 2].map((k) => readVec(m, MeshChannel.Position, m.indices[i + k], 3).join(',')).join('|');
        const was = new Set<string>();
        for (let i = 0; i + 2 < before.indices.length; i += 3) was.add(tri(before, i));
        for (let i = 0; i + 2 < mesh.indices.length; i += 3) expect(was.has(tri(mesh, i))).toBe(true);
        expect(mesh.indices.length).toBe(before.indices.length);
    });

    it('takes every shape the mesh can be blended into with it', () => {
        // A split vertex is the SAME vertex twice, so whatever moves the original
        // has to move both. Nothing else here reads the deltas, and a remap that
        // indexed the new table by its own position passed every other case.
        const base = cube();
        const per = 3;
        const deltas = new Float32Array(base.vertexCount * per);
        for (let v = 0; v < base.vertexCount; v++) deltas[v * per] = v + 1;
        const { mesh } = unwrapLightmapUV({
            ...base,
            morph: { names: ['Push'], hasNormals: false, deltas },
        });
        const moved = mesh.morph as NonNullable<MeshData['morph']>;
        expect(moved.deltas.length).toBe(mesh.vertexCount * per);
        // Looked up rather than derived: the corners are in winding order, and a
        // bit-pattern guess at their indices is a bug in this case, not the unwrap.
        const corners = new Map<string, number>();
        for (let v = 0; v < base.vertexCount; v++) {
            corners.set(readVec(base, MeshChannel.Position, v, 3).join(','), v);
        }
        for (let v = 0; v < mesh.vertexCount; v++) {
            const from = corners.get(readVec(mesh, MeshChannel.Position, v, 3).join(','));
            expect(from).toBeDefined();
            expect(moved.deltas[v * per]).toBe((from as number) + 1);
        }
    });

    it('carries a real model, not only a cube', () => {
        // A cube's charts are six flat quads; a model's are neither, and the packer
        // meets shapes a synthetic case never produces. Resolved from THIS file: a
        // relative path made the case skip itself in silence and pass for it.
        const file = path.resolve(__dirname,
            '../../examples/character-rig/assets/models/knight_4_0.esmesh');
        const source = decodeMesh(new Uint8Array(readFileSync(file)));
        expect(source.vertexCount).toBeGreaterThan(100);
        const { mesh, charts, coverage: filled } = unwrapLightmapUV(source);
        expect(charts).toBeGreaterThan(1);
        expect(mesh.vertexCount).toBeGreaterThanOrEqual(source.vertexCount);
        expect(filled).toBeGreaterThan(0.05);
        expect(coverage(mesh, 256).max).toBe(1);
    });
});
