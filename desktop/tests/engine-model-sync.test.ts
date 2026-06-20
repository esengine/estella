/**
 * @file  JSON-first L3/L4 payoff: SceneCommands dual-write keeps the source-of-
 *        truth model in sync with the World, and the model serializes LOSSLESSLY
 *        — unknown components/fields the World drops survive an edit→save round
 *        trip (the case the old `lossy` flag refused to save).
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { App, Transform, resetWorldTo } from 'esengine';
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
        // Project the scene into the World (lossy) and adopt it as the model (lossless).
        const map = resetWorldTo(host.world, structuredClone(sceneWithUnknown()) as never);
        SceneModel.adopt(structuredClone(sceneWithUnknown()), map as Map<number, number>);
        runtime1 = map.get(1)!;
        // The World dropped the unknown component; the model kept it.
        expect(host.world.has(runtime1, Transform)).toBe(true);
    });

    it('setField edits the World AND the model, preserving the unknown component', () => {
        SceneCommands.setField(runtime1, 'Transform', 'position', 'vec3', [9, 8, 7]);

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
        SceneCommands.setField(runtime1, 'Transform', 'position', 'vec3', [9, 0, 0]);
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
        SceneCommands.deleteEntity(runtime1);
        expect(SceneModel.serialize()!.entities.length).toBe(0);

        EditorHistory.undo();
        const saved = SceneModel.serialize()!;
        expect(saved.entities.length).toBe(1);
        // the restored entity still carries the unknown component:
        expect(saved.entities[0].components.some((c) => c.type === 'WaveMotion')).toBe(true);
    });
});
