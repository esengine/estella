// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    spine-scene-diagnostics.test.ts
 * @brief   "Why is this scene's spine expensive" — answered without a profiler.
 *
 * @details Two halves that are only useful joined. What a frame paid is a
 *          number, and a number is not somewhere to go; what each asset was
 *          MISSING is the other half, and it turns 800 unresolved poses into
 *          two assets nobody promised an extent for.
 *
 *          So the criteria here are about the join, and about the one editorial
 *          decision in it: an asset whose world pose carries state is never
 *          offered as wanting a certificate, because certifying it would change
 *          nothing. A diagnostic that sends someone to do work that cannot help
 *          is worse than one that says nothing.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { SpineRuntime } from '../src/spine/SpineRuntime';
import { spineSceneDiagnostics, formatSpineDiagnostics } from '../src/spine/spineSceneDiagnostics';
import type { SpineFindingCode, SpineDiagnosticRuntime } from '../src/spine/spineSceneDiagnostics';
import { newSpineFrameMetrics, SpineTimeWindow } from '../src/spine/spineMetrics';
import type { SpineVersion } from '../src/spine/SpineManager';
import { certifyBounds } from '../src/spine/spineBounds';
import type { SpineCullingEnvelope } from '../src/spine/spineBounds';
import { fakeSpineModule, fakeSpineEra } from './helpers/fakeSpineModule';
import type { Entity } from '../src/types';

const CERTIFIED: SpineCullingEnvelope = certifyBounds({ minX: -100, minY: -100, maxX: 100, maxY: 100 });
const DT = 1 / 60;

afterEach(() => { vi.restoreAllMocks(); });

/** A core answering visibility as `sees` says, per entity. */
function camera(sees: (entity: number) => boolean) {
    const heap = new Uint32Array(64);
    return {
        renderer_submitSkeletalBatchByEntity: () => {},
        renderer_entityVisibleToCamera: (
            _r: unknown, entity: number, _l: number,
            _a: number, _b: number, _c: number, _d: number, out: number,
        ) => { heap[out >> 2] = sees(entity) ? 1 : 0; },
        _malloc: () => 4,
        _free: () => {},
        HEAPU8: new Uint8Array(heap.buffer),
        HEAPU32: heap,
    } as never;
}

const ALWAYS = camera(() => true);
const NEVER = camera(() => false);

interface Asset {
    era: string;
    entities: number;
    culling?: SpineCullingEnvelope;
    stateful?: boolean;
}

/** One runtime per statefulness, since that is a property of the MODULE. */
function scene(assets: Asset[]): SpineRuntime[] {
    const runtimes: SpineRuntime[] = [];
    let nextEntity = 1;
    for (const kind of [false, true]) {
        const mine = assets.filter(a => (a.stateful ?? false) === kind);
        if (mine.length === 0) continue;
        const fake = fakeSpineModule();
        fake.continuousWorldPose = kind;
        const runtime = new SpineRuntime(kind ? '4.2' : '3.8', fake.module);
        for (const asset of mine) {
            const era = fakeSpineEra(asset.era, new Uint8Array([1]), asset.culling ?? { kind: 'unknown' });
            for (let i = 0; i < asset.entities; i++) runtime.loadEntity(nextEntity++ as Entity, era);
        }
        runtime.observe(true);
        runtimes.push(runtime);
    }
    return runtimes;
}

function codes(runtimes: SpineRuntime[]): SpineFindingCode[] {
    return spineSceneDiagnostics(runtimes, true).findings.map(f => f.code);
}

function dispose(runtimes: SpineRuntime[]): void {
    for (const runtime of runtimes) runtime.dispose();
}

