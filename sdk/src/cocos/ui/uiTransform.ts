// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    cocos/ui/uiTransform.ts
 * @brief   `UITransform`: a node's content size and anchor point, as a view on the engine's `ContentRect`.
 *
 * In Cocos the rectangle belongs to the node and the renderers draw into it; the engine's `ContentRect` is the same idea (a size and
 * the pivot the transform sits on), and the `Sprite`, `Text` and clip mask on the entity follow it. So `UITransform` has no
 * storage and no copying of its own: it reads and writes `ContentRect`, and the rectangle's consumers are the engine's.
 *
 * Importing a scene writes a `ContentRect` for every node that had a `UITransform`; a node that never had one gets it when a
 * script first asks, filled in from the renderer it has.
 */
import { Sprite, Transform } from '../../ecs/component';
import { ContentRect, applyContentRect, contentRectContains, type ContentRectData } from '../../ui/core/content-rect';
import { Text } from '../../ui/core/text';
import type { World } from '../../ecs/world';
import type { Entity } from '../../types';
import { Rect, Size, Vec2, Vec3 } from '../math';
import { Component } from '../component';
import { registerBuiltinComponent } from '../builtins';
import { viewAdapter } from './view';

/** The rectangle a node's renderers say it has, for a node that was never given one. */
function derive(world: World, entity: Entity): ContentRectData {
    const sprite = world.has(entity, Sprite) ? world.get(entity, Sprite) : null;
    if (sprite) return { size: { x: sprite.size.x, y: sprite.size.y }, pivot: { x: sprite.pivot.x, y: sprite.pivot.y } };
    const text = world.has(entity, Text) ? world.get(entity, Text) : null;
    const w = text?.boxWidth ?? 0, h = text?.boxHeight ?? 0;
    if (text && (w > 0 || h > 0)) {
        const pivot = text.boxPivot ?? { x: 0.5, y: 0.5 };
        return { size: { x: w, y: h }, pivot: { x: pivot.x, y: pivot.y } };
    }
    return { size: { x: 100, y: 100 }, pivot: { x: 0.5, y: 0.5 } };
}

/** The rectangle of a node, made if it has none. */
export function ensureUITransform(world: World, entity: Entity): ContentRectData {
    if (!world.has(entity, ContentRect)) world.insert(entity, ContentRect, derive(world, entity));
    return world.get(entity, ContentRect);
}

export class UITransform extends Component {
    private rect_(): ContentRectData { return ensureUITransform(this._world, this._entity); }
    /** Write the rectangle, and let the sprite and text on the node follow it now rather than at the end of the frame. */
    private write_(size: { x: number; y: number }, pivot: { x: number; y: number }): void {
        this._world.set(this._entity, ContentRect, { size, pivot });
        applyContentRect(this._world, this._entity);
    }

    get contentSize(): Size { const r = this.rect_(); return new Size(r.size.x, r.size.y); }
    set contentSize(v: Size) { this.write_({ x: v.width, y: v.height }, this.rect_().pivot); }
    setContentSize(w: number | Size, h?: number): void {
        if (typeof w === 'object') this.contentSize = w; else this.write_({ x: w, y: h ?? this.rect_().size.y }, this.rect_().pivot);
    }

    get width(): number { return this.rect_().size.x; }
    set width(v: number) { const r = this.rect_(); this.write_({ x: v, y: r.size.y }, r.pivot); }
    get height(): number { return this.rect_().size.y; }
    set height(v: number) { const r = this.rect_(); this.write_({ x: r.size.x, y: v }, r.pivot); }

    get anchorPoint(): Vec2 { const r = this.rect_(); return new Vec2(r.pivot.x, r.pivot.y); }
    set anchorPoint(v: Vec2) { this.write_(this.rect_().size, { x: v.x, y: v.y }); }
    setAnchorPoint(x: number | Vec2, y?: number): void {
        if (typeof x === 'object') this.anchorPoint = x; else this.write_(this.rect_().size, { x, y: y ?? this.rect_().pivot.y });
    }
    get anchorX(): number { return this.rect_().pivot.x; }
    set anchorX(v: number) { const r = this.rect_(); this.write_(r.size, { x: v, y: r.pivot.y }); }
    get anchorY(): number { return this.rect_().pivot.y; }
    set anchorY(v: number) { const r = this.rect_(); this.write_(r.size, { x: r.pivot.x, y: v }); }

