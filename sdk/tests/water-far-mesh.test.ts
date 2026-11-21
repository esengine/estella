// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The far distance mesh: the flat sea from the rings' edge out to its extent, built apart so it can take a material of its own, and
 *        meeting the rings on their own edge vertices so there is no crack between them.
 */
import { describe, expect, it } from 'vitest';
import { buildFarMesh, buildOceanMesh, oceanReach } from '../src/water/waterMesh';
import { MeshChannel, type MeshData } from '../src/asset/meshFormat';

function positions(mesh: MeshData): Array<[number, number]> {
    const pos = mesh.channels.find((c) => c.semantic === MeshChannel.Position)!;
    const view = new DataView(mesh.vertices.buffer, mesh.vertices.byteOffset, mesh.vertices.byteLength);
    const out: Array<[number, number]> = [];
    for (let v = 0; v < mesh.vertexCount; v++) out.push([view.getFloat32(v * mesh.vertexStride + pos.offset, true), view.getFloat32(v * mesh.vertexStride + pos.offset + 8, true)]);
    return out;
}

describe('the far distance mesh', () => {
    const cells = 16, rings = 3, cell = 10, reach = oceanReach(cells, rings, cell);

    it('reaches its extent, and starts on the rings\' own edge so the two meet without a crack', () => {
        const far = buildFarMesh(cells, rings, cell, 5000)!;
        const pts = positions(far);
        expect(Math.max(...pts.map(([x, z]) => Math.max(Math.abs(x), Math.abs(z))))).toBeCloseTo(5000, 3);
        const ringEdge = new Set(positions(buildOceanMesh(cells, rings, cell)).filter(([x, z]) => Math.max(Math.abs(x), Math.abs(z)) === reach).map(([x, z]) => `${x},${z}`));
        const inner = pts.filter(([x, z]) => Math.max(Math.abs(x), Math.abs(z)) === reach);
        expect(inner.length).toBeGreaterThan(0);
        for (const [x, z] of inner) expect(ringEdge.has(`${x},${z}`)).toBe(true);
        expect(far.indices.length % 3).toBe(0);
        expect(Math.max(...far.indices)).toBeLessThan(far.vertexCount);
    });

    it('is the apron the whole ocean mesh carries with a skirt, and nothing of the rings', () => {
        const far = buildFarMesh(cells, rings, cell, 5000)!;
        const whole = buildOceanMesh(cells, rings, cell, 5000), rings0 = buildOceanMesh(cells, rings, cell);
        expect(far.indices.length).toBe(whole.indices.length - rings0.indices.length);
        expect(far.vertexCount).toBe(whole.vertexCount - rings0.vertexCount);
    });

    it('is nothing where its extent does not reach past the rings', () => {
        expect(buildFarMesh(cells, rings, cell, reach)).toBeNull();
        expect(buildFarMesh(cells, rings, cell, reach / 2)).toBeNull();
    });
});
