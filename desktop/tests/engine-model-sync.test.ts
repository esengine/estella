/**
 * @file  Model-authoritative payoff (REARCH_EDITOR_MODEL.md): SceneCommands edit
 *        the SceneModel ONLY; the Reconciler projects the model into the World,
 *        so the World stays a faithful derived projection while the model
 *        serializes LOSSLESSLY — unknown components/fields the World drops
 *        survive an edit→save round trip, and delete→undo restores them.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { App, Transform, Parent, resetWorldTo } from 'esengine';
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

import { SceneCommands } from '@/engine/SceneCommands';
import { SceneModel } from '@/engine/SceneModel';
import { Reconciler } from '@/engine/Reconciler';
import { EditorHistory } from '@/engine/EditorHistory';

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

describe.skipIf(!HAS_WASM)('JSON-first dual-write + lossless save (L3/L4)', () => {
    let module: ESEngineModule;
    let runtime1: number;
    beforeAll(async () => {
        module = await loadWasmModule();
    });
    beforeEach(() => {
        const app = App.new();
        app.connectCpp(new module.Registry() as never, module);
        host.world = app.world;
        EditorHistory.clear();
        SceneModel.clear();
        // The Reconciler projects model → World; attach it so commands reach the
        // World (attach is idempotent across the suite, and reads the live world).
        Reconciler.attach();
        // Project the scene into the World (lossy) and adopt it as the model (lossless).
        const map = resetWorldTo(host.world, structuredClone(sceneWithUnknown()) as never);
        SceneModel.adopt(structuredClone(sceneWithUnknown()), map as Map<number, number>);
        runtime1 = map.get(1)!;
        // The World dropped the unknown component; the model kept it.
        expect(host.world.has(runtime1, Transform)).toBe(true);
    });

    afterEach(() => Reconciler.detach());

    it('setField edits the World AND the model, preserving the unknown component', () => {
        SceneCommands.setField(1, 'Transform', 'position', 'vec3', [9, 8, 7]); // by source id

        // World reflects the edit:
        expect(host.world.get(runtime1, Transform).position).toMatchObject({ x: 9, y: 8, z: 7 });

        // Model (the save truth) reflects the edit AND still has the unknown component:
        const saved = SceneModel.serialize()!;
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
        SceneCommands.setField(1, 'Transform', 'position', 'vec3', [9, 0, 0]); // by source id
        EditorHistory.undo();
        const hero = SceneModel.serialize()!.entities.find((e) => e.id === 1)!;
        const t = hero.components.find((c) => c.type === 'Transform')!.data as {
            position: { x: number };
        };
        expect(t.position.x).toBe(0);
    });

    it('addEntity / undo is reflected in the model', () => {
        const before = SceneModel.serialize()!.entities.length;
        SceneCommands.addEntity();
        expect(SceneModel.serialize()!.entities.length).toBe(before + 1);
        EditorHistory.undo();
        expect(SceneModel.serialize()!.entities.length).toBe(before);
    });

    it('delete then undo preserves the unknown component (lossless undo)', () => {
        SceneCommands.deleteEntity(1); // by source id
        expect(SceneModel.serialize()!.entities.length).toBe(0);

        EditorHistory.undo();
        const saved = SceneModel.serialize()!;
        expect(saved.entities.length).toBe(1);
        // the restored entity still carries the unknown component:
        expect(saved.entities[0].components.some((c) => c.type === 'WaveMotion')).toBe(true);
    });

    it('delete of a parented entity with an unknown component → undo restores model + World + parent link', () => {
        // Add a child of Hero (source 1) carrying an unknown component.
        const childSrc = SceneModel.addEntity(
            'Child',
            [{ type: 'WaveMotion', data: { amplitude: 3 } }] as never,
            1,
        );
        const childRt = SceneModel.runtimeFor(childSrc)!;
        expect(host.world.valid(childRt)).toBe(true);
        // The World got the parent link (unknown WaveMotion stays model-only).
        expect(host.world.has(childRt, Parent)).toBe(true);
        expect((host.world.get(childRt, Parent) as { entity: number }).entity).toBe(runtime1);

        SceneCommands.deleteEntity(childSrc);
        expect(SceneModel.entityBySource(childSrc)).toBeUndefined();
        expect(host.world.valid(childRt)).toBe(false);

        EditorHistory.undo();
        // Model: child is back, with its parent link AND its unknown component.
        const restored = SceneModel.entityBySource(childSrc)!;
        expect(restored.parent).toBe(1);
        expect(restored.components.some((c) => c.type === 'WaveMotion')).toBe(true);
        // World: child re-spawned and re-parented to Hero's runtime entity.
        const newChildRt = SceneModel.runtimeFor(childSrc)!;
        expect(host.world.has(newChildRt, Parent)).toBe(true);
        expect((host.world.get(newChildRt, Parent) as { entity: number }).entity).toBe(runtime1);
    });
});
