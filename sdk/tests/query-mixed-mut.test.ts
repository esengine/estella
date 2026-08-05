// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    query-mixed-mut.test.ts
 * @brief   One query asking for a BUILTIN component and a SCRIPT component in the
 *          same tuple, both Mut, plus a plain script component to narrow it.
 *
 *          The two are fetched by different machinery — a builtin reads through
 *          the wasm registry, a script one through per-context storage — and
 *          write-back takes a different branch for each. A game that positions
 *          entities (builtin Transform) and labels them (script Text) writes
 *          exactly this query, so "every argument arrives, and every write lands"
 *          is the claim.
 */
import { describe, it, expect } from 'vitest';
import { World } from '../src/ecs/world';
import { Query, QueryInstance, Mut } from '../src/ecs/query';
import { Transform, defineComponent, type TransformData } from '../src/ecs/component';
import { createMockModule } from './mocks/wasm';
import type { Entity } from '../src/types';

const Label = defineComponent('MixTestLabel', { text: '' });
const Piece = defineComponent('MixTestPiece', { kind: 'pawn', col: 0 });

function defaultTransform(): TransformData {
    return {
        position: { x: 0, y: 0, z: 0 },
        rotation: { w: 1, x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        worldPosition: { x: 0, y: 0, z: 0 },
        worldRotation: { w: 1, x: 0, y: 0, z: 0 },
        worldScale: { x: 1, y: 1, z: 1 },
    } as TransformData;
}

function connectedWorld(): World {
    const mod = createMockModule();
    const world = new World();
    world.connectCpp(mod.getRegistry(), mod);
    return world;
}

function seed(world: World, col: number): Entity {
    const e = world.spawn();
    world.insert(e, Transform, defaultTransform());
    world.insert(e, Label, { text: '' });
    world.insert(e, Piece, { kind: 'rook', col });
    return e;
}

describe('a query mixing a builtin and a script component', () => {
    it('hands every component of the tuple to the callback, none undefined', () => {
        const world = connectedWorld();
        const a = seed(world, 3);

        const seen: Array<[Entity, unknown, unknown, unknown]> = [];
        new QueryInstance(world, Query(Mut(Transform), Mut(Label), Piece), -1)
            .forEach((entity, transform, label, piece) => {
                seen.push([entity, transform, label, piece]);
            });

        expect(seen).toHaveLength(1);
        const [entity, transform, label, piece] = seen[0];
        expect(entity).toBe(a);
        expect(transform).toBeDefined();
        expect(label).toBeDefined();
        // The one that was reported as undefined in a real game: the narrowing
        // script component, third in a tuple whose first is builtin.
        expect(piece).toBeDefined();
        expect((piece as { col: number }).col).toBe(3);
    });

    it('writes back through both kinds in the same iteration', () => {
        const world = connectedWorld();
        const e = seed(world, 1);

        for (const [, transform, label] of new QueryInstance(world, Query(Mut(Transform), Mut(Label), Piece), -1)) {
            (transform as TransformData).position.x = 42;
            (label as { text: string }).text = 'rook';
        }

        expect(world.get(e, Transform).position.x).toBe(42);
        expect(world.get(e, Label).text).toBe('rook');
    });

    it('skips an entity missing the narrowing component rather than passing undefined', () => {
        const world = connectedWorld();
        const withPiece = seed(world, 5);
        const withoutPiece = world.spawn();
        world.insert(withoutPiece, Transform, defaultTransform());
        world.insert(withoutPiece, Label, { text: 'hud' });

        const visited: Entity[] = [];
        new QueryInstance(world, Query(Mut(Transform), Mut(Label), Piece), -1)
            .forEach((entity, _t, _l, piece) => {
                visited.push(entity);
                expect(piece).toBeDefined();
            });

        expect(visited).toEqual([withPiece]);
    });
});
