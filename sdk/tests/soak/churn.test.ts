// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Churn the engine and demand the counters come back.
 *
 * Sprites that fail to draw get found on the first run. What is never found is
 * the cost of the forty-seventh Play/Stop, because nobody plays a scene forty-
 * seven times by hand and nothing was watching if they did. This does, over the
 * headless half of the loop: entities, components, subscriptions, prefabs and
 * whole Apps built and torn down, with a census after every cycle.
 *
 * The verdict is a SLOPE, not a comparison against baseline. Caches plateau and
 * heaps wander, so "did it return to where it started" fails honest runs and
 * "did it grow every cycle" does not. See diagnostics/census.ts for the tiers.
 *
 *   SOAK_CYCLES=200 SOAK_ENTITIES=50000 pnpm --filter ./sdk test soak
 *   SOAK_ONLY=prefab …                  one step, to place a leak
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { App } from '../../src/app/app';
import { Transform, defineComponent } from '../../src/ecs/component';
import { Emitter } from '../../src/ecs/emitter';
import { instantiatePrefab } from '../../src/prefab';
import { PREFAB_FORMAT_VERSION } from '../../src/prefab/migrate';
import type { PrefabData } from '../../src/prefab/types';
import {
    takeCensus, analyzeCensusSeries, formatCensusReport, censusProbeIds, collectGarbage,
    type Census,
} from '../../src/diagnostics';
import type { CppRegistry, ESEngineModule } from '../../src/wasm';
import type { Entity } from '../../src/types';
import { loadWasmModule, HAS_WASM } from '../helpers/loadWasm';

const CYCLES = Number(process.env.SOAK_CYCLES ?? 12);
const ENTITIES = Number(process.env.SOAK_ENTITIES ?? 500);
const ONLY = process.env.SOAK_ONLY;

/**
 * Defined per test, never at module scope: tests/setup.ts clears user components
 * in beforeEach, so a module-scope one is gone before the first test body runs.
 * The prefab step then resolves it BY NAME, finds nothing, and logs a warning
 * while churning two thirds less than it claims to.
 */
const marker = () => defineComponent('SoakMarker', { hp: 0, tag: '' });
type Marker = ReturnType<typeof marker>;

interface ChurnContext {
    app: App;
    module: ESEngineModule;
    marker: Marker;
    cycle: number;
}

interface ChurnStep {
    name: string;
    run(ctx: ChurnContext): Promise<void> | void;
}

// =============================================================================
// The steps
// =============================================================================

/** A root with N children, each carrying a builtin and a script component. */
const sceneStep: ChurnStep = {
    name: 'scene',
    run({ app, marker: Marker }) {
        const world = app.world;
        const root = world.spawn('soak-root');
        for (let i = 0; i < ENTITIES; i++) {
            const e = world.spawn(`soak-${i}`);
            world.insert(e, Transform, { position: { x: i, y: -i, z: 0 } });
            world.insert(e, Marker, { hp: i, tag: `t${i & 7}` });
            world.setParent(e, root);
        }
        // Despawning the root alone: the subtree teardown is the path a scene
        // unload actually takes, and the one where a child can be left behind.
        world.despawn(root);
    },
};

/** Components added and removed without the entity going anywhere. */
const componentStep: ChurnStep = {
    name: 'component',
    run({ app, marker: Marker }) {
        const world = app.world;
        const held: Entity[] = [];
        for (let i = 0; i < 64; i++) {
            const e = world.spawn(`hold-${i}`);
            world.insert(e, Transform, {});
            held.push(e);
        }
        for (const e of held) {
            world.insert(e, Marker, { hp: 1, tag: 'x' });
            world.remove(e, Marker);
        }
        for (const e of held) world.despawn(e);
    },
};

/** Every subscription surface that hands back an unsubscribe. */
const subscriptionStep: ChurnStep = {
    name: 'subscription',
    run({ app }) {
        const offs: Array<() => void> = [];
        for (let i = 0; i < 32; i++) {
            offs.push(app.world.onSpawn(() => {}));
            offs.push(app.world.onDespawn(() => {}));
        }
        const emitter = new Emitter<{ ping: [number] }>();
        for (let i = 0; i < 32; i++) offs.push(emitter.on('ping', () => {}));
        emitter.emit('ping', 1);
        for (const off of offs) off();
    },
};

