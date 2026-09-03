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
 *
 *          The fourth is the script pools' epoch. The host keeps last frame's
 *          row table while the world stands, and it can read the engine's half
 *          itself — a script row appearing or going is the half only this side
 *          can see.
 */
import { describe, it, expect } from 'vitest';
import { World } from '../src/ecs/world';
import { defineComponent } from '../src/ecs/component';
import { defineSystem, SystemRunner } from '../src/ecs/system';
import { defineEvent, EventReader, EventWriter, EventRegistry } from '../src/ecs/event';
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

/** A host that can run only the systems it was told it could name. */
function fakeHost(runnable: readonly string[]) {
    const order = MANIFEST.systems.map((s) => s.name);
    const calls: number[] = [];
    const epochs: number[] = [];
    const reported: { name: string; rows: number; sparseCount: number }[] = [];
    const bindings: NativeAotBindings = {
        install: () => order.length,
        index: (name) => order.indexOf(name),
        bound: (i) => runnable.includes(order[i] ?? ''),
        scriptRows: (name, _sparse, sparseCount, rows) => {
            reported.push({ name, rows, sparseCount });
            return true;
        },
        resource: () => true,
        // Negative is "I still cannot name everything this reads" — the answer
        // that sends the system back to the interpreter for this frame.
        run: (i, scriptEpoch) => {
            if (!runnable.includes(order[i] ?? '')) return -1;
            calls.push(i);
            epochs.push(scriptEpoch);
            return 0;
        },
        reset: () => {},
    };
    return { bindings, calls, reported, epochs };
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

/**
 * The same two systems, plus one that writes an event and one that reads one.
 * A reader's payloads come through a QUERY slot naming the event, which is what
 * the compiled artifact tells a host as well.
 */
const EVENT_MANIFEST: AotManifest = {
    engineAbi: engineAbiDigest(8),
    projectShapes: projectShapeDigest([{ name: 'Drift', fields: ['x'] }]),
    systems: [
        {
            name: 'SendSystem', symbol: 'es_sys_Send', resources: [],
            queries: [[{ comp: 'Drift', mut: true }]],
            writers: [{ slot: 0, event: 'Hit', fields: ['amount'] }],
        },
        {
            name: 'ReadSystem', symbol: 'es_sys_Read', resources: [],
            queries: [[{ comp: 'Hit', mut: false }], [{ comp: 'Drift', mut: true }]],
            readers: [{ slot: 0, event: 'Hit', fields: ['amount'] }],
        },
        {
            name: 'PlainSystem', symbol: 'es_sys_Plain', resources: [],
            queries: [[{ comp: 'Drift', mut: true }]],
        },
    ],
};

function eventFixture() {
    const Drift = declareDrift();
    const Hit = defineEvent<{ amount: number }>('Hit');
    const events = new EventRegistry();
    const world = new World();
    const runner = new SystemRunner(world, new ResourceStorage(), events);
    const order = EVENT_MANIFEST.systems.map((s) => s.name);
    const calls: string[] = [];
    // A host that can name and run EVERY system in the module — so what keeps
    // its hands off the two event systems is this side's decision, not its
    // inability, which is the thing under test.
    const bindings: NativeAotBindings = {
        install: () => order.length,
        index: (name) => order.indexOf(name),
        bound: () => true,
        scriptRows: () => true,
        resource: () => true,
        run: (i) => { calls.push(order[i] ?? `#${i}`); return 0; },
        reset: () => {},
    };
    const runtime = installNativeAot({
        world, runner, modulePath: 'systems.dll', manifest: EVENT_MANIFEST,
        heap: fakeHeap(), bindings,
    });
    return { world, runner, runtime, Drift, Hit, events, calls };
}

describe('installing compiled systems on a host that loads a library', () => {
    it('a system the host cannot run is interpreted that frame, not skipped', () => {
        const f = fixture(['DriftSystem']);
        const Drift = f.Drift;
        expect(f.runtime).not.toBeNull();
        // Every declared system has a twin: whether the host can run one is a
        // fact about the frame — a pool has no rows until an entity has that
        // component — so it is settled at the call and asked again next time.
        expect(f.runtime!.systems.size).toBe(2);

        let interpreted = 0;
        const other = defineSystem([Query(Mut(Drift))], () => { interpreted++; }, { name: 'OtherSystem' });
        const compiled = defineSystem([Query(Mut(Drift))], () => {
            throw new Error('the closure must not run when the host took this one');
        }, { name: 'DriftSystem' });

        const entity = f.world.spawn();
        f.world.insert(entity, Drift, { x: 0 });
        f.runner.run(compiled);
        f.runner.run(other);

        expect(f.calls).toEqual([0]);
        expect(interpreted).toBe(1);
    });

    it('every system interprets where the host can run none of them', () => {
        const f = fixture([]);
        const Drift = f.Drift;

        let interpreted = 0;
        const system = defineSystem([Query(Mut(Drift))], () => { interpreted++; }, { name: 'DriftSystem' });
        f.runner.run(system);
        f.runner.run(system);

        expect(f.calls).toEqual([]);
        // Twice, because a refusal is per frame: the host may be able to next one.
        expect(interpreted).toBe(2);
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

    it('hands the host the script epoch, which moves when a row does', () => {
        const f = fixture(['DriftSystem']);
        const Drift = f.Drift;
        const system = defineSystem([Query(Mut(Drift))], () => {}, { name: 'DriftSystem' });
        const entity = f.world.spawn();
        f.world.insert(entity, Drift, { x: 0 });

        f.runner.run(system);
        f.runner.run(system);
        // Nothing moved between them, and the host may keep its rows only
        // because this number said so.
        expect(f.epochs.length).toBe(2);
        expect(f.epochs[1]).toBe(f.epochs[0]);

        // A row claimed, and a row given up. Neither moves an address the engine
        // can see, and a deletion does not even change the column's length — so
        // this is the only report the host gets.
        const second = f.world.spawn();
        f.world.insert(second, Drift, { x: 0 });
        f.runner.run(system);
        expect(f.epochs[2]).toBeGreaterThan(f.epochs[1]!);

        f.world.remove(second, Drift);
        f.runner.run(system);
        expect(f.epochs[3]).toBeGreaterThan(f.epochs[2]!);
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


/**
 * A native host's ctx carries `events = 0` (AotHost.hpp) and the emitted C
 * dereferences it before it looks at a row: probed against a real artifact, a
 * writer-only system with ZERO rows segfaults on entry. Nothing stopped it —
 * the takeover question was "did the library export this symbol".
 */
describe('a capability a loading host cannot hand compiled code', () => {
    it('leaves an event WRITER to the interpreter, and the event still arrives', () => {
        const f = eventFixture();
        expect(f.runtime).not.toBeNull();

        let sent = 0;
        const send = defineSystem([Query(Mut(f.Drift)), EventWriter(f.Hit)], (_q, out) => {
            sent++;
            out.send({ amount: 7 });
        }, { name: 'SendSystem' });
        const seen: number[] = [];
        const watch = defineSystem([EventReader(f.Hit)], (hits) => {
            for (const h of hits) seen.push(h.amount);
        }, { name: 'WatchSystem' });

        const entity = f.world.spawn();
        f.world.insert(entity, f.Drift, { x: 0 });
        f.runner.run(send);
        f.events.swapAll();
        f.runner.run(watch);

        expect(f.calls).not.toContain('SendSystem');
        expect(sent).toBe(1);
        expect(seen).toEqual([7]);
    });

    it('leaves an event READER to the interpreter, which is the half that would go quiet', () => {
        const f = eventFixture();
        f.events.getBus(f.Hit).send({ amount: 3 });
        f.events.swapAll();

        const seen: number[] = [];
        const read = defineSystem([EventReader(f.Hit), Query(Mut(f.Drift))], (hits) => {
            for (const h of hits) seen.push(h.amount);
        }, { name: 'ReadSystem' });
        f.runner.run(read);

        expect(f.calls).not.toContain('ReadSystem');
        expect(seen).toEqual([3]);
    });

    it('and takes the system that needs none of it', () => {
        const f = eventFixture();
        const plain = defineSystem([Query(Mut(f.Drift))], () => {
            throw new Error('the closure must not run when the host took this one');
        }, { name: 'PlainSystem' });
        const entity = f.world.spawn();
        f.world.insert(entity, f.Drift, { x: 0 });
        f.runner.run(plain);

        expect(f.calls).toEqual(['PlainSystem']);
    });
});
