// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * The claim: while an `attack-active` window is open a swing reaches along the path
 * its anchor travelled, so a blade faster than its own reach per frame still meets
 * what it passed; it lands on a target once per opening, and the window shutting -
 * or the clip being left - ends it.
 */
import { describe, it, expect } from 'vitest';
import {
    Health, MeleeAttack, MeleeAttacks, sweepMeleeWindows, resolveMeleeHits,
    COMBAT_ATTACK_ACTIVE, COMBAT_ATTACK_START, COMBAT_ATTACK_END,
    type HealthData, type DamagePayload, type MeleeAttackData, type MeleeOverlapQuery, type MeleeWindowSource,
} from '../src/gameplay';
import { Transform, type TransformData } from '../src/ecs/component';
import type { Entity } from '../src/types';

const ATTACKER = 1 as Entity;
const ANCHOR = 2 as Entity;
const TARGET = 3 as Entity;
const OTHER = 4 as Entity;

function makeWorld() {
    const store = new Map<unknown, Map<number, unknown>>();
    const mapOf = (c: unknown) => {
        let m = store.get(c);
        if (!m) { m = new Map(); store.set(c, m); }
        return m;
    };
    return {
        insert(e: number, c: unknown, d: unknown) { mapOf(c).set(e, d); },
        get(e: number, c: unknown) { return mapOf(c).get(e); },
        has(e: number, c: unknown) { return mapOf(c).has(e); },
        valid() { return true; },
        ensureTransformsComposed() {},
        update(e: number, c: unknown, edit: (d: any) => void) {
            const d = mapOf(c).get(e);
            edit(d); mapOf(c).set(e, d);
        },
        getEntitiesWithComponents(comps: unknown[]) {
            const [first, ...rest] = comps;
            return [...mapOf(first).keys()].filter(e => rest.every(c => mapOf(c).has(e)));
        },
    } as any;
}

function place(world: any, entity: Entity, x: number, y = 0, z = 0): void {
    world.insert(entity, Transform, {
        position: { x, y, z }, worldPosition: { x, y, z },
        rotation: { w: 1, x: 0, y: 0, z: 0 }, worldRotation: { w: 1, x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 }, worldScale: { x: 1, y: 1, z: 1 },
    } as unknown as TransformData);
}

/** An attacker at the origin swinging an anchor of reach 40; a target at x = 0, z = 100; another at x = 300. */
function scene(over: Partial<MeleeAttackData> = {}) {
    const world = makeWorld();
    place(world, ATTACKER, 0, 0, 0);
    place(world, ANCHOR, -200, 0, 100);
    place(world, TARGET, 0, 0, 100);
    place(world, OTHER, 300, 0, 100);
    for (const e of [ATTACKER, TARGET, OTHER]) world.insert(e, Health, { current: 100, max: 100 } as HealthData);
    world.insert(ATTACKER, MeleeAttack, {
        radius: 40, damage: 25, layers: 0, anchor: ANCHOR, enabled: true, attackId: 0, hitCount: 0, ...over,
    } as MeleeAttackData);
    return world;
}

function physics(world: any): MeleeOverlapQuery & { asked: number } {
    const q = {
        asked: 0,
        overlapSphere(centre: { x: number; y: number; z: number }, radius: number) {
            q.asked++;
            return [ATTACKER, TARGET, OTHER].filter((e) => {
                const p = (world.get(e, Transform) as TransformData).worldPosition!;
                return Math.hypot(p.x - centre.x, p.y - centre.y, p.z - centre.z) <= radius;
            }).map((e) => {
                const p = (world.get(e, Transform) as TransformData).worldPosition!;
                return { entity: e, x: p.x, y: p.y, z: p.z };
            });
        },
    };
    return q;
}

/** The animator's answer, set by hand: which opening of `attack-active` is open now. */
function windows(): MeleeWindowSource & { id: number | null } {
    const w = { id: null as number | null, openWindow: (_e: Entity, name: string) => (name === COMBAT_ATTACK_ACTIVE && w.id !== null ? { id: w.id } : null) };
    return w;
}

function moveAnchor(world: any, x: number): void {
    const t = world.get(ANCHOR, Transform) as TransformData;
    world.insert(ANCHOR, Transform, { ...t, position: { ...t.position, x }, worldPosition: { ...t.worldPosition!, x } });
}

function frame(world: any, attacks: MeleeAttacks, query: MeleeOverlapQuery, open: MeleeWindowSource): DamagePayload[] {
    const blows: DamagePayload[] = [];
    sweepMeleeWindows(world, attacks, query, open, { send: (b) => blows.push(b) });
    return blows;
}

const attackOf = (world: any) => world.get(ATTACKER, MeleeAttack) as MeleeAttackData;

