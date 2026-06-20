/**
 * @file  Model-authoritative payoff (REARCH_EDITOR_MODEL.md): SceneCommands edit
 *        the SceneModel ONLY; the Reconciler projects the model into the World,
 *        so the World stays a faithful derived projection while the model
 *        serializes LOSSLESSLY — unknown components/fields the World drops
 *        survive an edit→save round trip, and delete→undo restores them.
 *
 * Runs in an isolated EditorSession (P2): the session's reconciler bulk-adopts
 * the scene into the (mocked) headless World; commands flow model→World through it.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { App, Transform, Parent } from 'esengine';
import type { ESEngineModule, SceneData } from 'esengine';
import { loadWasmModule, HAS_WASM } from './helpers/loadWasm';

const host = vi.hoisted(() => ({ world: null as unknown as App['world'] }));
vi.mock('@/engine/EngineHost', () => ({
    EngineHost: {
        mutableWorld: () => host.world,
        get world() {
            return host.world;
        },
        getResource: () => undefined,
    },
}));

import { EditorSession } from '@/engine/EditorSession';

function sceneWithUnknown(): SceneData {
    return {
        version: '1.0',
        name: 'lossless',
        entities: [
            {
                id: 1,
                name: 'Hero',
                parent: null,
                children: [],
                components: [
                    {
                        type: 'Transform',
                        data: {
                            position: { x: 0, y: 0, z: 0 },
                            rotation: { w: 1, x: 0, y: 0, z: 0 },
                            scale: { x: 1, y: 1, z: 1 },
                        },
                    },
                    { type: 'WaveMotion', data: { amplitude: 5, phase: 1.5 } }, // unknown to the engine
                ],
            },
        ],
    } as unknown as SceneData;
}

describe.skipIf(!HAS_WASM)('Model-authoritative projection + lossless save', () => {
    let module: ESEngineModule;
    let S: EditorSession;
    let runtime1: number;
    beforeAll(async () => {
        module = await loadWasmModule();
    });
    beforeEach(() => {
        const app = App.new();
        app.connectCpp(new module.Registry() as never, module);
        host.world = app.world;
        S = EditorSession.create();
        // Bulk path: build the World (lossy) and adopt the raw scene (lossless).
        // No @uuid: refs here, so resolved === raw.
        S.reconciler.adopt(sceneWithUnknown(), sceneWithUnknown());
        runtime1 = S.model.runtimeFor(1)!;
        // The World dropped the unknown component; the model kept it.
        expect(host.world.has(runtime1, Transform)).toBe(true);
    });

    afterEach(() => S.dispose());

    it('setField edits the World AND the model, preserving the unknown component', () => {
        S.commands.setField(1, 'Transform', 'position', 'vec3', [9, 8, 7]); // by source id

        // World reflects the edit:
        expect(host.world.get(runtime1, Transform).position).toMatchObject({ x: 9, y: 8, z: 7 });

        // Model (the save truth) reflects the edit AND still has the unknown component:
        const saved = S.model.serialize()!;
        const hero = saved.entities.find((e) => e.id === 1)!;
        const t = hero.components.find((c) => c.type === 'Transform')!.data as {
            position: { x: number };
        };
        expect(t.position.x).toBe(9);
        const wave = hero.components.find((c) => c.type === 'WaveMotion');
        expect(wave).toBeDefined();
        expect((wave!.data as { amplitude: number }).amplitude).toBe(5);
    });

    it('undo of a field edit reverts the model too', () => {
        S.commands.setField(1, 'Transform', 'position', 'vec3', [9, 0, 0]); // by source id
        S.history.undo();
        const hero = S.model.serialize()!.entities.find((e) => e.id === 1)!;
        const t = hero.components.find((c) => c.type === 'Transform')!.data as {
            position: { x: number };
        };
        expect(t.position.x).toBe(0);
    });

    it('addEntity / undo is reflected in the model', () => {
        const before = S.model.serialize()!.entities.length;
        S.commands.addEntity();
        expect(S.model.serialize()!.entities.length).toBe(before + 1);
        S.history.undo();
        expect(S.model.serialize()!.entities.length).toBe(before);
    });

    it('delete then undo preserves the unknown component (lossless undo)', () => {
        S.commands.deleteEntity(1); // by source id
        expect(S.model.serialize()!.entities.length).toBe(0);

        S.history.undo();
        const saved = S.model.serialize()!;
        expect(saved.entities.length).toBe(1);
        // the restored entity still carries the unknown component:
        expect(saved.entities[0].components.some((c) => c.type === 'WaveMotion')).toBe(true);
    });

    it('delete of a parent cascades to its children (model + World); undo restores the subtree', () => {
        const childSrc = S.model.addEntity(
            'Child',
            [{ type: 'WaveMotion', data: { amplitude: 3 } }] as never,
            1,
        );
        const childRt = S.model.runtimeFor(childSrc)!;
        expect(host.world.valid(childRt)).toBe(true);

        S.commands.deleteEntity(1); // delete the PARENT (Hero) — the subtree goes
        expect(S.model.entityBySource(1)).toBeUndefined();
        expect(S.model.entityBySource(childSrc)).toBeUndefined();
        expect(host.world.valid(runtime1)).toBe(false);
        expect(host.world.valid(childRt)).toBe(false); // child despawned with its parent

        S.history.undo();
        // Model: both back, the child still parented to the restored parent.
        expect(S.model.entityBySource(1)).toBeDefined();
        expect(S.model.entityBySource(childSrc)?.parent).toBe(1);
        // World: both respawned, the child re-parented to the new parent runtime.
        const newParentRt = S.model.runtimeFor(1)!;
        const newChildRt = S.model.runtimeFor(childSrc)!;
        expect(host.world.has(newChildRt, Parent)).toBe(true);
        expect((host.world.get(newChildRt, Parent) as { entity: number }).entity).toBe(newParentRt);
    });

    it('delete of a parented entity with an unknown component → undo restores model + World + parent link', () => {
        // Add a child of Hero (source 1) carrying an unknown component.
        const childSrc = S.model.addEntity(
            'Child',
            [{ type: 'WaveMotion', data: { amplitude: 3 } }] as never,
            1,
        );
        const childRt = S.model.runtimeFor(childSrc)!;
        expect(host.world.valid(childRt)).toBe(true);
        // The World got the parent link (unknown WaveMotion stays model-only).
        expect(host.world.has(childRt, Parent)).toBe(true);
        expect((host.world.get(childRt, Parent) as { entity: number }).entity).toBe(runtime1);

        S.commands.deleteEntity(childSrc);
        expect(S.model.entityBySource(childSrc)).toBeUndefined();
        expect(host.world.valid(childRt)).toBe(false);

        S.history.undo();
        // Model: child is back, with its parent link AND its unknown component.
        const restored = S.model.entityBySource(childSrc)!;
        expect(restored.parent).toBe(1);
        expect(restored.components.some((c) => c.type === 'WaveMotion')).toBe(true);
        // World: child re-spawned and re-parented to Hero's runtime entity.
        const newChildRt = S.model.runtimeFor(childSrc)!;
        expect(host.world.has(newChildRt, Parent)).toBe(true);
        expect((host.world.get(newChildRt, Parent) as { entity: number }).entity).toBe(runtime1);
    });
});
