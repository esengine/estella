// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Regression net for the editor's read/write/undo core (SceneCommands +
 *        SceneQuery) against a real headless World. Proves the model-authoritative
 *        flow (REARCH_EDITOR_MODEL.md): commands edit the SceneModel by source id,
 *        the Reconciler projects into the World, undo replays model ops — and the
 *        World, a derived projection, reflects every step.
 *
 * Each test runs in its OWN isolated EditorSession (REARCH_EDITOR_MODEL P2) — a
 * fresh model/history/reconciler graph, no shared-singleton state to clear. The
 * engine (wasm World) is process-level: EngineHost is mocked to a per-test
 * headless World the session's reconciler projects into. Commands return SOURCE
 * ids; the World is asserted via session.model.runtimeFor.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { App, Transform, Parent, Sprite } from 'esengine';
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

import { EditorSession } from '@/engine/EditorSession';
import type { SceneData } from 'esengine';

const emptyScene = (): SceneData =>
    ({ version: '1.0', name: 'test', entities: [] }) as unknown as SceneData;

describe.skipIf(!HAS_WASM)('SceneCommands / SceneQuery (headless World)', () => {
    let module: ESEngineModule;
    let S: EditorSession;
    /** Resolve a source id to its current runtime World entity (for World asserts). */
    const rt = (sourceId: number): number => S.model.runtimeFor(sourceId)!;

    beforeAll(async () => {
        module = await loadWasmModule();
    });
    beforeEach(() => {
        const app = App.new();
        const registry = new module.Registry();
        app.connectCpp(registry as never, module);
        host.world = app.world;
        // A fresh, isolated session; its reconciler projects to the (mocked) World.
        S = EditorSession.create();
        S.model.adopt(emptyScene(), new Map());
    });

    afterEach(() => S.dispose());

    it('addEntity spawns an entity with a Transform; undo/redo round-trips', () => {
        const id = S.commands.addEntity();
        expect(id).not.toBeNull();
        expect(host.world.valid(rt(id!))).toBe(true);
        expect(host.world.has(rt(id!), Transform)).toBe(true);
        expect(host.world.getAllEntities().length).toBe(1);

        S.history.undo();
        expect(host.world.getAllEntities().length).toBe(0);

        S.history.redo();
        expect(host.world.getAllEntities().length).toBe(1);
    });

    it('setField writes a component field; undo reverts to the prior value', () => {
        const id = S.commands.addEntity()!;
        const e = rt(id);
        S.commands.setField(id, 'Transform', 'position', 'vec3', [10, 20, 30]);
        expect(host.world.get(e, Transform).position).toMatchObject({ x: 10, y: 20, z: 30 });

        S.history.undo();
        expect(host.world.get(e, Transform).position).toMatchObject({ x: 0, y: 0, z: 0 });

        S.history.redo();
        expect(host.world.get(e, Transform).position).toMatchObject({ x: 10, y: 20, z: 30 });
    });

    it('a gesture coalesces multiple setField writes into one undo step', () => {
        const id = S.commands.addEntity()!;
        const e = rt(id);
        S.commands.beginGesture('Drag');
        S.commands.setField(id, 'Transform', 'position', 'vec3', [1, 0, 0]);
        S.commands.setField(id, 'Transform', 'position', 'vec3', [2, 0, 0]);
        S.commands.setField(id, 'Transform', 'position', 'vec3', [3, 0, 0]);
        S.commands.endGesture();
        expect(host.world.get(e, Transform).position.x).toBe(3);

        S.history.undo(); // one step undoes the whole drag
        expect(host.world.get(e, Transform).position.x).toBe(0);
    });

    it('deleteEntity removes the entity; undo re-creates it', () => {
        const id = S.commands.addEntity()!;
        expect(host.world.getAllEntities().length).toBe(1);

        S.commands.deleteEntity(id);
        expect(host.world.getAllEntities().length).toBe(0);

        S.history.undo();
        expect(host.world.getAllEntities().length).toBe(1);
    });

    it('SceneQuery.readInspector lists the entity\'s editable components', () => {
        const id = S.commands.addEntity()!;
        const comps = S.query.readInspector(id);
        const transform = comps.find((c) => c.name === 'Transform');
        expect(transform).toBeDefined();
        expect(transform!.fields.some((f) => f.key === 'position')).toBe(true);
    });

    it('SceneQuery.readSceneTree returns a node per root entity', () => {
        S.commands.addEntity();
        S.commands.addEntity();
        const tree = S.query.readSceneTree();
        expect(tree.length).toBe(2);
    });

    it('setParent parents an entity (Parent component); undo un-parents it', () => {
        const parent = S.commands.addEntity()!;
        const child = S.commands.addEntity()!;
        const childRt = rt(child);
        const parentRt = rt(parent);
        S.commands.setParent(child, parent);
        expect(host.world.has(childRt, Parent)).toBe(true);
        expect((host.world.get(childRt, Parent) as { entity: number }).entity).toBe(parentRt);

        S.history.undo();
        expect(host.world.has(childRt, Parent)).toBe(false);

        S.history.redo();
        expect(host.world.has(childRt, Parent)).toBe(true);
    });

    it('setParent rejects a cycle (parenting under a descendant)', () => {
        const a = S.commands.addEntity()!;
        const b = S.commands.addEntity()!;
        const aRt = rt(a);
        const bRt = rt(b);
        S.commands.setParent(b, a); // b under a
        S.commands.setParent(a, b); // a under b would cycle — rejected
        expect(host.world.has(aRt, Parent)).toBe(false);
        expect((host.world.get(bRt, Parent) as { entity: number }).entity).toBe(aRt);
    });

    it('addComponent inserts a component (with defaults); undo/redo round-trips', () => {
        const id = S.commands.addEntity()!;
        const e = rt(id);
        expect(host.world.has(e, Sprite)).toBe(false);
        S.commands.addComponent(id, 'Sprite');
        expect(host.world.has(e, Sprite)).toBe(true);

        S.history.undo();
        expect(host.world.has(e, Sprite)).toBe(false);
        S.history.redo();
        expect(host.world.has(e, Sprite)).toBe(true);
    });

    it('removeComponent removes a component; undo restores it; Transform is protected', () => {
        const id = S.commands.addEntity()!;
        const e = rt(id);
        S.commands.addComponent(id, 'Sprite');
        S.commands.removeComponent(id, 'Sprite');
        expect(host.world.has(e, Sprite)).toBe(false);
        S.history.undo();
        expect(host.world.has(e, Sprite)).toBe(true);

        S.commands.removeComponent(id, 'Transform');
        expect(host.world.has(e, Transform)).toBe(true);
    });
});
