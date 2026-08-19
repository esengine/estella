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
import type { Entity, Quat, Vec3 } from '../types';
import type { World } from './world';
import { Transform, Sprite, Mesh2D } from './component';
import { UINode } from '../ui/core/ui-node';
import { q } from '../math/quat';
import { worldEngineApi } from './bridge/engineApi';

/**
 * The three reads a box derivation needs — so an editor's read-only projection
 * of a World satisfies it without being handed the mutators.
 *
 * @experimental
 */
export type ReadableWorld = Pick<World, 'valid' | 'has' | 'get'>;

/**
 * An oriented box in world units: a centre, half-extents along its own three
 * axes, and the rotation that turns those axes into the world's.
 *
 * A sprite, a UI node and any other quad have `hd` zero — they are flat, and a
 * box given thickness they do not have is hit by a ray that passes in front.
 *
 * @experimental
 */
export interface EntityBox {
    cx: number;
    cy: number;
    cz: number;
    hw: number;
    hh: number;
    hd: number;
    rot: Quat;
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

/** The rotation an entity is drawn with, defaulted for a partial write. */
function worldRot(t: { worldRotation: unknown }): Quat {
    const r = t.worldRotation as Partial<Quat> | undefined;
    return { x: r?.x ?? 0, y: r?.y ?? 0, z: r?.z ?? 0, w: r?.w ?? 1 };
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
    const rot = worldRot(t);

    const iconHalf = opts?.iconHalf ?? 0;
    // An icon is a marker in space rather than a card, so it is a cube: it reads
    // and clicks the same from wherever the view has been turned to.
    let w = iconHalf * 2;
    let h = iconHalf * 2;
    let d = iconHalf * 2;
    let px = 0.5;
    let py = 0.5;
    if (world.has(entity, Sprite)) {
        const sp = world.get(entity, Sprite);
        w = sp.size.x * t.worldScale.x;
        h = sp.size.y * t.worldScale.y;
        d = 0;
        px = sp.pivot?.x ?? 0.5;
        py = sp.pivot?.y ?? 0.5;
    } else if (iconHalf === 0) {
        return null;
    }

    // The centre orbits the transform position when the pivot is off-centre —
    // the position is what rotation turns around, not the middle of the sprite.
    const offset = q.rotate(rot, { x: w * (0.5 - px), y: h * (0.5 - py), z: 0 });
    return {
        cx: t.worldPosition.x + offset.x,
        cy: t.worldPosition.y + offset.y,
        cz: (t.worldPosition.z ?? 0) + offset.z,
        hw: Math.abs(w) / 2,
        hh: Math.abs(h) / 2,
        hd: Math.abs(d) / 2,
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
    return {
        cx: t.worldPosition.x,
        cy: t.worldPosition.y,
        cz: t.worldPosition.z ?? 0,
        hw: Math.abs(w) / 2,
        hh: Math.abs(h) / 2,
        hd: 0,
        rot: worldRot(t),
    };
}

/** What the engine answers about a mesh's extent. The z pair is optional: a core
 *  without it is reporting geometry with no thickness. */
interface LocalBounds {
    minX: number; minY: number; minZ?: number;
    maxX: number; maxY: number; maxZ?: number;
}

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
    const rot = worldRot(t);
    const minZ = b.minZ ?? 0;
    const maxZ = b.maxZ ?? 0;
    const scaleZ = t.worldScale.z ?? 1;
    // The geometry's centre is its own, not the transform's: a mesh authored
    // off-origin is drawn off-origin, and its box has to follow.
    const offset = q.rotate(rot, {
        x: ((b.minX + b.maxX) / 2) * t.worldScale.x,
        y: ((b.minY + b.maxY) / 2) * t.worldScale.y,
        z: ((minZ + maxZ) / 2) * scaleZ,
    });
    return {
        cx: t.worldPosition.x + offset.x,
        cy: t.worldPosition.y + offset.y,
        cz: (t.worldPosition.z ?? 0) + offset.z,
        hw: Math.abs((b.maxX - b.minX) * t.worldScale.x) / 2,
        hh: Math.abs((b.maxY - b.minY) * t.worldScale.y) / 2,
        hd: Math.abs((maxZ - minZ) * scaleZ) / 2,
        rot,
    };
}

/**
 * The box's eight corners in world units — what an outline is drawn through and
 * what a union is taken over. A flat box reports four of them twice, which is
 * what a quad's eight corners are.
 *
 * @experimental
 */
export function entityBoxCorners(b: EntityBox): Vec3[] {
    const out: Vec3[] = [];
    for (const sz of [-1, 1]) {
        for (const sy of [-1, 1]) {
            for (const sx of [-1, 1]) {
                const r = q.rotate(b.rot, { x: sx * b.hw, y: sy * b.hh, z: sz * b.hd });
                out.push({ x: b.cx + r.x, y: b.cy + r.y, z: b.cz + r.z });
            }
        }
    }
    return out;
}

/**
 * How far along @p dir a ray from @p origin travels to meet the box, or null
 * when it misses.
 *
 * The slab test in the box's own frame. Zero half-extent is a flat box rather
 * than a degenerate one: a ray parallel to it hits only from within its plane.
 *
 * @experimental
 */
export function entityBoxRayHit(b: EntityBox, origin: Vec3, dir: Vec3): number | null {
    const inv = q.conjugate(b.rot);
    const o = q.rotate(inv, { x: origin.x - b.cx, y: origin.y - b.cy, z: origin.z - b.cz });
    const d = q.rotate(inv, dir);
    const at = [o.x, o.y, o.z];
    const along = [d.x, d.y, d.z];
    const half = [b.hw, b.hh, b.hd];

    let enter = -Infinity;
    let exit = Infinity;
    for (let i = 0; i < 3; i++) {
        if (Math.abs(along[i]!) < 1e-9) {
            if (Math.abs(at[i]!) > half[i]! + 1e-6) return null;
            continue;
        }
        const t1 = (-half[i]! - at[i]!) / along[i]!;
        const t2 = (half[i]! - at[i]!) / along[i]!;
        enter = Math.max(enter, Math.min(t1, t2));
        exit = Math.min(exit, Math.max(t1, t2));
    }
    // A screen ray starts on the near plane, so everything drawn is ahead of it;
    // a box the ray starts inside is entered at zero rather than behind.
    if (exit < enter || exit < 0) return null;
    return Math.max(enter, 0);
}
