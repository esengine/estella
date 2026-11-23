// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { WaterField, fieldPartsTransfer, type RiverStation, type ZoneBody, type ZoneExclusion, type ZoneGrid } from '../src/water/zone';
import { placedSpace, placementOf } from '../src/water/zonePlacement';
import { Footprint } from '../src/water/footprint';
import { bakeZone, zoneBakeJob, zoneBakeTransfer } from '../src/water/zoneBake';
import { ZONE_BAKE_WORKER_SOURCE } from '../src/water/zoneBakeWorkerBundle.generated';
import { Bakes, elsewhere } from '../src/runtime/bakes';
import type { Point2 } from '../src/water/shore';

// A turned lake, a custom body from a mesh, a river into the lake, the sea, and a volume that keeps one body out: every kind of input
// that has to cross to the worker as plain data.
const square: Point2[] = [{ x: -10, y: -10 }, { x: 10, y: -10 }, { x: 10, y: 10 }, { x: -10, y: 10 }];
const turned = { worldPosition: { x: 5, y: 1, z: -3 }, worldRotation: { x: 0, y: Math.sin(0.3), z: 0, w: Math.cos(0.3) } };
const mesh = { xyz: [30, 0, 0, 40, 0, 0, 40, 0, 12, 30, 0, 12], indices: [0, 2, 1, 0, 3, 2] };
const shape = Footprint.of(mesh.xyz, mesh.indices)!;
const stations: RiverStation[] = [];
for (let x = -60; x <= -8; x += 1) stations.push({ x, z: 0, y: 1, half: 3, dx: 1, dz: 0, speed: 2 });

const bodies = (): ZoneBody[] => [
    { kind: 'lake', key: 1, level: 1, waveHeight: 1, shoreWidth: 4, outline: square, ...placedSpace(placementOf(turned, 1.5, 1)) },
    { kind: 'lake', key: 4, level: 0.5, waveHeight: 0.5, shoreWidth: 2, outline: shape.hull, ...placedSpace(placementOf({ worldPosition: { x: 0, y: 0.5, z: 0 }, worldRotation: { x: 0, y: 0, z: 0, w: 1 } }, 1, 0.5)),
        inside: (x, z) => shape.sdf(x, z), footprint: shape.source },
    { kind: 'river', key: 2, waveHeight: 0.2, shoreWidth: 1, stations },
    { kind: 'ocean', key: 3, level: -4, waveHeight: 2, shoreWidth: 6 },
];
const exclusions = (): ZoneExclusion[] => [
    { key: 9, bottom: -1, top: 3, outline: [{ x: -2, y: -2 }, { x: 2, y: -2 }, { x: 2, y: 2 }, { x: -2, y: 2 }], scale: 1,
        only: new Set([1]), ...placedSpace(placementOf({ worldPosition: { x: 4, y: 1, z: -2 }, worldRotation: { x: 0, y: 0, z: 0, w: 1 } }, 1, 1)) },
];
const grid: ZoneGrid = { minX: -70, minZ: -40, sizeX: 120, sizeZ: 80, nx: 121, nz: 81 };
const ground = (x: number, z: number): number | null => (Math.abs(x) > 55 ? null : -3 + 0.04 * x + 0.02 * z);

const inPlace = (): WaterField => WaterField.bake(grid, bodies(), ground, 6, exclusions(), 0.5);

function expectSameField(a: WaterField, b: WaterField): void {
    const pa = a.parts(), pb = b.parts();
    expect(pb.grid).toEqual(pa.grid);
    expect(pb.ocean).toEqual(pa.ocean);
    expect([pb.materials, pb.causticRange, pb.hasCausticLook]).toEqual([pa.materials, pa.causticRange, pa.hasCausticLook]);
    for (const name of Object.keys(pa.arrays) as (keyof typeof pa.arrays)[]) {
        expect(Array.from(pb.arrays[name]), name).toEqual(Array.from(pa.arrays[name]));
    }
}

describe('a water zone baked off the main thread', () => {
    it('bakes, from the plain job, the field the main thread bakes', () => {
        const grounds = (() => { const g = WaterField.groundsUnder(grid, ground); for (;;) { const n = g.next(); if (n.done) return n.value; } })();
        const job = zoneBakeJob(grid, bodies(), exclusions(), grounds, 6, 0.5);
        expect(job).not.toBeNull();
        // What crosses is data: a structured clone of it must lose nothing a bake reads.
        const crossed = structuredClone(job!);
        const field = inPlace();
        expectSameField(field, WaterField.fromParts(bakeZone(crossed)));
        // Agreement over a dry zone would prove nothing: every body holds water somewhere in it.
        expect(new Set(field.owner)).toEqual(new Set([-1, 1, 2, 3, 4]));
    });

    it('keeps a body that cannot cross on the main thread: one without its placement', () => {
        const lost = bodies().map((b) => (b.kind === 'lake' && b.key === 1 ? { ...b, placement: undefined } : b));
        expect(zoneBakeJob(grid, lost, exclusions(), new Float64Array(grid.nx * grid.nz), 6, 0.5)).toBeNull();
    });

    it('transfers the grounds and the field\'s arrays rather than copying them', () => {
        const job = zoneBakeJob(grid, bodies(), exclusions(), new Float64Array(grid.nx * grid.nz), 6, 0.5)!;
        expect(zoneBakeTransfer(job)).toEqual([job.grounds.buffer]);
        const parts = inPlace().parts();
        expect(fieldPartsTransfer(parts).length).toBe(Object.keys(parts.arrays).length);
    });

    it('runs as the generated worker script: a job posted in, the same field posted back', async () => {
        const replies: Array<{ id: number; result?: ReturnType<typeof bakeZone>; error?: string }> = [];
        const scope = { onmessage: null as ((e: { data: unknown }) => void) | null, postMessage: (m: never) => { replies.push(m); } };
        new Function('self', ZONE_BAKE_WORKER_SOURCE)(scope);
        expect(scope.onmessage).toBeTypeOf('function');
        const grounds = (() => { const g = WaterField.groundsUnder(grid, ground); for (;;) { const n = g.next(); if (n.done) return n.value; } })();
        scope.onmessage!({ data: { ...structuredClone(zoneBakeJob(grid, bodies(), exclusions(), grounds, 6, 0.5)!), id: 7 } });
        expect(replies[0]?.error).toBeUndefined();
        expect(replies[0]?.id).toBe(7);
        expectSameField(inPlace(), WaterField.fromParts(replies[0]!.result!));
    });
});

describe('a bake waiting on a worker', () => {
    it('takes one turn a frame, not the frame\'s whole budget', () => {
        const bakes = new Bakes();
        let turns = 0;
        bakes.run('waiting', (function* () { for (;;) { turns++; yield elsewhere(0.4); } })());
        let t = 0;
        bakes.step(() => (t += 0.01));
        expect(turns).toBe(1);
        expect(bakes.active[0]?.progress).toBeCloseTo(0.4, 9);
    });

    it('is not finished in place: finish hands it back to the frames', () => {
        const bakes = new Bakes();
        const job = bakes.run('waiting', (function* () { yield elsewhere(0.2); return 1; })());
        job.finish();
        expect(bakes.active.length).toBe(1);
    });
});
