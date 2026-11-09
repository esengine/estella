// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    rig2dPlugin.ts
 * @brief   Bones as entities, and what bends them after the animation has spoken: IK chains and bone constraints.
 *
 * @details Runs after the animator, the timeline and physics, on the pose they stated, so a foot lands where the ground is whichever
 *          clip is playing. Worlds are walked from the local fields rather than read from `Transform.worldPosition`: those are
 *          composed for the frame's draw and are last frame's here, and each chain has to see what the one before it just did.
 *
 *          A solve starts from the ANIMATED pose. Something a bone holds that this system did not write is the animation's and
 *          becomes the base; what it did write is not, or `weight` would creep towards 1 on a bone no clip touches.
 */
import type { App, Plugin } from '../app/app';
import { defineComponent, Parent, Transform } from '../ecs/component';
import { playModeOnly } from '../ecs/env';
import { Schedule, defineSystem } from '../ecs/system';
import type { Entity } from '../types';
import type { World } from '../ecs/world';
import { clampAngle, solveChain2D, type ChainBone } from './solve2d';

const DEG = Math.PI / 180;

/** A bone: an entity whose Transform is its joint, reaching `length` along its own +x. @experimental */
export interface Bone2DData { length: number }
/** @experimental */
export const Bone2D = defineComponent<Bone2DData>('Bone2D', { length: 0 }, {
    fields: { length: { min: 0, tooltip: 'How far the bone reaches along its +x. An IK chain ending here reaches for the target with this end.' } },
});

/** @experimental */
export interface IK2DData {
    /** What the end of this bone reaches for. */
    target: Entity;
    /** Bones bent, this one and those above it. */
    chainLength: number;
    /** Two bones: which way the middle joint bends, 1 counter-clockwise or -1. */
    bend: number;
    /** 0 leaves the animation alone, 1 reaches the target. */
    weight: number;
    /** Also turn this bone to the target's rotation: a foot flat on a slope, a hand holding what it holds. */
    matchTargetRotation: boolean;
    enabled: boolean;
}
/** @experimental */
export const IK2D = defineComponent<IK2DData>('IK2D', {
    target: 0 as Entity, chainLength: 2, bend: 1, weight: 1, matchTargetRotation: false, enabled: true,
}, {
    entityFields: ['target'],
    animatableFields: ['weight'],
    fields: {
        target: { tooltip: 'The entity the end of this bone reaches for.' },
        chainLength: { min: 1, max: 32, step: 1, tooltip: 'How many bones bend, counting this one. Two bones solve exactly and keep their bend; more take an iterative solve.' },
        bend: { min: -1, max: 1, step: 2, tooltip: 'Two bones: the way the middle joint bends, 1 counter-clockwise or -1.' },
        weight: { min: 0, max: 1, step: 0.01, tooltip: 'How far from the animated pose towards the solve.' },
        matchTargetRotation: { tooltip: "Also turn this bone to the target's rotation." },
    },
});

/** What a {@link BoneConstraint2D} does. @experimental */
export const BoneConstraintKind = {
    /** Keep the bone's local rotation between `min` and `max`. An IK chain through this bone keeps to them too. */
    LimitRotation: 0,
    /** Take `source`'s world rotation, plus `offset`. */
    CopyRotation: 1,
    /** Stand on `source`'s world position. */
    CopyPosition: 2,
    /** Point +x at `source`, plus `offset`. */
    LookAt: 3,
} as const;

/** @experimental */
export interface BoneConstraint2DData {
    kind: number;
    source: Entity;
    /** LimitRotation: degrees of local rotation. */
    min: number;
    max: number;
    /** CopyRotation and LookAt: degrees added on top. */
    offset: number;
    weight: number;
    enabled: boolean;
}
/** @experimental */
export const BoneConstraint2D = defineComponent<BoneConstraint2DData>('BoneConstraint2D', {
    kind: BoneConstraintKind.LimitRotation, source: 0 as Entity, min: -45, max: 45, offset: 0, weight: 1, enabled: true,
}, {
    entityFields: ['source'],
    animatableFields: ['weight'],
    fields: {
        kind: { enum: [
            { label: 'Limit Rotation', value: BoneConstraintKind.LimitRotation },
            { label: 'Copy Rotation', value: BoneConstraintKind.CopyRotation },
            { label: 'Copy Position', value: BoneConstraintKind.CopyPosition },
            { label: 'Look At', value: BoneConstraintKind.LookAt },
        ] },
        source: { tooltip: 'The entity copied or looked at. Limit Rotation reads none.' },
        min: { unit: '°', shownWhen: { field: 'kind', values: [BoneConstraintKind.LimitRotation] } },
        max: { unit: '°', shownWhen: { field: 'kind', values: [BoneConstraintKind.LimitRotation] } },
        offset: { unit: '°', shownWhen: { field: 'kind', values: [BoneConstraintKind.CopyRotation, BoneConstraintKind.LookAt] } },
        weight: { min: 0, max: 1, step: 0.01 },
    },
});

