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
import { Transform, Parent, Sprite, MeshRenderer, ShapeRenderer, type SpriteData, type ShapeRendererData, type TransformData } from './component';
import { UINode } from '../ui/core/ui-node';
import { q } from '../math/quat';
import { v3 } from '../math/vec3';
import { worldEngineApi, type EngineApi } from './bridge/engineApi';

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
    /** Unit axes of a flat draw whose rendered basis may be sheared. Use the box helpers to honor them. */
    flatAxes?: { x: Vec3; y: Vec3 };
}

/** @experimental */
export interface EntityBoxOptions {
    /**
     * World half-size for an entity that draws nothing of its own — a camera, a
     * light, an empty. Zero (the default) reports no box for those; an editor
     * that wants them clickable passes the size of the icon it drew.
     *
     * A function when that size is not a world size: an icon drawn at a fixed
     * number of PIXELS covers a world extent that depends on where it is, and the
     * caller is handed the entity's world position to answer for it.
     */
    iconHalf?: number | ((at: Vec3) => number);
    /**
     * The drawn extent of an entity whose size is not in a component the box reads — a skeleton, a
     * tilemap: a rectangle in the entity's own units, `x`/`y` its lower-left corner from the origin.
     * Scaled and turned by the world transform like a sprite's.
     */
    extentOf?: (entity: Entity) => { x: number; y: number; width: number; height: number } | null;
}

/** The rotation an entity is drawn with, defaulted for a partial write. */
function worldRot(t: { worldRotation: unknown }): Quat {
    const r = t.worldRotation as Partial<Quat> | undefined;
    return { x: r?.x ?? 0, y: r?.y ?? 0, z: r?.z ?? 0, w: r?.w ?? 1 };
}

/** The XY-plane turn used by the flat sprite and shape render paths. */
function flatWorldRot(t: TransformData): Quat {
    const { z, w } = worldRot(t);
    const length = Math.hypot(z, w);
    return length > 0 ? { x: 0, y: 0, z: z / length, w: w / length } : { x: 0, y: 0, z: 0, w: 1 };
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
    return resolveEntityWorldBox(world, entity, opts)?.box ?? null;
}

/** @internal Resolve geometry and its draw order together, with optional renderer visibility. */
export function resolveEntityWorldBox(
    world: ReadableWorld, entity: Entity, opts?: EntityBoxOptions,
    visibility?: {
        hiddenMesh?: boolean;
        iconPickable?: (entity: Entity) => boolean;
        readTransform?: (entity: Entity) => TransformData;
        drawablesOnly?: boolean;
    },
    readSprite?: SpriteBoundsReader,
): { box: EntityBox; drawable: SpriteData | ShapeRendererData | null; sprite?: true } | null {
    if (!world.valid(entity) || !world.has(entity, Transform)) return null;
    if (world.has(entity, UINode)) return null;

    const t = visibility?.readTransform ? visibility.readTransform(entity) : world.get(entity, Transform);
    const sprite = world.has(entity, Sprite) ? world.get(entity, Sprite) : null;
    if (sprite && (!visibility || sprite.enabled !== false)) {
        const box = readSprite ? readSprite(entity, t, sprite)
            : withSpriteBounds(world, read => read(entity, t, sprite));
        if (box) return { box, drawable: sprite, sprite: true };
    }
    const shape = world.has(entity, ShapeRenderer) ? world.get(entity, ShapeRenderer) : null;
    if (visibility?.drawablesOnly) {
        return shape && shape.enabled !== false ? { box: shapeWorldBox(t, shape), drawable: shape } : null;
    }
    const hiddenRenderer = visibility && (visibility.hiddenMesh || sprite?.enabled === false || shape?.enabled === false);
    const spec = hiddenRenderer && !visibility.iconPickable?.(entity) ? 0 : opts?.iconHalf ?? 0;
    const iconSize = 2 * (typeof spec === 'function' ? spec(t.worldPosition as Vec3) : spec);
    if (shape && (!visibility || shape.enabled !== false)) {
        return { box: shapeWorldBox(t, shape, iconSize), drawable: shape };
    }
    const ext = opts?.extentOf?.(entity);
    if (ext) {
        const scaleX = t.worldScale.x, scaleY = t.worldScale.y;
        return { box: positionedBox(t, worldRot(t), Math.max(Math.abs(ext.width * scaleX), iconSize),
            Math.max(Math.abs(ext.height * scaleY), iconSize), 0,
            (ext.x + ext.width / 2) * scaleX, (ext.y + ext.height / 2) * scaleY), drawable: null };
    }
    // An icon uses a cube so it can be clicked from every view angle.
    return iconSize === 0 ? null : { box: positionedBox(t, worldRot(t), iconSize, iconSize, iconSize), drawable: null };
}

type SpriteBoundsReader = (entity: Entity, transform: TransformData, sprite: SpriteData) => EntityBox | null;

