/**
 * @file  SceneModel (JSON-first L1) — proves the editor's source-of-truth model
 *        retains exactly what the live World drops on projection: unknown
 *        component types, visible:false entities, and portable @uuid: asset refs.
 *        This is the basis of lossless save (L4).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { SceneData } from 'esengine';
import { SceneModel } from '@/engine/SceneModel';

function fixture(): SceneData {
    return {
        version: '1.0',
        name: 'fixture',
        entities: [
            {
                id: 1,
                name: 'Player',
                parent: null,
                children: [],
                components: [
                    { type: 'Transform', data: { position: { x: 1, y: 2, z: 3 } } },
                    { type: 'Sprite', data: { texture: '@uuid:abc-123', extraField: 7 } },
                    { type: 'WaveMotion', data: { amplitude: 5 } }, // unknown to this engine
                ],
            },
            {
                id: 2,
                name: 'HiddenSpawner',
                parent: null,
                children: [],
                visible: false, // never spawned into the World
                components: [{ type: 'Spawner', data: { rate: 10 } }],
            },
        ],
    } as unknown as SceneData;
}

describe('SceneModel (JSON-first source of truth)', () => {
    beforeEach(() => SceneModel.clear());

    it('retains the full scene incl. unknown components + invisible entities', () => {
        const scene = fixture();
        // entity 1 spawned to runtime 100; entity 2 (visible:false) not spawned.
        SceneModel.adopt(scene, new Map([[1, 100]]));

        expect(SceneModel.current).toBe(scene);

        const player = SceneModel.sourceEntity(100);
        expect(player?.name).toBe('Player');
        // unknown component preserved (the World would have dropped it):
        expect(player?.components.some((c) => c.type === 'WaveMotion')).toBe(true);
        // schema-extra field + @uuid: ref preserved verbatim:
        const sprite = player?.components.find((c) => c.type === 'Sprite');
        expect((sprite?.data as Record<string, unknown>).extraField).toBe(7);
        expect((sprite?.data as Record<string, unknown>).texture).toBe('@uuid:abc-123');

        // invisible entity survives in the model despite having no runtime entity:
        const hidden = SceneModel.current!.entities.find((e) => e.id === 2);
        expect(hidden?.name).toBe('HiddenSpawner');
        expect(SceneModel.runtimeFor(2)).toBeUndefined();
    });

    it('maps runtime entities to/from their source ids', () => {
        SceneModel.adopt(fixture(), new Map([[1, 100]]));
        expect(SceneModel.runtimeFor(1)).toBe(100);
        expect(SceneModel.sourceFor(100)).toBe(1);
        expect(SceneModel.sourceFor(999)).toBeUndefined();
    });

    it('clear() drops the model and mappings', () => {
        SceneModel.adopt(fixture(), new Map([[1, 100]]));
        SceneModel.clear();
        expect(SceneModel.current).toBeNull();
        expect(SceneModel.sourceFor(100)).toBeUndefined();
    });
});
