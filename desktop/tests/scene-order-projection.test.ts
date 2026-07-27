// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Scene order is render order, and the World is a projection of the model —
 *        so an outliner drag has to reach the live World, not just the saved file.
 *        The engine draws in the order it walks its pools, which a load establishes
 *        by spawning in `data.entities` order; `orderChanged` re-establishes it on
 *        the already-populated World (Reconciler.projectOrder → applyEntityOrder).
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { App, Sprite } from 'esengine';
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

const sprite = (id: number, parent: number | null, children: number[]) => ({
    id,
    name: `E${id}`,
    parent,
    children,
    components: [
        { type: 'Transform', data: { position: { x: 0, y: 0, z: 0 } } },
        { type: 'Sprite', data: { size: { x: 10, y: 10 } } },
    ],
});

const scene = (entities: unknown[]): SceneData =>
    ({ version: '1.0', name: 'order', entities }) as unknown as SceneData;

describe.skipIf(!HAS_WASM)('scene order → World draw order', () => {
    let module: ESEngineModule;
    let S: EditorSession;

    beforeAll(async () => {
        module = await loadWasmModule();
    });

    beforeEach(() => {
        const app = App.new();
        app.connectCpp(new module.Registry() as never, module);
        host.world = app.world;
        S = EditorSession.create();
    });

    afterEach(() => S.dispose());

    /** The World's sprite iteration order, back in SOURCE ids. */
    const worldOrder = (): number[] =>
        host.world
            .getEntitiesWithComponents([Sprite])
            .map((rt) => S.model.sourceFor(rt))
            .filter((id): id is number => id != null);

    it('a load projects scene order onto the World', () => {
        const data = scene([sprite(1, null, []), sprite(2, null, []), sprite(3, null, [])]);
        S.reconciler.adopt(data, scene([sprite(1, null, []), sprite(2, null, []), sprite(3, null, [])]));
        expect(worldOrder()).toEqual([1, 2, 3]);
    });

    it('a drag-reorder reaches the live World immediately', () => {
        S.reconciler.adopt(
            scene([sprite(1, null, []), sprite(2, null, []), sprite(3, null, [])]),
            scene([sprite(1, null, []), sprite(2, null, []), sprite(3, null, [])]),
        );

        S.commands.reorderEntity(1, 3, false); // drop E1 after E3 → E1 draws last (on top)

        expect(S.model.entityOrder()).toEqual([2, 3, 1]);
        expect(worldOrder()).toEqual([2, 3, 1]);
    });

    it('undo restores the World order too', () => {
        S.reconciler.adopt(
            scene([sprite(1, null, []), sprite(2, null, []), sprite(3, null, [])]),
            scene([sprite(1, null, []), sprite(2, null, []), sprite(3, null, [])]),
        );

        S.commands.reorderEntity(3, 1, true);
        expect(worldOrder()).toEqual([3, 1, 2]);

        S.history.undo();
        expect(worldOrder()).toEqual([1, 2, 3]);
    });

    it('a dragged parent takes its children with it in the World', () => {
        const entities = [sprite(1, null, [2]), sprite(2, 1, []), sprite(3, null, [])];
        S.reconciler.adopt(scene(entities), scene([sprite(1, null, [2]), sprite(2, 1, []), sprite(3, null, [])]));

        S.commands.reorderEntity(1, 3, false);

        expect(worldOrder()).toEqual([3, 1, 2]);
    });

    it("reorders the parent's child list too (UI draws in child order)", () => {
        // A UI subtree draws in child-list order, not pool order, so the same drag
        // has to move the child list or a Canvas child would ignore the outliner.
        const entities = () => [sprite(1, null, [2, 3, 4]), sprite(2, 1, []), sprite(3, 1, []), sprite(4, 1, [])];
        S.reconciler.adopt(scene(entities()), scene(entities()));
        const childOrder = (): number[] => {
            // The wasm Children.entities is an embind vector (snapshot, then free).
            const vec = host.world.getCppRegistry()!.getChildren(S.model.runtimeFor(1)!).entities;
            const out: number[] = [];
            for (let i = 0; i < vec.size(); i++) out.push(S.model.sourceFor(vec.get(i) as never)!);
            vec.delete();
            return out;
        };
        expect(childOrder()).toEqual([2, 3, 4]);

        S.commands.reorderEntity(4, 2, true); // drop E4 before E2 → first child, drawn behind

        expect(childOrder()).toEqual([4, 2, 3]);
    });

    it('a newly added entity draws last, ahead of nothing', () => {
        S.reconciler.adopt(scene([sprite(1, null, [])]), scene([sprite(1, null, [])]));
        const added = S.model.addEntity('New', [
            { type: 'Transform', data: {} },
            { type: 'Sprite', data: {} },
        ] as never);
        expect(worldOrder()).toEqual([1, added]);
    });
});
