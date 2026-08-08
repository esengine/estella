// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The asset lifecycle, tortured.
 *
 * Every function below is individually correct and has the unit test to prove
 * it. What none of them prove is that they are correct TOGETHER: a hot reload
 * landing between a fetch resolving and the cache write, a release running
 * while a superseded load is still in flight, a scene unloading on top of a
 * load it started. The failures live in the order, and the order is what a
 * hand-written test fixes to whatever its author already suspected.
 *
 * So the order is generated. fast-check picks the commands AND decides which
 * pending load settles next, then shrinks both to the smallest sequence that
 * still breaks an invariant.
 *
 * The invariants are the specification — the four the engine must never
 * violate no matter the interleaving, stated once here and checked after every
 * single command rather than at the end, so a failure names the command that
 * caused it instead of the one that noticed.
 *
 *   TORTURE_RUNS=5000 pnpm --filter ./sdk exec vitest run tests/torture
 *   TORTURE_SEED=1234 …                replay one failure
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
    makeAssetHarness, withoutLoadTimeout, textureRefs,
    type AssetHarness,
} from './assetHarness';

const KEYS = ['tex/a.png', 'tex/b.png'] as const;
const RUNS = Number(process.env.TORTURE_RUNS ?? 200);
const SEED = process.env.TORTURE_SEED ? Number(process.env.TORTURE_SEED) : undefined;

/** One completed load, as the test saw it — which generation asked, what it got. */
interface Outcome {
    key: string;
    generation: number;
    handle?: number;
    failed?: boolean;
    /** The unflipped variant lives under its own cache key. */
    raw?: boolean;
}

/** What the test believes about the world; the real system must not contradict it. */
interface Model {
    /** Bumped by every invalidate: the generation a later resolution belongs to. */
    generation: Map<string, number>;
    /**
     * Loads a NEW request could join: issued in the current generation and not
     * yet settled. Superseded loads do not count — invalidate took the key from
     * them, so the next caller must fetch rather than wait on stale bytes.
     */
    joinable: Map<string, number>;
    /** Loader invocations the test can justify: one per key per generation, plus retries after failure. */
    allowedLoads: Map<string, number>;
    /**
     * References the test has actually been HANDED and not yet given back.
     *
     * Release is gated on this, so the property models a well-behaved caller.
     * Over-release is a caller bug with its own finding in the guards file;
     * mixing it in here would mask every other failure behind it.
     */
    held: Map<string, number>;
    /**
     * releaseAll() calls so far. A load that spans one has no owner by the time
     * it lands: the engine fails it when the reset beats its internal
     * completion, and cannot un-resolve a promise that already settled. Either
     * way the result is void by contract, so its handle is not asserted alive.
     */
    resets: number;
    /** Held references to the UNFLIPPED variant, which has its own cache key. */
    heldRaw: Map<string, number>;
    /**
     * The run's scheduler. It lives on the model because a command's `check`
     * only ever sees the model, and "is there anything left to settle" has to be
     * answerable there or the shrinker cannot drop settle points.
     */
    scheduler: fc.Scheduler;
}

interface Real {
    harness: AssetHarness;
    outcomes: Outcome[];
    settled: Promise<unknown>[];
}

const freshModel = (scheduler: fc.Scheduler): Model => ({
    generation: new Map(KEYS.map((k) => [k, 0])),
    joinable: new Map(KEYS.map((k) => [k, 0])),
    allowedLoads: new Map(KEYS.map((k) => [k, 0])),
    held: new Map(KEYS.map((k) => [k, 0])),
    heldRaw: new Map(KEYS.map((k) => [k, 0])),
    resets: 0,
    scheduler,
});

const bump = (m: Map<string, number>, k: string, by = 1): void => {
    m.set(k, (m.get(k) ?? 0) + by);
};

// =============================================================================
// The invariants — the specification
// =============================================================================

/**
 * Checked after every command. Each throws with the sentence a failure should
 * print; fast-check shrinks the command list until only the cause remains.
 */