    /** The rectangle in the node's own space: its left/bottom corner is minus the anchor times the size. */
    private local_(): Rect {
        const r = this.rect_();
        return new Rect(-r.pivot.x * r.size.x, -r.pivot.y * r.size.y, r.size.x, r.size.y);
    }

    /** A point in the node's space (relative to its anchor) as a point in world space, scale and rotation applied. */
    convertToWorldSpaceAR(point: Vec3, out?: Vec3): Vec3 {
        const world = this._world;
        world.ensureTransformsComposed();
        const t = world.get(this._entity, Transform);
        const { x: qx, y: qy, z: qz, w: qw } = t.worldRotation;
        const sx = point.x * t.worldScale.x, sy = point.y * t.worldScale.y, sz = point.z * t.worldScale.z;
        const tx = 2 * (qy * sz - qz * sy), ty = 2 * (qz * sx - qx * sz), tz = 2 * (qx * sy - qy * sx);
        const result = out ?? new Vec3();
        result.x = t.worldPosition.x + sx + qw * tx + (qy * tz - qz * ty);
        result.y = t.worldPosition.y + sy + qw * ty + (qz * tx - qx * tz);
        result.z = t.worldPosition.z + sz + qw * tz + (qx * ty - qy * tx);
        return result;
    }

    /** The reverse: a world point as a point relative to this node's anchor. */
    convertToNodeSpaceAR(point: Vec3, out?: Vec3): Vec3 {
        const world = this._world;
        world.ensureTransformsComposed();
        const t = world.get(this._entity, Transform);
        const dx = point.x - t.worldPosition.x, dy = point.y - t.worldPosition.y, dz = point.z - t.worldPosition.z;
        const { x: qx, y: qy, z: qz, w: qw } = t.worldRotation;
        const ix = -qx, iy = -qy, iz = -qz;
        const tx = 2 * (iy * dz - iz * dy), ty = 2 * (iz * dx - ix * dz), tz = 2 * (ix * dy - iy * dx);
        const rx = dx + qw * tx + (iy * tz - iz * ty);
        const ry = dy + qw * ty + (iz * tx - ix * tz);
        const rz = dz + qw * tz + (ix * ty - iy * tx);
        const result = out ?? new Vec3();
        result.x = rx / (t.worldScale.x || 1);
        result.y = ry / (t.worldScale.y || 1);
        result.z = rz / (t.worldScale.z || 1);
        return result;
    }

    /** Whether a world-space point is inside the rectangle. */
    isHit(worldPoint: Vec2): boolean {
        this.rect_();
        return contentRectContains(this._world, this._entity, worldPoint.x, worldPoint.y);
    }

    /** The axis-aligned box of the rectangle in world space. */
    getBoundingBoxToWorld(): Rect {
        const r = this.local_();
        const corners = [new Vec3(r.x, r.y, 0), new Vec3(r.x + r.width, r.y, 0), new Vec3(r.x + r.width, r.y + r.height, 0), new Vec3(r.x, r.y + r.height, 0)]
            .map((c) => this.convertToWorldSpaceAR(c));
        const xs = corners.map((c) => c.x), ys = corners.map((c) => c.y);
        const x = Math.min(...xs), y = Math.min(...ys);
        return new Rect(x, y, Math.max(...xs) - x, Math.max(...ys) - y);
    }
}

registerBuiltinComponent(UITransform, ['cc.UITransform', 'UITransform'], viewAdapter(
    UITransform,
    (world, entity) => world.has(entity, ContentRect) || world.has(entity, Sprite) || world.has(entity, Text),
    (world, entity) => { ensureUITransform(world, entity); },
));
