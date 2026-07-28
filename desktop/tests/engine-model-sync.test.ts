// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
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
import { App, Transform, Parent, Sprite, Canvas } from 'esengine';
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
import { inspectorFields, readonlyFieldsFor } from '@/engine/schema';

describe('readonly field metadata (C++ ES_PROPERTY(readonly) → COMPONENT_META)', () => {
    it("exposes Transform's engine-computed world fields as readonly", () => {
        expect([...readonlyFieldsFor('Transform')]).toEqual(['worldPosition', 'worldRotation', 'worldScale']);
    });
    it('reports no readonly fields for components that have none', () => {
        expect(readonlyFieldsFor('Sprite')).toEqual([]);
        expect(readonlyFieldsFor('NotAComponent')).toEqual([]);
    });
});

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

    it('a slice edit to a field the scene OMITS still writes a whole value', () => {
        // Scene data stores only what was authored, so a field sitting at its default
        // simply is not there — a UINode's Transform.position never is, because the
        // layout pass owns it. Merging the edited axis onto the raw stored data wrote
        // `{ x }` with no y/z: the World rejected it ("Missing field: y") and the
        // inspector, unable to recognize the shape, dropped the row out of the panel.
        const id = S.model.addEntity('Widget', [{ type: 'Transform', data: {} }] as never);
        S.commands.setField(id, 'Transform', 'position', 'vec3', [50, NaN, NaN]);

        const data = S.model.entityBySource(id)!.components.find((c) => c.type === 'Transform')!
            .data as Record<string, unknown>;
        expect(data.position).toEqual({ x: 50, y: 0, z: 0 });
        expect(inspectorFields('Transform', data).some((f) => f.key === 'position')).toBe(true);
    });

    it('a Transform edit preserves the engine-computed world fields (never clobbers them to the origin)', () => {
        // worldPosition/worldRotation/worldScale are ES_PROPERTY(readonly) — engine
        // outputs composed each frame, not authoring inputs. Seed a sentinel world
        // transform (standing in for that composition), then edit a LOCAL field: the
        // reconciler must re-use the live readonly values, not reset them to the model's
        // zero default. That reset was the bug — a moving entity's gizmo snapped to 0,0.
        host.world.set(runtime1, Transform, {
            position: { x: 1, y: 2, z: 0 },
            rotation: { w: 1, x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
            worldPosition: { x: 7, y: 8, z: 9 },
            worldRotation: { w: 1, x: 0, y: 0, z: 0 },
            worldScale: { x: 3, y: 3, z: 3 },
        } as never);

        S.commands.setField(1, 'Transform', 'position', 'vec3', [9, 8, 7]); // by source id

        const t = host.world.get(runtime1, Transform) as {
            position: { x: number };
            worldPosition: { x: number; y: number; z: number };
            worldScale: { x: number };
        };
        expect(t.position.x).toBe(9); // the local edit applied
        expect(t.worldPosition).toMatchObject({ x: 7, y: 8, z: 9 }); // preserved, NOT zeroed
        expect(t.worldScale.x).toBe(3);
    });

    it('attachUINodeBox adds a sized UINode + reparents under the Canvas as one undo step', () => {
        const canvas = S.model.addEntity('Canvas', [{ type: 'Transform', data: {} }, { type: 'Canvas', data: {} }] as never);
        const text = S.model.addEntity('Label', [{ type: 'Transform', data: {} }, { type: 'Text', data: { content: 'Hi' } }] as never);

        S.commands.attachUINodeBox(text, canvas, 240, 80);
        const e = S.model.entityBySource(text)!;
        expect(e.parent).toBe(canvas);
        const ui = e.components.find((c) => c.type === 'UINode')!.data as { width: { value: number; unit: number } };
        expect(ui.width).toMatchObject({ value: 240, unit: 0 });

        S.history.undo(); // a single step reverts BOTH the UINode add and the reparent
        const u = S.model.entityBySource(text)!;
        expect(u.components.some((c) => c.type === 'UINode')).toBe(false);
        expect(u.parent ?? null).toBeNull();
    });

    it('setField writes a Canvas designResolution to the model AND the World (the viewport Design control path)', () => {
        const canvas = S.model.addEntity('Canvas', [{ type: 'Transform', data: {} }, { type: 'Canvas', data: {} }] as never);
        S.commands.setField(canvas, 'Canvas', 'designResolution', 'vec2', [1080, 1920]);

        const d = S.model.entityBySource(canvas)!.components.find((c) => c.type === 'Canvas')!.data as {
            designResolution: { x: number; y: number };
        };
        expect(d.designResolution).toMatchObject({ x: 1080, y: 1920 });

        const cw = host.world.get(S.model.runtimeFor(canvas)!, Canvas) as { designResolution: { x: number; y: number } };
        expect(cw.designResolution).toMatchObject({ x: 1080, y: 1920 });
    });

    it('attachUINodeBox is a no-op when the Text already has a UINode', () => {
        const canvas = S.model.addEntity('Canvas', [{ type: 'Transform', data: {} }, { type: 'Canvas', data: {} }] as never);
        const text = S.model.addEntity('Label', [{ type: 'Transform', data: {} }, { type: 'UINode', data: {} }, { type: 'Text', data: {} }] as never);

        S.commands.attachUINodeBox(text, canvas, 240, 80);
        expect(S.model.entityBySource(text)!.parent ?? null).toBeNull(); // left where it was
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

    it('undo of an edit to a field the Transform omitted restores the default (no wasm crash, field stays in the inspector)', () => {
        // A Transform that omits rotation (defaults to identity); editing it records
        // before=undefined, which used to crash wasm + drop rotation from the inspector.
        const src = S.model.addEntity('Partial', [{ type: 'Transform', data: { position: { x: 1, y: 2, z: 0 } } }] as never);
        const rt = S.model.runtimeFor(src)!;
        S.commands.setField(src, 'Transform', 'rotation', 'angle', 45);

        expect(() => S.history.undo()).not.toThrow();
        expect((host.world.get(rt, Transform).rotation as { w: number }).w).toBe(1);

        const tData = S.model.entityBySource(src)!.components.find((c) => c.type === 'Transform')!.data as Record<string, unknown>;
        expect('rotation' in tData).toBe(false); // absent, not present-and-undefined
        expect(inspectorFields('Transform', tData).some((f) => f.key === 'rotation')).toBe(true);
    });

    it('visibility toggle re-resolves plain-path asset refs (no white-block)', () => {
        const raw = (): SceneData => ({
            version: '1.0',
            name: 'fx',
            entities: [
                {
                    id: 7,
                    name: 'FX',
                    parent: null,
                    children: [],
                    components: [
                        { type: 'Transform', data: { position: { x: 0, y: 0, z: 0 } } },
                        { type: 'Sprite', data: { texture: 'assets/t.png', material: 'assets/m.esmaterial' } },
                    ],
                },
            ],
        }) as unknown as SceneData;
        const resolved = raw();
        (resolved.entities[0].components[1].data as Record<string, unknown>).texture = 42;
        (resolved.entities[0].components[1].data as Record<string, unknown>).material = 9;
        S.reconciler.setAssetResolver((ref) => (ref === 'assets/t.png' ? 42 : ref === 'assets/m.esmaterial' ? 9 : 0));
        S.reconciler.adopt(raw(), resolved);
        const rt = S.model.runtimeFor(7)!;

        S.commands.setEntityVisible(7, false);
        S.commands.setEntityVisible(7, true);

        const sprite = host.world.get(rt, Sprite) as { texture: number; material: number; enabled: boolean };
        expect(sprite.texture).toBe(42);
        expect(sprite.material).toBe(9);
        expect(sprite.enabled).toBe(true);
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
