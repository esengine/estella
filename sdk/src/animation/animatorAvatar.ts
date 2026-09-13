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

/** A rig's own spelling for each joint a clip may name. */
export interface AnimatorAvatar {
    /**
     * The name a clip uses → the `childPath` this rig reaches that joint by. A
     * name with no entry resolves as itself, so a clip authored against this rig
     * keeps working and an avatar can translate only what differs.
     */
    joints: Record<string, string>;
}

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
    return { joints: out };
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
