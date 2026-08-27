// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    aot-native-install.test.ts
 * @brief   Installing compiled systems on a host that loads a library.
 *
 * @details The host is stood in for, because what is worth pinning here is not
 *          that a `.dll` opens — `tests/aot/test_aot_host.cpp` does that against
 *          a real one — but the three things this side owes it: only the systems
 *          it BOUND become twins, the pools are re-reported when they may have
 *          moved, and the Changed ticks the compiled code cannot leave.
 *
 *          The first is the one that fails silently. The runner calls a twin
 *          wherever it finds one, so a twin for a system the host could not bind
 *          is a system that never runs at all.
 */
import { describe, it, expect } from 'vitest';
import { World } from '../src/ecs/world';
import { defineComponent } from '../src/ecs/component';
import { defineSystem, SystemRunner } from '../src/ecs/system';
import { Query, Mut, Changed } from '../src/ecs/query';
import { ResourceStorage } from '../src/ecs/resource';
import { engineAbiDigest, projectShapeDigest } from '../src/ecs/aot/abiDigest';
import type { AotManifest } from '../src/ecs/aot/AotSystems';
import { installNativeAot, type NativeAotBindings } from '../src/ecs/aot/installNativeAot';
import type { WasmHeap } from '../src/ecs/WasmPoolMemory';

/** Declared per test, not at module scope: the suite's setup resets the
 *  component context, and `installNativeAot` resolves names through it. */
const declareDrift = () => defineComponent('Drift', { x: 0 });

/** A linear heap, the way a native host's arena looks from here. */
function fakeHeap(): WasmHeap {
    const bytes = new Uint8Array(1 << 16);
    let next = 8;
    return {
        _malloc: (size: number) => { const at = next; next += (size + 7) & ~7; return at; },
        _free: () => {},
        HEAPU8: bytes,
    };
}

const MANIFEST: AotManifest = {
    engineAbi: engineAbiDigest(8),
    projectShapes: projectShapeDigest([{ name: 'Drift', fields: ['x'] }]),
    systems: [
        { name: 'DriftSystem', symbol: 'es_sys_Drift', queries: [[{ comp: 'Drift', mut: true }]], resources: [] },
        { name: 'OtherSystem', symbol: 'es_sys_Other', queries: [[{ comp: 'Drift', mut: true }]], resources: [] },
    ],
};

/** A host that bound only the systems it was told to. */
function fakeHost(boundNames: readonly string[]) {
    const order = MANIFEST.systems.map((s) => s.name);
    const calls: number[] = [];
    const reported: { name: string; rows: number; sparseCount: number }[] = [];
    const bindings: NativeAotBindings = {
        install: () => order.length,
        index: (name) => order.indexOf(name),
        bound: (i) => boundNames.includes(order[i] ?? ''),
        scriptRows: (name, _sparse, sparseCount, rows) => {
            reported.push({ name, rows, sparseCount });
            return true;
        },
        resource: () => true,
        run: (i) => { calls.push(i); return 0; },
        reset: () => {},
    };
    return { bindings, calls, reported };
}

function fixture(boundNames: readonly string[]) {
    const Drift = declareDrift();
    const world = new World();
    const runner = new SystemRunner(world, new ResourceStorage());
    const host = fakeHost(boundNames);
    const runtime = installNativeAot({
        world, runner, modulePath: 'systems.dll', manifest: MANIFEST,
        heap: fakeHeap(), bindings: host.bindings,
    });
    return { world, runner, runtime, Drift, ...host };
}

describe('installing compiled systems on a host that loads a library', () => {
    it('makes a twin only of what the host bound, so the rest still interpret', () => {
        const f = fixture(['DriftSystem']);
        const Drift = f.Drift;
        expect(f.runtime).not.toBeNull();
        expect(f.runtime!.systems.size).toBe(1);
        expect(f.runtime!.systems.get('DriftSystem')).toBeDefined();
        expect(f.runtime!.systems.get('OtherSystem')).toBeUndefined();

        let interpreted = 0;
        const other = defineSystem([Query(Mut(Drift))], () => { interpreted++; }, { name: 'OtherSystem' });
        const compiled = defineSystem([Query(Mut(Drift))], () => {
            throw new Error('the closure must not run when the host bound this one');
        }, { name: 'DriftSystem' });

        const entity = f.world.spawn();
        f.world.insert(entity, Drift, { x: 0 });
        f.runner.run(compiled);
        f.runner.run(other);

        expect(f.calls).toEqual([0]);
        expect(interpreted).toBe(1);
    });

    it('says nothing at all where the host bound nothing', () => {
        const f = fixture([]);
        const Drift = f.Drift;
        expect(f.runtime!.systems.size).toBe(0);

        let interpreted = 0;
        const system = defineSystem([Query(Mut(Drift))], () => { interpreted++; }, { name: 'DriftSystem' });
        f.runner.run(system);

        expect(f.calls).toEqual([]);
        expect(interpreted).toBe(1);
    });

    it('tells the host where the rows are, once per move rather than per frame', () => {
        const f = fixture(['DriftSystem']);
        const Drift = f.Drift;
        const system = defineSystem([Query(Mut(Drift))], () => {}, { name: 'DriftSystem' });
        const entity = f.world.spawn();
        f.world.insert(entity, Drift, { x: 0 });

        f.runner.run(system);
        const afterFirst = f.reported.length;
        expect(afterFirst).toBeGreaterThan(0);
        expect(f.reported[0]!.name).toBe('Drift');

        // Nothing moved, so nothing is said again — the epoch is the whole rule.
        f.runner.run(system);
        expect(f.reported.length).toBe(afterFirst);

        // A claimed row bumps it, and the host is told the new column.
        const second = f.world.spawn();
        f.world.insert(second, Drift, { x: 0 });
        f.runner.run(system);
        expect(f.reported.length).toBeGreaterThan(afterFirst);
    });

    it('marks the Changed ticks the compiled code could not leave', () => {
        const f = fixture(['DriftSystem']);
        const Drift = f.Drift;
        const system = defineSystem([Query(Mut(Drift))], () => {}, { name: 'DriftSystem' });
        // A watcher is the only thing that can tell: the compiled code calls
        // nothing, so a `Mut` it honoured is invisible unless the host records it.
        const watched: number[] = [];
        const watcher = defineSystem([Query(Changed(Drift))], (query) => {
            let n = 0;
            for (const _ of query as Iterable<unknown>) n++;
            watched.push(n);
        }, { name: 'Watcher' });

        const entity = f.world.spawn();
        f.world.insert(entity, Drift, { x: 0 });
        // Past the tick the insert itself marked, so what the watcher sees next
        // is the dispatcher's doing and not the spawn's.
        f.world.advanceTick();
        f.runner.run(watcher);
        f.world.advanceTick();

        f.runner.run(system);
        f.runner.run(watcher);

        expect(watched.at(-1)).toBe(1);
    });
});
