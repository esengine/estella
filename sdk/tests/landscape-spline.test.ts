// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { MeshChannel, MeshChannelType, type MeshData } from '../src/asset/meshFormat';
import {
    connectedLandscape,
    connectLandscape,
    landscapeMesh,
    landscapePoint,
    landscapeSpans,
    splitLandscape,
    type LandscapeSpline,
} from '../src/terrain/landscapeSpline';
import { deformLandscapeMesh, landscapePieces } from '../src/terrain/landscapeMesh';
import { gradeLandscapeGround, landscapeGradeBrushes } from '../src/terrain/landscapeGrade';
import { GroundEdit } from '../src/terrain/groundEdit';
import { FieldSource, ModifiedSource } from '../src/terrain/source';

function road() {
    const a = landscapePoint(1, { x: -24, y: 40, z: 0 }, 12),
        b = landscapePoint(2, { x: 24, y: 40, z: 0 }, 12);
    const g: LandscapeSpline = { points: [a, b], segments: [] };
    const s = connectLandscape(g, a, b)!;
    return { a, b, g, s };
}

describe('landscape spline networks', () => {
    it('keeps every point on a socket-attached cubic and the mesh settings on both sides of a split', () => {
        const { a, b, g, s } = road();
        a.rotation.y = 70;
        b.rotation.y = -25;
        a.rotation.z = 18;
        a.sockets = [{ name: 'left', offset: { x: 1, y: 3, z: 5 } }];
        s.start.socket = 'left';
        s.end.tangent = -54;
        s.meshes.push({ ...landscapeMesh(), mesh: 'track' });
        s.layer = 4;
        const original = landscapeSpans(g)[0]!,
            split = 0.37;
        const added = splitLandscape(g, s.id, split)!;
        const [left, right] = landscapeSpans(g);
        for (let i = 0; i <= 48; i++) {
            const t = i / 48,
                p = original.at(t),
                actual = t < split ? left!.at(t / split) : right!.at((t - split) / (1 - split));
            expect(actual.x).toBeCloseTo(p.x, 8);
            expect(actual.y).toBeCloseTo(p.y, 8);
            expect(actual.z).toBeCloseTo(p.z, 8);
        }
        expect(added.layer).toBe(4);
        expect(right!.segment.meshes).toEqual(left!.segment.meshes);
        right!.segment.meshes[0]!.mesh = 'bridge';
        expect(s.meshes[0]!.mesh).toBe('track');
        const branch = landscapePoint(9, { x: 10, y: 0, z: 10 }, 6),
            isolated = landscapePoint(12, { x: 0, y: 0, z: 30 }, 6);
        g.points.push(branch, isolated);
        connectLandscape(g, added, branch);
        expect(connectLandscape(g, branch, added)).toBeUndefined();
        expect(connectedLandscape(g, [], [s.id])).toEqual({ points: new Set([1, 2, added.id, 9]), segments: new Set([1, 2, 3]) });
    });

    it('grades the core, cosine shoulders and terminal caps once and restores both height and layer eight in one patch', () => {
        const { g, s, a, b } = road();
        a.sideFalloff = b.sideFalloff = 8;
        a.endFalloff = b.endFalloff = 12;
        s.layer = 7;
        const size = 128,
            count = size + 1;
        const field = { width: count, height: count, data: new Float32Array(count * count).fill(0.2) };
        const data = { sizeX: size, sizeZ: size, height: 100, rockSlope: 0.35, dirtHeight: 0.62, snowHeight: 0.88 };
        const source = new FieldSource(field, data, null, null),
            origin = { x: 90, y: 0, z: -60 };
        const edit = new GroundEdit({ remake: () => {} }, source, new ModifiedSource(source, () => [], origin, 1), size, size);
        const height = (x: number, z: number) => edit.heightAt(x + origin.x, z + origin.z);
        const paint = (x: number, z: number) => edit.splatmapPixels().b!.pixels[((z + size / 2) * count + x + size / 2) * 4 + 3];
        const apply = () => {
            edit.begin();
            gradeLandscapeGround(edit, g, landscapeGradeBrushes(g, edit));
            return edit.end();
        };
        const patch = apply()!;
        expect(height(0, 0)).toBeCloseTo(40);
        expect(paint(0, 0)).toBe(255);
        for (const [x, z] of [
            [0, 10],
            [30, 0],
        ]) {
            expect(height(x!, z!)).toBeCloseTo(30);
            expect(paint(x!, z!)).toBe(128);
        }
        expect(height(0, 14)).toBeCloseTo(20);
        expect(height(36, 0)).toBeCloseTo(20);
        edit.apply(patch, 'before');
        expect(height(0, 0)).toBeCloseTo(20);
        expect(paint(0, 0)).toBe(0);
        edit.apply(patch, 'after');
        expect(height(0, 0)).toBeCloseTo(40);
        expect(paint(0, 0)).toBe(255);
        s.layer = -1;
        s.lower = false;
        a.y = b.y = 8;
        expect(apply()).toBeNull();
        expect(height(0, 0)).toBeCloseTo(40);
    });

    it('bends the source vertices down a curved segment while preserving UVs, mesh flip, and seeded variation', () => {
        const { g, s, a, b } = road();
        a.rotation.y = 70;
        b.rotation.y = -70;
        const span = landscapeSpans(g)[0]!;
        const verts = new Float32Array([0, -1, 0, 0, 0, 1, 0, 0, 0.5, 0, 2, 1, 0, 1, 0]);
        const mesh: MeshData = {
            channels: [
                { semantic: MeshChannel.Position, type: MeshChannelType.Float32, components: 3, offset: 0 },
                { semantic: MeshChannel.TexCoord0, type: MeshChannelType.Float32, components: 2, offset: 12 },
            ],
            vertexStride: 20,
            vertexCount: 3,
            indices: new Uint32Array([0, 1, 2]),
            vertices: new Uint8Array(verts.buffer),
            aabbMin: [0, -1, 0],
            aabbMax: [2, 1, 0],
        };
        const entry = { ...landscapeMesh(), mesh: 'road', up: 'Z' as const };
        s.meshes = [entry, { ...entry, mesh: 'bridge' }];
        const sources = new Map([
            ['road', mesh],
            ['bridge', mesh],
        ]);
        const first = landscapePieces(span, sources);
        expect(first.length).toBeGreaterThan(2);
        expect(landscapePieces(span, sources).map((p) => p.entry.mesh)).toEqual(first.map((p) => p.entry.mesh));
        expect(first.at(-1)!.end).toBeCloseTo(span.curve.length);
        const full = { entry, source: mesh, start: 0, end: span.curve.length };
        const values = () => new Float32Array(deformLandscapeMesh(span, full)!.vertices.buffer as ArrayBuffer);
        const front = values(),
            center = span.curve.position(span.curve.length / 2);
        expect(front[5]).toBeCloseTo(center[0]);
        expect(front[7]).toBeCloseTo(center[2]);
        expect(front[8]).toBe(0.5);
        expect(Math.abs(front[7]!)).toBeGreaterThan(2);
        s.flipped = true;
        expect(values()[0]).toBeGreaterThan(front[0]! + 20);
        expect(verts[0]).toBe(0);
    });
});
