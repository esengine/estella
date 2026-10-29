// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  nearest.ts
 * @brief The entities of a kind that stand nearest a point: the one thing an "interact" button needs to know before it decides what it does.
 *
 * @details {@link nearestEntities} walks the entities that carry a component and a `Transform`, keeps the ones within a radius that pass the game's filter, and
 *          returns them nearest first. {@link nearestMarkers} is the same over `Marker`, whose `type` is the game's own word for what an entity is (a door, a
 *          tree, a bed). What the button DOES for each kind, and which kinds count, are the game's: the engine says what is near and how far, and the game
 *          maps that to a verb.
 *
 *          The distance is measured on the screen plane (x and y) by default, or on the ground (x and z) with `plane: 'xz'`, from each entity's world position.
 *          An entity switched off with `Disabled` is not found. The cost is one pass over the entities that carry the component, which is what a button
 *          press or a once-a-frame prompt can afford over the hundreds of things a village holds; a world of many thousands wants a spatial index of its own.
 */
import type { ComponentDef } from '../ecs/component';
import { Disabled, Marker, Transform, type MarkerData, type TransformData } from '../ecs/component';
import type { World } from '../ecs/world';
import type { Entity } from '../types';

/** One entity found, how far it is from the point, and where it stands. */
export interface NearEntity {
    entity: Entity;
    distance: number;
    x: number;
    y: number;
}

/** @experimental */
export interface NearestOptions<D> {
    /** The farthest an entity may be and still be found, in world units (default: any distance). */
    radius?: number;
    /** The most entities returned, nearest first (default: all of them). */
    limit?: number;
    /** Whether an entity counts: asked with its component's data, after the radius. */
    filter?(entity: Entity, data: D): boolean;
    /** Which two world axes the distance is measured on: the screen plane (default) or the ground. */
    plane?: 'xy' | 'xz';
}

/** The entities carrying `component`, within `options.radius` of `from` and passing `options.filter`, nearest first. */
export function nearestEntities<D>(
    world: World, component: ComponentDef<D>, from: { x: number; y: number }, options: NearestOptions<D> = {},
): NearEntity[] {
    world.ensureTransformsComposed();
    const radius = options.radius ?? Infinity;
    const ground = options.plane === 'xz';
    const found: NearEntity[] = [];
    for (const entity of world.getEntitiesWithComponents([component, Transform])) {
        if (world.has(entity, Disabled)) continue;
        const at = (world.get(entity, Transform) as TransformData).worldPosition;
        const y = ground ? at.z : at.y;
        const distance = Math.hypot(at.x - from.x, y - from.y);
        if (distance > radius) continue;
        if (options.filter && !options.filter(entity, world.get(entity, component) as D)) continue;
        found.push({ entity, distance, x: at.x, y });
    }
    found.sort((a, b) => a.distance - b.distance);
    return options.limit !== undefined ? found.slice(0, Math.max(options.limit, 0)) : found;
}

/**
 * The markers near a point, nearest first. `type` keeps only markers of that type (or any of several); `has` keeps only those whose `properties` carry every
 * given key and value.
 */
export function nearestMarkers(
    world: World, from: { x: number; y: number },
    options: Omit<NearestOptions<MarkerData>, 'filter'> & { type?: string | readonly string[]; has?: Readonly<Record<string, string>> } = {},
): NearEntity[] {
    const types = options.type === undefined ? null : typeof options.type === 'string' ? [options.type] : options.type;
    const { type: _type, has, ...rest } = options;
    return nearestEntities(world, Marker, from, {
        ...rest,
        filter: (_entity, marker) => (types === null || types.includes(marker.type))
            && (has === undefined || Object.entries(has).every(([key, value]) => marker.properties[key] === value)),
    });
}
