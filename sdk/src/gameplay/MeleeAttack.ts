// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    MeleeAttack.ts
 * @brief   The swing: when the animation says it connects, what was in the way,
 *          and who is allowed to be hurt by it.
 *
 * @details Three facts, kept apart on purpose:
 *
 *              an animation event  ≠  a hit  ≠  damage
 *
 *          The clip says only that the swing reached its effective moment. What
 *          is in that space is the physics world's answer, and what that does to
 *          anyone is gameplay's. Collapsing any two of them is what makes a
 *          combat system that cannot be re-aimed, re-timed or re-balanced.
 *
 *          So: the animator posts `hit` and knows nothing about damage; the
 *          query is asked at the ANIMATED anchor and knows nothing about health;
 *          the filtering (self, already-hit, damageable) lives here and nowhere
 *          in the physics layer.
 */

import { defineComponent, type ComponentDef } from '../ecs/component';
import { Transform, type TransformData } from '../ecs/component';
import type { World } from '../ecs/world';
import type { Entity } from '../types';
import type { Overlap3DHit } from '../physics3d/Physics3DQueries';
import type { AnimatorEventPayload } from '../animation/animatorEvent';
import { Health, type DamagePayload, type HealthData } from './Health';

/**
 * The events a clip declares that this reads. Names rather than times: a state
 * that re-times its swing re-times the hit, and nothing else has to be told.
 */
export const COMBAT_ATTACK_START = 'attack-start';
export const COMBAT_HIT = 'hit';
export const COMBAT_ATTACK_END = 'attack-end';

/** The fields of the `MeleeAttack` component. @experimental */
export interface MeleeAttackData {
    /** Radius of the sphere a `hit` tests, in world units. */
    radius: number;
    /** What a landed blow takes off. */
    damage: number;
    /** Physics layers the swing can reach; 0 is every layer. */
    layers: number;
    /**
     * The entity whose WORLD placement the query is centred on — a socket under
     * an animated joint, so where the swing reaches is what the animation did.
     * 0 falls back to the attacker itself, which is a body slam, not a sword.
     */
    anchor: Entity;
    enabled: boolean;
    /** Engine-written: the live swing, or 0 when none is running. */
    attackId: number;
    /** Engine-written: how many targets the live swing has landed on. */
    hitCount: number;
}

/**
 * A melee swing whose timing is the animation's and whose reach is the physics
 * world's. Add it beside an `Animator` whose attack clip declares `attack-start`,
 * `hit` and `attack-end`.
 *
 * @experimental
 */
export const MeleeAttack: ComponentDef<MeleeAttackData> =
    defineComponent<MeleeAttackData>('MeleeAttack', {
        radius: 60,
        damage: 25,
        layers: 0,
        anchor: 0 as Entity,
        enabled: true,
        attackId: 0,
        hitCount: 0,
    }, {
        entityFields: ['anchor'],
        readonlyFields: ['attackId', 'hitCount'],
        fields: {
            radius: { min: 0 },
            damage: { min: 0 },
            layers: { min: 0, max: 15, step: 1, advanced: true },
            anchor: { tooltip: 'The animated socket the swing reaches from.' },
            attackId: { advanced: true },
            hitCount: { advanced: true },
        },
    });

// =============================================================================
// Attack instances — what makes one swing land once
// =============================================================================

interface LiveAttack {
    id: number;
    /** Everything this swing has already landed on. */
    hit: Set<Entity>;
}

/**
 * The swings currently in the air, one per attacker: ONE swing lands on a target
 * once, and the next one may land again. Leaning on "the event only fires once"
 * is a contract the first multi-frame hit window breaks, and breaks silently —
 * double damage reads as a balance problem, not a bug.
 */
export class MeleeAttacks {
    private readonly live_ = new Map<Entity, LiveAttack>();
    private nextId_ = 1;

    /** Begin a swing, ending whatever this attacker had in the air. */
    open(entity: Entity): number {
        const id = this.nextId_++;
        this.live_.set(entity, { id, hit: new Set() });
        return id;
    }

    close(entity: Entity): void {
        this.live_.delete(entity);
    }

