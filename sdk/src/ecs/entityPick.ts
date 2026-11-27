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
import { Transform, MeshRenderer, SortingGroup, Parent, type MeshRendererData, type SortingGroupData, type ParentData } from './component';
import {
    layerOrderOf, layerVisibleToCamera, rankPickCandidates, sortingIdentity, type PickCandidate,
} from '../render/layerOrder';
import {
    resolveEntityWorldBox, meshWorldBox, entityBoxRayHit, type EntityBox, type LayoutWorld, type EntityBoxOptions,
} from './entityBox';

/** Sorting layer for an entity that has none of its own, where a realm draws a
 *  gizmo for it: above every real layer, so a small marker wins against the
 *  sprite it sits on. A realm that draws no gizmos has nothing up there. */
const GIZMO_PICK_LAYER = 1e6;

/**
 * The groups enclosing @p entity, OUTERMOST first — what `sortingIdentity` needs.
 *
 * Resolve component readers once and walk live ancestry per hit. The bounds
 * callback can change the world between hits, so parent and group values are
 * read after each spatial test.
 */
function createEnclosingGroupReader(world: PickWorld & Partial<Pick<World, 'resolveGetter'>>) {
    const groupGetter = world.resolveGetter?.(SortingGroup) as ((entity: Entity) => SortingGroupData) | null | undefined;
    const parentGetter = world.resolveGetter?.(Parent) as ((entity: Entity) => ParentData) | null | undefined;
    const readGroup = groupGetter ?? (entity => world.get(entity, SortingGroup));
    const readParent = parentGetter ?? (entity => world.get(entity, Parent));
    return (entity: Entity): { layer: number; order: number }[] => {
        const chain: { layer: number; order: number }[] = [];
        let current: Entity | undefined = entity;
        const seen = new Set<Entity>();
        while (current !== undefined && !seen.has(current)) {
            seen.add(current);
            if (world.has(current, SortingGroup)) {
                const g = readGroup(current);
                if (g.enabled) chain.push({ layer: g.layer, order: g.order });
            }
            current = world.has(current, Parent) ? readParent(current).entity : undefined;
        }
        return chain.reverse();
    };
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
    /** Whether an icon is drawn for an entity whose renderer is disabled. */
    iconPickable?(entity: Entity): boolean;
    /** The project's sorting-layer masks, so hits rank the way the frame stacked them. */
    ySortLayers?: number;
    depthLayers?: number;
    /** Sorting layers drawn by the camera. Defaults to all layers. */
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
    const hits: PickCandidate<Entity>[] = [];
    const opaqueHits: { candidate: PickCandidate<Entity>; distance: number }[] = [];
    visitPickHits(world, opts, box => entityBoxRayHit(box, ray.origin, ray.dir), {
        ranked(entity, distance, identity, opaque) {
            const t = world.get(entity, Transform);
            const candidate: PickCandidate<Entity> = {
                entity,
                index: hits.length + opaqueHits.length,
                rank: {
                    layer: identity.layer,
                    order: layerOrderOf(identity.layer, opts.ySortLayers ?? 0, opts.depthLayers ?? 0),
                    orderInLayer: identity.orderInLayer,
                    groupInner: identity.groupInner,
                    opaque,
                    worldY: t.worldPosition.y,
                    worldZ: t.worldPosition.z ?? 0,
                },
            };
            if (opaque) opaqueHits.push({ candidate, distance });
            else hits.push(candidate);
        },
    });
    if (!opaqueHits.length) return rankPickCandidates(hits);

    // Depth-tested opaque meshes occlude one another even across sorting layers.
    // Rank the nearest against the blended draws; keep the others for cycling.
    opaqueHits.sort((a, b) => a.distance - b.distance || b.candidate.index - a.candidate.index);
    hits.push(opaqueHits[0].candidate);
    return rankPickCandidates(hits).concat(opaqueHits.slice(1).map(hit => hit.candidate.entity));
}

/** Active, visible world entities whose pick bounds pass a spatial test, in storage order. @experimental */
export function pickEntitiesByBounds(
    world: PickWorld, intersects: (box: EntityBox, entity: Entity) => boolean, opts: EntityPickOptions = {},
): Entity[] {
    const hits: Entity[] = [];
    visitPickHits(world, opts, (box, entity) => intersects(box, entity) ? 0 : null, { unranked: entity => hits.push(entity) });
    return hits;
}

type PickHitVisitor =
    | { ranked(entity: Entity, distance: number, identity: ReturnType<typeof sortingIdentity>, opaque?: boolean): void }
    | { unranked(entity: Entity): void };

function visitPickHits(
    world: PickWorld, opts: EntityPickOptions, intersect: (box: EntityBox, entity: Entity) => number | null,
    visit: PickHitVisitor,
): void {
    const iconHalf = opts.iconHalf ?? 0;
    const cullingMask = opts.cullingMask ?? 0xFFFFFFFF;
    const unlayered = (typeof iconHalf === 'function' || iconHalf > 0) ? GIZMO_PICK_LAYER : 0;
    const fastWorld = world as PickWorld & Partial<Pick<World, 'resolveGetter'>>;
    const meshGetter = fastWorld.resolveGetter?.(MeshRenderer) as ((entity: Entity) => MeshRendererData) | null | undefined;
    const readMesh = meshGetter ?? (entity => world.get(entity, MeshRenderer));
    let groupsOf: ReturnType<typeof createEnclosingGroupReader> | undefined;
    // Use the ECS query's effective activity, including the parent's switch.
    // An empty filter preserves storage order for draw-order ties.
    const entities = world.getEntitiesWithComponents?.([]) ?? world.getAllEntities();
    for (const entity of entities) {
        if (!world.valid(entity) || !world.has(entity, Transform)) continue;
        if (opts.pickable && !opts.pickable(entity)) continue;
        // A mesh's extent is in its vertices, so it is asked for before the icon
        // fallback would answer with the size of a gizmo.
        const renderer = world.has(entity, MeshRenderer) ? readMesh(entity) : null;
        const hiddenMesh = renderer?.enabled === false;
        const meshBox = renderer && !hiddenMesh ? meshWorldBox(world, entity) : null;
        if (!meshBox && opts.fallbackPickable && !opts.fallbackPickable(entity)) continue;
        const fallback = meshBox ? null : resolveEntityWorldBox(world, entity, opts, { hiddenMesh, iconPickable: opts.iconPickable });
        const box = meshBox ?? fallback?.box;
        if (!box) continue;
        const distance = intersect(box, entity);
        if (distance === null) continue;

        const mesh = meshBox ? renderer : null;
        const sprite = fallback?.drawable;
        const needsLayer = cullingMask !== 0xFFFFFFFF && (mesh || sprite);
        // Area picks already arrive in storage order. A group matters only
        // when its layer determines whether the camera draws this hit.
        if ('unranked' in visit && !needsLayer) {
            visit.unranked(entity);
            continue;
        }
        // A group owns the layer as well as the order, so the layer's RULE is asked of
        // the group's — the same resolution pushBatchDraw does, for the same reason.
        groupsOf ??= createEnclosingGroupReader(fastWorld);
        const identity = sortingIdentity(
            groupsOf(entity),
            mesh ? mesh.layer ?? 0 : sprite ? sprite.layer : unlayered,
            (sprite as { order?: number } | null)?.order ?? 0,
        );
        if (needsLayer && !layerVisibleToCamera(identity.layer, cullingMask)) continue;
        if ('ranked' in visit) visit.ranked(entity, distance, identity, mesh?.opaque);
        else visit.unranked(entity);
    }
}
