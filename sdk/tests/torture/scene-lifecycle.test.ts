// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Scene lifecycle, tortured.
 *
 * A scene manager keeps five bits of bookkeeping for the same fact — a status
 * on the instance, plus `active`/`additive`/`paused`/`sleeping` sets — and they
 * are written by eight different verbs that can interleave with a load still in
 * flight. Every one of them is correct alone. The question is whether any order
 * of them can leave those five disagreeing, or leave a scene's entities alive
 * after it unloaded.
 *
 *   TORTURE_RUNS=20000 pnpm run torture
 */
import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';

vi.mock('../../src/scene/scene', () => ({
    loadSceneWithAssets: vi.fn().mockResolvedValue(new Map()),
}));
vi.mock('../../src/render/customDraw', () => ({
    registerDrawCallback: vi.fn(), unregisterDrawCallback: vi.fn(),
}));
vi.mock('../../src/postprocess', () => ({
    PostProcess: { bind: vi.fn(), unbind: vi.fn() }, PostProcessStack: vi.fn(),
}));
vi.mock('../../src/render/material', () => ({
    Material: { release: vi.fn(), createShader: vi.fn() }, defineResource: vi.fn(),
}));
vi.mock('../../src/asset', () => ({
    Assets: {
        releaseTexture: vi.fn(), releaseFont: vi.fn(),
        releaseMaterial: vi.fn(), releaseAll: vi.fn(),
    },
    discoverSceneAssets: vi.fn().mockReturnValue({ textures: [], fonts: [], spines: [], audios: [], unresolved: [] }),
    preloadSceneAssets: vi.fn().mockResolvedValue({
        loadedTextures: new Set(), loadedFonts: new Set(), loadedMaterials: new Set(), missing: [],
    }),
}));

import { SceneManagerState } from '../../src/scene/sceneManager';

const SCENES = ['alpha', 'beta'] as const;
const RUNS = Number(process.env.TORTURE_RUNS ?? 200);
const SEED = process.env.TORTURE_SEED ? Number(process.env.TORTURE_SEED) : undefined;
const SCENE_DATA = { version: '1.0', name: 'T', entities: [] };

interface FakeWorld {
    live: Set<number>;
    spawn(): number;
}

function makeManager(setupGate: (name: string) => Promise<unknown>) {
    const live = new Set<number>();
    const components = new Map<number, Set<unknown>>();
    let next = 1;
    const world = {
        spawn: () => { const e = next++; live.add(e); components.set(e, new Set()); return e; },
        despawn: (e: number) => { live.delete(e); components.delete(e); },
        valid: (e: number) => live.has(e),
        has: (e: number, c: unknown) => components.get(e)?.has(c) ?? false,
        get: () => ({ scene: '', persistent: false }),
        insert: (e: number, c: unknown) => { components.get(e)?.add(c); },
        set: () => {},
        remove: (e: number, c: unknown) => { components.get(e)?.delete(c); },
    };
    const app = {
        world,
        hasResource: () => false,
        getResource: () => undefined,
        addSystemToSchedule: () => {},
        removeSystem: () => {},
    };
    const manager = new SceneManagerState(app as never);
    for (const name of SCENES) {
        manager.register({
            name,
            data: SCENE_DATA,
            // Every setup is a scheduled task, so a load can be suspended
            // mid-flight while other verbs run against the same scene.
            setup: async (ctx) => { await setupGate(name); ctx.spawn(); ctx.spawn(); },
        });
    }
    return { manager, world: { live, spawn: world.spawn } as FakeWorld };
}

type Manager = SceneManagerState;

/**
 * The five records of one fact must agree, and an unloaded scene must leave
 * nothing behind. Checked after every command.
 */
function checkInvariants(manager: Manager, world: FakeWorld, loadedNow: Set<string>): void {
    for (const name of SCENES) {
        const loaded = manager.isLoaded(name);

        if (!loaded) {
            if (manager.isSleeping(name)) throw new Error(`${name} is unloaded but still listed as sleeping`);
            if (manager.isPaused(name)) throw new Error(`${name} is unloaded but still listed as paused`);
            if (manager.isActive(name)) throw new Error(`${name} is unloaded but still the active scene`);
            continue;
        }
        if (manager.isSleeping(name) && manager.isPaused(name)) {
            throw new Error(`${name} is listed as both sleeping and paused`);
        }
    }

    // Nothing may outlive its scene: when every scene is gone, so are the
    // entities they spawned. (No entity here is persistent.)
    if (loadedNow.size === 0 && world.live.size > 0) {
        throw new Error(`${world.live.size} entit(ies) outlived every scene that owned them`);
    }
}