/** A placement in the world: `point = (x, y) + R(angle) * S * local`. */
interface Place { x: number; y: number; angle: number; sx: number; sy: number }
const NOWHERE: Place = { x: 0, y: 0, angle: 0, sx: 1, sy: 1 };

/** What a bone held that the animation stated, and what was written over it. */
interface Base { angle: number; wroteAngle: number | null; x: number; y: number; wroteX: number | null; wroteY: number | null; frame: number }

const zAngle = (q: { w: number; z: number }): number => 2 * Math.atan2(q.z, q.w);
const close = (a: number | null, b: number): boolean => a !== null && Math.abs(a - b) < 1e-5;
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** One frame of solving. @internal */
export class Rig2DSolver {
    private readonly bases_ = new Map<Entity, Base>();
    private readonly places_ = new Map<Entity, Place>();
    private frame_ = 0;

    constructor(private readonly world: World) {}

    forget(entity: Entity): void { this.bases_.delete(entity); }

    private parentOf_(entity: Entity): Entity | null {
        const parent = this.world.tryGet(entity, Parent) as { entity: Entity } | null;
        return parent && this.world.valid(parent.entity) && this.world.has(parent.entity, Transform) ? parent.entity : null;
    }

    private placeOf_(entity: Entity | null): Place {
        if (entity === null) return NOWHERE;
        const known = this.places_.get(entity);
        if (known) return known;
        const up = this.placeOf_(this.parentOf_(entity));
        const t = this.world.get(entity, Transform);
        const c = Math.cos(up.angle), s = Math.sin(up.angle), lx = t.position.x * up.sx, ly = t.position.y * up.sy;
        const mirrored = up.sx * up.sy < 0;
        const place: Place = {
            x: up.x + c * lx - s * ly, y: up.y + s * lx + c * ly,
            angle: up.angle + (mirrored ? -1 : 1) * zAngle(t.rotation), sx: up.sx * t.scale.x, sy: up.sy * t.scale.y,
        };
        this.places_.set(entity, place);
        return place;
    }

    private baseOf_(entity: Entity): Base {
        const t = this.world.get(entity, Transform), angle = zAngle(t.rotation);
        let base = this.bases_.get(entity);
        if (!base) {
            base = { angle, wroteAngle: null, x: t.position.x, y: t.position.y, wroteX: null, wroteY: null, frame: this.frame_ };
            this.bases_.set(entity, base);
            return base;
        }
        if (base.frame !== this.frame_) {
            base.frame = this.frame_;
            if (!close(base.wroteAngle, angle)) { base.angle = angle; base.wroteAngle = null; }
            if (!close(base.wroteX, t.position.x) || !close(base.wroteY, t.position.y)) { base.x = t.position.x; base.y = t.position.y; base.wroteX = null; base.wroteY = null; }
        }
        return base;
    }

    private writeAngle_(entity: Entity, base: Base, angle: number): void {
        base.wroteAngle = angle;
        const half = angle / 2;
        this.world.update(entity, Transform, (t) => { t.rotation = { w: Math.cos(half), x: 0, y: 0, z: Math.sin(half) }; });
        this.places_.clear();
    }

    private toLocal_(parent: Place, x: number, y: number): { x: number; y: number } {
        const c = Math.cos(parent.angle), s = Math.sin(parent.angle), dx = x - parent.x, dy = y - parent.y;
        return { x: (c * dx + s * dy) / (parent.sx || 1), y: (-s * dx + c * dy) / (parent.sy || 1) };
    }

    private limitOf_(entity: Entity): { min?: number; max?: number } {
        const limit = this.world.tryGet(entity, BoneConstraint2D);
        if (!limit || !limit.enabled || limit.kind !== BoneConstraintKind.LimitRotation) return {};
        return { min: limit.min * DEG, max: limit.max * DEG };
    }

