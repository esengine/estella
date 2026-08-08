// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Break the engine on purpose and demand the census notices.
 *
 * A leak detector that has never caught anything is indistinguishable from one
 * that cannot. This project has been here before: eleven of fifteen benchmarks
 * had not run since the ECS moved and reported success anyway. So every counter
 * the soak asserts gets a matching sabotage here — a leak injected by hand, and
 * a demand that the verdict goes red.
 *
 * The specificity half matters as much. A judge that fails everything also has a
 * perfect catch rate, so the legitimate shapes — a cache that fills and stops, a
 * counter that wobbles without trending — are asserted to stay GREEN.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { App } from '../../src/app/app';
import { Transform, defineComponent } from '../../src/ecs/component';
import { Emitter } from '../../src/ecs/emitter';
import { addTrackedListener } from '../../src/util/listeners';
import {
    takeCensus, analyzeCensusSeries, counter, collectGarbage,
    type Census, type CensusEntry, type CensusTier,
} from '../../src/diagnostics';
import type { CppRegistry, ESEngineModule } from '../../src/wasm';
import { loadWasmModule, HAS_WASM } from '../helpers/loadWasm';

const SabotageMarker = defineComponent('SabotageMarker', { n: 0 });

// =============================================================================
// The judge, on synthetic series — sensitivity and specificity, no engine
// =============================================================================

function series(key: string, tier: CensusTier, values: number[], unit: CensusEntry['unit'] = 'count'): Census[] {
    return values.map((v) => ({
        atMs: 0,
        entries: new Map([[key, counter(key, v, tier, unit)]]),
        failedProbes: [],
    }));
}

const leakedKeys = (samples: Census[], opts = {}): string[] =>
    analyzeCensusSeries(samples, opts).leaks.map((v) => v.key);

describe('the census judge', () => {
    it('catches a conserved counter that climbs', () => {
        const climbing = Array.from({ length: 20 }, (_, i) => 100 + i);
        expect(leakedKeys(series('x', 'conserved', climbing))).toEqual(['x']);
    });

    it('catches a conserved counter that spikes and returns', () => {
        // Ends where it began, so a slope test alone calls this steady. It is not:
        // a cycle cleaned up one cycle late, and a longer run overlaps two.
        const wobble = Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? 100 : 140));
        expect(leakedKeys(series('x', 'conserved', wobble))).toEqual(['x']);
    });

    it('passes a conserved counter that holds exactly', () => {
        expect(leakedKeys(series('x', 'conserved', Array(20).fill(100)))).toEqual([]);
    });

    it('catches a bounded counter that never plateaus', () => {
        const climbing = Array.from({ length: 30 }, (_, i) => 10 + i * 3);
        expect(leakedKeys(series('x', 'bounded', climbing))).toEqual(['x']);
    });

    it('passes a bounded counter that fills a cache and stops', () => {
        // The shape every pool and cache makes. Judging it as a leak is what
        // makes a soak suite get switched off.
        const filling = Array.from({ length: 30 }, (_, i) => Math.min(64, 10 + i * 8));
        expect(leakedKeys(series('x', 'bounded', filling))).toEqual([]);
    });

    it('passes a pool that steps ONCE mid-run, which a line fits as a ramp', () => {
        // From a real run: one 4 KB sparse page at cycle 30 of 80, flat either
        // side. Least squares alone called that a confident 947 KB leak. One rise
        // in 79 transitions is what saves it.
        const staircase = Array.from({ length: 80 }, (_, i) => (i < 30 ? 0 : 4104));
        expect(leakedKeys(series('m', 'bounded', staircase, 'bytes'))).toEqual([]);
    });

    it('still catches a counter that steps a page every few cycles', () => {
        // The other side of that rule: repeated steps are a leak however chunky,
        // so the discrimination cannot just be "ignore anything step-shaped".
        const repeating = Array.from({ length: 80 }, (_, i) => Math.floor(i / 2) * 4104);
        expect(leakedKeys(series('m', 'bounded', repeating, 'bytes'))).toEqual(['m']);
    });

    it('catches a heap that grows past its budget', () => {
        const MB = 1024 * 1024;
        const growing = Array.from({ length: 30 }, (_, i) => 40 * MB + i * 512 * 1024);
        expect(leakedKeys(series('h', 'trend', growing, 'bytes'))).toEqual(['h']);
    });

    it('passes a heap that wanders without trending', () => {
        // Real V8 numbers move like this. The confidence bound is what keeps the
        // verdict from depending on which cycle sampling happened to stop at.
        const noise = [0, 3, -2, 5, -4, 1, 6, -3, 2, -1, 4, 0, -5, 3, 1, -2, 4, -1, 2, 0];
        const wandering = noise.map((n) => 40 * 1024 * 1024 + n * 8 * 1024);
        expect(leakedKeys(series('h', 'trend', wandering, 'bytes'))).toEqual([]);
    });

    it('never judges an info counter', () => {
        const climbing = Array.from({ length: 20 }, (_, i) => i * 1000);
        expect(leakedKeys(series('x', 'info', climbing))).toEqual([]);
    });

    it('reports a probe that stopped answering rather than passing without it', () => {
        const samples = series('x', 'conserved', Array(10).fill(1));
        const broken: Census[] = samples.map((s) => ({ ...s, failedProbes: ['render: boom'] }));
        expect(analyzeCensusSeries(broken).failedProbes).toEqual(['render: boom']);
    });
});