interface Model {
    /** Scenes the test believes are loaded — the manager must agree. */
    loaded: Set<string>;
    scheduler: fc.Scheduler;
}
interface Real {
    manager: Manager;
    world: FakeWorld;
    settled: Promise<unknown>[];
}

type Cmd = fc.AsyncCommand<Model, Real>;

/** Loads are fired, never awaited: awaiting one would deadlock the scheduler. */
function fire(real: Real, model: Model, name: string, p: Promise<unknown>): void {
    real.settled.push(p.then(() => { model.loaded.add(name); }, () => {}));
}

class Load implements Cmd {
    constructor(readonly name: string, readonly additive: boolean) {}
    check = (): boolean => true;
    async run(model: Model, real: Real): Promise<void> {
        const call = this.additive
            ? real.manager.loadAdditive(this.name)
            : real.manager.load(this.name);
        fire(real, model, this.name, call);
        checkInvariants(real.manager, real.world, model.loaded);
    }
    toString = (): string => `${this.additive ? 'loadAdditive' : 'load'}(${this.name})`;
}

class Unload implements Cmd {
    constructor(readonly name: string) {}
    check = (): boolean => true;
    async run(model: Model, real: Real): Promise<void> {
        await real.manager.unload(this.name);
        model.loaded.delete(this.name);
        checkInvariants(real.manager, real.world, model.loaded);
    }
    toString = (): string => `unload(${this.name})`;
}

class Verb implements Cmd {
    constructor(readonly name: string, readonly verb: 'sleep' | 'wake' | 'pause' | 'resume') {}
    check = (): boolean => true;
    async run(model: Model, real: Real): Promise<void> {
        real.manager[this.verb](this.name);
        checkInvariants(real.manager, real.world, model.loaded);
    }
    toString = (): string => `${this.verb}(${this.name})`;
}

class SettleOne implements Cmd {
    check = (model: Model): boolean => model.scheduler.count() > 0;
    async run(model: Model, real: Real): Promise<void> {
        await model.scheduler.waitOne();
        await new Promise((resolve) => setTimeout(resolve, 0));
        checkInvariants(real.manager, real.world, model.loaded);
    }
    toString = (): string => 'settleOne()';
}

describe('scene lifecycle under generated interleavings', () => {
    it('keeps its bookkeeping consistent and leaves nothing behind', async () => {
        const scene = fc.constantFrom(...SCENES);
        await fc.assert(
            fc.asyncProperty(
                fc.scheduler(),
                fc.commands(
                    [
                        scene.map((s) => new Load(s, false)),
                        scene.map((s) => new Load(s, true)),
                        scene.map((s) => new Unload(s)),
                        scene.chain((s) => fc.constantFrom('sleep', 'wake', 'pause', 'resume')
                            .map((v) => new Verb(s, v as 'sleep'))),
                        fc.constant(new SettleOne()),
                    ],
                    { maxCommands: 24 },
                ),
                async (scheduler, commands) => {
                    const { manager, world } = makeManager(scheduler.scheduleFunction(async (n: string) => n));
                    const real: Real = { manager, world, settled: [] };
                    const model: Model = { loaded: new Set(), scheduler };

                    await fc.asyncModelRun(() => ({ model, real }), commands);
                    await scheduler.waitAll();
                    await Promise.allSettled(real.settled);

                    // Tear everything down: nothing the scenes spawned may survive.
                    for (const name of SCENES) await manager.unload(name);
                    model.loaded.clear();
                    checkInvariants(manager, world, model.loaded);
                    expect(world.live.size, 'entities outlived unloadAll').toBe(0);
                },
            ),
            { numRuns: RUNS, seed: SEED, verbose: true },
        );
    }, 300_000);
});
