// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    realm-registry-isolation.test.ts
 * @brief   An asset belongs to the realm that loaded it — including in what a
 *          schedule says its systems touch.
 *
 * @details An editor world beside a play world is two Apps in one process. The
 *          asset-backed definitions lived in module-global maps, so the second
 *          app to load a key overwrote the first's value: both then ran the same
 *          graph, and one app's asset even decided what the OTHER app's system
 *          declared it reaches for.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { App } from '../src/app/app';
import { Assets } from '../src/asset/Assets';
import { Catalog } from '../src/asset/Catalog';
import { Assets as AssetsResource } from '../src/asset/AssetPlugin';
import { fsmTouches } from '../src/ai/fsm/FsmPlugin';
import { btTouches } from '../src/ai/bt/BtPlugin';
import { StateMachineAgent, clearFsmStore, registerFsm,
         type StateMachineAgentData } from '../src/ai/fsm/StateMachineAgent';
import { FsmPlugin, stepStateMachines } from '../src/ai/fsm/FsmPlugin';
import { appRegistryAsset } from '../src/asset/registryLookup';
import type { CommandsInstance } from '../src/ecs/commands';
import type { AnyComponentDef, ComponentData } from '../src/ecs/component';
import type { Entity } from '../src/types';
import { clearBtStore } from '../src/ai/bt/BehaviorTreeAgent';
import { ensureBuiltinAiRegistrations } from '../src/ai/builtins';
import type { Backend } from '../src/asset/Backend';

vi.mock('../src/wasm/resourceManager', () => ({
    requireResourceManager: () => ({}),
    getResourceManager: () => null,
    evictTextureDimensions: vi.fn(),
}));

const KEY = 'assets/ai/enemy.esfsm';
const BT_KEY = 'assets/ai/enemy.esbt';

/** An FSM whose one state writes `component` through the built-in property.set. */
const fsmWriting = (component: string): string => JSON.stringify({
    initial: 'Act',
    states: [{
        name: 'Act',
        onEnter: { name: 'property.set', params: { path: `${component}.enabled`, value: 'true' } },
    }],
});
const btWriting = (component: string): string => JSON.stringify({
    root: {
        type: 'action', id: 'n0', name: 'property.set',
        params: { path: `${component}.enabled`, value: 'true' },
    },
});

function realm(text: (url: string) => string): { app: App; assets: Assets } {
    const app = App.new();
    const assets = Assets.create({
        backend: {
            fetchBinary: vi.fn(async () => new ArrayBuffer(0)),
            fetchText: vi.fn(async (url: string) => text(url)),
            resolveUrl: (p: string) => p,
        } as unknown as Backend,
        catalog: Catalog.empty(),
        module: null as never,
    });
    app.insertResource(AssetsResource, assets as never);
    return { app, assets };
}

/** One entity carrying a StateMachineAgent — all `stepStateMachines` reads. */
class AgentWorld {
    private data = new Map<Entity, StateMachineAgentData>();
    private next = 1;

    spawn(agent: StateMachineAgentData): Entity {
        const entity = this.next++ as Entity;
        this.data.set(entity, agent);
        return entity;
    }
    getEntitiesWithComponents(): readonly Entity[] { return [...this.data.keys()]; }
    get<C extends AnyComponentDef>(entity: Entity, _component: C): ComponentData<C> {
        return this.data.get(entity) as ComponentData<C>;
    }
    set<C extends AnyComponentDef>(entity: Entity, _component: C, value: ComponentData<C>): void {
        this.data.set(entity, value as StateMachineAgentData);
    }
    has(): boolean { return true; }
}