function soakPrefab(children: number): PrefabData {
    return {
        version: PREFAB_FORMAT_VERSION,
        name: 'SoakPrefab',
        rootEntityId: 'root',
        entities: [
            {
                prefabEntityId: 'root', name: 'Root', parent: null, visible: true,
                children: Array.from({ length: children }, (_, i) => `c${i}`),
                components: [{ type: 'Transform', data: { position: { x: 0, y: 0, z: 0 } } }],
            },
            ...Array.from({ length: children }, (_, i) => ({
                prefabEntityId: `c${i}`, name: `Child${i}`, parent: 'root', children: [], visible: true,
                components: [
                    { type: 'Transform', data: { position: { x: i, y: 0, z: 0 } } },
                    { type: 'SoakMarker', data: { hp: i, tag: 'p' } },
                ],
            })),
        ],
    } as PrefabData;
}

const prefabStep: ChurnStep = {
    name: 'prefab',
    async run({ app, marker: Marker }) {
        const data = soakPrefab(16);
        const a = await instantiatePrefab(app.world, data);
        const b = await instantiatePrefab(app.world, data, { parent: a.root });
        // The prefab loader resolves components BY NAME and merely warns when it
        // cannot, so an unregistered one leaves this step churning Transform
        // alone while still looking busy. Checked every cycle, not once.
        const child = a.entities.get(1);
        if (child === undefined || !app.world.has(child, Marker)) {
            throw new Error('prefab instantiate dropped SoakMarker — this step is not churning what it claims');
        }
        app.world.despawn(b.root);
        app.world.despawn(a.root);
    },
};

/**
 * A whole App built and quit — the headless half of Play/Stop.
 *
 * Deliberately its own registry: quit() must return the plugins, systems and
 * subscriptions an install created, and sharing the outer app's world would let
 * a leaked one hide among counters the other steps are already moving.
 */
const appStep: ChurnStep = {
    name: 'app',
    async run({ module }) {
        const inner = App.new();
        const registry = new (module as unknown as { Registry: new () => CppRegistry }).Registry();
        inner.connectCpp(registry, module);
        const e = inner.world.spawn('inner');
        inner.world.insert(e, Transform, {});
        await inner.tick(1 / 60);
        inner.quit({ keepRenderer: true });
        (registry as unknown as { delete?: () => void }).delete?.();
    },
};

const ALL_STEPS: ChurnStep[] = [sceneStep, componentStep, subscriptionStep, prefabStep, appStep];

// =============================================================================
// The run
// =============================================================================

describe.skipIf(!HAS_WASM)('resource census over a churn soak', () => {
    let module: ESEngineModule;
    let app: App;
    let registry: CppRegistry;

    beforeAll(async () => {
        module = await loadWasmModule();
        app = App.new();
        registry = new (module as unknown as { Registry: new () => CppRegistry }).Registry();
        app.connectCpp(registry, module);
    });

    afterAll(() => {
        app?.quit({ keepRenderer: true });
    });

    it('has probes registered at all', () => {
        // A census with no probes reports nothing and passes everything. That is
        // the failure mode this whole file exists to not have, so it is asserted
        // before any of it runs.
        const ids = censusProbeIds();
        expect(ids).toContain('ecs');
        expect(ids).toContain('events');
        expect(ids).toContain('heap');
        const census = takeCensus({ app, module });
        expect(census.failedProbes).toEqual([]);
        expect(census.entries.size).toBeGreaterThan(10);
    });

    it(`returns every conserved counter to baseline over ${CYCLES} cycles`, async () => {
        const steps = ONLY ? ALL_STEPS.filter((s) => s.name === ONLY) : ALL_STEPS;
        expect(steps.length, `SOAK_ONLY=${ONLY} matched no step`).toBeGreaterThan(0);

        const Marker = marker();
        const samples: Census[] = [];
        for (let cycle = 0; cycle < CYCLES; cycle++) {
            for (const step of steps) await step.run({ app, module, marker: Marker, cycle });
            // Between cycles, never inside one: mid-cycle a conserved counter is
            // legitimately up by a whole scene. The collection is what makes the heap
            // counters mean "kept" rather than "allocated".
            collectGarbage();
            samples.push(takeCensus({ app, module }));
        }

        const report = analyzeCensusSeries(samples, { projectCycles: 10_000 });
        // A passing run prints nothing by default and so teaches nothing. This is
        // how you read the counters that did NOT move, and how the noise floor of
        // the harness itself gets measured.
        if (process.env.SOAK_REPORT) console.log(formatCensusReport(report));
        expect(report.failedProbes).toEqual([]);
        expect(report.leaks, `\n${formatCensusReport(report)}\n`).toEqual([]);
    }, 600_000);
});
