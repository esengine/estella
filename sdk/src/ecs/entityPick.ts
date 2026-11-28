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
import { isValidEntity, type Entity, type Vec2, type Vec3 } from '../types';
import { World } from './world';
import type { WorldRay } from '../ui/util/math';
import { Transform, MeshRenderer, ShapeRenderer, Sprite, SortingGroup, Parent, type SortingGroupData, type TransformData } from './component';
import { borrowedComponentReader } from './borrowedComponentReader';
import {
    firstRankedPick, layerOrderOf, layerVisibleToCamera, rankPickCandidates, sortingIdentity, type PickCandidate,
} from '../render/layerOrder';
import {
    resolveEntityWorldBox, resolveMeshWorldBox, entityBoxRayHit, parallaxOffset, shapeWorldBox, translateBox, withMeshBounds, withSpriteBounds,
    type EntityBox, type LayoutWorld, type EntityBoxOptions,
} from './entityBox';

/** Sorting layer for an entity that has none of its own, where a realm draws a
 *  gizmo for it: above every real layer, so a small marker wins against the
 *  sprite it sits on. A realm that draws no gizmos has nothing up there. */
const GIZMO_PICK_LAYER = 1e6;
const NO_ENCLOSING_GROUPS: readonly { layer: number; order: number }[] = [];

/**
 * The two outermost groups enclosing the entity, in the order `sortingIdentity` needs.
 *
 * Resolve component readers once and walk live ancestry per hit. The bounds
 * callback can change the world between hits, so parent and group values are
 * read after each spatial test. The returned slots are borrowed until the next read.
 */
function createEnclosingGroupReader(world: PickWorld) {
    const readGroup = borrowedComponentReader(world, SortingGroup);
    const readParent = borrowedComponentReader(world, Parent);
    const coreWorld = world instanceof World ? world : null;
    const coreRegistry = coreWorld?.getCppRegistry();
    const optionalGroup = coreWorld?.builtin.resolvePtrGetter(SortingGroup._cppName) as
        ((entity: Entity) => SortingGroupData | null) | null | undefined;
    const outer = { layer: 0, order: 0 }, inner = { layer: 0, order: 0 };
    const two = [outer, inner], one = [outer];
    const seen = new Set<Entity>();
    return (entity: Entity): readonly { layer: number; order: number }[] => {
        // Core readers can answer missing components directly. Adapters and
        // speculative reads still go through the World's component surface.
        const registry = coreWorld?.getCppRegistry();
        const direct = !world.speculating && registry && registry === coreRegistry ? registry : null;
        seen.clear();
        let count = 0;
        let current: Entity = entity;
        for (;;) {
            const g = direct && optionalGroup ? optionalGroup(current)
                : world.has(current, SortingGroup) ? readGroup(current) : null;
            if (g?.enabled) {
                inner.layer = outer.layer;
                inner.order = outer.order;
                outer.layer = g.layer;
                outer.order = g.order;
                count++;
            }
            const parent = direct?.getParent ? direct.getParent(current).entity
                : world.has(current, Parent) ? readParent(current).entity : undefined;
            if (parent === undefined || !isValidEntity(parent)) break;
            seen.add(current);
            if (seen.has(parent)) break;
            current = parent;
        }
        return count > 1 ? two : count === 1 ? one : NO_ENCLOSING_GROUPS;
    };
}

/**
 * The reads a pick needs: a box's, plus the World's entity query in storage order.
 * Adapters supplying only the raw list are responsible for filtering activity.
 *
 * @experimental
 */
export type PickWorld = LayoutWorld & Pick<World, 'getAllEntities'>
    & Partial<Pick<World, 'getEntitiesWithComponents' | 'resolveGetter' | 'speculating'>>;

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
    /** The camera's parallax centre relative to its render origin. */
    parallaxCenter?: Readonly<Vec2>;
}