describe('what the frame did not do', () => {
    it('an unseen certified entity leaves the frame owing the pose nobody wanted', () => {
        const runtimes = scene([{ era: 'hero#1', entities: 1, culling: CERTIFIED }]);
        runtimes[0].updateAll(DT);
        runtimes[0].extractAndSubmitMeshes(NEVER, {} as never);

        const d = spineSceneDiagnostics(runtimes, true);
        expect(d.pose.logicalUpdates, 'the animation stopped').toBe(1);
        expect(d.pose.worldMaterializations, 'a pose nobody asked for was resolved').toBe(0);
        expect(d.worldPoseDebt, 'the skipped world pose was not reported as skipped').toBe(1);
        expect(d.deferrable).toBe(1);
        dispose(runtimes);
    });

    it('a seen one owes nothing, and a second camera finds the debt settled', () => {
        const runtimes = scene([{ era: 'hero#1', entities: 1, culling: CERTIFIED }]);
        runtimes[0].updateAll(DT);
        runtimes[0].extractAndSubmitMeshes(ALWAYS, {} as never);
        runtimes[0].extractAndSubmitMeshes(ALWAYS, {} as never);

        const d = spineSceneDiagnostics(runtimes, true);
        expect(d.pose.worldMaterializations, 'the second camera paid for the pose again').toBe(1);
        expect(d.pose.worldAlreadyCurrent).toBe(1);
        expect(d.pose.meshExtractions, 'extraction is per camera, and two of them drew it').toBe(2);
        expect(d.worldPoseDebt, 'a pose that was resolved is still reported as owed').toBe(0);
        dispose(runtimes);
    });

    it('counts a decline per camera, because that is what it is', () => {
        const runtimes = scene([{ era: 'hero#1', entities: 1, culling: CERTIFIED }]);
        runtimes[0].updateAll(DT);
        runtimes[0].extractAndSubmitMeshes(NEVER, {} as never);
        runtimes[0].extractAndSubmitMeshes(NEVER, {} as never);

        const d = spineSceneDiagnostics(runtimes, true);
        expect(d.pose.renderCulled).toBe(2);
        expect(d.worldPoseDebt, 'one entity owes one pose however many cameras declined it').toBe(1);
        dispose(runtimes);
    });

    it('a disabled entity is out of the frame, not in debt', () => {
        // Posing every frame would not have resolved it either, so counting it
        // would credit the scheduler with work no scheduler was going to do.
        const runtimes = scene([{ era: 'hero#1', entities: 1, culling: CERTIFIED }]);
        runtimes[0].updateAll(DT);
        expect(runtimes[0].worldPoseDebt(), 'it owes one after advancing').toBe(1);

        runtimes[0].setEnabled(1 as Entity, false);
        runtimes[0].updateAll(DT);
        expect(spineSceneDiagnostics(runtimes, true).worldPoseDebt,
            'an entity nobody was going to pose was counted as a saving').toBe(0);
        dispose(runtimes);
    });
});

describe('why an asset is not lazy', () => {
    it('names the missing proof, and both of them when both are missing', () => {
        const runtimes = scene([
            { era: 'lazy#1', entities: 1, culling: CERTIFIED },
            { era: 'unpromised#1', entities: 1 },
            { era: 'stateful#1', entities: 1, culling: CERTIFIED, stateful: true },
            { era: 'neither#1', entities: 1, stateful: true },
        ]);
        const byEra = new Map(spineSceneDiagnostics(runtimes, true).assets.map(a => [a.era, a]));

        expect(byEra.get('lazy#1')!.mayDefer).toBe(true);
        expect(byEra.get('lazy#1')!.blockedBy).toEqual([]);
        expect(byEra.get('unpromised#1')!.blockedBy).toEqual(['no-certificate']);
        expect(byEra.get('stateful#1')!.blockedBy).toEqual(['stateful-constraints']);
        expect(byEra.get('neither#1')!.blockedBy)
            .toEqual(['stateful-constraints', 'no-certificate']);
        expect(byEra.get('neither#1')!.envelope).toBe('unknown');
        dispose(runtimes);
    });

    it('offers only the assets a certificate would actually unlock', () => {
        // The one with stateful constraints stays out: certifying it changes
        // nothing, and offering it as work is offering a dead end.
        const runtimes = scene([
            { era: 'unpromised#1', entities: 3 },
            { era: 'neither#1', entities: 40, stateful: true },
        ]);
        const d = spineSceneDiagnostics(runtimes, true);
        const certificate = d.findings.find(f => f.code === 'no-certificate')!;

        expect(certificate.assets).toEqual(['unpromised#1']);
        expect(certificate.entities, 'an asset no promise can unlock was offered as work').toBe(3);
        expect(d.findings.find(f => f.code === 'stateful-constraints')!.assets)
            .toEqual(['neither#1']);
        dispose(runtimes);
    });

    it('carries the pair, so nothing downstream has to split an era id', () => {
        // Refs that CONTAIN the separator, because that is the case a split gets
        // wrong: `@uuid:a:@uuid:b` has three colons and one right answer.
        const pair = { skeleton: '@uuid:aaaa', atlas: '@uuid:bbbb' };
        const fake = fakeSpineModule();
        const runtime = new SpineRuntime('3.8', fake.module);
        runtime.loadEntity(1 as Entity, fakeSpineEra('era#1', new Uint8Array([1]), CERTIFIED, pair));

        const asset = spineSceneDiagnostics([runtime], true).assets[0];
        expect(asset.pair, 'the pair was rebuilt from a string instead of carried').toEqual(pair);
        runtime.dispose();
    });

    it('puts the biggest asset first, so the first line is the one that matters', () => {
        const runtimes = scene([
            { era: 'few#1', entities: 2 },
            { era: 'many#1', entities: 30 },
            { era: 'some#1', entities: 9 },
        ]);
        const d = spineSceneDiagnostics(runtimes, true);
        expect(d.assets.map(a => a.era)).toEqual(['many#1', 'some#1', 'few#1']);
        expect(d.assets.map(a => a.entities)).toEqual([30, 9, 2]);
        expect(d.entities).toBe(41);
        dispose(runtimes);
    });
});