describe('two realms in one process do not share an asset', () => {
    beforeEach(() => { clearFsmStore(); clearBtStore(); ensureBuiltinAiRegistrations(); });

    it('the same key loads a different graph in each, and each keeps its own', async () => {
        const a = realm(() => fsmWriting('Sprite'));
        const b = realm(() => fsmWriting('Velocity'));

        await a.assets.acquireTyped('statemachine', KEY);
        await b.assets.acquireTyped('statemachine', KEY);   // loads second — used to win

        const inA = a.assets.resolveRegistryAsset('statemachine', KEY);
        const inB = b.assets.resolveRegistryAsset('statemachine', KEY);
        expect(inA).toBeDefined();
        expect(inB).toBeDefined();
        expect(inA, 'the app that loaded last answered for both').not.toBe(inB);
    });

    it('what a schedule says the FSM system touches is its own realm\'s', async () => {
        // Worse than reading the wrong graph: one app's asset deciding what
        // another app's system declares it reaches for.
        const a = realm(() => fsmWriting('Sprite'));
        const b = realm(() => fsmWriting('Velocity'));
        await a.assets.acquireTyped('statemachine', KEY);
        await b.assets.acquireTyped('statemachine', KEY);

        expect(fsmTouches(a.app).writes).toContain('Sprite');
        expect(fsmTouches(a.app).writes, 'B\'s graph is in A\'s declaration').not.toContain('Velocity');
        expect(fsmTouches(b.app).writes).toContain('Velocity');
        expect(fsmTouches(b.app).writes).not.toContain('Sprite');
    });

    it('and the same holds for behaviour trees', async () => {
        const a = realm(() => btWriting('Sprite'));
        const b = realm(() => btWriting('Velocity'));
        await a.assets.acquireTyped('behaviortree', BT_KEY);
        await b.assets.acquireTyped('behaviortree', BT_KEY);

        expect(btTouches(a.app).writes).toContain('Sprite');
        expect(btTouches(a.app).writes).not.toContain('Velocity');
        expect(btTouches(b.app).writes).toContain('Velocity');
        expect(btTouches(b.app).writes).not.toContain('Sprite');
    });

    it('a timeline plays its own realm\'s asset, and one app\'s cleanup leaves the other', async () => {
        // The worst of the three: the timeline registry was a module-level
        // pointer at whichever plugin built LAST, and the plugin object itself
        // is a shared singleton.
        const timeline = (duration: number, texture: string): string => JSON.stringify({
            version: 1, duration, tracks: [{
                type: 'animFrames', target: '', frames: [{ texture, duration: 1 }],
            }],
        });
        const a = realm(() => timeline(1, 'a.png'));
        const b = realm(() => timeline(9, 'b.png'));
        await a.assets.acquireTyped('timeline', 'cut/intro.estimeline');
        await b.assets.acquireTyped('timeline', 'cut/intro.estimeline');

        const inA = a.assets.resolveRegistryAsset<{ asset: { duration: number } }>('timeline', 'cut/intro.estimeline');
        const inB = b.assets.resolveRegistryAsset<{ asset: { duration: number } }>('timeline', 'cut/intro.estimeline');
        expect(inA?.asset.duration).toBe(1);
        expect(inB?.asset.duration, 'both apps read whichever built its plugin last').toBe(9);

        // And a code registration still wins over the realm's asset.
        const { TimelineAPI } = await import('../src/timeline/TimelineControl');
        const api = new TimelineAPI();
        api.useAssetTimelines((ref) => a.assets.resolveRegistryAsset<{ asset: { duration: number } }>('timeline', ref)?.asset as never);
        expect(api.getAsset('cut/intro.estimeline')?.duration).toBe(1);
        api.registerAsset('cut/intro.estimeline', { duration: 5 } as never);
        expect(api.getAsset('cut/intro.estimeline')?.duration).toBe(5);

        // B goes away; A is still playing.
        b.assets.releaseAll();
        expect(a.assets.resolveRegistryAsset('timeline', 'cut/intro.estimeline')).toBeDefined();
        expect(b.assets.resolveRegistryAsset('timeline', 'cut/intro.estimeline')).toBeUndefined();
    });

    it('a code-registered controller still wins over the realm\'s asset', async () => {
        // This round changes which realm answers, not who wins: a name the game
        // registered in code is still the one an Animator gets.
        const { AnimatorControllerAPI } = await import('../src/animation/Animator');
        const CODE = { initialState: 'run', states: [{ name: 'run' }] };
        const DISK = JSON.stringify({ initialState: 'idle', states: [{ name: 'idle' }] });
        const a = realm(() => DISK);
        await a.assets.acquireTyped('animatorcontroller', 'enemy.esanimator');

        const ctrl = new AnimatorControllerAPI();
        ctrl.useAssetControllers((ref) => a.assets.resolveRegistryAsset('animatorcontroller', ref));
        expect(ctrl.getController('enemy.esanimator')?.initialState).toBe('idle');

        ctrl.registerController('enemy.esanimator', CODE as never);
        expect(ctrl.getController('enemy.esanimator')?.initialState).toBe('run');
    });

    it('a registration made after the App was built still reaches it', () => {
        // Hot reload re-imports the bundle into a LIVE app, so a module-scope
        // `registerFsm` runs after build on every edit. An app holding a copy
        // taken at build would answer with the version from before it, forever.
        const a = realm(() => fsmWriting('Sprite'));
        new FsmPlugin().build(a.app);
        registerFsm('lateComer', JSON.parse(fsmWriting('Camera')) as never);

        expect(fsmTouches(a.app).writes, 'the app answered from a copy taken at build')
            .toContain('Camera');

        // And the step RUNS it, not only the schedule declaring it: the realm
        // resolver answers nothing for a name that is not an asset.
        const world = new AgentWorld();
        const entity = world.spawn({ fsm: 'lateComer', current: '' });
        stepStateMachines(
            world, {} as CommandsInstance, 1 / 60, new Map(),
            (ref) => appRegistryAsset(a.app, 'statemachine', ref),
        );
        expect(world.get(entity, StateMachineAgent).current).toBe('Act');
    });

    it('a code registration has no realm, and every app still sees it', async () => {
        // The other half of the rule: `registerFsm('patrol', …)` is not an asset.
        const { registerFsm } = await import('../src/ai/fsm/StateMachineAgent');
        const a = realm(() => fsmWriting('Sprite'));
        const b = realm(() => fsmWriting('Sprite'));
        registerFsm('patrol', JSON.parse(fsmWriting('Camera')) as never);

        expect(fsmTouches(a.app).writes).toContain('Camera');
        expect(fsmTouches(b.app).writes).toContain('Camera');
    });
});
