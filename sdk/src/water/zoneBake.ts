// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    zoneBake.ts
 * @brief   A zone's bake as a message a worker can take, and the field it sends back.
 *
 * @details Baking a zone is computation, and on the main thread it is frames not drawn however finely it is sliced: at the editor's
 *          frame rate the water took seconds more to appear than the work itself. The main thread keeps the one part that asks the scene
 *          (the ground's height at each texel, {@link WaterField.groundsUnder}); the rest runs on a worker from plain data. A lake or an
 *          exclusion volume crosses as its outline and placement, a custom body with the mesh its shape is made from, and each is rebuilt
 *          there by the same arithmetic. The worker's script is this file's {@link bakeZone} (zoneBakeWorker.ts).
 */
import { WaterField, type WaterFieldParts, type ZoneBody, type ZoneExclusion, type ZoneGrid, type ZoneLake } from './zoneField';
import { placedSpace, type Placement } from './zonePlacement';
import { Footprint } from './footprint';

type PlainLake = Omit<ZoneLake, 'toLocal' | 'toWorld' | 'inside'> & { placement: Placement };
type PlainBody = Exclude<ZoneBody, ZoneLake> | PlainLake;
type PlainExclusion = Omit<ZoneExclusion, 'toLocal' | 'toWorld' | 'only'> & { placement: Placement; only?: number[] };

/** A zone's bake as plain data: what is posted to the worker. */
export interface ZoneBakeJob {
    grid: ZoneGrid;
    bodies: PlainBody[];
    exclusions: PlainExclusion[];
    grounds: Float64Array;
    surfLength: number;
    surfSpread: number;
}

/**
 * The bake as a message, or null where a body or a volume cannot cross: one built without its placement, or a custom shape without the
 * mesh it was made from. Such a zone is baked in place, as before.
 */
export function zoneBakeJob(grid: ZoneGrid, bodies: readonly ZoneBody[], exclusions: readonly ZoneExclusion[], grounds: Float64Array,
    surfLength: number, surfSpread: number): ZoneBakeJob | null {
    const plainBodies: PlainBody[] = [];
    for (const b of bodies) {
        if (b.kind !== 'lake') { plainBodies.push(b); continue; }
        if (!b.placement || (b.inside && !b.footprint)) return null;
        const { toLocal: _l, toWorld: _w, inside: _i, ...rest } = b;
        plainBodies.push({ ...rest, placement: b.placement });
    }
    const plainExclusions: PlainExclusion[] = [];
    for (const e of exclusions) {
        if (!e.placement) return null;
        const { toLocal: _l, toWorld: _w, only, ...rest } = e;
        plainExclusions.push({ ...rest, placement: e.placement, ...(only ? { only: [...only] } : {}) });
    }
    return { grid, bodies: plainBodies, exclusions: plainExclusions, grounds, surfLength, surfSpread };
}

/** The buffers a job carries, to transfer rather than copy: the grounds are made for it and read by nothing after. */
export function zoneBakeTransfer(job: ZoneBakeJob): ArrayBuffer[] {
    return [job.grounds.buffer as ArrayBuffer];
}

/** Bakes a job to the end: the worker's whole part, and what a host with no worker does in place. */
export function bakeZone(job: ZoneBakeJob): WaterFieldParts {
    const bodies: ZoneBody[] = job.bodies.map((b) => {
        if (b.kind !== 'lake') return b;
        const lake = b as PlainLake;
        const shape = lake.footprint ? Footprint.of(lake.footprint.xyz, lake.footprint.indices) : null;
        return { ...lake, ...placedSpace(lake.placement), ...(shape ? { inside: (x: number, z: number) => shape.sdf(x, z) } : {}) };
    });
    const exclusions: ZoneExclusion[] = job.exclusions.map(({ only, ...e }) => ({
        ...e, ...placedSpace(e.placement), ...(only ? { only: new Set(only) } : {}),
    }));
    const baking = WaterField.bakingOver(job.grid, bodies, job.grounds, job.surfLength, exclusions, job.surfSpread);
    for (;;) {
        const next = baking.next();
        if (next.done) return next.value.parts();
    }
}
