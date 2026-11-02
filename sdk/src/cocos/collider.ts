// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    cocos/collider.ts
 * @brief   `Collider` and `BoxCollider`: views on the engine's `BoxCollider3D`.
 *
 * A Cocos box is described in the node's own units (`size`, `center`) and takes the node's scale on top; the engine's box holds its half
 * extents already scaled, which is how the importer writes it. The view converts at the boundary, so a script that reads `size` gets what it
 * set and the engine's box is the size it is drawn at. A collider with no rigid body is a static one in Cocos; the engine spells that as a static
 * body beside the box, which adding the collider here puts there.
 */
import { BoxCollider3D, RigidBody3D } from '../physics3d/Physics3DComponents';
import type { World } from '../ecs/world';
import type { Entity } from '../types';
import { Component } from './component';
import { registerBuiltinComponent } from './builtins';
import { Vec3 } from './math';
import { viewAdapter } from './ui/view';

/** The base of every collider a script asks for. */
export class Collider extends Component {}

const axes = ['x', 'y', 'z'] as const;

export class BoxCollider extends Collider {
    private data_() { return this._world.get(this._entity, BoxCollider3D); }
    private patch_(fields: Record<string, unknown>): void {
        this._world.set(this._entity, BoxCollider3D, { ...this.data_(), ...fields } as never);
    }
    /** The node's scale along an axis; a flat axis would divide by nothing, so it counts as one. */
    private scaleOf_(axis: 'x' | 'y' | 'z'): number {
        const s = Math.abs(this.node.scale[axis]);
        return s > 1e-6 ? s : 1;
    }

    /** Whether the collider takes part. */
    get enabled(): boolean { return this.data_().enabled; }
    set enabled(v: boolean) { this.patch_({ enabled: v }); }

    /** A trigger reports overlaps and pushes nothing. */
    get isTrigger(): boolean { return this.data_().isSensor; }
    set isTrigger(v: boolean) { this.patch_({ isSensor: v }); }

    /** The full size of the box, in the node's units. */
    get size(): Vec3 {
        const h = this.data_().halfExtents;
        return new Vec3((h.x * 2) / this.scaleOf_('x'), (h.y * 2) / this.scaleOf_('y'), (h.z * 2) / this.scaleOf_('z'));
    }
    set size(v: Vec3) {
        const half = {} as Record<string, number>;
        for (const a of axes) half[a] = (Math.abs(v[a]) * this.scaleOf_(a)) / 2;
        this.patch_({ halfExtents: half });
    }

    /** Where the box stands from the node's origin, in the node's units. */
    get center(): Vec3 {
        const c = this.data_().center ?? { x: 0, y: 0, z: 0 };
        return new Vec3(c.x / this.scaleOf_('x'), c.y / this.scaleOf_('y'), c.z / this.scaleOf_('z'));
    }
    set center(v: Vec3) {
        const at = {} as Record<string, number>;
        for (const a of axes) at[a] = v[a] * this.scaleOf_(a);
        this.patch_({ center: at });
    }
}

const hasBox = (world: World, entity: Entity): boolean => world.has(entity, BoxCollider3D);
const addBox = (world: World, entity: Entity): void => {
    if (!world.has(entity, RigidBody3D)) world.insert(entity, RigidBody3D, { bodyType: 0 });
    // Cocos's default box is one unit each way
    world.insert(entity, BoxCollider3D, { halfExtents: { x: 0.5, y: 0.5, z: 0.5 } });
};
registerBuiltinComponent(BoxCollider, ['cc.BoxCollider', 'BoxCollider'], viewAdapter(BoxCollider, hasBox, addBox));
