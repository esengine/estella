// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { ZoneDef } from './zones';
import { Zones } from './zones';

/** A path's reserved corridor, usable on a 3D ground plane or a 2D world's x/y plane. */
export interface RoadOptions {
    id: string;
    /** World [x, z] points (read z as y in a 2D world). Repeat the first point to close a loop. */
    points: readonly (readonly [number, number])[];
    /** Full width of the travelled surface. */
    width: number;
    /** Extra clearance on each side, before the soft edge (default 0). */
    clearance?: number;
    falloff?: number;
    priority?: number;
    /** Default ['*']; use tags such as tree/building to keep small ground cover. */
    excludes?: readonly string[];
    biome?: string;
    fields?: Readonly<Record<string, number>>;
}

const prefixOf = (id: string): string => `road:${encodeURIComponent(id)}/`;

/**
 * Turns a polyline into ordinary zones: rectangles with round joins and end caps, so bends leave no holes.
 * These serialize into worker plans and use the normal footprint-aware exclusion and terrain-paint paths.
 * It reserves a corridor; it does not make a road mesh or flatten a sloping road to one height.
 */
export function roadZones(options: RoadOptions): ZoneDef[] {
    const { id, points, width } = options;
    if (typeof id !== 'string' || !id.trim()) throw new Error('road.id: a nonempty name');
    if (!Number.isFinite(width) || width <= 0) throw new Error('road.width: a positive distance');
    for (const key of ['clearance', 'falloff'] as const) if (options[key] !== undefined
        && (!Number.isFinite(options[key]) || options[key]! < 0)) throw new Error(`road.${key}: a nonnegative distance`);
    if (options.priority !== undefined && !Number.isFinite(options.priority)) throw new Error('road.priority: a finite number');
    if (!Array.isArray(points) || points.length < 2 || points.some((p) => !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite))) {
        throw new Error('road.points: at least two finite [x, z] points');
    }
    const radius = width / 2 + (options.clearance ?? 0), prefix = prefixOf(id);
    const common = { kind: 'road', falloff: options.falloff ?? 0, priority: options.priority ?? 10,
        excludes: [...(options.excludes ?? ['*'])], ...(options.biome ? { biome: options.biome } : {}),
        ...(options.fields ? { fields: { ...options.fields } } : {}) };
    const zones: ZoneDef[] = [];
    points.forEach(([x, z], i) => {
        zones.push({ ...common, id: `${prefix}join:${i}`, shape: { type: 'circle', x, z, radius } });
        if (i === 0) return;
        const [px, pz] = points[i - 1]!, dx = x - px, dz = z - pz, length = Math.hypot(dx, dz);
        if (length === 0) return;
        // Zone rectangles use the 2D distance function's rotation convention, with local +X along the segment.
        zones.push({ ...common, id: `${prefix}segment:${i - 1}`, shape: { type: 'rect', x: (x + px) / 2, z: (z + pz) / 2,
            halfX: length / 2, halfZ: radius, yaw: Math.atan2(dz, dx) } });
    });
    return zones;
}

/** Replace just this road's zones, including removing obsolete segments after shortening the path. Validates before changing anything. */
export function setRoad(zones: Zones, options: RoadOptions): void {
    const next = roadZones(options), ids = new Set(next.map((z) => z.id)), prefix = prefixOf(options.id);
    for (const zone of [...zones.all()]) if (zone.id.startsWith(prefix) && !ids.has(zone.id)) zones.delete(zone.id);
    for (const zone of next) zones.set(zone);
}

/** Remove a road's reservation; unrelated zones are preserved. */
export function removeRoad(zones: Zones, id: string): void {
    const prefix = prefixOf(id);
    for (const zone of [...zones.all()]) if (zone.id.startsWith(prefix)) zones.delete(zone.id);
}