/** @internal Share one lazily allocated render-matrix buffer for a synchronous bounds traversal. */
export function withSpriteBounds<T>(world: ReadableWorld, use: (read: SpriteBoundsReader) => T): T {
    const core = world as Partial<LayoutWorld>;
    let owner: EngineApi | null = null;
    let pointer = 0;
    let matrix: Float32Array | undefined;
    const release = () => {
        if (pointer) owner?._free?.(pointer);
        pointer = 0;
        matrix = undefined;
    };
    const readMatrix = (entity: Entity): Float32Array | null | undefined => {
        if (!core.getWasmModule || !core.getCppRegistry) return undefined;
        const api = worldEngineApi(core as LayoutWorld);
        if (api !== owner) {
            release();
            owner = api;
        }
        const registry = core.getCppRegistry();
        if (!api?.transform_copyFlatRenderMatrix || !api._malloc || !api._free || !api.HEAPU8 || !registry) return undefined;
        if (!pointer) {
            pointer = api._malloc(64);
            if (!pointer) throw new Error('Could not allocate sprite transform scratch.');
        }
        if (!api.transform_copyFlatRenderMatrix(registry, entity, pointer)) return null;
        const heap = api.HEAPU8;
        const offset = heap.byteOffset + pointer;
        if (matrix?.buffer !== heap.buffer || matrix.byteOffset !== offset) matrix = new Float32Array(heap.buffer, offset, 16);
        return matrix;
    };
    try {
        return use((entity, transform, sprite) => spriteWorldBox(world, entity, transform, sprite, readMatrix));
    } finally {
        release();
    }
}

function spriteWorldBox(
    world: ReadableWorld, entity: Entity, t: TransformData, sprite: SpriteData,
    readMatrix: (entity: Entity) => Float32Array | null | undefined,
): EntityBox | null {
    const parented = world.has(entity, Parent);
    if (parented) {
        const matrix = readMatrix(entity);
        if (matrix !== undefined) return matrix && parentedSpriteBox(matrix, t, sprite);
    }
    const w = sprite.size.x * t.worldScale.x;
    const h = sprite.size.y * t.worldScale.y;
    const rot = parented ? worldRot(t) : flatWorldRot(t);
    return positionedBox(t, rot, w, h, 0, w * (0.5 - (sprite.pivot?.x ?? 0.5)), h * (0.5 - (sprite.pivot?.y ?? 0.5)));
}

function parentedSpriteBox(m: Float32Array, t: TransformData, sprite: SpriteData): EntityBox {
    const x = { x: m[0], y: m[1], z: m[2] };
    const y = { x: m[4], y: m[5], z: m[6] };
    const sx = v3.len(x), sy = v3.len(y);
    const { x: width, y: height } = sprite.size;
    const pivot = sprite.pivot;
    const offsetX = width * (0.5 - (pivot?.x ?? 0.5)), offsetY = height * (0.5 - (pivot?.y ?? 0.5));
    return { cx: m[12] + x.x * offsetX + y.x * offsetY,
        cy: m[13] + x.y * offsetX + y.y * offsetY,
        cz: m[14] + x.z * offsetX + y.z * offsetY,
        hw: Math.abs(width) * sx / 2, hh: Math.abs(height) * sy / 2, hd: 0,
        rot: worldRot(t), flatAxes: { x: v3.scale(x, 1 / sx), y: v3.scale(y, 1 / sy) } };
}

/** @internal Bounds of an individual shape draw, with an optional minimum size for picking. */
export function shapeWorldBox(t: TransformData, shape: ShapeRendererData, minSize = 0): EntityBox {
    return positionedBox(t, flatWorldRot(t), Math.max(Math.abs(shape.size.x * t.worldScale.x), minSize),
        Math.max(Math.abs(shape.size.y * t.worldScale.y), minSize), 0);
}

