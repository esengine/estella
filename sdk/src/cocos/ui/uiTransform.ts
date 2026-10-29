// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    cocos/ui/uiTransform.ts
 * @brief   `UITransform`: a node's content size and anchor point.
 *
 * In Cocos the rectangle belongs to the node and the renderers draw into it. The engine has the opposite arrangement — a `Sprite`
 * has its own size and pivot, a `Text` its own box — and nothing for a node that draws nothing but still has an extent (a button's
 * hit area, a layout container, a scroll view's viewport). So the extent is kept in a small data component of the compatibility layer,
 * `Cocos.UITransform`, which is the one place a script's `contentSize` lives, and a write to it is carried through to the `Sprite` and
 * `Text` on the same node so they draw into the rectangle the script set.
 *
 * Importing a scene writes this component for every node that had a `UITransform`, so it starts out as authored; a node that never
 * had one gets it when a script first asks, filled in from the renderer it has.
 */
import { defineComponent } from '../../ecs/component';
import { Sprite, Transform } from '../../ecs/component';
import { Text } from '../../ui/core/text';
import type { World } from '../../ecs/world';
import type { Entity } from '../../types';
import { Rect, Size, Vec2, Vec3 } from '../math';
import { Component } from '../component';
import { registerBuiltinComponent } from '../builtins';
import { viewAdapter } from './view';

export interface UITransformData {
    width: number;
    height: number;
    anchorX: number;
    anchorY: number;
}

/** The data component, defined per context so a fresh `AppContext` still finds it. */
export function uiTransformDef() {
    return defineComponent<UITransformData>('Cocos.UITransform', { width: 100, height: 100, anchorX: 0.5, anchorY: 0.5 });
}

/** The rectangle a node's renderers say it has, for a node that was never given one. */
function derive(world: World, entity: Entity): UITransformData {
    const sprite = world.has(entity, Sprite) ? world.get(entity, Sprite) : null;
    if (sprite) return { width: sprite.size.x, height: sprite.size.y, anchorX: sprite.pivot.x, anchorY: sprite.pivot.y };
    const text = world.has(entity, Text) ? world.get(entity, Text) : null;
    if (text && (text.boxWidth > 0 || text.boxHeight > 0)) {
        return { width: text.boxWidth, height: text.boxHeight, anchorX: text.boxPivot.x, anchorY: text.boxPivot.y };
    }
    return { width: 100, height: 100, anchorX: 0.5, anchorY: 0.5 };
}

/** The rectangle data of a node, made if it has none. */
export function ensureUITransform(world: World, entity: Entity): UITransformData {
    const def = uiTransformDef();
    if (!world.has(entity, def)) world.insert(entity, def, derive(world, entity));
    return world.get(entity, def);
}

/** Carry a rectangle to the renderers on the same node, which draw it. */
function propagate(world: World, entity: Entity, rect: UITransformData): void {
    if (world.has(entity, Sprite)) {
        const s = world.get(entity, Sprite);
        world.set(entity, Sprite, { ...s, size: { x: rect.width, y: rect.height }, pivot: { x: rect.anchorX, y: rect.anchorY } });
    }
    if (world.has(entity, Text)) {
        const t = world.get(entity, Text);
        world.set(entity, Text, { ...t, boxWidth: rect.width, boxHeight: rect.height, boxPivot: { x: rect.anchorX, y: rect.anchorY } });
    }
}

export class UITransform extends Component {
    private read_(): UITransformData { return ensureUITransform(this._world, this._entity); }
    private write_(patch: Partial<UITransformData>): void {
        const next = { ...this.read_(), ...patch };
        this._world.set(this._entity, uiTransformDef(), next);
        propagate(this._world, this._entity, next);
    }

    get contentSize(): Size { const r = this.read_(); return new Size(r.width, r.height); }
    set contentSize(v: Size) { this.write_({ width: v.width, height: v.height }); }
    setContentSize(w: number | Size, h?: number): void {
        if (typeof w === 'object') this.contentSize = w; else this.write_({ width: w, height: h ?? this.read_().height });
    }

    get width(): number { return this.read_().width; }
    set width(v: number) { this.write_({ width: v }); }
    get height(): number { return this.read_().height; }
    set height(v: number) { this.write_({ height: v }); }

    get anchorPoint(): Vec2 { const r = this.read_(); return new Vec2(r.anchorX, r.anchorY); }
    set anchorPoint(v: Vec2) { this.write_({ anchorX: v.x, anchorY: v.y }); }
    setAnchorPoint(x: number | Vec2, y?: number): void {
        if (typeof x === 'object') this.anchorPoint = x; else this.write_({ anchorX: x, anchorY: y ?? this.read_().anchorY });
    }
    get anchorX(): number { return this.read_().anchorX; }
    set anchorX(v: number) { this.write_({ anchorX: v }); }
    get anchorY(): number { return this.read_().anchorY; }
    set anchorY(v: number) { this.write_({ anchorY: v }); }

    /** The rectangle in the node's own space: its left/bottom corner is minus the anchor times the size. */
    private local_(): Rect {
        const r = this.read_();
        return new Rect(-r.anchorX * r.width, -r.anchorY * r.height, r.width, r.height);
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
        const local = this.convertToNodeSpaceAR(new Vec3(worldPoint.x, worldPoint.y, 0));
        return this.local_().contains(new Vec2(local.x, local.y));
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
    (world, entity) => world.has(entity, uiTransformDef()) || world.has(entity, Sprite) || world.has(entity, Text),
    (world, entity) => { ensureUITransform(world, entity); },
));
