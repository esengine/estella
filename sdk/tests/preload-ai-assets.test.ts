// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * Regression: a scene that references .esfsm/.esbt brains through
 * StateMachineAgent.fsm / BehaviorTreeAgent.bt must have those assets loaded by
 * preloadSceneAssets, so getFsm/getBt resolve before the agents first tick.
 * Previously preloadSceneAssets dispatched a hardcoded type list that omitted
 * 'statemachine'/'behaviortree', so editor-authored AI assets never loaded and
 * the agents silently did nothing (the enemy-ai example: enemies never chased).
 *
 * The AI component defs are re-declared per test because the shared setup clears
 * the component registry (tests/setup.ts) — discovery only needs their
 * assetFields/discoverAssets, so this mirrors the real StateMachineAgent /
 * BehaviorTreeAgent metadata without depending on module-load order.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Assets } from '../src/asset/Assets';
import { Catalog } from '../src/asset/Catalog';
import type { Backend } from '../src/asset/Backend';
import type { SceneData } from '../src/scene';
import { defineComponent } from '../src/ecs/component';
import { getFsm, clearFsmStore } from '../src/ai/fsm/StateMachineAgent';
import { getBt, clearBtStore } from '../src/ai/bt/BehaviorTreeAgent';

// The FSM/BT loaders don't touch the ResourceManager, but the shared LoadContext
// materializes it eagerly — stub it so the load path runs headless.
vi.mock('../src/wasm/resourceManager', () => ({
    requireResourceManager: () => ({}),
    evictTextureDimensions: vi.fn(),
}));

const FSM_PATH = 'assets/ai/enemy.esfsm';
const BT_PATH = 'assets/ai/enemy.esbt';

const FSM_JSON = JSON.stringify({
    initial: 'Patrol',
    states: [
        { name: 'Patrol', transitions: [{ to: 'Chase', condition: 'seesPlayer' }] },
        { name: 'Chase', onUpdate: 'chase', transitions: [{ to: 'Patrol', condition: 'lostPlayer' }] },
    ],
});
const BT_JSON = JSON.stringify({
    root: { type: 'selector', id: 'n0', children: [{ type: 'action', id: 'n1', name: 'patrol' }] },
});

function aiBackend(): Backend {
    return {
        fetch: vi.fn(async () => new ArrayBuffer(0)),
        fetchText: vi.fn(async (url: string) =>
            url.includes('.esfsm') ? FSM_JSON : url.includes('.esbt') ? BT_JSON : '{}'),
        resolveUrl: vi.fn((p: string) => p),
        resolvePath: vi.fn((p: string) => p),
    } as unknown as Backend;
}

const scene: SceneData = {
    name: 'ai', entities: [
        { id: 1, name: 'A', parent: null, children: [], components: [{ type: 'StateMachineAgent', data: { fsm: FSM_PATH, current: '' } }] },
        { id: 2, name: 'B', parent: null, children: [], components: [{ type: 'BehaviorTreeAgent', data: { bt: BT_PATH, status: 0 } }] },
    ],
};

describe('preloadSceneAssets — AI brains', () => {
    beforeEach(() => {
        clearFsmStore();
        clearBtStore();
        // Mirror the real SDK component metadata (the registry is cleared per test).
        defineComponent('StateMachineAgent', { fsm: '', current: '' }, {
            assetFields: [{ field: 'fsm', type: 'statemachine' }],
            discoverAssets: (d) => (typeof d.fsm === 'string' && d.fsm.endsWith('.esfsm') ? [{ type: 'statemachine', path: d.fsm }] : []),
        });
        defineComponent('BehaviorTreeAgent', { bt: '', status: 0 }, {
            assetFields: [{ field: 'bt', type: 'behaviortree' }],
            discoverAssets: (d) => (typeof d.bt === 'string' && d.bt.endsWith('.esbt') ? [{ type: 'behaviortree', path: d.bt }] : []),
        });
    });

    it('loads .esfsm / .esbt referenced by agents into the AI store', async () => {
        const assets = Assets.create({ backend: aiBackend(), catalog: Catalog.empty(), module: null as never });

        expect(getFsm(FSM_PATH)).toBeUndefined();
        expect(getBt(BT_PATH)).toBeUndefined();

        const result = await assets.preloadSceneAssets(scene, undefined, { skipSpine: true });

        expect(result.missing).toEqual([]);
        expect(getFsm(FSM_PATH)).toBeDefined();
        expect(getBt(BT_PATH)).toBeDefined();
    });

    it('keys the store by the resolved ref when a realm resolver is set', async () => {
        // Mirrors the play realm: the ref resolver prefixes the origin, so the
        // FSM/BT register under the resolved path — the key FsmPlugin/BtPlugin's
        // resolveKey reproduces from the agent's authored ref.
        const base = 'estella://project';
        const assets = Assets.create({ backend: aiBackend(), catalog: Catalog.empty(), module: null as never });
        assets.setAssetRefResolver((ref) => (ref.includes('://') ? ref : `${base}/${ref}`));

        const result = await assets.preloadSceneAssets(scene, undefined, { skipSpine: true });

        expect(result.missing).toEqual([]);
        expect(getFsm(`${base}/${FSM_PATH}`)).toBeDefined();
        expect(getBt(`${base}/${BT_PATH}`)).toBeDefined();
        expect(getFsm(FSM_PATH)).toBeUndefined(); // NOT keyed by the raw ref
    });
});
