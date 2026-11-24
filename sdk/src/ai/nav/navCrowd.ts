// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { Entity } from '../../types';
import type { AvoidanceNeighbour } from './avoidance';

export interface CrowdBody extends AvoidanceNeighbour {
    entity: Entity;
    order: number;
}

/** Past this multiple of the combined radii the steering solver ignores a body. */
const NEIGHBOUR_REACH = 6;

interface RadiusBand {
    maxRadius: number;
    cellSize: number;
    bodies: CrowdBody[];
    columns: Map<number, Map<number, CrowdBody[]>>;
}

/** One frozen steering snapshot. Movers and parked bodies share both the
 * ground plane and the original entity order used to score candidate velocities. */
export class NavCrowd {
    private bands_: RadiusBand[] | null = null;
    private queries_ = 0;

    constructor(private readonly bodies_: readonly CrowdBody[]) {}

    neighbours(self: Entity, x: number, z: number, radius: number): AvoidanceNeighbour[] | null {
        // A lone mover only needs one pass over the snapshots. Small crowds are
        // cheaper to walk directly, even if every body moves.
        if (++this.queries_ === 2 && this.bodies_.length >= 48) this.bands_ = indexBodies(this.bodies_);
        if (!this.bands_ || !Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(radius)) {
            return collectInRange(this.bodies_, self, x, z, radius, null);
        }
        let matches: CrowdBody[] | null = null;
        for (const band of this.bands_) {
            const cx = Math.floor(x / band.cellSize), cz = Math.floor(z / band.cellSize);
            // At an exact cell multiple, subtraction can round a body on the
            // opposite cell boundary onto the inclusive distance limit.
            const ring = Math.floor((radius + band.maxRadius) * NEIGHBOUR_REACH / band.cellSize) + 1;
            // A large seeker can cover many empty cells in a smaller band.
            // Visit its bodies directly when the cell walk would cost more.
            if ((ring * 2 + 1) ** 2 >= band.bodies.length
                || !Number.isSafeInteger(Math.abs(cx) + ring) || !Number.isSafeInteger(Math.abs(cz) + ring)) {
                matches = collectInRange(band.bodies, self, x, z, radius, matches);
                continue;
            }
            for (let dx = -ring; dx <= ring; dx++) {
                const column = band.columns.get(cx + dx);
                if (!column) continue;
                for (let dz = -ring; dz <= ring; dz++) {
                    const cell = column.get(cz + dz);
                    if (cell) matches = collectInRange(cell, self, x, z, radius, matches);
                }
            }
        }
        if (matches && matches.length > 1) matches.sort((a, b) => a.order - b.order);
        return matches;
    }
}

function collectInRange(bodies: readonly CrowdBody[], self: Entity, x: number, z: number,
    radius: number, matches: CrowdBody[] | null): CrowdBody[] | null {
    for (const other of bodies) {
        if (other.entity === self) continue;
        const reach = (radius + other.radius) * NEIGHBOUR_REACH;
        if (Math.hypot(other.x - x, other.z - z) > reach) continue;
        matches ??= [];
        matches.push(other);
    }
    return matches;
}

/** Index centres at their own radius scale. A single exceptionally wide body
 * must not enlarge every other body's search area. */
function indexBodies(bodies: readonly CrowdBody[]): RadiusBand[] | null {
    const bands = new Map<number, RadiusBand>();
    for (const body of bodies) {
        // A power-of-two cell wider than two equal bodies' combined reach
        // leaves a same-sized seeker at most nine cells to inspect.
        const cellSize = 16 * 2 ** Math.ceil(Math.log2(body.radius));
        const x = Math.floor(body.x / cellSize), z = Math.floor(body.z / cellSize);
        if (!Number.isFinite(cellSize) || cellSize <= 0 || !Number.isSafeInteger(x) || !Number.isSafeInteger(z)) return null;
        let band = bands.get(cellSize);
        if (!band) {
            band = { maxRadius: body.radius, cellSize, bodies: [], columns: new Map() };
            bands.set(cellSize, band);
        }
        band.maxRadius = Math.max(band.maxRadius, body.radius);
        band.bodies.push(body);
        let column = band.columns.get(x);
        if (!column) {
            column = new Map();
            band.columns.set(x, column);
        }
        const cell = column.get(z);
        if (cell) cell.push(body);
        else column.set(z, [body]);
    }
    return [...bands.values()];
}