/**
 * Entities the ray meets, topmost first.
 *
 * A camera ray is bounded by its near and far planes. The layer rules decide which hit is on
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
    const readTransform = borrowedComponentReader(world, Transform);
    const repeated = visitPickHits(world, opts, rayIntersection(ray), readTransform, {
        ranked(entity, distance, identity, offsetY, opaque) {
            const candidate = rankRayHit(readTransform, opts, entity, hits.length + opaqueHits.length, identity, offsetY, opaque);
            if (opaque) opaqueHits.push({ candidate, distance });
            else hits.push(candidate);
        },
    });
    // Depth-tested opaque meshes occlude one another even across sorting layers.
    // Rank the nearest against the blended draws; keep the others for cycling.
    if (opaqueHits.length) {
        opaqueHits.sort((a, b) => a.distance - b.distance || b.candidate.index - a.candidate.index);
        hits.push(opaqueHits[0].candidate);
    }
    const ranked = rankPickCandidates(hits);
    for (let i = 1; i < opaqueHits.length; i++) ranked.push(opaqueHits[i].candidate.entity);
    return repeated ? [...new Set(ranked)] : ranked;
}

/** The topmost ray hit, with the same result as the first entry of {@link pickEntitiesByRay}. @experimental */
export function pickEntityByRay(world: PickWorld, ray: WorldRay, opts: EntityPickOptions = {}): Entity | null {
    const hits: PickCandidate<Entity>[] = [];
    let index = 0;
    let nearestOpaque: PickCandidate<Entity> | undefined;
    let nearestDistance = Infinity;
    const readTransform = borrowedComponentReader(world, Transform);
    visitPickHits(world, opts, rayIntersection(ray), readTransform, {
        ranked(entity, distance, identity, offsetY, opaque) {
            const position = index++;
            if (opaque && distance > nearestDistance) return;
            const candidate = rankRayHit(readTransform, opts, entity, position, identity, offsetY, opaque);
            if (opaque) {
                nearestOpaque = candidate;
                nearestDistance = distance;
            } else {
                hits.push(candidate);
            }
        },
    });
    // Later opaque hits at equal distance win, just as they do in the stack.
    // Keep the same draw ordering for blended hits and the nearest opaque hit.
    if (nearestOpaque) hits.push(nearestOpaque);
    return firstRankedPick(hits) ?? null;
}

function rayIntersection(ray: WorldRay): (box: EntityBox) => number | null {
    const maxDistance = ray.maxDistance ?? Infinity;
    return box => {
        const distance = entityBoxRayHit(box, ray.origin, ray.dir);
        return distance !== null && distance <= maxDistance ? distance : null;
    };
}

function rankRayHit(
    readTransform: (entity: Entity) => TransformData, opts: EntityPickOptions, entity: Entity, index: number,
    identity: ReturnType<typeof sortingIdentity>, offsetY: number, opaque?: boolean,
): PickCandidate<Entity> {
    const t = readTransform(entity);
    return {
        entity,
        index,
        rank: {
            layer: identity.layer,
            order: layerOrderOf(identity.layer, opts.ySortLayers ?? 0, opts.depthLayers ?? 0),
            orderInLayer: identity.orderInLayer,
            groupInner: identity.groupInner,
            opaque,
            worldY: t.worldPosition.y + offsetY,
            worldZ: t.worldPosition.z ?? 0,
        },
    };
}

/** Active, visible world entities whose pick bounds pass a spatial test, in storage order. @experimental */
export function pickEntitiesByBounds(
    world: PickWorld, intersects: (box: EntityBox, entity: Entity) => boolean, opts: EntityPickOptions = {},
): Entity[] {
    const hits: Entity[] = [];
    visitPickHits(world, opts, (box, entity) => intersects(box, entity) ? 0 : null, borrowedComponentReader(world, Transform),
        { unranked: entity => hits.push(entity) });
    return hits;
}