describe('what the report says about itself', () => {
    it('says nothing is counting rather than handing over zeros as facts', () => {
        const runtimes = scene([{ era: 'hero#1', entities: 1, culling: CERTIFIED }]);
        for (const runtime of runtimes) runtime.observe(false);

        const d = spineSceneDiagnostics(runtimes, false);
        expect(d.observing).toBe(false);
        expect(d.findings[0].code).toBe('not-observing');
        expect(d.pose.logicalUpdates).toBe(0);
        expect(formatSpineDiagnostics(d)).toContain('nothing is counting');
        dispose(runtimes);
    });

    it('separates deferral that paid from deferral that had no chance to', () => {
        const runtimes = scene([{ era: 'hero#1', entities: 1, culling: CERTIFIED }]);
        runtimes[0].updateAll(DT);
        runtimes[0].extractAndSubmitMeshes(ALWAYS, {} as never);
        expect(codes(runtimes), 'a frame that deferred nothing claimed a saving')
            .toContain('nothing-deferred');

        runtimes[0].updateAll(DT);
        runtimes[0].extractAndSubmitMeshes(NEVER, {} as never);
        expect(codes(runtimes)).toContain('deferral-working');
        dispose(runtimes);
    });

    it('wraps a finding without losing or gluing a word', () => {
        const runtimes = scene([{ era: 'a-very-long-era-name-for-wrapping#1', entities: 7 }]);
        const text = formatSpineDiagnostics(spineSceneDiagnostics(runtimes, true));
        const bullet = text.split('\n').filter(l => l.startsWith('  * ') || l.startsWith('    '));

        expect(bullet.length, 'the sentence never wrapped at all').toBeGreaterThan(1);
        for (const line of bullet) expect(line.length).toBeLessThanOrEqual(78);
        expect(bullet[0]).toMatch(/^ {2}\* \S/);
        // Exactly the bullet's width, so the sentence hangs under itself. A
        // continuation that drifts by one space still READS fine, which is why
        // the column is asserted rather than eyeballed.
        for (const line of bullet.slice(1)) expect(line).toMatch(/^ {4}\S/);
        expect(bullet.map(l => l.replace(/^ +\*? ?/, '')).join(' '))
            .toBe('7 entities across 1 asset (a-very-long-era-name-for-wrapping#1) resolve a world'
                + ' pose every frame because nothing certified their extent. Scan the asset and'
                + ' record a culling contract to let them skip it while no camera wants them.');
        dispose(runtimes);
    });

    it('never asks for a certificate when every asset already has one', () => {
        const runtimes = scene([{ era: 'hero#1', entities: 4, culling: CERTIFIED }]);
        expect(codes(runtimes)).not.toContain('no-certificate');
        expect(codes(runtimes)).not.toContain('stateful-constraints');
        dispose(runtimes);
    });
});