describe('a swing in its active window', () => {
    it('meets what the anchor passed between two frames, which a check where it ended up misses', () => {
        const world = scene(), attacks = new MeleeAttacks(), query = physics(world), open = windows();
        open.id = 7;
        expect(frame(world, attacks, query, open)).toEqual([]);     // -200: nobody near
        moveAnchor(world, 200);                                     // 400 units in one frame, reach 40
        const blows = frame(world, attacks, query, open);
        expect(blows.map((b) => b.target)).toEqual([TARGET]);
        // Where it ended up there is nobody: an instant check there would have found no one.
        expect(query.overlapSphere({ x: 200, y: 0, z: 100 }, 40)).toEqual([]);
    });

    it('lands on a target once however many frames it stays in reach', () => {
        const world = scene(), attacks = new MeleeAttacks(), query = physics(world), open = windows();
        open.id = 1;
        moveAnchor(world, 0);
        expect(frame(world, attacks, query, open)).toHaveLength(1);
        expect(frame(world, attacks, query, open)).toHaveLength(0);
        moveAnchor(world, 10);
        expect(frame(world, attacks, query, open)).toHaveLength(0);
        expect(attackOf(world).hitCount).toBe(1);
    });

    it('is a new swing when the window opens again, so the next attack of a combo lands too', () => {
        const world = scene(), attacks = new MeleeAttacks(), query = physics(world), open = windows();
        moveAnchor(world, 0);
        open.id = 1;
        expect(frame(world, attacks, query, open)).toHaveLength(1);
        const firstSwing = attackOf(world).attackId;
        open.id = 2;                                                // the next opening, no frame between
        expect(frame(world, attacks, query, open)).toHaveLength(1);
        expect(attackOf(world).attackId).not.toBe(firstSwing);
    });

    it('is over when the window shuts, and reaches nobody after', () => {
        const world = scene(), attacks = new MeleeAttacks(), query = physics(world), open = windows();
        open.id = 1;
        frame(world, attacks, query, open);
        expect(attackOf(world).attackId).not.toBe(0);
        open.id = null;                                             // shut, or the clip was left
        moveAnchor(world, 0);
        expect(frame(world, attacks, query, open)).toEqual([]);
        expect(attackOf(world).attackId).toBe(0);
    });

    it('starts a sweep from where the anchor is, not from where the last swing ended', () => {
        const world = scene(), attacks = new MeleeAttacks(), query = physics(world), open = windows();
        open.id = 1;
        moveAnchor(world, 300);                                     // the first swing ends by OTHER
        frame(world, attacks, query, open);
        open.id = null;
        frame(world, attacks, query, open);
        moveAnchor(world, -200);
        open.id = 2;                                                // the next one opens far away
        const blows = frame(world, attacks, query, open);
        expect(blows).toEqual([]);                                  // no line drawn back across TARGET
    });

    it('swings once when a clip says both attack-start and attack-active', () => {
        const world = scene(), attacks = new MeleeAttacks(), query = physics(world), open = windows();
        moveAnchor(world, 0);
        resolveMeleeHits(world, attacks, query,
            [{ entity: ATTACKER, name: COMBAT_ATTACK_START, value: 0, text: '' }], { send: () => {} });
        const swing = attackOf(world).attackId;
        open.id = 3;
        expect(frame(world, attacks, query, open)).toHaveLength(1);
        expect(attackOf(world).attackId).toBe(swing);
    });

    it('leaves a swing attack-start opened live past its window, for attack-end to end', () => {
        const world = scene(), attacks = new MeleeAttacks(), query = physics(world), open = windows();
        moveAnchor(world, 0);
        resolveMeleeHits(world, attacks, query,
            [{ entity: ATTACKER, name: COMBAT_ATTACK_START, value: 0, text: '' }], { send: () => {} });
        open.id = 3;
        expect(frame(world, attacks, query, open)).toHaveLength(1);
        const swing = attackOf(world).attackId;
        open.id = null;                                             // the active frames are over, the swing is not
        frame(world, attacks, query, open);
        expect(attackOf(world).attackId).toBe(swing);
        expect(attackOf(world).hitCount).toBe(1);
        open.id = 4;                                                // a second window inside the same swing
        expect(frame(world, attacks, query, open)).toHaveLength(0); // the target was already hit by this swing
        resolveMeleeHits(world, attacks, query,
            [{ entity: ATTACKER, name: COMBAT_ATTACK_END, value: 0, text: '' }], { send: () => {} });
        expect(attackOf(world).attackId).toBe(0);
    });

    it('reaches nobody once its attacker is down, or switched off', () => {
        const world = scene(), attacks = new MeleeAttacks(), query = physics(world), open = windows();
        moveAnchor(world, 0);
        open.id = 1;
        world.insert(ATTACKER, Health, { current: 0, max: 100 } as HealthData);
        expect(frame(world, attacks, query, open)).toEqual([]);
        world.insert(ATTACKER, Health, { current: 100, max: 100 } as HealthData);
        attackOf(world).enabled = false;
        expect(frame(world, attacks, query, open)).toEqual([]);
    });

    it('asks a bounded number of spheres however far the anchor jumped', () => {
        const world = scene(), attacks = new MeleeAttacks(), query = physics(world), open = windows();
        open.id = 1;
        frame(world, attacks, query, open);
        query.asked = 0;
        moveAnchor(world, 1e6);
        frame(world, attacks, query, open);
        expect(query.asked).toBeLessThanOrEqual(32);
    });

    it('is not the hit itself: it never touches Health, it sends a blow', () => {
        const world = scene(), attacks = new MeleeAttacks(), query = physics(world), open = windows();
        open.id = 1;
        moveAnchor(world, 0);
        frame(world, attacks, query, open);
        expect((world.get(TARGET, Health) as HealthData).current).toBe(100);
    });
});
