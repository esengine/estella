// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    aot-dispatcher-seam.test.ts
 * @brief   The runner drives a twin whose rows were laid out somewhere else.
 *
 * @details A wasm module shares the engine's memory, so `AotDispatch` packs the
 *          rows here and hands the call their address. A host that loads a
 *          library has 64-bit addresses and a heap nothing here can see, so it
 *          packs them itself and takes only which system to run.
 *
 *          One interface either way, and this is what says so: a runtime whose
 *          dispatcher is neither `AotDispatch` nor backed by any wasm memory,
 *          driven by the same scheduler. Without it the seam is an interface
 *          with one implementation, which is a decision nobody has made yet.
 */
import { describe, it, expect } from 'vitest';
import { World } from '../src/ecs/world';
import { defineComponent } from '../src/ecs/component';
import { defineSystem, SystemRunner } from '../src/ecs/system';
import { Query, Mut } from '../src/ecs/query';
import { ResourceStorage } from '../src/ecs/resource';
import { AotSystems, type AotManifest, type AotTwin } from '../src/ecs/aot/AotSystems';
import { engineAbiDigest, projectShapeDigest } from '../src/ecs/aot/abiDigest';
import type { AotContext, AotRuntime } from '../src/ecs/aot/AotRuntime';

const Drift = defineComponent('Drift', { x: 0 });

/** A library in the host's own process, so an address is a pointer. The JS
 *  side still checks the handshake — it just checks the OTHER width. */
const NATIVE_ADDR = 8;

const MANIFEST: AotManifest = {
    engineAbi: engineAbiDigest(NATIVE_ADDR),
    projectShapes: projectShapeDigest([{ name: 'Drift', fields: ['x'] }]),
    systems: [{
        name: 'DriftSystem',
        symbol: 'es_sys_Drift',
        queries: [[{ comp: 'Drift', mut: true }]],
        resources: [],
    }],
};

/**
 * A host that owns the row table. It never touches the twin's `call`, because
 * on that side the export is a native function pointer and calling it is the
 * host's job — here it stands in for one and moves the world directly.
 */
class HostPackedDispatcher {
    readonly ran: string[] = [];
    constructor(private readonly world: World) {}
    run(twin: AotTwin): boolean {
        this.ran.push(twin.decl.name);
        for (const e of this.world.queryEntities([Drift])) {
            this.world.set(e, Drift, { x: this.world.get(e, Drift).x + 1 });
        }
        return true;
    }
}

/** A runtime with no wasm anything: what a native install would hand the runner. */
function hostRuntime(world: World, seen: { dispatcher?: HostPackedDispatcher }): AotRuntime {
    const systems = new AotSystems();
    // The export table is what a loader resolved. A native one holds function
    // pointers; the shape the runner sees is the same either way.
    systems.install(
        MANIFEST,
        { es_sys_Drift: () => { throw new Error('the host calls it, not the runner'); } },
        (name) => (name === 'Drift' ? Drift : undefined),
        () => [],
        NATIVE_ADDR,
    );
    return {
        systems,
        addresses: { componentNamed: () => Drift, resourceAt: () => undefined } as AotRuntime['addresses'],
        // Never read: the ctx is where JS lays a call out, and this host lays it
        // out on its own side. Typed rather than optional, because a runtime that
        // could omit it would let the wasm path omit it too.
        ctx: null as unknown as AotContext,
        dispatcherFor: (w) => {
            const d = new HostPackedDispatcher(w);
            seen.dispatcher = d;
            return d;
        },
    };
}

describe('the scheduler and a host that packs its own rows', () => {
    it('asks the runtime which dispatcher, and drives the twin through it', () => {
        const world = new World();
        const runner = new SystemRunner(world, new ResourceStorage());
        const system = defineSystem([Query(Mut(Drift))], () => {
            throw new Error('the closure must not run when a twin exists');
        }, { name: 'DriftSystem' });

        const entity = world.spawn();
        world.insert(entity, Drift, { x: 0 });

        const seen: { dispatcher?: HostPackedDispatcher } = {};
        runner.useAot(hostRuntime(world, seen));
        runner.run(system);

        expect(seen.dispatcher, 'the runner never asked for a dispatcher').toBeDefined();
        expect(seen.dispatcher!.ran).toEqual(['DriftSystem']);
        // The world moved, and it moved because the DISPATCHER moved it — the
        // interpreted closure throws and the export throws.
        expect(world.get(entity, Drift).x).toBe(1);
    });

    it('and stops when the twins are taken away, without a wasm heap ever existing', () => {
        const world = new World();
        const runner = new SystemRunner(world, new ResourceStorage());
        let ran = 0;
        const system = defineSystem([Query(Mut(Drift))], () => { ran++; }, { name: 'DriftSystem' });

        const entity = world.spawn();
        world.insert(entity, Drift, { x: 0 });

        runner.useAot(hostRuntime(world, {}));
        runner.run(system);
        expect(world.get(entity, Drift).x).toBe(1);
        expect(ran).toBe(0);

        // Uninstalled, the same system is an ordinary closure again. This is the
        // fallback the whole design rests on, on the side that has no module.
        runner.useAot(null);
        runner.run(system);
        expect(ran).toBe(1);
        expect(world.get(entity, Drift).x).toBe(1);
    });
});
