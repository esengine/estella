// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * The claim: an animation event, a hit and damage are three different facts, and
 * one swing lands on one target exactly once.
 */
import { describe, it, expect } from 'vitest';
import {
    Health, Damage, applyDamage, MeleeAttack, MeleeAttacks, resolveMeleeHits,
    COMBAT_ATTACK_START, COMBAT_HIT, COMBAT_ATTACK_END,
    type HealthData, type DamagePayload, type MeleeAttackData, type MeleeOverlapQuery,
} from '../src/gameplay';
import { Transform, type TransformData } from '../src/ecs/component';
import type { AnimatorEventPayload } from '../src/animation';
import type { Entity } from '../src/types';

const ATTACKER = 1 as Entity;
const ANCHOR = 2 as Entity;
const NEAR = 3 as Entity;
const FAR = 4 as Entity;
const FLOOR = 5 as Entity;

function makeWorld() {
    const store = new Map<unknown, Map<number, unknown>>();
    const mapOf = (c: unknown) => {
        let m = store.get(c);
        if (!m) { m = new Map(); store.set(c, m); }
        return m;
    };
    return {
        composed: 0,
        insert(e: number, c: unknown, d: unknown) { mapOf(c).set(e, d); },
        get(e: number, c: unknown) { return mapOf(c).get(e); },
        has(e: number, c: unknown) { return mapOf(c).has(e); },
        set(e: number, c: unknown, d: unknown) { mapOf(c).set(e, d); },
        valid() { return true; },
        ensureTransformsComposed() { this.composed++; },
        update(e: number, c: unknown, edit: (d: any) => void) {
            const d = mapOf(c).get(e);
            if (d === undefined) throw new Error('update: entity does not carry it');
            edit(d); mapOf(c).set(e, d);
        },
        getEntitiesWithComponents(comps: unknown[]) {
            const [first, ...rest] = comps;
            return [...mapOf(first).keys()].filter(e => rest.every(c => mapOf(c).has(e)));
        },
    } as any;
}

