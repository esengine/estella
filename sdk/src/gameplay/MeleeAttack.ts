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

import { COMBAT_ATTACK_START, COMBAT_HIT, COMBAT_ATTACK_END, COMBAT_ATTACK_ACTIVE } from './vocabulary';
export { COMBAT_ATTACK_START, COMBAT_HIT, COMBAT_ATTACK_END, COMBAT_ATTACK_ACTIVE, COMBAT_COMBO_WINDOW, COMBAT_INVULNERABLE } from './vocabulary';

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
    /**
     * Seconds the whole game holds still when this swing lands, the stop that gives a blow its weight. 0 = none. It
     * holds everything, so leave it 0 in a game whose clock others share (a networked one).
     */
    hitStop?: number;
    enabled: boolean;
    /** Engine-written: the live swing, or 0 when none is running. */
    attackId: number;
    /** Engine-written: how many targets the live swing has landed on. */
    hitCount: number;
}

/**
 * A melee swing whose timing is the animation's and whose reach is the physics
 * world's. Add it beside an `Animator` whose attack clip declares an
 * `attack-active` window (a custom event with a duration) over the frames the
 * swing can land in, or the moments `attack-start`, `hit` and `attack-end`.
 *
 * @experimental
 */
export const MeleeAttack: ComponentDef<MeleeAttackData> =
    defineComponent<MeleeAttackData>('MeleeAttack', {
        radius: 60,
        damage: 25,
        layers: 0,
        anchor: 0 as Entity,
        hitStop: 0,
        enabled: true,
        attackId: 0,
        hitCount: 0,
    }, {
    // World lengths and speeds: written at 100 units a metre, scaled to the project (ecs/worldUnits.ts).
    worldUnitFields: ['radius'],
        entityFields: ['anchor'],
        readonlyFields: ['attackId', 'hitCount'],
        fields: {
            radius: { min: 0 },
            damage: { min: 0 },
            layers: { min: 0, max: 15, step: 1, advanced: true },
            anchor: { tooltip: 'The animated socket the swing reaches from.' },
            hitStop: { min: 0, max: 0.3, step: 0.01, unit: 's', tooltip: 'How long the game holds still when this swing lands; 0.04 to 0.08 gives a blow weight. 0 = none.' },
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
    /** The animator window this swing is reaching in now, or 0 for none. */
    window: number;
    /**
     * Whether `attack-start` (or a lone `hit`) opened it. Such a swing is the events' to end, on `attack-end`: a
     * window inside it is only the stretch it reaches along a path, and closing does not end the swing.
     */
    byEvent: boolean;
    /** Where its anchor was when the swing last swept, for the next sweep to start from. */
    last: { x: number; y: number; z: number } | null;
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

    /** Begin a swing, ending whatever this attacker had in the air. `window` is the animator window it is. */
    open(entity: Entity, window = 0): number {
        const id = this.nextId_++;
        this.live_.set(entity, { id, hit: new Set(), window, last: null, byEvent: window === 0 });
        return id;
    }

    /** The animator window the live swing is reaching in: 0 for none, null when no swing is live. */
    windowOf(entity: Entity): number | null {
        return this.live_.get(entity)?.window ?? null;
    }

    /** Whether the live swing is the events' to end (`attack-start` opened it), rather than a window's. */
    openedByEvent(entity: Entity): boolean {
        return this.live_.get(entity)?.byEvent ?? false;
    }

    /**
     * Let the live swing reach in `window` (0: stop reaching). A clip that says both `attack-start` and
     * `attack-active` swings once, not twice: the window is a stretch of the swing the events opened.
     */
    adopt(entity: Entity, window: number): void {
        const attack = this.live_.get(entity);
        if (!attack) return;
        attack.window = window;
        // A path is swept within one window: the next one starts from where the anchor is then.
        attack.last = null;
    }

    /** Record where the live swing's anchor is now; answers where it was at the last sweep, or null. */
    trail(entity: Entity, at: { x: number; y: number; z: number }): { x: number; y: number; z: number } | null {
        const attack = this.live_.get(entity);
        if (!attack) return null;
        const before = attack.last;
        attack.last = { x: at.x, y: at.y, z: at.z };
        return before;
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

// =============================================================================
// Active windows — a swing that reaches along its path, not at an instant
// =============================================================================

/**
 * Where a window's openings come from: `AnimatorControllerAPI` answers it, and a
 * test's map does too. The id is what tells one opening from the next.
 */
export interface MeleeWindowSource {
    openWindow(entity: Entity, name: string): { id: number } | null;
}

/** The longest stretch between two spheres of a sweep, as a fraction of their radius. */
const SWEEP_SPACING = 0.5;
/** Past this many spheres a frame, the anchor jumped (a teleport), and the spheres stay this many. */
const SWEEP_MAX_STEPS = 32;

/**
 * Sweep every swing whose `attack-active` window is open through the space its
 * anchor crossed since the last frame.
 *
 * A sphere asked only where the anchor is now misses what a fast swing passed:
 * a blade that moves farther in a frame than its own reach goes through a target
 * between two frames. So the spheres stand along the line from where the anchor
 * was to where it is, no farther apart than half their radius, which covers the
 * capsule the moving sphere swept. Runs on the pose the last animator update left,
 * with the windows that update reported, as the event path does.
 *
 * The window opening begins a swing and its closing ends it; a clip left before it
 * closes ends it too, the animator no longer reporting it. A swing lands on each
 * target once, whether it met it over one frame or several.
 *
 * @experimental
 */
export function sweepMeleeWindows(
    world: World, attacks: MeleeAttacks, queries: MeleeOverlapQuery | null,
    windows: MeleeWindowSource | null,
    damage: { send(blow: DamagePayload): void },
): void {
    if (!windows) return;
    for (const attacker of world.getEntitiesWithComponents([MeleeAttack])) {
        const attack = world.get(attacker, MeleeAttack) as MeleeAttackData;
        const down = world.has(attacker, Health) && (world.get(attacker, Health) as HealthData).current <= 0;
        const open = attack.enabled && !down ? windows.openWindow(attacker, COMBAT_ATTACK_ACTIVE) : null;
        const live = attacks.windowOf(attacker);
        if (!open) {
            // A swing a window opened ends with it; one `attack-start` opened only stops reaching, and ends on `attack-end`.
            if (live !== null && live !== 0) {
                if (attacks.openedByEvent(attacker)) attacks.adopt(attacker, 0);
                else attacks.close(attacker);
                publish(world, attacker, attacks);
            }
            continue;
        }
        if (live === null || (live !== open.id && !attacks.openedByEvent(attacker))) attacks.open(attacker, open.id);
        else if (live !== open.id) attacks.adopt(attacker, open.id);

        const anchor = anchorOf(world, attacker, attack);
        world.ensureTransformsComposed();
        const placement = world.get(anchor, Transform) as TransformData;
        const now = placement.worldPosition ?? placement.position;
        const from = attacks.trail(attacker, now) ?? now;

        const dx = now.x - from.x, dy = now.y - from.y, dz = now.z - from.z;
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const spacing = Math.max(attack.radius * SWEEP_SPACING, 1e-6);
        const steps = Math.min(SWEEP_MAX_STEPS, Math.ceil(distance / spacing));
        for (let i = steps === 0 ? 0 : 1; i <= steps; i++) {
            // The first frame of a swing has no path yet: one sphere where the anchor is.
            const t = steps === 0 ? 1 : i / steps;
            const centre = { x: from.x + dx * t, y: from.y + dy * t, z: from.z + dz * t };
            for (const found of queries?.overlapSphere(centre, attack.radius, attack.layers) ?? []) {
                if (found.entity === attacker) continue;
                if (!world.valid(found.entity) || !world.has(found.entity, Health)) continue;
                if (!attacks.record(attacker, found.entity)) continue;
                damage.send({
                    target: found.entity, source: attacker, amount: attack.damage,
                    x: found.x, y: found.y, z: found.z,
                });
            }
        }
        publish(world, attacker, attacks);
    }
}
