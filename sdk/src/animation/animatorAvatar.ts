// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    animatorAvatar.ts
 * @brief   How one rig spells the joints another rig's clips name.
 *
 * @details A clip addresses what it animates by `childPath`, which is the name
 *          whoever exported the model chose. Two characters rigged by two people
 *          therefore share no clip at all, and the corpus shows the cost: an
 *          enemy has to be rigged with the names its clips already use.
 *
 *          An avatar is the translation, and it is a property of the RIG, not of
 *          the controller: one controller drives many characters, and what each
 *          of them calls its left hand is each of their own business.
 *
 *          It applies at the one place a path becomes an entity. There is no
 *          retarget stage and no rewritten clip — a clip is data several rigs can
 *          read at once, and rewriting it on load would make one copy per rig and
 *          a question about which copy a change reached.
 */

import type { Entity } from '../types';
import type { World } from '../ecs/world';
import { resolveChildEntity } from '../ecs/childPath';
import { Transform } from '../ecs/component';
import { q } from '../math/quat';
import type { Pose, PoseWorld } from './pose';
import type { QuatLike } from './quatMix';

/** A rig's own spelling for each joint a clip may name, and how it stands at rest. */
export interface AnimatorAvatar {
    /**
     * The name a clip uses → the `childPath` this rig reaches that joint by. A
     * name with no entry resolves as itself, so a clip authored against this rig
     * keeps working and an avatar can translate only what differs.
     */
    joints: Record<string, string>;
    /**
     * Each joint's rotation in the BIND pose, by the name `joints` uses. What a
     * clip states is where a joint is, and what it MEANS is the offset from where
     * that joint rests — two rigs bound differently need this to read one clip
     * the same way. Absent for a rig nothing is retargeted onto.
     */
    rest?: Record<string, Quat>;
    /**
     * Root to the joint furthest from it, at rest — the ONE measure every avatar
     * uses, since two measured differently give a ratio that means nothing. What
     * it buys is displacement: a step authored on a smaller rig slides on a
     * taller one unless it travels further.
     */
    scale?: number;
}

interface Quat { w: number; x: number; y: number; z: number }

/** Finding a joint on a rig, whichever way a clip spelled it. */
export type JointResolver = (root: Entity, path: string) => Entity | null;

/** What a `.esavatar` this build writes claims. */
export const AVATAR_FORMAT_VERSION = 1;

/**
 * Read a parsed `.esavatar`. Throws for a shape that is not one and for a
 * version this build does not know — the same upward guard a controller has, for
 * the same reason: a translation half-read animates the wrong joints in silence.
 */
export function parseAvatar(raw: unknown): AnimatorAvatar {
    if (typeof raw !== 'object' || raw === null) throw new Error('Avatar data must be an object');
    const obj = raw as Record<string, unknown>;
    const version = obj['version'];
    if (version !== undefined && (typeof version !== 'number' || !Number.isInteger(version))) {
        throw new Error('Avatar "version" must be an integer');
    }
    if ((version as number | undefined ?? AVATAR_FORMAT_VERSION) > AVATAR_FORMAT_VERSION) {
        throw new Error(
            `Avatar is version ${version}; this build reads up to ${AVATAR_FORMAT_VERSION}.`,
        );
    }
    const joints = obj['joints'];
    if (typeof joints !== 'object' || joints === null || Array.isArray(joints)) {
        throw new Error('An avatar needs a "joints" object mapping clip names to childPaths');
    }
    const out: Record<string, string> = {};
    for (const [name, path] of Object.entries(joints as Record<string, unknown>)) {
        if (typeof path !== 'string') {
            throw new Error(`Avatar joint "${name}" must map to a childPath string`);
        }
        // An entry mapping a name to itself is what having no entry already means.
        if (path && path !== name) out[name] = path;
    }
    const scale = obj['scale'];
    if (scale !== undefined && (typeof scale !== 'number' || !(scale > 0))) {
        throw new Error('Avatar "scale" must be a positive number');
    }
    const rest = obj['rest'] === undefined ? undefined : readRest(obj['rest']);
    const avatar: AnimatorAvatar = { joints: out };
    if (rest) avatar.rest = rest;
    if (scale !== undefined) avatar.scale = scale as number;
    return avatar;
}

/**
 * How far a clip authored against `source` should travel on `target`. One where
 * either rig does not state its size — a ratio against a guess would move a
 * character by an amount nobody chose.
 */
export function travelRatio(
    source: AnimatorAvatar | null, target: AnimatorAvatar | null,
): number {
    const from = source?.scale;
    const to = target?.scale;
    return from && to ? to / from : 1;
}

/** The bind pose, one rotation per joint. A joint listed without a usable
 *  rotation is refused rather than defaulted: an identity nobody meant would
 *  rebase every clip through a pose the rig is not in. */
function readRest(raw: unknown): Record<string, Quat> {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        throw new Error('Avatar "rest" must be an object of joint rotations');
    }
    const out: Record<string, Quat> = {};
    for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
        const q = value as Partial<Quat> | null;
        if (!q || ['w', 'x', 'y', 'z'].some((k) => typeof q[k as 'w'] !== 'number')) {
            throw new Error(`Avatar rest pose for "${name}" must be a quaternion`);
        }
        out[name] = { w: q.w!, x: q.x!, y: q.y!, z: q.z! };
    }
    return out;
}

/** A blank avatar, which translates nothing and resolves every path as itself. */
export function emptyAvatar(): AnimatorAvatar & { version: number } {
    return { version: AVATAR_FORMAT_VERSION, joints: {} };
}

/**
 * The resolver a rig with `avatar` uses. Null for no avatar rather than an
 * identity one, so the common case reaches {@link resolveChildEntity} with
 * nothing in between.
 */
export function avatarResolver(
    world: Pick<World, 'tryGet'>, avatar: AnimatorAvatar | null,
): JointResolver {
    if (!avatar) return (root, path) => resolveChildEntity(world, root, path);
    return (root, path) => resolveChildEntity(world, root, avatar.joints[path] ?? path);
}

/**
 * Re-state `pose` as this rig would stand it: a clip says where a joint IS and
 * MEANS the offset from its rest, so another bind pose needs
 * `targetRest · sourceRest⁻¹`. Once on the stack's answer — composing commutes
 * with a left multiplication — and before the constraints, which read positions.
 */
export function rebasePose(
    pose: Pose, root: Entity, source: AnimatorAvatar, target: AnimatorAvatar,
    resolveJoint: JointResolver, world: PoseWorld,
): void {
    const from = source.rest;
    const to = target.rest;
    if (!from || !to) return;
    for (const [joint, sourceRest] of Object.entries(from)) {
        const targetRest = to[joint];
        if (!targetRest) continue;
        const entity = resolveJoint(root, joint);
        if (entity === null) continue;
        const track = pose.track(world, entity, Transform);
        if (!track || !track.touched.has('rotation')) continue;
        const stated = track.data.rotation as QuatLike | undefined;
        if (!stated) continue;
        const offset = q.mul(q.conjugate(sourceRest), stated);
        const rebased = q.normalize(q.mul(targetRest, offset));
        track.data.rotation = { w: rebased.w, x: rebased.x, y: rebased.y, z: rebased.z };
    }
}
