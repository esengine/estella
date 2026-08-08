// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The same torture, on the half that is not textures.
 *
 * Audio, materials, fonts, clips, timelines, tilemaps and prefabs share one
 * code path and, since the ledger was unified, one set of rules. They also
 * shared the bug: releaseTyped returned early when the cache had no entry, so a
 * generation superseded by invalidate() left its loaded asset unreachable and
 * unload() was never called. Textures got that fixed first; this is the proof
 * the other seven kinds got it too, rather than the assurance that they did.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { makeGenericHarness, genericRefs, type GenericHarness } from './assetHarness';

const KEYS = ['maps/a.estilemap', 'maps/b.estilemap'] as const;
const RUNS = Number(process.env.TORTURE_RUNS ?? 200);
const SEED = process.env.TORTURE_SEED ? Number(process.env.TORTURE_SEED) : undefined;

interface Model {
    held: Map<string, number>;
    joinable: Map<string, number>;
    scheduler: fc.Scheduler;
}

interface Real {
    harness: GenericHarness;
    settled: Promise<unknown>[];
}

const freshModel = (scheduler: fc.Scheduler): Model => ({
    held: new Map(KEYS.map((k) => [k, 0])),
    joinable: new Map(KEYS.map((k) => [k, 0])),
    scheduler,
});

const bump = (m: Map<string, number>, k: string, by = 1): void => m.set(k, (m.get(k) ?? 0) + by) && undefined;

function checkInvariants(real: Real): void {
    const { assets, loader } = real.harness;

    // No entry may be unloaded twice — the loader would double-free whatever it
    // owns (an audio buffer, a material's bound textures).
    const seen = new Set<unknown>();
    for (const entry of loader.unloaded) {
        if (seen.has(entry)) throw new Error(`an asset was unloaded twice: ${JSON.stringify(entry)}`);
        seen.add(entry);
    }

    for (const [key, generations] of genericRefs(assets)) {
        if (generations.length === 0) throw new Error(`${key} keeps an empty generation list`);
        for (const generation of generations) {
            if (generation.count <= 0) {
                throw new Error(`refCount(${key}) = ${generation.count} — a release outran its acquire`);
            }
            if (loader.unloaded.includes(generation.value)) {
                throw new Error(`${key} still references an asset that was already unloaded`);
            }
        }
    }
}

/** Everything loaded must be unloaded once every reference is given back. */
function checkFullTeardown(model: Model, real: Real): void {
    const { assets, loader } = real.harness;
    for (const [key, count] of model.held) {
        for (let i = 0; i < count; i++) assets.releaseTilemap(key);
        model.held.set(key, 0);
    }
    const live = loader.live();
    if (live.length > 0) {
        throw new Error(
            `${live.length} asset(s) never unloaded after every reference was dropped: `
            + `${live.map((e) => JSON.stringify(e)).join(', ')} (loaded ${loader.loads.length})`,
        );
    }
    const refs = genericRefs(assets);
    if (refs.size > 0) throw new Error(`ledger not empty after teardown: ${[...refs.keys()].join(', ')}`);
}

type Cmd = fc.AsyncCommand<Model, Real>;

class Load implements Cmd {
    constructor(readonly key: string) {}
    check = (): boolean => true;
    async run(model: Model, real: Real): Promise<void> {
        bump(model.joinable, this.key);
        real.settled.push(real.harness.assets.loadTilemap(this.key).then(
            () => { bump(model.held, this.key); bump(model.joinable, this.key, -1); },
            () => { bump(model.joinable, this.key, -1); },
        ));
        checkInvariants(real);
    }
    toString = (): string => `load(${this.key})`;
}

class Release implements Cmd {
    constructor(readonly key: string) {}
    check = (model: Model): boolean => (model.held.get(this.key) ?? 0) > 0;
    async run(model: Model, real: Real): Promise<void> {
        real.harness.assets.releaseTilemap(this.key);
        bump(model.held, this.key, -1);
        checkInvariants(real);
    }
    toString = (): string => `release(${this.key})`;
}

class Invalidate implements Cmd {
    constructor(readonly key: string) {}
    check = (): boolean => true;
    async run(model: Model, real: Real): Promise<void> {
        real.harness.assets.invalidate(this.key);
        model.joinable.set(this.key, 0);
        checkInvariants(real);
    }
    toString = (): string => `invalidate(${this.key})`;
}

class FailNext implements Cmd {
    constructor(readonly key: string) {}
    check = (): boolean => true;
    async run(model: Model, real: Real): Promise<void> {
        real.harness.failNext(this.key);
        checkInvariants(real);
    }
    toString = (): string => `failNext(${this.key})`;
}

class SettleOne implements Cmd {
    check = (model: Model): boolean => model.scheduler.count() > 0;
    async run(model: Model, real: Real): Promise<void> {
        await model.scheduler.waitOne();
        await new Promise((resolve) => setTimeout(resolve, 0));
        checkInvariants(real);
    }
    toString = (): string => 'settleOne()';
}

describe('generic asset lifecycle under generated interleavings', () => {
    it('unloads everything it loaded, whatever the order', async () => {
        const key = fc.constantFrom(...KEYS);
        await fc.assert(
            fc.asyncProperty(
                fc.scheduler(),
                fc.commands(
                    [
                        key.map((k) => new Load(k)),
                        key.map((k) => new Release(k)),
                        key.map((k) => new Invalidate(k)),
                        key.map((k) => new FailNext(k)),
                        fc.constant(new SettleOne()),
                    ],
                    { maxCommands: 24 },
                ),
                async (scheduler, commands) => {
                    const harness = makeGenericHarness(scheduler.scheduleFunction(async (p: string) => p));
                    const real: Real = { harness, settled: [] };
                    const model = freshModel(scheduler);
                    try {
                        await fc.asyncModelRun(() => ({ model, real }), commands);
                        await scheduler.waitAll();
                        await Promise.all(real.settled);
                        checkFullTeardown(model, real);
                    } finally {
                        harness.dispose();
                    }
                },
            ),
            { numRuns: RUNS, seed: SEED, verbose: true },
        );
    }, 300_000);
});

describe('generic assets: the texture bug, one layer over', () => {
    it('unloads an asset whose load was superseded by invalidate', async () => {
        // The exact shape that stranded a texture, on the path every non-texture
        // kind takes. It failed here until the ledger was unified.
        let open!: () => void;
        const harness = makeGenericHarness(() => new Promise<unknown>((r) => { open = () => r(null); }));
        try {
            const load = harness.assets.loadTilemap(KEYS[0]);
            harness.assets.invalidate(KEYS[0]);
            open();
            await load;

            harness.assets.releaseTilemap(KEYS[0]);

            expect(harness.loader.live(), 'the superseded asset was never unloaded').toEqual([]);
            expect([...genericRefs(harness.assets).keys()], 'an orphan ledger row survived').toEqual([]);
        } finally {
            harness.dispose();
        }
    });
});