    private solveIK_(tip: Entity): void {
        const ik = this.world.get(tip, IK2D);
        if (!ik.enabled || !(ik.weight > 0) || !this.world.valid(ik.target) || !this.world.has(ik.target, Transform)) return;
        const bones: Entity[] = [tip];
        for (let at = this.parentOf_(tip); at !== null && bones.length < ik.chainLength; at = this.parentOf_(at)) bones.unshift(at);
        const above = this.placeOf_(this.parentOf_(bones[0]!));
        const target = this.placeOf_(ik.target);
        const local = this.toLocal_(above, target.x, target.y);
        const chain: ChainBone[] = bones.map((bone) => {
            const t = this.world.get(bone, Transform);
            const place: ChainBone = { x: t.position.x, y: t.position.y, rotation: this.baseOf_(bone).angle };
            return { ...place, ...this.limitOf_(bone) };
        });
        const tipBone = this.world.tryGet(tip, Bone2D);
        solveChain2D(chain, local.x, local.y, { tipLength: tipBone ? tipBone.length : 0, bend: ik.bend === 0 ? undefined : ik.bend });
        bones.forEach((bone, i) => {
            const base = this.baseOf_(bone);
            this.writeAngle_(bone, base, base.angle + wrap(chain[i]!.rotation - base.angle) * Math.min(1, ik.weight));
        });
        if (ik.matchTargetRotation) {
            const above2 = this.placeOf_(this.parentOf_(tip)), base = this.baseOf_(tip);
            const sign = above2.sx * above2.sy < 0 ? -1 : 1;
            const held = this.world.get(tip, Transform);
            const current = zAngle(held.rotation);
            this.writeAngle_(tip, base, current + wrap(sign * (target.angle - above2.angle) - current) * Math.min(1, ik.weight));
        }
    }

    private applyConstraint_(bone: Entity): void {
        const c = this.world.get(bone, BoneConstraint2D);
        if (!c.enabled || !(c.weight > 0)) return;
        const base = this.baseOf_(bone), weight = Math.min(1, c.weight);
        const held = zAngle(this.world.get(bone, Transform).rotation);
        if (c.kind === BoneConstraintKind.LimitRotation) {
            const limited = clampAngle(held, c.min * DEG, c.max * DEG);
            if (limited !== held) this.writeAngle_(bone, base, held + (limited - held) * weight);
            return;
        }
        if (!this.world.valid(c.source) || !this.world.has(c.source, Transform)) return;
        const source = this.placeOf_(c.source), up = this.placeOf_(this.parentOf_(bone));
        const sign = up.sx * up.sy < 0 ? -1 : 1;
        if (c.kind === BoneConstraintKind.CopyPosition) {
            const local = this.toLocal_(up, source.x, source.y);
            const x = base.x + (local.x - base.x) * weight, y = base.y + (local.y - base.y) * weight;
            base.wroteX = x; base.wroteY = y;
            this.world.update(bone, Transform, (t) => { t.position.x = x; t.position.y = y; });
            this.places_.clear();
            return;
        }
        const own = this.placeOf_(bone);
        const world = c.kind === BoneConstraintKind.CopyRotation ? source.angle : Math.atan2(source.y - own.y, source.x - own.x);
        const wanted = sign * (world + c.offset * DEG - up.angle);
        this.writeAngle_(bone, base, held + wrap(wanted - held) * weight);
    }

    private depthOf_(entity: Entity): number {
        let depth = 0;
        for (let at = this.parentOf_(entity); at !== null; at = this.parentOf_(at)) depth++;
        return depth;
    }

    /** Chains first, from the trunk out, so a limb reaches from where its body now is; constraints have the last word, the same way. */
    step(): void {
        this.frame_++;
        this.places_.clear();
        const byDepth = (list: readonly Entity[]) => list.map(e => [this.depthOf_(e), e] as const).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(p => p[1]);
        for (const tip of byDepth(this.world.getEntitiesWithComponents([IK2D, Transform]))) this.solveIK_(tip);
        for (const bone of byDepth(this.world.getEntitiesWithComponents([BoneConstraint2D, Transform]))) this.applyConstraint_(bone);
    }
}

/** Runs {@link IK2D} and {@link BoneConstraint2D} on a running game. @experimental */
export class Rig2DPlugin implements Plugin {
    name = 'rig2d';
    readonly activeWhen = [IK2D, BoneConstraint2D];

    build(app: App): void {
        const solver = new Rig2DSolver(app.world);
        app.world.onDespawn((entity: Entity) => solver.forget(entity));
        app.addSystemToSchedule(Schedule.PostUpdate, defineSystem([], () => solver.step(), { name: 'Rig2DSystem' }), {
            runAfter: ['PhysicsInterpolateSystem'], runIf: playModeOnly,
        });
    }
}
