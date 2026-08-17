// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Physics3DQueries.ts
 * @brief   Asking the 3D world what is where, in the units a scene is authored in.
 * @details Every distance crosses in metres and comes back in world units, the
 *          same contract the step follows — a query answering in the solver's
 *          units would be a second set of numbers for a caller to remember.
 */
import type { Entity } from '../types';
import type { Physics3DWasmModule } from './Physics3DModule';

/** Where a cast met something, in world units. */
export interface Cast3DHit {
    entity: Entity;
    /** How far along the cast, 0..1. */
    fraction: number;
    x: number;
    y: number;
    z: number;
    normalX: number;
    normalY: number;
    normalZ: number;
}

/** One body an overlap test found, and a point where it touches. */
export interface Overlap3DHit {
    entity: Entity;
    x: number;
    y: number;
    z: number;
}

/**
 * The 3D world's spatial queries.
 *
 * A layer mask of 0 means every layer: a caller that did not ask to filter is
 * asking for everything, and answering "nothing" there would be a silent empty
 * result for the commonest call.
 */
export class Physics3DQueries {
    constructor(private readonly module_: Physics3DWasmModule,
                private readonly ppu_: number) {}

    /** The nearest body along a ray, or null. `direction` carries its length. */
    raycast(origin: { x: number; y: number; z: number },
            direction: { x: number; y: number; z: number },
            layerMask = 0): Cast3DHit | null {
        const p = this.ppu_;
        const hit = this.module_._physics3d_raycast(
            origin.x / p, origin.y / p, origin.z / p,
            direction.x / p, direction.y / p, direction.z / p, layerMask);
        return hit ? this.readCast_() : null;
    }

    /**
     * Sweeps a sphere along `direction` and returns the first body it meets.
     *
     * What a ray cannot answer: a ray is infinitely thin, so it passes through
     * the very gaps a moving body would not fit — "can this thing get there" is
     * a different question from "is anything on this line".
     */
    sphereCast(origin: { x: number; y: number; z: number }, radius: number,
               direction: { x: number; y: number; z: number },
               layerMask = 0): Cast3DHit | null {
        const p = this.ppu_;
        const hit = this.module_._physics3d_sphereCast(
            origin.x / p, origin.y / p, origin.z / p, radius / p,
            direction.x / p, direction.y / p, direction.z / p, layerMask);
        return hit ? this.readCast_() : null;
    }

    /** Every body overlapping a sphere — what a spawn point asks before it spawns. */
    overlapSphere(centre: { x: number; y: number; z: number }, radius: number,
                  layerMask = 0): Overlap3DHit[] {
        const p = this.ppu_;
        const count = this.module_._physics3d_overlapSphere(
            centre.x / p, centre.y / p, centre.z / p, radius / p, layerMask);
        return this.readOverlaps_(count);
    }

    /** The same for a box, given its half-extents. */
    overlapBox(centre: { x: number; y: number; z: number },
               halfExtents: { x: number; y: number; z: number },
               layerMask = 0): Overlap3DHit[] {
        const p = this.ppu_;
        const count = this.module_._physics3d_overlapBox(
            centre.x / p, centre.y / p, centre.z / p,
            halfExtents.x / p, halfExtents.y / p, halfExtents.z / p, layerMask);
        return this.readOverlaps_(count);
    }

    private readCast_(): Cast3DHit {
        const f32 = this.module_.HEAPF32;
        const o = this.module_._physics3d_queryResult() >> 2;
        const p = this.ppu_;
        return {
            entity: f32[o] as Entity,
            fraction: f32[o + 1]!,
            x: f32[o + 2]! * p, y: f32[o + 3]! * p, z: f32[o + 4]! * p,
            // A normal is a direction, so it is NOT scaled: multiplying it would
            // leave a unit vector 100 units long.
            normalX: f32[o + 5]!, normalY: f32[o + 6]!, normalZ: f32[o + 7]!,
        };
    }

    private readOverlaps_(count: number): Overlap3DHit[] {
        if (count <= 0) return [];
        const f32 = this.module_.HEAPF32;
        const base = this.module_._physics3d_queryResult() >> 2;
        const p = this.ppu_;
        const out: Overlap3DHit[] = [];
        for (let i = 0; i < count; i++) {
            const o = base + i * 4;
            out.push({
                entity: f32[o] as Entity,
                x: f32[o + 1]! * p, y: f32[o + 2]! * p, z: f32[o + 3]! * p,
            });
        }
        return out;
    }
}