    live(entity: Entity): { id: number; hits: number } | null {
        const attack = this.live_.get(entity);
        return attack ? { id: attack.id, hits: attack.hit.size } : null;
    }

    /**
     * Record `target` as hit by this attacker's live swing. False when the swing
     * already reached it, which is the whole point.
     */
    record(entity: Entity, target: Entity): boolean {
        const attack = this.live_.get(entity);
        if (!attack || attack.hit.has(target)) return false;
        attack.hit.add(target);
        return true;
    }

    /** Drop an attacker's swing (wire to world.onDespawn). */
    forget(entity: Entity): void {
        this.live_.delete(entity);
    }

    clear(): void {
        this.live_.clear();
    }
}

// =============================================================================
// Resolution
// =============================================================================

/**
 * The only thing a swing asks the physics world. Narrow on purpose: what is in
 * this space is all physics can answer, and `Physics3DQueries` satisfies it
 * without combat depending on the rest of that surface.
 */
export interface MeleeOverlapQuery {
    overlapSphere(
        centre: { x: number; y: number; z: number }, radius: number, layerMask?: number,
    ): readonly Overlap3DHit[];
}

/** Where a swing reaches from: the animated anchor, else the attacker itself. */
function anchorOf(world: World, attacker: Entity, attack: MeleeAttackData): Entity {
    const anchor = attack.anchor;
    return anchor && world.valid(anchor) && world.has(anchor, Transform) ? anchor : attacker;
}

/** Publish what the live swing is, for an inspector and for a driver to read. */
function publish(world: World, entity: Entity, attacks: MeleeAttacks): void {
    const live = attacks.live(entity);
    world.update(entity, MeleeAttack, (data: MeleeAttackData) => {
        data.attackId = live?.id ?? 0;
        data.hitCount = live?.hits ?? 0;
    });
}

/**
 * Turn the animation events an attacker posted into blows.
 *
 * Runs on LAST frame's events, before this frame's animator poses anything:
 * the joints still hold the pose that produced the event, so the swing is asked
 * about the space it was actually in.
 */
export function resolveMeleeHits(
    world: World, attacks: MeleeAttacks, queries: MeleeOverlapQuery | null,
    events: Iterable<AnimatorEventPayload>,
    damage: { send(blow: DamagePayload): void },
): void {
    for (const event of events) {
        const attacker = event.entity;
        if (!world.valid(attacker) || !world.has(attacker, MeleeAttack)) continue;
        const attack = world.get(attacker, MeleeAttack) as MeleeAttackData;
        if (!attack.enabled) continue;
        // A swing already in the air when its owner went down lands on nobody:
        // the animator keeps playing whatever it was playing, and "the attack
        // stops" cannot be left to whoever remembers to switch this off.
        if (world.has(attacker, Health)
            && (world.get(attacker, Health) as HealthData).current <= 0) continue;

        if (event.name === COMBAT_ATTACK_START) {
            attacks.open(attacker);
            publish(world, attacker, attacks);
            continue;
        }
        if (event.name === COMBAT_ATTACK_END) {
            attacks.close(attacker);
            publish(world, attacker, attacks);
            continue;
        }
        if (event.name !== COMBAT_HIT) continue;

        // A clip that says only `hit` still gets an instance, so its dedup holds;
        // the ceremony is for clips with a window, not a requirement.
        if (!attacks.live(attacker)) attacks.open(attacker);

        const anchor = anchorOf(world, attacker, attack);
        // The anchor hangs off an animated joint, so its world placement is
        // composed rather than stored. O(1) when nothing moved.
        world.ensureTransformsComposed();
        const placement = world.get(anchor, Transform) as TransformData;
        const centre = placement.worldPosition ?? placement.position;

        for (const found of queries?.overlapSphere(centre, attack.radius, attack.layers) ?? []) {
            // Gameplay's rules, none of them the physics world's to know.
            if (found.entity === attacker) continue;
            if (!world.valid(found.entity) || !world.has(found.entity, Health)) continue;
            if (!attacks.record(attacker, found.entity)) continue;
            damage.send({
                target: found.entity, source: attacker, amount: attack.damage,
                x: found.x, y: found.y, z: found.z,
            });
        }
        publish(world, attacker, attacks);
    }
}
