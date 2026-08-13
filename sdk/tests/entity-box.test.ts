// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The box an editor outlines is the box the renderer draws.
 *
 * Two derivations of it agree on a plain sprite and part company the moment a
 * pivot or a parent scale is involved — which is the case a selection outline
 * sitting beside its sprite is made of. One definition, these claims.
 */
import { describe, expect, it } from 'vitest';
import { entityWorldBox, entityBoxCorners } from '../src/ecs/entityBox';
import { Transform, Sprite } from '../src/ecs/component';
import { UINode } from '../src/ui/core/ui-node';
import type { Entity } from '../src/types';

interface Comp { name: string }

/** A world of hand-written component values — the three reads the box takes. */
function fakeWorld(rows: Record<number, Record<string, unknown>>) {
    const nameOf = (c: unknown): string => (c as Comp & { _name?: string })._name ?? (c as { name?: string }).name ?? '';
    return {
        valid: (e: Entity) => rows[e as unknown as number] !== undefined,
        has: (e: Entity, c: unknown) => rows[e as unknown as number]?.[nameOf(c)] !== undefined,
        get: (e: Entity, c: unknown) => rows[e as unknown as number]?.[nameOf(c)],
    } as never;
}

const T = (x: number, y: number, sx = 1, sy = 1, angle = 0) => ({
    worldPosition: { x, y, z: 0 },
    worldScale: { x: sx, y: sy, z: 1 },
    worldRotation: { x: 0, y: 0, z: Math.sin(angle / 2), w: Math.cos(angle / 2) },
});

const name = (c: unknown): string => (c as { _name?: string })._name ?? (c as { name: string }).name;
const ent = (n: number) => n as unknown as Entity;

describe('an entity world box', () => {
    it('is the sprite size taken through the WORLD scale', () => {
        // A parent scale reaches the drawn size, so it has to reach the box: this
        // is the case where "size alone" and "size × world scale" diverge.
        const world = fakeWorld({
            1: { [name(Transform)]: T(10, 20, 2, 3), [name(Sprite)]: { size: { x: 100, y: 50 }, pivot: { x: 0.5, y: 0.5 } } },
        });
        const box = entityWorldBox(world, ent(1));
        expect(box).toEqual({ cx: 10, cy: 20, hw: 100, hh: 75, rot: 0 });
    });

    it('puts the centre off the transform when the pivot is off-centre', () => {
        // A bottom-left pivot means the position is the sprite's CORNER; a box
        // centred on the position would sit a half-sprite down and left of it.
        const world = fakeWorld({
            1: { [name(Transform)]: T(0, 0), [name(Sprite)]: { size: { x: 100, y: 40 }, pivot: { x: 0, y: 0 } } },
        });
        const box = entityWorldBox(world, ent(1))!;
        expect(box.cx).toBeCloseTo(50);
        expect(box.cy).toBeCloseTo(20);
    });

    it('orbits that off-centre box around the position when rotated', () => {
        const world = fakeWorld({
            1: { [name(Transform)]: T(0, 0, 1, 1, Math.PI / 2), [name(Sprite)]: { size: { x: 100, y: 40 }, pivot: { x: 0, y: 0 } } },
        });
        const box = entityWorldBox(world, ent(1))!;
        // The +50,+20 offset turned a quarter-turn about the transform position.
        expect(box.cx).toBeCloseTo(-20);
        expect(box.cy).toBeCloseTo(50);
    });

    it('has no box for a UI node, which is hit-tested in its own space', () => {
        const world = fakeWorld({ 1: { [name(Transform)]: T(0, 0), [name(UINode)]: {} } });
        expect(entityWorldBox(world, ent(1))).toBeNull();
    });

    it('reports nothing for an entity that draws nothing, unless given an icon size', () => {
        const world = fakeWorld({ 1: { [name(Transform)]: T(5, 5) } });
        expect(entityWorldBox(world, ent(1))).toBeNull();
        expect(entityWorldBox(world, ent(1), { iconHalf: 24 })).toEqual({ cx: 5, cy: 5, hw: 24, hh: 24, rot: 0 });
    });

    it('has no box for an entity that is not there', () => {
        expect(entityWorldBox(fakeWorld({}), ent(9))).toBeNull();
    });

    it('walks its corners counter-clockwise from the local -x,-y', () => {
        const corners = entityBoxCorners({ cx: 0, cy: 0, hw: 2, hh: 1, rot: 0 });
        expect(corners).toEqual([
            { x: -2, y: -1 },
            { x: 2, y: -1 },
            { x: 2, y: 1 },
            { x: -2, y: 1 },
        ]);
    });
});