// =============================================================================
// The probes, against a real engine — proving they are wired to anything
// =============================================================================

describe.skipIf(!HAS_WASM)('census probes catch a real injected leak', () => {
    let module: ESEngineModule;

    beforeAll(async () => {
        module = await loadWasmModule();
    });

    function freshApp(): App {
        const app = App.new();
        const registry = new (module as unknown as { Registry: new () => CppRegistry }).Registry();
        app.connectCpp(registry, module);
        return app;
    }

    /** Run `sabotage` once per cycle and report which counters went red. */
    function soak(sabotage: (app: App, cycle: number) => void, cycles = 16): string[] {
        const app = freshApp();
        const samples: Census[] = [];
        try {
            for (let cycle = 0; cycle < cycles; cycle++) {
                sabotage(app, cycle);
                collectGarbage();
                samples.push(takeCensus({ app, module }));
            }
            return analyzeCensusSeries(samples).leaks.map((v) => v.key);
        } finally {
            app.quit({ keepRenderer: true });
        }
    }

    it('sees entities that were never despawned', () => {
        expect(soak((app) => { app.world.spawn('leaked'); })).toContain('ecs.entities');
    });

    it('sees script component rows left behind', () => {
        const leaked = soak((app) => {
            const e = app.world.spawn('holder');
            app.world.insert(e, SabotageMarker, { n: 1 });
            // The entity goes; only the storage row is meant to be at issue, but a
            // despawn that forgot ScriptStorage would show here and not in entities.
        });
        expect(leaked).toContain('ecs.scriptRows');
    });

    it('sees an emitter subscription that was never released', () => {
        const emitter = new Emitter<{ tick: [] }>();
        expect(soak(() => { emitter.on('tick', () => {}); })).toContain('events.emitterHandlers');
    });

    it('sees a host listener that was never detached', () => {
        const target = new EventTarget();
        expect(soak(() => { addTrackedListener(target, 'ping', () => {}); }))
            .toContain('events.domListeners');
    });

    it('sees a world spawn callback that was never unsubscribed', () => {
        expect(soak((app) => { app.world.onSpawn(() => {}); })).toContain('ecs.spawnCallbacks');
    });

    it('sees C++ memory that was malloced and never freed', () => {
        const held: number[] = [];
        const leaked = soak(() => { held.push(module._malloc(64 * 1024)); });
        for (const ptr of held) module._free(ptr);
        expect(leaked).toContain('wasm.mallocBytes');
    });

    it('sees retained objects on the JS heap, at the real budget', () => {
        // 24 cycles of a few hundred KB — the retained-scene class the loose byte
        // budget is set for. If this stops failing, that budget has drifted useless.
        const held: object[][] = [];
        const leaked = soak(() => {
            held.push(Array.from({ length: 8000 }, (_, i) => ({ i, tag: `held-${i}` })));
        }, 24);
        expect(held.length).toBe(24);
        expect(leaked).toContain('js.heapUsed');
    });

    it('sees retained buffers, which land OUTSIDE the JS heap', () => {
        // A leaked texture, audio buffer or mesh is a typed array, and its bytes
        // are external memory — `js.heapUsed` does not move for them at all. Both
        // counters exist because either alone is blind to half of what leaks.
        const held: Uint8Array[] = [];
        const leaked = soak(() => { held.push(new Uint8Array(256 * 1024).fill(7)); }, 24);
        expect(held.length).toBe(24);
        expect(leaked).toContain('js.external');
    });

    it('stays green on the same workload without the sabotage', () => {
        // The control. Every case above churns an App the same way; if this one
        // went red too, none of them would have proven anything.
        const leaked = soak((app) => {
            const e = app.world.spawn('clean');
            app.world.insert(e, Transform, {});
            app.world.insert(e, SabotageMarker, { n: 1 });
            app.world.despawn(e);
        });
        expect(leaked).toEqual([]);
    });
});