type PickHitVisitor =
    | { ranked(entity: Entity, distance: number, identity: ReturnType<typeof sortingIdentity>, offsetY: number, opaque?: boolean): void }
    | { unranked(entity: Entity): void };

function visitPickHits(
    world: PickWorld, opts: EntityPickOptions, intersect: (box: EntityBox, entity: Entity) => number | null,
    readTransform: (entity: Entity) => TransformData, visit: PickHitVisitor,
): boolean {
    const iconHalf = opts.iconHalf ?? 0;
    const cullingMask = opts.cullingMask ?? 0xFFFFFFFF;
    const unlayered = (typeof iconHalf === 'function' || iconHalf > 0) ? GIZMO_PICK_LAYER : 0;
    const readMesh = borrowedComponentReader(world, MeshRenderer);
    let groupsOf: ReturnType<typeof createEnclosingGroupReader> | undefined;
    let repeated = false;
    const unranked = 'unranked' in visit;
    const center = opts.parallaxCenter;
    const submit = (entity: Entity, box: EntityBox,
        drawable: { layer?: number; order?: number; parallax?: Vec2 } | null, opaque?: boolean) => {
        const offset = parallaxOffset(drawable?.parallax, center);
        const distance = intersect(translateBox(box, offset), entity);
        if (distance === null) return false;
        const needsLayer = cullingMask !== 0xFFFFFFFF && drawable;
        if (unranked && !needsLayer) {
            visit.unranked(entity);
            return true;
        }
        // The enclosing group owns the layer and order, as it does during draw submission.
        groupsOf ??= createEnclosingGroupReader(world);
        const groups = groupsOf(entity);
        const layer = drawable ? drawable.layer ?? 0 : unlayered;
        if (needsLayer && !layerVisibleToCamera(groups.length ? groups[0].layer : layer, cullingMask)) return false;
        if (unranked) visit.unranked(entity);
        else visit.ranked(entity, distance, sortingIdentity(groups, layer, drawable?.order ?? 0), offset?.y ?? 0, opaque);
        return true;
    };
    // Use the ECS query's effective activity, including the parent's switch.
    // An empty filter preserves storage order for draw-order ties.
    const entities = world.getEntitiesWithComponents?.([]) ?? world.getAllEntities();
    withMeshBounds(world, readMeshBounds => withSpriteBounds(world, readSprite => {
        for (const entity of entities) {
            if (!world.valid(entity) || !world.has(entity, Transform)) continue;
            if (opts.pickable && !opts.pickable(entity)) continue;
            // A mesh's extent is in its vertices, so it is asked for before the icon
            // fallback would answer with the size of a gizmo.
            const renderer = world.has(entity, MeshRenderer) ? readMesh(entity) : null;
            const hiddenMesh = renderer?.enabled === false;
            const meshBox = renderer && !hiddenMesh ? resolveMeshWorldBox(world, entity, readTransform, readMeshBounds) : null;
            const meshHit = !!(meshBox && submit(entity, meshBox, renderer, renderer?.opaque));
            if (unranked && meshHit) continue;
            if (meshBox ? !world.has(entity, Sprite) && !world.has(entity, ShapeRenderer)
                : opts.fallbackPickable && !opts.fallbackPickable(entity)) continue;
            const flat = resolveEntityWorldBox(world, entity, opts,
                { hiddenMesh, iconPickable: opts.iconPickable, readTransform, drawablesOnly: !!meshBox }, readSprite);
            const flatHit = !!(flat && submit(entity, flat.box, flat.drawable));
            if (unranked && flatHit) continue;
            repeated ||= meshHit && flatHit;
            // Sprite and ShapeRenderer have independent draws even on the same transform.
            if (flat?.sprite && world.has(entity, ShapeRenderer)) {
                const shape = world.get(entity, ShapeRenderer);
                if (shape.enabled !== false && submit(entity, shapeWorldBox(readTransform(entity), shape), shape)) {
                    repeated ||= meshHit || flatHit;
                }
            }
        }
    }));
    return repeated;
}