function checkInvariants(model: Model, real: Real): void {
    const { assets, gpu } = real.harness;

    // I3 — a reference count is a count of references. Nothing may drive it
    // below zero, and no key may keep a count once its entry is gone.
    for (const [key, generations] of textureRefs(assets)) {
        for (const generation of generations) {
            if (generation.count < 0) {
                throw new Error(`refCount(${key}, handle ${generation.value}) = ${generation.count} — a release outran its acquire`);
            }
            if (generation.count === 0) {
                throw new Error(`refCount(${key}, handle ${generation.value}) = 0 is recorded rather than removed — a generation nothing can drain`);
            }
        }
        if (generations.length === 0) {
            throw new Error(`${key} keeps an empty generation list — a key nothing will ever clean up`);
        }
    }

    // I4 — a disposed GPU resource must never be reachable again. Reviving one
    // hands the renderer a freed handle, which draws garbage or crashes the driver.
    for (const key of KEYS) {
        const live = assets.getTexture(key);
        if (live && gpu.freed.includes(live.handle)) {
            throw new Error(`getTexture(${key}) returns handle ${live.handle}, which the pool already destroyed`);
        }
    }

    // The pool must never be told to free the same handle twice.
    if (gpu.doubleReleased.length > 0) {
        throw new Error(`handle(s) released more times than acquired: ${gpu.doubleReleased.join(', ')}`);
    }
    // Handles the pool destroyed stay destroyed: none may be sitting in the
    // resident set waiting to be revived into a future load.
    for (const [key, handle] of gpu.resident) {
        if (gpu.freed.includes(handle)) {
            throw new Error(`handle ${handle} is resident under ${key} after the pool destroyed it`);
        }
    }

    // I1 — at most one authoritative request per key per generation. A load
    // that finished after losing the key must not leave a record that makes the
    // next request start a duplicate fetch of bytes already in flight.
    for (const key of KEYS) {
        const calls = real.harness.loaderCalls.filter((c) => c === key).length;
        const allowed = model.allowedLoads.get(key) ?? 0;
        if (calls > allowed) {
            throw new Error(
                `${key} was fetched ${calls} times where ${allowed} request(s) were asked for — `
                + 'a superseded load evicted its successor\'s record and the next caller started a duplicate',
            );
        }
    }

    // I2 — a resolution from a superseded generation must not touch the current
    // one. It may still reach its own caller; it may not become the cached value.
    for (const outcome of real.outcomes) {
        if (outcome.failed || outcome.raw || outcome.handle === undefined) continue;
        const currentGeneration = model.generation.get(outcome.key) ?? 0;
        if (outcome.generation === currentGeneration) continue;
        const live = assets.getTexture(outcome.key);
        if (live?.handle === outcome.handle) {
            throw new Error(
                `${outcome.key} is cached as handle ${outcome.handle}, produced by generation `
                + `${outcome.generation} while the current generation is ${currentGeneration} — stale bytes are live`,
            );
        }
    }
}

/**
 * The end-of-run claim, and the one that finds leaks: after the test releases
 * every reference it holds, every handle the engine minted must have been given
 * back. A handle nobody released is a texture resident for the life of the
 * process, which is what "the editor got slower" is made of.
 */
function checkFullTeardown(model: Model, real: Real): void {
    const { assets, gpu } = real.harness;
    for (const key of KEYS) {
        const owed = Math.max(model.held.get(key) ?? 0, model.heldRaw.get(key) ?? 0);
        for (let i = 0; i < owed; i++) assets.releaseTexture(key);
        model.held.set(key, 0);
        model.heldRaw.set(key, 0);
    }

    // Every minted handle back at zero C++ references; one above zero is
    // resident for the life of the process. Zero-ref handles the pool retains
    // as evictable are its business, not a leak.
    const owed = gpu.created.filter((h) => (gpu.refs.get(h) ?? 0) > 0);
    if (owed.length > 0) {
        throw new Error(
            `${owed.length} texture handle(s) still referenced after every reference was dropped: `
            + owed.map((h) => `${h}(refs ${gpu.refs.get(h)})`).join(', '),
        );
    }
    const refs = textureRefs(assets);
    if (refs.size > 0) {
        throw new Error(
            'refcount ledger is not empty after full teardown: '
            + [...refs].map(([k, g]) => `${k}=[${g.map((x) => `h${x.value}x${x.count}`).join(',')}]`).join(', '),
        );
    }
}

