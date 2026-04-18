/**
 * @file    query-filter.test.ts
 * @brief   Composable filter predicates (With/Without/And/Or/Not) on Query.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { World } from '../src/world';
import { defineComponent, defineTag } from '../src/component';
import { Query, QueryInstance, With, Without, And, Or, Not } from '../src/query';

const Position = defineComponent('F_Position', { x: 0, y: 0 });
const Health   = defineComponent('F_Health',   { hp: 100 });
const Player   = defineTag('F_Player');
const Enemy    = defineTag('F_Enemy');
const Shielded = defineTag('F_Shielded');

function runQuery<T>(world: World, query: { [Symbol.iterator]?: unknown; toArray(): T[] }): T[] {
    return query.toArray();
}

describe('Query filter composition', () => {
    let world: World;
    let p: number, e1: number, e2: number, shieldedEnemy: number, loose: number;

    beforeEach(() => {
        world = new World();
        p = world.spawn();
        world.insert(p, Position, { x: 1, y: 0 });
        world.insert(p, Health, { hp: 100 });
        world.insert(p, Player, {});

        e1 = world.spawn();
        world.insert(e1, Position, { x: 2, y: 0 });
        world.insert(e1, Health, { hp: 50 });
        world.insert(e1, Enemy, {});

        e2 = world.spawn();
        world.insert(e2, Position, { x: 3, y: 0 });
        world.insert(e2, Health, { hp: 30 });
        world.insert(e2, Enemy, {});

        shieldedEnemy = world.spawn();
        world.insert(shieldedEnemy, Position, { x: 4, y: 0 });
        world.insert(shieldedEnemy, Health, { hp: 80 });
        world.insert(shieldedEnemy, Enemy, {});
        world.insert(shieldedEnemy, Shielded, {});

        loose = world.spawn();
        world.insert(loose, Position, { x: 5, y: 0 });
    });

    it('Or(With(A), With(B)) matches entities that have at least one', () => {
        const q = new QueryInstance(
            world,
            Query(Position).filter(Or(With(Player), With(Enemy))),
        );
        const ids = q.toArray().map((r: unknown[]) => r[0]).sort();
        expect(ids).toEqual([p, e1, e2, shieldedEnemy].sort());
    });

    it('Not(With(X)) excludes entities that have X', () => {
        const q = new QueryInstance(
            world,
            Query(Position).filter(Not(With(Shielded))),
        );
        const ids = q.toArray().map((r: unknown[]) => r[0]).sort();
        expect(ids).toEqual([p, e1, e2, loose].sort());
    });

    it('And(With(A), Not(With(B))) composes', () => {
        const q = new QueryInstance(
            world,
            Query(Position).filter(And(With(Enemy), Not(With(Shielded)))),
        );
        const ids = q.toArray().map((r: unknown[]) => r[0]).sort();
        expect(ids).toEqual([e1, e2].sort());
    });

    it('Or(With(Player), And(With(Enemy), Not(With(Shielded))))', () => {
        const q = new QueryInstance(
            world,
            Query(Position).filter(
                Or(With(Player), And(With(Enemy), Not(With(Shielded)))),
            ),
        );
        const ids = q.toArray().map((r: unknown[]) => r[0]).sort();
        expect(ids).toEqual([p, e1, e2].sort());
    });

    it('Without(X) via filter tree is equivalent to .without(X)', () => {
        const tree = new QueryInstance(world, Query(Position).filter(Without(Shielded)));
        const viaTree = tree.toArray().map((r: unknown[]) => r[0]).sort();

        const flat = new QueryInstance(world, Query(Position).without(Shielded));
        const viaBuilder = flat.toArray().map((r: unknown[]) => r[0]).sort();

        expect(viaTree).toEqual(viaBuilder);
    });

    it('filter tree composes with .with() / .without() shortcuts (AND)', () => {
        // Must have Health AND (Player OR Enemy), and must NOT have Shielded.
        const q = new QueryInstance(
            world,
            Query(Position).with(Health).without(Shielded).filter(Or(With(Player), With(Enemy))),
        );
        const ids = q.toArray().map((r: unknown[]) => r[0]).sort();
        expect(ids).toEqual([p, e1, e2].sort());
    });

    it('count() honours the filter tree', () => {
        const q = new QueryInstance(
            world,
            Query(Position).filter(Or(With(Player), With(Enemy))),
        );
        expect(q.count()).toBe(4);
    });

    it('replacing .filter() uses the new tree (last-write-wins)', () => {
        const builder = Query(Position).filter(With(Player)).filter(With(Enemy));
        const q = new QueryInstance(world, builder);
        const ids = q.toArray().map((r: unknown[]) => r[0]).sort();
        expect(ids).toEqual([e1, e2, shieldedEnemy].sort());
    });
});
