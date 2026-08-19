// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    entityPick.ts
 * @brief   Which entities a click lands on, for whoever is holding a camera.
 *
 * The editor's viewport and a running game ask the same question of the same
 * boxes. They asked it twice, and the two answers had drifted: one knew a mesh's
 * extent and the other boxed a model as a point.
 */
import type { Entity, Vec3 } from '../types';
import type { World } from './world';
import type { WorldRay } from '../ui/util/math';
import { Transform, Sprite } from './component';
import { layerOrderOf, rankPickCandidates, type PickCandidate } from '../render/layerOrder';
import {
    entityWorldBox, meshWorldBox, entityBoxRayHit, type LayoutWorld,
} from './entityBox';

/** Sorting layer for an entity that has none of its own, where a realm draws a
 *  gizmo for it: above every real layer, so a small marker wins against the
 *  sprite it sits on. A realm that draws no gizmos has nothing up there. */
const GIZMO_PICK_LAYER = 1e6;

/**
 * The reads a pick needs: a box's, plus the World's own list of entities.
 *
 * @experimental
 */
export type PickWorld = LayoutWorld & Pick<World, 'getAllEntities'>;

/** @experimental */
export interface EntityPickOptions {
    /**
     * World half-size of the box given to entities that draw nothing — a camera,
     * a light, an empty. Zero (the default) leaves them unpickable, which is what
     * a realm that draws no gizmo for them wants. A function when the icon's size
     * is a screen size (see {@link EntityBoxOptions.iconHalf}).
     */
    iconHalf?: number | ((at: Vec3) => number);
    /** Entities this realm refuses to select. Everything is selectable by default. */
    pickable?(entity: Entity): boolean;
    /** The project's sorting-layer masks, so hits rank the way the frame stacked them. */
    ySortLayers?: number;
    depthLayers?: number;
}

/**
 * Entities the ray meets, topmost first.
 *
 * The ray decides what is hit; the layer rules decide which of the hits is on
 * top, because that is what the renderer stacked them by and a click that ranked
 * them any other way selects something the person cannot see.
 *
 * @experimental
 */
export function pickEntitiesByRay(
    world: PickWorld, ray: WorldRay, opts: EntityPickOptions = {},
): Entity[] {
    const iconHalf = opts.iconHalf ?? 0;
    // Whether icons are pickable at all, which is the question here — how big one is
    // where it stands is entityWorldBox's.
    const unlayered = (typeof iconHalf === 'function' || iconHalf > 0) ? GIZMO_PICK_LAYER : 0;
    const hits: PickCandidate<Entity>[] = [];
    for (const entity of world.getAllEntities()) {
        if (!world.valid(entity) || !world.has(entity, Transform)) continue;
        if (opts.pickable && !opts.pickable(entity)) continue;
        // A mesh's extent is in its vertices, so it is asked for before the icon
        // fallback would answer with the size of a gizmo.
        const box = meshWorldBox(world, entity) ?? entityWorldBox(world, entity, { iconHalf });
        if (!box || entityBoxRayHit(box, ray.origin, ray.dir) === null) continue;

        const layer = world.has(entity, Sprite) ? world.get(entity, Sprite).layer : unlayered;
        const t = world.get(entity, Transform);
        hits.push({
            entity,
            index: hits.length,
            rank: {
                layer,
                order: layerOrderOf(layer, opts.ySortLayers ?? 0, opts.depthLayers ?? 0),
                worldY: t.worldPosition.y,
                worldZ: t.worldPosition.z ?? 0,
            },
        });
    }
    return rankPickCandidates(hits);
}