describe('a scene is every runtime it loaded', () => {
    it('adds up what two spine versions each cost, rather than reporting one', () => {
        // A scene mixing versions loads a runtime per version, and the frame is
        // the sum: reporting either alone understates it by the other.
        const now = vi.spyOn(performance, 'now');
        now.mockReturnValueOnce(0).mockReturnValueOnce(2)     // 3.8 pose:  2ms
           .mockReturnValueOnce(10).mockReturnValueOnce(13)   // 3.8 read:  3ms
           .mockReturnValueOnce(20).mockReturnValueOnce(27)   // 4.2 pose:  7ms
           .mockReturnValueOnce(30).mockReturnValueOnce(31);  // 4.2 read:  1ms

        const runtimes = scene([
            { era: 'hero#1', entities: 2, culling: CERTIFIED },
            { era: 'rope#1', entities: 5, culling: CERTIFIED, stateful: true },
        ]);
        for (const runtime of runtimes) {
            runtime.updateAll(DT);
            runtime.extractAndSubmitMeshes(ALWAYS, {} as never);
        }

        const d = spineSceneDiagnostics(runtimes, true);
        expect(d.time.pose, 'one runtime was reported as the scene').toBe(9);
        expect(d.time.readback).toBe(4);
        expect(d.time.total).toBe(13);
        expect(d.pose.logicalUpdates).toBe(7);
        expect(d.assets.map(a => a.version)).toEqual(['4.2', '3.8']);
        dispose(runtimes);
    });

    it('keeps each runtime\'s window to itself, because a percentile does not add', () => {
        const runtimes = scene([
            { era: 'hero#1', entities: 1, culling: CERTIFIED },
            { era: 'rope#1', entities: 1, culling: CERTIFIED, stateful: true },
        ]);
        for (let i = 0; i < 4; i++) {
            for (const runtime of runtimes) {
                runtime.updateAll(DT);
                runtime.extractAndSubmitMeshes(ALWAYS, {} as never);
            }
        }

        const d = spineSceneDiagnostics(runtimes, true);
        expect(d.runtimes.map(t => t.version)).toEqual(['3.8', '4.2']);
        // Four frames begun, three of them completed: the one in hand is not a
        // frame yet, and a window over frames may not contain it.
        for (const t of d.runtimes) expect(t.frames).toBe(3);
        dispose(runtimes);
    });
});

/** A runtime as the report reads one — the whole seam, so what a frame moved
 *  can be driven to KNOWN and different numbers. Zeros on both sides would sum
 *  to zero however the summing was written. */
function stub(version: SpineVersion, at: number): SpineDiagnosticRuntime {
    const m = newSpineFrameMetrics();
    m.frame = at;
    m.meshBatches = at; m.vertices = at * 10; m.indices = at * 100;
    m.abi.pose = at * 2; m.abi.world = at * 3; m.abi.batchData = at * 4; m.abi.submit = at * 5;
    m.abi.batchCount = at * 6; m.abi.vertexCount = at * 7; m.abi.indexCount = at * 8;
    m.abi.malloc = at * 9; m.abi.free = at * 11;
    m.bytes.wasmRead = at * 1000; m.bytes.coreWrite = at * 2000; m.bytes.scratchAllocated = at * 3000;
    m.pose.logicalUpdates = at;
    const window = () => { const w = new SpineTimeWindow(); w.push(at); return w; };
    return {
        version, entityCount: 0,
        worldPoseDebt: () => 0,
        residencies: () => [],
        metrics: () => m,
        windows: () => ({ pose: window(), readback: window(), total: window() }),
    };
}

describe('what a frame moved, not only what it decided', () => {
    it('sums the crossings and the bytes, so the report needs no second door', () => {
        // Retiring SpineManager.frameMetrics() is only honest if these survive:
        // the batch-storage work was argued entirely in bytes moved.
        const d = spineSceneDiagnostics([stub('3.8', 1), stub('4.2', 2)], true);

        expect(d.geometry).toEqual({ meshBatches: 3, vertices: 30, indices: 300 });
        expect(d.bytes).toEqual({ wasmRead: 3000, coreWrite: 6000, scratchAllocated: 9000 });
        expect(d.abi).toEqual({
            pose: 6, world: 9, batchCount: 18, vertexCount: 21, indexCount: 24,
            batchData: 12, malloc: 27, free: 33, submit: 15,
        });
        expect(d.frame, 'the newest frame any runtime reached').toBe(2);
        expect(d.runtimes.map(t => t.total.last)).toEqual([1, 2]);
    });

    it('reports the crossings a real runtime actually made', () => {
        const runtimes = scene([{ era: 'hero#1', entities: 3, culling: CERTIFIED }]);
        runtimes[0].updateAll(DT);
        runtimes[0].extractAndSubmitMeshes(ALWAYS, {} as never);

        const d = spineSceneDiagnostics(runtimes, true);
        expect(d.abi.pose, 'the advance crossings went missing').toBe(3);
        expect(d.abi.world, 'the world crossings went missing').toBe(3);
        dispose(runtimes);
    });
});