// =============================================================================
// The commands
// =============================================================================

type Cmd = fc.AsyncCommand<Model, Real>;

class Load implements Cmd {
    constructor(readonly key: string) {}
    check = (): boolean => true;
    async run(model: Model, real: Real): Promise<void> {
        const generation = model.generation.get(this.key) ?? 0;
        const resetsAtIssue = model.resets;
        // A request that cannot join an in-flight or cached one is entitled to
        // its own fetch; that is what makes a THIRD fetch a bug rather than work.
        if ((model.joinable.get(this.key) ?? 0) === 0 && !real.harness.assets.getTexture(this.key)) {
            bump(model.allowedLoads, this.key);
        }
        bump(model.joinable, this.key);

        const settled = real.harness.assets.loadTexture(this.key).then(
            (result) => {
                // I4, at the only moment it can be judged: ordering matters, and
                // a handle destroyed LATER is not evidence of anything.
                if (model.resets === resetsAtIssue && real.harness.gpu.freed.includes(result.handle)) {
                    throw new Error(`load(${this.key}) resolved with handle ${result.handle}, which the pool had already destroyed`);
                }
                real.outcomes.push({ key: this.key, generation, handle: result.handle });
                bump(model.held, this.key);
                if (model.generation.get(this.key) === generation) bump(model.joinable, this.key, -1);
            },
            () => {
                real.outcomes.push({ key: this.key, generation, failed: true });
                if (model.generation.get(this.key) === generation) bump(model.joinable, this.key, -1);
            },
        );
        real.settled.push(settled);
        checkInvariants(model, real);
    }
    toString = (): string => `load(${this.key})`;
}

class Release implements Cmd {
    constructor(readonly key: string) {}
    /** Only what the caller was actually handed — see Model.held. */
    check = (model: Model): boolean =>
        (model.held.get(this.key) ?? 0) > 0 || (model.heldRaw.get(this.key) ?? 0) > 0;
    async run(model: Model, real: Real): Promise<void> {
        real.harness.assets.releaseTexture(this.key);
        // ONE call, TWO references: the variants are separate cache keys and
        // releaseTexture drains one from each, so two loads of the same file
        // need only one release between them.
        if ((model.held.get(this.key) ?? 0) > 0) bump(model.held, this.key, -1);
        if ((model.heldRaw.get(this.key) ?? 0) > 0) bump(model.heldRaw, this.key, -1);
        checkInvariants(model, real);
    }
    toString = (): string => `release(${this.key})`;
}

/** The raw (unflipped) variant — a second cache key for the same file, which
 *  releaseTexture drains in the same call. Two keys per path is where a fix for
 *  one variant quietly skips the other. */
class LoadRaw implements Cmd {
    constructor(readonly key: string) {}
    check = (): boolean => true;
    async run(model: Model, real: Real): Promise<void> {
        const generation = model.generation.get(this.key) ?? 0;
        const resetsAtIssue = model.resets;
        bump(model.allowedLoads, this.key);
        const settled = real.harness.assets.loadTextureRaw(this.key).then(
            (result) => {
                if (model.resets === resetsAtIssue && real.harness.gpu.freed.includes(result.handle)) {
                    throw new Error(`loadRaw(${this.key}) resolved with handle ${result.handle}, which the pool had already destroyed`);
                }
                real.outcomes.push({ key: this.key, generation, handle: result.handle, raw: true });
                bump(model.heldRaw, this.key);
            },
            () => { real.outcomes.push({ key: this.key, generation, failed: true, raw: true }); },
        );
        real.settled.push(settled);
        checkInvariants(model, real);
    }
    toString = (): string => `loadRaw(${this.key})`;
}