function positionedBox(t: TransformData, rot: Quat, w: number, h: number, d: number, centerX = 0, centerY = 0): EntityBox {
    // The centre orbits the transform position when the pivot is off-centre —
    // the position is what rotation turns around, not the middle of the sprite.
    const offset = q.rotate(rot, { x: centerX, y: centerY, z: 0 });
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
 * The world box of a MeshRenderer's geometry — {@link entityWorldBox} for a mesh,
 * whose extent is in its vertices rather than in a size field. The engine
 * answers: only it knows whether the live geometry is the resident one or the
 * inline payload. Null for anything else, and for a mesh that draws nothing.
 *
 * @experimental
 */
export function meshWorldBox(world: LayoutWorld, entity: Entity): EntityBox | null {
    return resolveMeshWorldBox(world, entity);
}

/** @internal Picking can supply a borrowed transform reader for a single traversal. */
export function resolveMeshWorldBox(
    world: LayoutWorld, entity: Entity, readTransform?: (entity: Entity) => TransformData,
): EntityBox | null {
    if (!world.valid(entity) || !world.has(entity, MeshRenderer) || !world.has(entity, Transform)) return null;
    if (world.has(entity, UINode)) return null;
    // The wasm module, not the shared engine api: this answer is a small object,
    // which is a shape only that binding surface carries.
    const module = world.getWasmModule() as {
        meshRenderer_localBounds?(registry: unknown, entity: number): LocalBounds | null;
    } | null;
    const registry = world.getCppRegistry();
    if (!registry || !module?.meshRenderer_localBounds) return null;
    const b = module.meshRenderer_localBounds(registry, entity);
    if (!b) return null;

    const t = readTransform ? readTransform(entity) : world.get(entity, Transform);
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
    const count = b.hd === 0 ? 4 : 8;
    for (let i = 0; i < count; i++) {
        const x = i & 1 ? b.hw : -b.hw, y = i & 2 ? b.hh : -b.hh;
        const r = b.flatAxes ? v3.add(v3.scale(b.flatAxes.x, x), v3.scale(b.flatAxes.y, y)) : q.rotate(b.rot, {
            x, y,
            z: i & 4 ? b.hd : -b.hd,
        });
        out.push({ x: b.cx + r.x, y: b.cy + r.y, z: b.cz + r.z });
    }
    // Keep both faces in the corner order, with independently mutable points.
    if (count === 4) {
        for (let i = 0; i < count; i++) out.push({ ...out[i] });
    }
    return out;
}

/** Axis-aligned limits in world units. @experimental */
export interface EntityBoxBounds {
    minX: number;
    minY: number;
    minZ: number;
    maxX: number;
    maxY: number;
    maxZ: number;
}

/** Expand an existing bound in place, or start one from a single oriented box. @experimental */
export function extendEntityBoxBounds(bounds: EntityBoxBounds | null, box: EntityBox): EntityBoxBounds {
    // Each rotated half-axis contributes its absolute length along each world axis.
    const right = box.flatAxes ? v3.scale(box.flatAxes.x, box.hw) : q.rotate(box.rot, { x: box.hw, y: 0, z: 0 });
    const up = box.flatAxes ? v3.scale(box.flatAxes.y, box.hh) : q.rotate(box.rot, { x: 0, y: box.hh, z: 0 });
    const forward = q.rotate(box.rot, { x: 0, y: 0, z: box.hd });
    const x = Math.abs(right.x) + Math.abs(up.x) + Math.abs(forward.x);
    const y = Math.abs(right.y) + Math.abs(up.y) + Math.abs(forward.y);
    const z = Math.abs(right.z) + Math.abs(up.z) + Math.abs(forward.z);
    const minX = box.cx - x, minY = box.cy - y, minZ = box.cz - z;
    const maxX = box.cx + x, maxY = box.cy + y, maxZ = box.cz + z;
    if (!bounds) return { minX, minY, minZ, maxX, maxY, maxZ };
    bounds.minX = Math.min(bounds.minX, minX);
    bounds.minY = Math.min(bounds.minY, minY);
    bounds.minZ = Math.min(bounds.minZ, minZ);
    bounds.maxX = Math.max(bounds.maxX, maxX);
    bounds.maxY = Math.max(bounds.maxY, maxY);
    bounds.maxZ = Math.max(bounds.maxZ, maxZ);
    return bounds;
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
    let o = { x: origin.x - b.cx, y: origin.y - b.cy, z: origin.z - b.cz };
    let d = dir;
    const { x, y, z, w } = b.rot;
    // An unrotated box already shares the world's axes, including the -q
    // identity a quaternion interpolation can produce.
    if (b.flatAxes) {
        const { x, y } = b.flatAxes;
        // A sheared basis needs its reciprocal axes, since a rotation inverse
        // cannot map the drawn parallelogram back to its local rectangle.
        const normal = v3.cross(x, y);
        const normalSquared = v3.dot(normal, normal);
        if (!(normalSquared > 0)) return null;
        const dualX = v3.cross(y, normal), dualY = v3.cross(normal, x);
        const normalLength = Math.sqrt(normalSquared);
        const toLocal = (v: Vec3) => ({
            x: v3.dot(v, dualX) / normalSquared, y: v3.dot(v, dualY) / normalSquared,
            z: v3.dot(v, normal) / normalLength,
        });
        o = toLocal(o);
        d = toLocal(dir);
    } else if (x !== 0 || y !== 0 || z !== 0 || Math.abs(w) !== 1) {
        const inv = q.conjugate(b.rot);
        o = q.rotate(inv, o);
        d = q.rotate(inv, dir);
    }
    const at = [o.x, o.y, o.z];
    const along = [d.x, d.y, d.z];
    const half = [b.hw, b.hh, b.hd];

    // The ray only extends forward. Each slab can shrink the interval, so an
    // empty interval cannot be recovered by the remaining axes.
    let enter = 0;
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
        if (exit < enter) return null;
    }
    return enter;
}
