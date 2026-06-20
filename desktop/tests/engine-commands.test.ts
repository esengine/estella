/**
 * @file  Regression net for the editor's read/write/undo core (SceneCommands +
 *        SceneQuery) against a real headless World. This is the safety net for
 *        the JSON-first rewrite (REARCH_SERIALIZATION.md), which re-targets these
 *        modules from the live World to the data model.
 *
 * EngineHost (the engine-boot singleton that needs a canvas + WebGL) is mocked
 * to return a per-test headless World built from the WASM SDK; the rest of the
 * editor logic (EditorHistory, EntityHandles, schema) runs for real.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { App, Transform, Parent } from 'esengine';
import type { ESEngineModule } from 'esengine';
import { loadWasmModule, HAS_WASM } from './helpers/loadWasm';

// Per-test World, injected into the mocked EngineHost. `vi.hoisted` so the
// mock factory (hoisted above imports) can close over it.
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
import { SceneQuery } from '@/engine/SceneQuery';
import { EditorHistory } from '@/engine/EditorHistory';

describe.skipIf(!HAS_WASM)('SceneCommands / SceneQuery (headless World)', () => {
    let module: ESEngineModule;
    beforeAll(async () => {
        module = await loadWasmModule();
    });
    beforeEach(() => {
        const app = App.new();
        const registry = new module.Registry();
        app.connectCpp(registry as never, module);
        host.world = app.world;
        EditorHistory.clear();
    });

    it('addEntity spawns an entity with a Transform; undo/redo round-trips', () => {
        const id = SceneCommands.addEntity();
        expect(id).not.toBeNull();
        expect(host.world.valid(id!)).toBe(true);
        expect(host.world.has(id!, Transform)).toBe(true);
        expect(host.world.getAllEntities().length).toBe(1);

        EditorHistory.undo();
        expect(host.world.getAllEntities().length).toBe(0);

        EditorHistory.redo();
        expect(host.world.getAllEntities().length).toBe(1);
    });

    it('setField writes a component field; undo reverts to the prior value', () => {
        const id = SceneCommands.addEntity()!;
        SceneCommands.setField(id, 'Transform', 'position', 'vec3', [10, 20, 30]);
        expect(host.world.get(id, Transform).position).toMatchObject({ x: 10, y: 20, z: 30 });

        EditorHistory.undo();
        expect(host.world.get(id, Transform).position).toMatchObject({ x: 0, y: 0, z: 0 });

        EditorHistory.redo();
        expect(host.world.get(id, Transform).position).toMatchObject({ x: 10, y: 20, z: 30 });
    });

    it('a gesture coalesces multiple setField writes into one undo step', () => {
        const id = SceneCommands.addEntity()!;
        SceneCommands.beginGesture('Drag');
        SceneCommands.setField(id, 'Transform', 'position', 'vec3', [1, 0, 0]);
        SceneCommands.setField(id, 'Transform', 'position', 'vec3', [2, 0, 0]);
        SceneCommands.setField(id, 'Transform', 'position', 'vec3', [3, 0, 0]);
        SceneCommands.endGesture();
        expect(host.world.get(id, Transform).position.x).toBe(3);

        EditorHistory.undo(); // one step undoes the whole drag
        expect(host.world.get(id, Transform).position.x).toBe(0);
    });

    it('deleteEntity removes the entity; undo re-creates it', () => {
        const id = SceneCommands.addEntity()!;
        expect(host.world.getAllEntities().length).toBe(1);

        SceneCommands.deleteEntity(id);
        expect(host.world.getAllEntities().length).toBe(0);

        EditorHistory.undo();
        expect(host.world.getAllEntities().length).toBe(1);
    });

    it('SceneQuery.readInspector lists the entity\'s editable components', () => {
        const id = SceneCommands.addEntity()!;
        const comps = SceneQuery.readInspector(id);
        const transform = comps.find((c) => c.name === 'Transform');
        expect(transform).toBeDefined();
        expect(transform!.fields.some((f) => f.key === 'position')).toBe(true);
    });

    it('SceneQuery.readSceneTree returns a node per root entity', () => {
        SceneCommands.addEntity();
        SceneCommands.addEntity();
        const tree = SceneQuery.readSceneTree();
        expect(tree.length).toBe(2);
    });

    it('setParent parents an entity (Parent component); undo un-parents it', () => {
        const parent = SceneCommands.addEntity()!;
        const child = SceneCommands.addEntity()!;
        SceneCommands.setParent(child, parent);
        expect(host.world.has(child, Parent)).toBe(true);
        expect((host.world.get(child, Parent) as { entity: number }).entity).toBe(parent);

        EditorHistory.undo();
        expect(host.world.has(child, Parent)).toBe(false);

        EditorHistory.redo();
        expect(host.world.has(child, Parent)).toBe(true);
    });

    it('setParent rejects a cycle (parenting under a descendant)', () => {
        const a = SceneCommands.addEntity()!;
        const b = SceneCommands.addEntity()!;
        SceneCommands.setParent(b, a); // b under a
        SceneCommands.setParent(a, b); // a under b would cycle — rejected
        expect(host.world.has(a, Parent)).toBe(false);
        expect((host.world.get(b, Parent) as { entity: number }).entity).toBe(a);
    });
});
