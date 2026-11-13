// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    hitboxes.ts
 * @brief   A skinned character a shot can tell the parts of: a box on each bone that follows the animation, met by rays and
 *          by nothing else.
 *
 * @details A character's capsule is one shape, so a shot that meets it cannot say whether it met a head or a boot. With a
 *          `Hitboxes`, each bone long enough gets a box along it, the size the character's ragdoll would give it, on the
 *          bone's own entity: a kinematic body the world moves to wherever the animation has put the bone, and a sensor,
 *          so nothing walks into it or is pushed by it - its own character included - and a ray still meets it. What a ray
 *          meets is then the bone, and `hitPartOf` says whose and which.
 *
 *          While the character's `Ragdoll` is limp its bones are bodies of their own, which a ray meets just as well; the
 *          boxes give way to them, and come back when it stands up.
 */
import type { App } from '../app/app';
import type { Entity } from '../types';
import type { World } from '../ecs/world';
import { defineSystem, Schedule } from '../ecs/system';
import { playModeOnly } from '../ecs/env';
import { defineComponent, Name, Parent, type ComponentDef, type ParentData } from '../ecs/component';
import { log } from '../util/logger';
import { RigidBody3D, BoxCollider3D } from './Physics3DComponents';
import { Ragdoll, ragdollPlan, type RagdollData } from './ragdoll';

export interface HitboxesData {
    /** The skinned mesh whose bones get boxes; 0 finds the first one on the entity or below it. */
    skin: number;
    /** A box's thickness as a fraction of its bone's length, as a ragdoll's limbs. */
    thickness: number;
    /** A bone shorter than this gets no box (a finger, a toe); what hangs from it is its parent's. World units. */
    minBoneLength: number;
    /** The collision layer the boxes are in, so a shot can ask for them and a sight line can leave them out. */
    layer: number;
    enabled: boolean;
}

/** @experimental */
export const Hitboxes: ComponentDef<HitboxesData> = defineComponent<HitboxesData>('Hitboxes', {
    skin: 0, thickness: 0.25, minBoneLength: 5, layer: 0, enabled: true,
}, {
    entityFields: ['skin'],
    fields: {
        thickness: { min: 0.01, max: 2, tooltip: 'A box\'s thickness as a fraction of its bone\'s length.' },
        minBoneLength: { min: 0, tooltip: 'A bone shorter than this gets no box of its own, in world units.' },
        layer: { min: 0, max: 15, step: 1, tooltip: 'The collision layer the boxes are in, for a shot to ask for.' },
    },
});

/**
 * Which character a ray met and which of its bones, from the entity it met: the bone's own name, and the entity with the
 * `Hitboxes` (or `Ragdoll`) above it. Null for anything that is not a part of one.
 *
 * @experimental
 */
export function hitPartOf(world: World, entity: Entity): { character: Entity; bone: string } | null {
    if (!world.valid(entity)) return null;
    const bone = world.has(entity, Name) ? (world.get(entity, Name) as { value: string }).value : '';
    let at: Entity | undefined = entity;
    for (let guard = 0; at !== undefined && world.valid(at) && guard < 256; guard++) {
        if (at !== entity && (world.has(at, Hitboxes) || world.has(at, Ragdoll))) return { character: at, bone };
        at = world.has(at, Parent) ? (world.get(at, Parent) as ParentData).entity : undefined;
    }
    return null;
}

/** Installs the system that puts boxes on a character's bones and takes them off. Called once by the 3D physics plugin. */
export function installHitboxes(app: App): void {
    const world = app.world;
    /** The bones each character's boxes are on. */
    const boxed = new Map<Entity, Entity[]>();

    const take = (entity: Entity): void => {
        for (const bone of boxed.get(entity) ?? []) {
            if (!world.valid(bone)) continue;
            world.remove(bone, BoxCollider3D);
            world.remove(bone, RigidBody3D);
        }
        boxed.delete(entity);
    };

    const give = (entity: Entity, data: HitboxesData): void => {
        const plan = ragdollPlan(world, entity, { ...(Ragdoll._default as RagdollData), skin: data.skin, thickness: data.thickness, minBoneLength: data.minBoneLength });
        if (!plan) {
            log.warn('physics3d', `Hitboxes on entity ${entity} found no skinned mesh with joints on it or below it`);
            boxed.set(entity, []);
            return;
        }
        const bones: Entity[] = [];
        for (const { limb } of plan.limbs) {
            const bone = limb.entity as Entity;
            // A bone that is already a body (something else made it one) is left to that.
            if (world.has(bone, RigidBody3D)) continue;
            world.insert(bone, RigidBody3D, { bodyType: 1, layer: data.layer, enabled: true });
            world.insert(bone, BoxCollider3D, { halfExtents: limb.halfExtents, center: limb.center, isSensor: true, enabled: true });
            bones.push(bone);
        }
        boxed.set(entity, bones);
    };

    app.addSystemToSchedule(Schedule.Update, defineSystem([], () => {
        const live = new Set<Entity>();
        for (const entity of world.getEntitiesWithComponents([Hitboxes])) {
            live.add(entity);
            const data = world.get(entity, Hitboxes) as HitboxesData;
            const limp = world.has(entity, Ragdoll) && (world.get(entity, Ragdoll) as RagdollData).active;
            if (limp) {
                // The ragdoll has put bodies of its own on these bones, over the boxes: they are its now, and it takes them off.
                boxed.delete(entity);
                continue;
            }
            if (!data.enabled) { if (boxed.has(entity)) take(entity); continue; }
            if (!boxed.has(entity)) give(entity, data);
        }
        for (const entity of [...boxed.keys()]) if (!live.has(entity)) take(entity);
    }, { name: 'HitboxSystem' }), { runIf: playModeOnly });
}
