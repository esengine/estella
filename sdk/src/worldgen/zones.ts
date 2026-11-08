// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    zones.ts
 * @brief   Areas a world is planned by: a home, a road, a landing site, a building's footprint, a view kept open.
 *
 * @details A zone has a shape, a kind, a priority and an edge that fades over `falloff` world units. Over its area it can keep out what
 *          is placed (everything, or what carries one of the tags it names), hold a biome, and set fields; at its edge each of those
 *          fades, and what it keeps out thins rather than stopping on a line. Where zones overlap the higher priority holds the biome.
 *          A game adds zones as it plans (a reserved home) and as the player builds; authored ones come from `WorldZone` components.
 */
import { hash01, hashString } from './fields';

/** A zone's outline: a circle, or a rectangle turned by `yaw` radians about the vertical. */
export type ZoneShape =
    | { type: 'circle'; x: number; z: number; radius: number; y?: number }
    | { type: 'rect'; x: number; z: number; halfX: number; halfZ: number; yaw?: number; y?: number; facing?: readonly [number, number, number] };

export interface ZoneDef {
    /** Stable: what a placement records as the zone it stands in or was kept out by. */
    id: string;
    /** What the zone is for (home, road, landing, building, resource, view): a game's own words. */
    kind: string;
    shape: ZoneShape;
    /** Over how many world units past its outline it fades out. */
    falloff: number;
    priority: number;
    /** The tags of what it keeps out; `*` keeps out everything. */
    excludes: readonly string[];
    /** A biome it holds over its area, if any. */
    biome?: string;
    /** Fields it sets over its area. */
    fields?: Readonly<Record<string, number>>;
    /**
     * Levels the terrain under it: to this world height, or ('ground') to the ground's height at its centre as the ground was made,
     * blending back over its falloff. Live plane generators hold the modifier; it is released when the zone or its last consumer goes.
     */
    flatten?: number | 'ground';
}

/** How far (x, z) is outside a zone's outline: negative inside. */
export function zoneDistance(shape: ZoneShape, x: number, z: number): number {
    if (shape.type === 'circle') return Math.hypot(x - shape.x, z - shape.z) - shape.radius;
    const c = Math.cos(-(shape.yaw ?? 0)), s = Math.sin(-(shape.yaw ?? 0));
    const dx = x - shape.x, dz = z - shape.z;
    const lx = Math.abs(dx * c - dz * s) - shape.halfX, lz = Math.abs(dx * s + dz * c) - shape.halfZ;
    return Math.hypot(Math.max(lx, 0), Math.max(lz, 0)) + Math.min(Math.max(lx, lz), 0);
}

/** How much of a zone holds at a point `d` outside its outline: 1 inside, fading smoothly to 0 at `falloff`. */
export function zoneWeight(zone: ZoneDef, d: number): number {
    if (d <= 0) return 1;
    if (zone.falloff <= 0 || d >= zone.falloff) return 0;
    const t = 1 - d / zone.falloff;
    return t * t * (3 - 2 * t);
}

/** The square a zone reaches, its edge included: [minX, minZ, maxX, maxZ]. */
export function zoneBounds(zone: ZoneDef): [number, number, number, number] {
    const s = zone.shape;
    const r = (s.type === 'circle' ? s.radius : Math.hypot(s.halfX, s.halfZ)) + Math.max(zone.falloff, 0);
    return [s.x - r, s.z - r, s.x + r, s.z + r];
}

/** The zones of one world. */
export class Zones {
    private readonly zones_ = new Map<string, ZoneDef>();
    private readonly listeners_ = new Set<NonNullable<Zones['onChange']>>();
    /** Bumped on every change. */
    revision = 0;
    /** Told the area every change touched (the zone's old and new bounds) and the zone there, so only what stands there is placed again. */
    onChange: ((bounds: [number, number, number, number], zone: ZoneDef) => void) | null = null;

    /** Listens alongside other consumers; the returned function stops listening. */
    subscribe(listener: NonNullable<Zones['onChange']>): () => void {
        this.listeners_.add(listener);
        return () => { this.listeners_.delete(listener); };
    }

    private changed(zone: ZoneDef): void {
        const bounds = zoneBounds(zone);
        this.onChange?.(bounds, zone);
        for (const listener of this.listeners_) listener(bounds, zone);
    }

    set(zone: ZoneDef): void {
        const had = this.zones_.get(zone.id);
        if (had && JSON.stringify(had) === JSON.stringify(zone)) return;
        this.zones_.set(zone.id, zone);
        this.revision++;
        if (had) this.changed(had);
        this.changed(zone);
    }

    delete(id: string): void {
        const had = this.zones_.get(id);
        if (!had) return;
        this.zones_.delete(id);
        this.revision++;
        this.changed(had);
    }

    get(id: string): ZoneDef | undefined {
        return this.zones_.get(id);
    }

    all(): IterableIterator<ZoneDef> {
        return this.zones_.values();
    }

    /** The zones that hold at (x, z), with how much, highest priority first. */
    at(x: number, z: number, reach = 0): { zone: ZoneDef; weight: number }[] {
        const out: { zone: ZoneDef; weight: number }[] = [];
        for (const zone of this.zones_.values()) {
            const w = zoneWeight(zone, zoneDistance(zone.shape, x, z) - reach);
            if (w > 0) out.push({ zone, weight: w });
        }
        return out.sort((a, b) => b.zone.priority - a.zone.priority || (a.zone.id < b.zone.id ? -1 : 1));
    }

    /**
     * The zone that keeps out something of radius `radius` carrying `tags` at (x, z), or null. Inside a zone it is kept out; in its
     * edge it is kept out with the zone's weight there, by a draw fixed for that place, so the edge thins instead of ending on a line.
     */
    excluding(x: number, z: number, radius: number, tags: readonly string[], seed: number): ZoneDef | null {
        for (const { zone, weight } of this.at(x, z, radius)) {
            if (!zone.excludes.some((t) => t === '*' || tags.includes(t))) continue;
            if (weight >= 1 || hash01(seed, hashString(zone.id), Math.floor(x * 16), Math.floor(z * 16)) < weight) return zone;
        }
        return null;
    }
}
