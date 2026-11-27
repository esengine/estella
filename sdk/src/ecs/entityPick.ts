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
import { Transform, Sprite, ShapeRenderer, MeshRenderer, SortingGroup, Parent } from './component';
import {
    layerOrderOf, layerVisibleToCamera, rankPickCandidates, sortingIdentity, type PickCandidate,
} from '../render/layerOrder';
import {
    entityWorldBox, meshWorldBox, entityBoxRayHit, type LayoutWorld, type EntityBoxOptions,
} from './entityBox';

/** Sorting layer for an entity that has none of its own, where a realm draws a
 *  gizmo for it: above every real layer, so a small marker wins against the
 *  sprite it sits on. A realm that draws no gizmos has nothing up there. */
const GIZMO_PICK_LAYER = 1e6;

/**
 * The groups enclosing @p entity, OUTERMOST first — what `sortingIdentity` needs.
 *
 * Walked per hit rather than resolved once for the world: a pick sees a handful of
 * candidates, and a table built for all of them would be the renderer's job done a
 * second time, on a different clock, to answer about the frame that was drawn.
 */
function enclosingGroups(world: PickWorld, entity: Entity): { layer: number; order: number }[] {
    const chain: { layer: number; order: number }[] = [];
    let current: Entity | undefined = entity;
    const seen = new Set<Entity>();
    while (current !== undefined && !seen.has(current)) {
        seen.add(current);
        if (world.has(current, SortingGroup)) {
            const g = world.get(current, SortingGroup);
            if (g.enabled) chain.push({ layer: g.layer, order: g.order });
        }
        current = world.has(current, Parent) ? world.get(current, Parent).entity : undefined;
    }
    return chain.reverse();
}

/**
 * The reads a pick needs: a box's, plus the World's entity query in storage order.
 * Adapters supplying only the raw list are responsible for filtering activity.
 *
 * @experimental
 */
export type PickWorld = LayoutWorld & Pick<World, 'getAllEntities'> & Partial<Pick<World, 'getEntitiesWithComponents'>>;

/** @experimental */
export interface EntityPickOptions {
    /**
     * World half-size of the box given to entities that draw nothing — a camera,
     * a light, an empty. Zero (the default) leaves them unpickable, which is what
     * a realm that draws no gizmo for them wants. A function when the icon's size
     * is a screen size (see {@link EntityBoxOptions.iconHalf}).
     */
    iconHalf?: number | ((at: Vec3) => number);
    /** See {@link EntityBoxOptions.extentOf}. */
    extentOf?: EntityBoxOptions['extentOf'];
    /** Entities this realm refuses to select. Everything is selectable by default. */
    pickable?(entity: Entity): boolean;
    /** Whether to try other bounds for a selectable entity without a mesh box. */
    fallbackPickable?(entity: Entity): boolean;
    /** The project's sorting-layer masks, so hits rank the way the frame stacked them. */
    ySortLayers?: number;
    depthLayers?: number;
    /** Sorting layers drawn by the camera producing this ray. Defaults to all layers. */
    cullingMask?: number;
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
    const cullingMask = opts.cullingMask ?? 0xFFFFFFFF;
    // Whether icons are pickable at all, which is the question here — how big one is
    // where it stands is entityWorldBox's.
    const unlayered = (typeof iconHalf === 'function' || iconHalf > 0) ? GIZMO_PICK_LAYER : 0;
    const hits: PickCandidate<Entity>[] = [];
    const opaqueHits: { candidate: PickCandidate<Entity>; distance: number }[] = [];
    // Use the ECS query's effective activity, including the parent's switch.
    // An empty filter preserves storage order for draw-order ties.
    const entities = world.getEntitiesWithComponents?.([]) ?? world.getAllEntities();
    for (const entity of entities) {
        if (!world.valid(entity) || !world.has(entity, Transform)) continue;
        if (opts.pickable && !opts.pickable(entity)) continue;
        // A mesh's extent is in its vertices, so it is asked for before the icon
        // fallback would answer with the size of a gizmo.
        const meshBox = meshWorldBox(world, entity);
        if (!meshBox && opts.fallbackPickable && !opts.fallbackPickable(entity)) continue;
        const box = meshBox ?? entityWorldBox(world, entity, { iconHalf, extentOf: opts.extentOf });
        if (!box) continue;
        const distance = entityBoxRayHit(box, ray.origin, ray.dir);
        if (distance === null) continue;

        const mesh = meshBox ? world.get(entity, MeshRenderer) : null;
        const sprite = mesh ? null : world.has(entity, Sprite) ? world.get(entity, Sprite)
            : world.has(entity, ShapeRenderer) ? world.get(entity, ShapeRenderer) : null;
        // A group owns the layer as well as the order, so the layer's RULE is asked of
        // the group's — the same resolution pushBatchDraw does, for the same reason.
        const identity = sortingIdentity(
            enclosingGroups(world, entity),
            mesh ? mesh.layer ?? 0 : sprite ? sprite.layer : unlayered,
            (sprite as { order?: number } | null)?.order ?? 0,
        );
        if (cullingMask !== 0xFFFFFFFF && (mesh || sprite) && !layerVisibleToCamera(identity.layer, cullingMask)) continue;
        const t = world.get(entity, Transform);
        const candidate: PickCandidate<Entity> = {
            entity,
            index: hits.length + opaqueHits.length,
            rank: {
                layer: identity.layer,
                order: layerOrderOf(identity.layer, opts.ySortLayers ?? 0, opts.depthLayers ?? 0),
                orderInLayer: identity.orderInLayer,
                groupInner: identity.groupInner,
                opaque: mesh?.opaque,
                worldY: t.worldPosition.y,
                worldZ: t.worldPosition.z ?? 0,
            },
        };
        if (mesh?.opaque) opaqueHits.push({ candidate, distance });
        else hits.push(candidate);
    }
    if (!opaqueHits.length) return rankPickCandidates(hits);

    // Depth-tested opaque meshes occlude one another even across sorting layers.
    // Rank the nearest against the blended draws; keep the others for cycling.
    opaqueHits.sort((a, b) => a.distance - b.distance || b.candidate.index - a.candidate.index);
    hits.push(opaqueHits[0].candidate);
    return rankPickCandidates(hits).concat(opaqueHits.slice(1).map(hit => hit.candidate.entity));
}
