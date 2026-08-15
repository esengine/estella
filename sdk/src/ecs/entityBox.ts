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
import { Transform, Sprite, Mesh2D } from './component';
import { UINode } from '../ui/core/ui-node';
import { quaternionToAngle2D } from '../ui/util/math';
import { worldEngineApi } from './bridge/engineApi';

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
 * What a UI box derivation needs on top of the reads: a laid-out size lives in
 * the engine core, not in a component.
 *
 * @experimental
 */
export type LayoutWorld = ReadableWorld & Pick<World, 'getCppRegistry' | 'getWasmModule'>;

/**
 * The world box of a UI node's resolved layout — {@link entityWorldBox} for the
 * space UI lives in. Null for anything that is not a laid-out UI node.
 *
 * @experimental
 */
export function uiNodeWorldBox(world: LayoutWorld, entity: Entity): EntityBox | null {
    if (!world.valid(entity) || !world.has(entity, UINode) || !world.has(entity, Transform)) return null;
    const engine = worldEngineApi(world);
    const registry = world.getCppRegistry();
    if (!registry || !engine?.uiNode_computedWidth || !engine.uiNode_computedHeight) return null;

    const t = world.get(entity, Transform);
    const w = engine.uiNode_computedWidth(registry, entity) * t.worldScale.x;
    const h = engine.uiNode_computedHeight(registry, entity) * t.worldScale.y;
    if (!(w > 0) || !(h > 0)) return null;
    const r = t.worldRotation as { z: number; w: number };
    return {
        cx: t.worldPosition.x,
        cy: t.worldPosition.y,
        hw: Math.abs(w) / 2,
        hh: Math.abs(h) / 2,
        rot: quaternionToAngle2D(r.z, r.w),
    };
}

interface LocalBounds { minX: number; minY: number; maxX: number; maxY: number }

/**
 * The world box of a Mesh2D's geometry — {@link entityWorldBox} for a mesh,
 * whose extent is in its vertices rather than in a size field. The engine
 * answers: only it knows whether the live geometry is the resident one or the
 * inline payload. Null for anything else, and for a mesh that draws nothing.
 *
 * @experimental
 */
export function meshWorldBox(world: LayoutWorld, entity: Entity): EntityBox | null {
    if (!world.valid(entity) || !world.has(entity, Mesh2D) || !world.has(entity, Transform)) return null;
    if (world.has(entity, UINode)) return null;
    // The wasm module, not the shared engine api: this answer is a small object,
    // which is a shape only that binding surface carries.
    const module = world.getWasmModule() as {
        mesh2d_localBounds?(registry: unknown, entity: number): LocalBounds | null;
    } | null;
    const registry = world.getCppRegistry();
    if (!registry || !module?.mesh2d_localBounds) return null;
    const b = module.mesh2d_localBounds(registry, entity);
    if (!b) return null;

    const t = world.get(entity, Transform);
    const rot = quaternionToAngle2D((t.worldRotation as { z: number }).z,
                                    (t.worldRotation as { w: number }).w);
    // The geometry's centre is its own, not the transform's: a mesh authored
    // off-origin is drawn off-origin, and its box has to follow.
    const ox = (b.minX + b.maxX) / 2 * t.worldScale.x;
    const oy = (b.minY + b.maxY) / 2 * t.worldScale.y;
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    return {
        cx: t.worldPosition.x + ox * c - oy * s,
        cy: t.worldPosition.y + ox * s + oy * c,
        hw: Math.abs((b.maxX - b.minX) * t.worldScale.x) / 2,
        hh: Math.abs((b.maxY - b.minY) * t.worldScale.y) / 2,
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
