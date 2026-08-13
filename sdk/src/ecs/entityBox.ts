// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    entityBox.ts
 * @brief   How much room an entity takes up in the world, and where.
 *
 * The box an editor outlines, hit-tests and drags is the box the renderer
 * draws, so both have to be derived from one description of it. Two of them
 * agree until a pivot or a parent scale is involved, and then a selection
 * outline sits beside the sprite it claims to be around.
 */
import type { Entity } from '../types';
import type { World } from './world';
import { Transform, Sprite } from './component';
import { UINode } from '../ui/core/ui-node';
import { quaternionToAngle2D } from '../ui/util/math';

/**
 * The three reads a box derivation needs — so an editor's read-only projection
 * of a World satisfies it without being handed the mutators.
 *
 * @experimental
 */
export type ReadableWorld = Pick<World, 'valid' | 'has' | 'get'>;

/**
 * An oriented box in world units: centre, half-extents, and rotation in radians.
 *
 * @experimental
 */
export interface EntityBox {
    cx: number;
    cy: number;
    hw: number;
    hh: number;
    rot: number;
}

/** @experimental */
export interface EntityBoxOptions {
    /**
     * World half-size for an entity that draws nothing of its own — a camera, a
     * light, an empty. Zero (the default) reports no box for those; an editor
     * that wants them clickable passes the size of the icon it drew.
     */
    iconHalf?: number;
}

/**
 * The world box of `entity`, or null when it has none.
 *
 * Size scaled by the WORLD scale, centred by the pivot, turned by the world
 * rotation — the three fields the renderer composes. UI nodes get null: they
 * live in the layout's own screen space and are hit-tested there.
 *
 * @experimental
 */
export function entityWorldBox(world: ReadableWorld, entity: Entity, opts?: EntityBoxOptions): EntityBox | null {
    if (!world.valid(entity) || !world.has(entity, Transform)) return null;
    if (world.has(entity, UINode)) return null;

    const t = world.get(entity, Transform);
    const r = t.worldRotation as { z: number; w: number };
    const rot = quaternionToAngle2D(r.z, r.w);

    const iconHalf = opts?.iconHalf ?? 0;
    let w = iconHalf * 2;
    let h = iconHalf * 2;
    let px = 0.5;
    let py = 0.5;
    if (world.has(entity, Sprite)) {
        const sp = world.get(entity, Sprite);
        w = sp.size.x * t.worldScale.x;
        h = sp.size.y * t.worldScale.y;
        px = sp.pivot?.x ?? 0.5;
        py = sp.pivot?.y ?? 0.5;
    } else if (iconHalf === 0) {
        return null;
    }

    // The centre orbits the transform position when the pivot is off-centre —
    // the position is what rotation turns around, not the middle of the sprite.
    const ox = w * (0.5 - px);
    const oy = h * (0.5 - py);
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    return {
        cx: t.worldPosition.x + ox * c - oy * s,
        cy: t.worldPosition.y + ox * s + oy * c,
        hw: Math.abs(w) / 2,
        hh: Math.abs(h) / 2,
        rot,
    };
}

/**
 * The box's four corners in world units, counter-clockwise from its local
 * -x,-y — what an outline is drawn through.
 *
 * @experimental
 */
export function entityBoxCorners(b: EntityBox): Array<{ x: number; y: number }> {
    const c = Math.cos(b.rot);
    const s = Math.sin(b.rot);
    return ([[-b.hw, -b.hh], [b.hw, -b.hh], [b.hw, b.hh], [-b.hw, b.hh]] as const).map(([lx, ly]) => ({
        x: b.cx + lx * c - ly * s,
        y: b.cy + lx * s + ly * c,
    }));
}