/** An entity standing at a world point, with no local of its own to confuse it. */
function place(world: any, entity: Entity, x: number, y: number, z: number): void {
    world.insert(entity, Transform, {
        position: { x, y, z },
        worldPosition: { x, y, z },
        rotation: { w: 1, x: 0, y: 0, z: 0 },
        worldRotation: { w: 1, x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        worldScale: { x: 1, y: 1, z: 1 },
    } as unknown as TransformData);
}

const health = (current = 100): HealthData => ({ current, max: 100 });

/**
 * A world with an attacker at the origin, its swing anchor 100 units out along
 * +X, a target beside the ANCHOR and another beside the ATTACKER — so a query
 * asked at the wrong place picks the wrong one.
 */
function scene(over: Partial<MeleeAttackData> = {}) {
    const world = makeWorld();
    place(world, ATTACKER, 0, 0, 0);
    place(world, ANCHOR, 100, 0, 0);
    place(world, NEAR, 110, 0, 0);
    place(world, FAR, 10, 0, 0);
    place(world, FLOOR, 100, -10, 0);
    world.insert(NEAR, Health, health());
    world.insert(FAR, Health, health());
    world.insert(ATTACKER, Health, health());
    world.insert(ATTACKER, MeleeAttack, {
        radius: 40, damage: 25, layers: 0, anchor: ANCHOR,
        enabled: true, attackId: 0, hitCount: 0, ...over,
    } as MeleeAttackData);
    return world;
}

/** A physics world that answers with whoever is inside the sphere it was asked
 *  about — including the floor and the attacker, which is what a real one does. */
function physics(world: any, population: Entity[] = [ATTACKER, NEAR, FAR, FLOOR]): MeleeOverlapQuery & { asked: { x: number; y: number; z: number }[] } {
    const asked: { x: number; y: number; z: number }[] = [];
    return {
        asked,
        overlapSphere(centre, radius) {
            asked.push({ ...centre });
            return population
                .filter((e) => {
                    const p = (world.get(e, Transform) as TransformData).worldPosition!;
                    return Math.hypot(p.x - centre.x, p.y - centre.y, p.z - centre.z) <= radius;
                })
                .map((e) => {
                    const p = (world.get(e, Transform) as TransformData).worldPosition!;
                    return { entity: e, x: p.x, y: p.y, z: p.z };
                });
        },
    };
}

const event = (name: string, entity: Entity = ATTACKER): AnimatorEventPayload =>
    ({ entity, name, value: 0, text: '' });

/** Collect the blows a run of events produced. */
function swing(world: any, attacks: MeleeAttacks, names: string[], query = physics(world)): DamagePayload[] {
    const blows: DamagePayload[] = [];
    resolveMeleeHits(world, attacks, query, names.map((n) => event(n)), { send: (b) => blows.push(b) });
    return blows;
}

const attackData = (world: any) => world.get(ATTACKER, MeleeAttack) as MeleeAttackData;

// =============================================================================
// Health: one writer
// =============================================================================

describe('a blow lands in exactly one place', () => {
    it('takes the amount off, and no lower than nothing', () => {
        const world = scene();
        applyDamage(world, [{ target: NEAR, source: ATTACKER, amount: 30, x: 0, y: 0, z: 0 }]);
        expect((world.get(NEAR, Health) as HealthData).current).toBe(70);

        applyDamage(world, [{ target: NEAR, source: ATTACKER, amount: 999, x: 0, y: 0, z: 0 }]);
        expect((world.get(NEAR, Health) as HealthData).current).toBe(0);
    });

    it('passes over anything that has no health to lose', () => {
        const world = scene();
        expect(() => applyDamage(
            world, [{ target: FLOOR, source: ATTACKER, amount: 30, x: 0, y: 0, z: 0 }],
        )).not.toThrow();
        expect(world.has(FLOOR, Health)).toBe(false);
    });

    it('leaves something already down alone', () => {
        const world = scene();
        world.insert(NEAR, Health, health(0));
        applyDamage(world, [{ target: NEAR, source: ATTACKER, amount: 30, x: 0, y: 0, z: 0 }]);
        expect((world.get(NEAR, Health) as HealthData).current).toBe(0);
    });
});

// =============================================================================
// An animation event is not a hit, and a hit is not damage
// =============================================================================

describe('where the swing is asked about', () => {
    it('is the animated anchor, not the character it belongs to', () => {
        const world = scene();
        const query = physics(world);
        const blows = swing(world, new MeleeAttacks(), [COMBAT_ATTACK_START, COMBAT_HIT], query);

        expect(query.asked).toEqual([{ x: 100, y: 0, z: 0 }]);
        // NEAR stands by the anchor, FAR by the attacker: only one is reachable.
        expect(blows.map((b) => b.target)).toEqual([NEAR]);
    });

    it('falls back to the attacker when no anchor is named', () => {
        const world = scene({ anchor: 0 as Entity });
        const query = physics(world);
        const blows = swing(world, new MeleeAttacks(), [COMBAT_HIT], query);

        expect(query.asked).toEqual([{ x: 0, y: 0, z: 0 }]);
        expect(blows.map((b) => b.target)).toEqual([FAR]);
    });

    it('makes the composition current first, since the anchor hangs off a joint', () => {
        const world = scene();
        swing(world, new MeleeAttacks(), [COMBAT_HIT]);
        expect(world.composed).toBeGreaterThan(0);
    });
});

describe('who a swing may hurt', () => {
    it('is never the one swinging it', () => {
        // The attacker is inside its own reach here, and carries Health.
        const world = scene({ anchor: 0 as Entity, radius: 200 });
        const blows = swing(world, new MeleeAttacks(), [COMBAT_HIT]);
        expect(blows.map((b) => b.target)).not.toContain(ATTACKER);
    });

    it('is never something with no health — the floor is a collider too', () => {
        const world = scene({ anchor: 0 as Entity, radius: 500 });
        const blows = swing(world, new MeleeAttacks(), [COMBAT_HIT]);
        expect(blows.map((b) => b.target).sort((a, b) => a - b)).toEqual([NEAR, FAR]);
    });

    it('is decided here, not by the physics world it asked', () => {
        // The query is told to answer with everything, wherever it is.
        const world = scene();
        const everything: MeleeOverlapQuery = {
            overlapSphere: () => [ATTACKER, NEAR, FAR, FLOOR].map((e) => ({ entity: e, x: 0, y: 0, z: 0 })),
        };
        const blows = swing(world, new MeleeAttacks(), [COMBAT_HIT], everything as never);
        expect(blows.map((b) => b.target).sort((a, b) => a - b)).toEqual([NEAR, FAR]);
    });
});

describe('one swing lands once', () => {
    it('however many times the clip says it connects', () => {
        const world = scene();
        const attacks = new MeleeAttacks();
        const blows = swing(world, attacks, [COMBAT_ATTACK_START, COMBAT_HIT, COMBAT_HIT, COMBAT_HIT]);
        expect(blows.length).toBe(1);
        expect(attackData(world).hitCount).toBe(1);
    });

    it('and the next swing may land again', () => {
        const world = scene();
        const attacks = new MeleeAttacks();
        const first = swing(world, attacks, [COMBAT_ATTACK_START, COMBAT_HIT, COMBAT_ATTACK_END]);
        const firstId = attackData(world).attackId;
        const second = swing(world, attacks, [COMBAT_ATTACK_START, COMBAT_HIT]);

        expect(first.length).toBe(1);
        expect(second.length).toBe(1);
        expect(attackData(world).attackId).not.toBe(firstId);
    });

    it('even when the clip declares no start of its own', () => {
        const world = scene();
        const attacks = new MeleeAttacks();
        expect(swing(world, attacks, [COMBAT_HIT, COMBAT_HIT]).length).toBe(1);
        expect(attackData(world).attackId).toBeGreaterThan(0);
    });

    it('and the swing is over when the clip says so', () => {
        const world = scene();
        const attacks = new MeleeAttacks();
        swing(world, attacks, [COMBAT_ATTACK_START, COMBAT_HIT, COMBAT_ATTACK_END]);
        expect(attackData(world).attackId).toBe(0);
        expect(attackData(world).hitCount).toBe(0);
    });
});

describe('what the animator says is not what combat does', () => {
    it('ignores an event from something that cannot swing', () => {
        const world = scene();
        const blows: DamagePayload[] = [];
        resolveMeleeHits(world, new MeleeAttacks(), physics(world),
                         [event(COMBAT_HIT, NEAR)], { send: (b) => blows.push(b) });
        expect(blows).toEqual([]);
    });

    it('ignores every event name it was not told to care about', () => {
        const world = scene();
        expect(swing(world, new MeleeAttacks(), ['footstep', 'windup', 'recover'])).toEqual([]);
    });

    it('does nothing at all while the attack is disabled', () => {
        const world = scene({ enabled: false });
        expect(swing(world, new MeleeAttacks(), [COMBAT_ATTACK_START, COMBAT_HIT])).toEqual([]);
    });
});

describe('what a blow carries', () => {
    it('is who dealt it, how much, and where it landed', () => {
        const world = scene();
        const [blow] = swing(world, new MeleeAttacks(), [COMBAT_HIT]);
        expect(blow).toEqual({
            target: NEAR, source: ATTACKER, amount: 25, x: 110, y: 0, z: 0,
        });
    });

    it('and the damage is the attack’s, so two attackers hit differently', () => {
        const world = scene({ damage: 7 });
        expect(swing(world, new MeleeAttacks(), [COMBAT_HIT])[0].amount).toBe(7);
    });
});

describe('the whole way through', () => {
    it('an event becomes a query becomes a blow becomes health', () => {
        const world = scene();
        const blows = swing(world, new MeleeAttacks(), [COMBAT_ATTACK_START, COMBAT_HIT]);
        expect((world.get(NEAR, Health) as HealthData).current).toBe(100);
        applyDamage(world, blows);
        expect((world.get(NEAR, Health) as HealthData).current).toBe(75);
        expect((world.get(FAR, Health) as HealthData).current).toBe(100);
    });

    it('and the Damage bus is the seam between the two halves', () => {
        // Nothing in combat writes Health: the resolve above changed nothing
        // until applyDamage ran, which is the whole of this claim.
        const world = scene();
        swing(world, new MeleeAttacks(), [COMBAT_ATTACK_START, COMBAT_HIT]);
        expect((world.get(NEAR, Health) as HealthData).current).toBe(100);
        expect(Damage).toBeDefined();
    });
});
