// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/** The strip a road lays on the ground: where its vertices go is what decides whether it lies on the hills or cuts through them. */
import { describe, expect, it } from 'vitest';
import { MeshChannel, type MeshData } from '../src/asset/meshFormat';
import { buildRoadDecal, type RoadDecalData, type RoadGround } from '../src/spline/roadDecal';
import type { SplineData } from '../src/spline/splineComponent';

const ROAD: RoadDecalData = { step: 10, across: 4, widthScale: 1, lift: 0.5, edgeFade: 0.5, tile: 100 };
const straight = (width = 40): SplineData => ({ closed: false, points: [{ x: 0, y: 7, z: 0, width }, { x: 100, y: 7, z: 0, width }] });
const ORIGIN = { x: 0, y: 0, z: 0 };

function read(mesh: MeshData) {
    const view = new DataView(mesh.vertices.buffer);
    const at = (semantic: number) => mesh.channels.find((c) => c.semantic === semantic)!.offset;
    const out: { x: number; y: number; z: number; u: number; v: number; alpha: number; ny: number }[] = [];
    for (let i = 0; i < mesh.vertexCount; i++) {
        const b = i * mesh.vertexStride;
        out.push({
            x: view.getFloat32(b + at(MeshChannel.Position), true), y: view.getFloat32(b + at(MeshChannel.Position) + 4, true), z: view.getFloat32(b + at(MeshChannel.Position) + 8, true),
            u: view.getFloat32(b + at(MeshChannel.TexCoord0), true), v: view.getFloat32(b + at(MeshChannel.TexCoord0) + 4, true),
            alpha: view.getUint8(b + at(MeshChannel.Color) + 3) / 255, ny: view.getFloat32(b + at(MeshChannel.Normal) + 4, true),
        });
    }
    return out;
}

describe('a road on the ground', () => {
    it('lies where the ground says, a lift above it, wherever the curve itself was drawn', () => {
        const hills: RoadGround = { heightAt: (x, z) => Math.sin(x * 0.1) * 20 + z * 0.5 };
        const mesh = buildRoadDecal(straight(), ROAD, ORIGIN, hills)!;
        for (const p of read(mesh)) expect(p.y).toBeCloseTo(Math.sin(p.x * 0.1) * 20 + p.z * 0.5 + 0.5, 2);
    });

    it('lies along the curve as drawn with no ground to ask, or where the ground has no answer', () => {
        for (const p of read(buildRoadDecal(straight(), ROAD, ORIGIN, null)!)) expect(p.y).toBeCloseTo(7.5, 3);
        const edge: RoadGround = { heightAt: (x) => (x < 50 ? 3 : null) };
        const pts = read(buildRoadDecal(straight(), ROAD, ORIGIN, edge)!);
        expect(pts.find((p) => p.x < 40)!.y).toBeCloseTo(3.5, 3);
        expect(pts.find((p) => p.x > 60)!.y).toBeCloseTo(7.5, 3);
    });

    it('is measured from the entity, whose place it is drawn through', () => {
        const hills: RoadGround = { heightAt: () => 10 };
        const pts = read(buildRoadDecal(straight(), ROAD, { x: 1000, y: 4, z: -500 }, hills)!);
        expect(pts[0]!.y).toBeCloseTo(6.5, 3);
        expect(pts[0]!.x).toBeCloseTo(0, 3);
    });

    it('asks the ground at the world place, not the local one', () => {
        const seen: number[] = [];
        buildRoadDecal(straight(), { ...ROAD, step: 100 }, { x: 1000, y: 0, z: 0 }, { heightAt: (x) => { seen.push(x); return 0; } });
        expect(Math.min(...seen)).toBeGreaterThanOrEqual(1000);
    });

    it('is as wide as the spline says, times its scale', () => {
        const z = (scale: number) => read(buildRoadDecal(straight(40), { ...ROAD, widthScale: scale }, ORIGIN, null)!).map((p) => p.z);
        expect(Math.max(...z(1)) - Math.min(...z(1))).toBeCloseTo(40, 3);
        expect(Math.max(...z(0.5)) - Math.min(...z(0.5))).toBeCloseTo(20, 3);
    });

    it('fades to nothing at both edges and is whole down the middle', () => {
        const pts = read(buildRoadDecal(straight(), ROAD, ORIGIN, null)!);
        expect(pts.filter((p) => p.u === 0 || p.u === 1).every((p) => p.alpha === 0)).toBe(true);
        expect(pts.filter((p) => p.u === 0.5).every((p) => p.alpha === 1)).toBe(true);
    });

    it('keeps a hard edge when told to', () => {
        const pts = read(buildRoadDecal(straight(), { ...ROAD, edgeFade: 0 }, ORIGIN, null)!);
        expect(pts.every((p) => p.alpha === 1)).toBe(true);
    });

    it('repeats its texture along the curve by world length', () => {
        const pts = read(buildRoadDecal(straight(), ROAD, ORIGIN, null)!);
        expect(Math.max(...pts.map((p) => p.v))).toBeCloseTo(1, 3);
        const longer = read(buildRoadDecal(straight(), { ...ROAD, tile: 25 }, ORIGIN, null)!);
        expect(Math.max(...longer.map((p) => p.v))).toBeCloseTo(4, 3);
    });

    it('takes the ground\'s normal, so it is lit as the ground is', () => {
        const pts = read(buildRoadDecal(straight(), ROAD, ORIGIN, { heightAt: () => 0, normalAt: () => [0, 0.6, 0.8] })!);
        expect(pts[0]!.ny).toBeCloseTo(0.6, 3);
    });

    it('has triangles that face up and name only its own vertices', () => {
        const mesh = buildRoadDecal(straight(), ROAD, ORIGIN, null)!;
        expect(Math.max(...mesh.indices)).toBeLessThan(mesh.vertexCount);
        const pts = read(mesh);
        const [a, b, c] = [pts[mesh.indices[0]!]!, pts[mesh.indices[1]!]!, pts[mesh.indices[2]!]!];
        const ny = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
        expect(ny).toBeGreaterThan(0);
    });

    it('lays nothing for a curve with nothing in it', () => {
        expect(buildRoadDecal({ closed: false, points: [{ x: 0, y: 0, z: 0, width: 1 }] }, ROAD, ORIGIN, null)).toBeNull();
        expect(buildRoadDecal({ closed: false, points: [{ x: 5, y: 0, z: 5, width: 1 }, { x: 5, y: 0, z: 5, width: 1 }] }, ROAD, ORIGIN, null)).toBeNull();
    });
});
