// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    animatorMask.ts
 * @brief   The part of a rig a layer is allowed to write.
 *
 * @details A mask needs no vocabulary of its own: a rig's joints ARE its entity
 *          hierarchy, and a clip already names what it animates by `childPath`.
 *          So a mask is a set of those same paths, each standing for the subtree
 *          under it — and it is resolved against the entity being animated,
 *          because the same controller drives rigs that are not the same objects.
 */

import type { Entity } from '../types';
import type { World } from '../ecs/world';
import { resolveChildEntity, collectSubtree } from '../ecs/childPath';
import type { PoseTrack } from './pose';
import type { LayerReach } from './layerStack';

/** Which subtrees of the animated entity a layer may write. */
export interface AnimatorMask {
    /**
     * Each names a subtree by `childPath`, the subtree's own root included; the
     * empty path is the whole rig. A mask with no paths admits nothing, which is
     * a layer switched off rather than a layer with no restriction — that is
     * spelled by having no mask at all.
     */
    paths: string[];
}

/**
 * One layer's resolved mask, reused across frames. Re-resolved each time rather
 * than cached against the hierarchy: a rig gains and loses entities while it
 * plays, and a mask that went stale would silently start writing a joint the
 * author excluded.
 */
export class MaskReach implements LayerReach {
    private readonly admitted_ = new Set<Entity>();

    resolve(world: Pick<World, 'tryGet'>, root: Entity, mask: AnimatorMask): void {
        this.admitted_.clear();
        for (const path of mask.paths) {
            const at = resolveChildEntity(world, root, path);
            if (at !== null) collectSubtree(world, at, this.admitted_);
        }
    }

    admits(track: PoseTrack): boolean {
        return this.admitted_.has(track.entity);
    }
}