/** Scene unload: everything goes at once, including loads still in flight. */
class ReleaseAll implements Cmd {
    check = (): boolean => true;
    async run(model: Model, real: Real): Promise<void> {
        real.harness.assets.releaseAll();
        model.resets++;
        for (const key of KEYS) {
            model.held.set(key, 0);
            model.heldRaw.set(key, 0);
        }
        // NOT a new generation: dropping references does not stale the bytes, so
        // a revive may hand the same handle back. Only invalidate ages an asset.
        // Pending records are gone though, so nothing is joinable.
        for (const key of KEYS) {
            model.joinable.set(key, 0);
            bump(model.allowedLoads, key);
        }
        checkInvariants(model, real);
    }
    toString = (): string => 'releaseAll()';
}

class Invalidate implements Cmd {
    constructor(readonly key: string) {}
    check = (): boolean => true;
    async run(model: Model, real: Real): Promise<void> {
        real.harness.assets.invalidate(this.key);
        bump(model.generation, this.key);
        // Everything still in flight belonged to the outgoing generation, so
        // nothing is joinable any more: the next request is entitled to fetch.
        model.joinable.set(this.key, 0);
        // The bytes changed on disk, so the next request must fetch again — a new
        // generation is entitled to a fetch even while the old one is in flight.
        bump(model.allowedLoads, this.key);
        checkInvariants(model, real);
    }
    toString = (): string => `invalidate(${this.key})`;
}

class FailNext implements Cmd {
    constructor(readonly key: string) {}
    check = (): boolean => true;
    async run(model: Model, real: Real): Promise<void> {
        real.harness.failNext(this.key);
        // A failed load leaves nothing cached, so the retry is a fetch we asked for.
        bump(model.allowedLoads, this.key);
        checkInvariants(model, real);
    }
    toString = (): string => `failNext(${this.key})`;
}

/** Let exactly one pending load settle — the scheduler picks which. */
class SettleOne implements Cmd {
    check = (model: Model): boolean => model.scheduler.count() > 0;
    async run(model: Model, real: Real): Promise<void> {
        await model.scheduler.waitOne();
        // A macrotask, not one microtask: a completion runs through several
        // awaits inside AsyncCache, and a model that resumed early would hold
        // fewer references than the engine has already recorded.
        await new Promise((resolve) => setTimeout(resolve, 0));
        checkInvariants(model, real);
    }
    toString = (): string => 'settleOne()';
}

// =============================================================================
// The property
// =============================================================================

describe('asset lifecycle under generated interleavings', () => {
    it('holds every invariant no matter the order', async () => {
        const key = fc.constantFrom(...KEYS);

        await withoutLoadTimeout(() => fc.assert(
            fc.asyncProperty(
                fc.scheduler(),
                fc.commands(
                    [
                        key.map((k) => new Load(k)),
                        key.map((k) => new Release(k)),
                        key.map((k) => new Invalidate(k)),
                        key.map((k) => new FailNext(k)),
                        key.map((k) => new LoadRaw(k)),
                        fc.constant(new ReleaseAll()),
                        fc.constant(new SettleOne()),
                    ],
                    { maxCommands: 24 },
                ),
                async (scheduler, commands) => {
                    const harness = makeAssetHarness(scheduler.scheduleFunction(async (k: string) => k));
                    const real: Real = { harness, outcomes: [], settled: [] };
                    const model = freshModel(scheduler);
                    try {
                        await fc.asyncModelRun(() => ({ model, real }), commands);
                        // Drain whatever the commands left in flight, in an order
                        // the scheduler chose and can shrink.
                        await scheduler.waitAll();
                        await Promise.all(real.settled);
                        checkFullTeardown(model, real);
                    } finally {
                        harness.dispose();
                    }
                },
            ),
            { numRuns: RUNS, seed: SEED, verbose: true },
        ));
    }, 300_000);
});
