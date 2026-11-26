// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    worldSnapshot.ts
 * @brief   A running world as an inspector shows it: the shallow tree, and one
 *          entity with its values — from the editor's Play realm and from a
 *          device alike.
 */
import type { App } from '../app/app';
import type { World } from '../ecs/world';
import { isLiveEntity, liveEntities } from '../ecs/liveEntityHandles';
import { getComponent, renderableComponents, type AnyComponentDef, type RenderableComponentDef } from '../ecs/component';
import { getComponentAssetFieldDescriptors } from '../scene/scene';
import { Assets } from '../asset/AssetPlugin';
import { UINode, UIDisplay } from '../ui/core/ui-node';
import { sceneOriginOf } from '../scene/sceneOrigins';

/** Kept as the tree's own shape (name, parent, children) rather than as rows. */
const STRUCTURAL = new Set(['Name', 'Parent', 'Children', 'WorldTransform']);

type RendererPriority = { definition: RenderableComponentDef; rank: number };
const rendererPriorities = new WeakMap<readonly RenderableComponentDef[], ReadonlyMap<string, RendererPriority>>();

function rendererPriorityIndex(): ReadonlyMap<string, RendererPriority> {
    const renderers = renderableComponents();
    let index = rendererPriorities.get(renderers);
    if (!index) {
        index = new Map(renderers.map((definition, rank) => [definition._name, { definition, rank }]));
        rendererPriorities.set(renderers, index);
    }
    return index;
}

export interface SnapshotComponent {
    type: string;
    data: Record<string, unknown>;
}

export interface SnapshotEntity {
    id: number;
    name: string;
    parent: number | null;
    children: number[];
    /** Types only in the tree; values only for the entity asked for. */
    components: SnapshotComponent[];
    /** Whether it has something to hide, and whether it is hidden. */
    hideable?: boolean;
    hidden?: boolean;
    /** The id of the document entity it was loaded from, for the entry scene's. */
    src?: number;
}

export interface WorldSnapshot {
    tree: { version: '1.0'; name: 'live'; entities: SnapshotEntity[] } | null;
    selected: SnapshotEntity | null;
}

export interface WorldSnapshotOptions {
    /** The scene whose entities carry their document id (`src`). */
    entryScene?: string;
    /** Turns an asset's load path into the one its reader knows it by. */
    assetPath?: (path: string) => string | null;
}

/** Authoring inspection omits transient state; runtime diagnostics may request
 * it explicitly. The tree's own structural fields remain separate. */
export function inspectableTypes(world: World, entity: number, includeTransient = false): string[] {
    return filterInspectableTypes(world.getComponentTypes(entity as never), includeTransient);
}

function filterInspectableTypes(types: string[], includeTransient = false): string[] {
    return types.filter((t) => {
        if (STRUCTURAL.has(t)) return false;
        const def = getComponent(t);
        return !!def && (includeTransient || !def.transient);
    });
}

/**
 * Rewrite handle-valued asset fields to the load paths behind them. A World stores
 * handles; an inspector speaks refs, and a handle shown raw reads as an empty slot.
 * Handles nobody can name pass through untouched.
 */
export function translateAssetHandles(
    components: readonly SnapshotComponent[],
    pathForHandle: (kind: string, handle: number) => string | null,
): SnapshotComponent[] {
    return components.map(({ type, data }) => {
        let out: Record<string, unknown> | null = null;
        for (const d of getComponentAssetFieldDescriptors(type)) {
            const v = data[d.field];
            if (typeof v !== 'number' || v === 0) continue;
            const path = pathForHandle(d.type, v);
            if (path !== null) (out ??= { ...data })[d.field] = path;
        }
        return out ? { type, data: out } : { type, data };
    });
}

/**
 * @p app's world: the tree when @p withTree (O(entities), so a caller polling one
 * entity's values skips it), and @p selectedId's values when given.
 */
export function worldSnapshot(
    app: App, selectedId: number | null, withTree: boolean, opts: WorldSnapshotOptions = {},
): WorldSnapshot {
    const world = app.world;
    if (selectedId != null && !isLiveEntity(world, selectedId as never)) selectedId = null;
    if (!withTree && selectedId == null) return { tree: null, selected: null };
    const nameDef = getComponent('Name');
    const parentDef = getComponent('Parent');
    const childrenDef = getComponent('Children');
    const ownerDef = getComponent('SceneOwner');
    const all = withTree ? liveEntities(world) : [];
    const treeTypes = withTree ? world.getComponentTypesBatch(all) : null;
    const detailTypes = !withTree && selectedId != null ? world.getComponentTypes(selectedId as never) : null;
    let parentReader: ReturnType<World['resolveGetter']> | undefined;
    const parentValue = (entity: number, types: string[]): number | undefined => {
        if (!parentDef || !types.includes(parentDef._name)) return undefined;
        if (parentReader === undefined) parentReader = world.resolveGetter(parentDef);
        // Membership comes from the current core, not the SDK's hierarchy cache.
        // Only the scalar escapes a reader that may borrow its component value.
        const p = (parentReader ? parentReader(entity as never) : world.get(entity as never, parentDef)) as { entity?: number } | null;
        return p?.entity;
    };

    const parentOf = new Map<number, number>();
    const childrenOf = new Map<number, number[]>();
    if (!withTree && selectedId != null && childrenDef) {
        const parent = parentValue(selectedId, detailTypes!);
        if (parent !== undefined && isLiveEntity(world, parent as never)) parentOf.set(selectedId, parent);
        // Native hierarchy writers can move children without updating the SDK's
        // membership cache. Ask the current core before reading this relation.
        const hasChildren = world.resolveHas(childrenDef);
        let c: { entities?: number[] } | null = null;
        if (!hasChildren) {
            c = world.tryGet(selectedId as never, childrenDef) as { entities?: number[] } | null;
        } else if (hasChildren(selectedId as never)) {
            const read = world.resolveGetter(childrenDef, 'retained');
            c = (read ? read(selectedId as never) : world.tryGet(selectedId as never, childrenDef)) as { entities?: number[] } | null;
        }
        if (c?.entities?.length) {
            // Children is maintained with Parent. The inspector's order is the
            // world's storage order, which can differ from attachment order.
            const members = new Set(c.entities);
            childrenOf.set(selectedId, world.getAllEntities().filter(e => members.has(e) && isLiveEntity(world, e)));
        }
    } else if (parentDef) {
        const entities = withTree ? all : liveEntities(world);
        const types = treeTypes ?? world.getComponentTypesBatch(entities);
        let live: Set<number> | undefined;
        for (let i = 0; i < entities.length; i++) {
            const entity = entities[i];
            const parent = parentValue(entity, types[i]);
            if (parent === undefined || !(live ??= new Set(entities)).has(parent)) continue;
            parentOf.set(entity, parent);
            const children = childrenOf.get(parent);
            if (children) children.push(entity);
            else childrenOf.set(parent, [entity]);
        }
    }

    const nameOf = (e: number): string =>
        (nameDef ? (world.tryGet(e as never, nameDef) as { value?: string } | null)?.value : undefined) ?? `Entity_${e}`;
    const priorities = rendererPriorityIndex();
    const visibilityReaders = new Map<AnyComponentDef, (entity: number) => unknown>();
    const visibilityOf = (e: number, types: string[]): Pick<SnapshotEntity, 'hideable' | 'hidden'> => {
        let source: AnyComponentDef | undefined;
        let rank = Infinity;
        for (const type of types) {
            if (type === UINode._name) {
                source = UINode;
                break;
            }
            const candidate = priorities.get(type);
            if (candidate && candidate.rank < rank) {
                source = candidate.definition;
                rank = candidate.rank;
            }
        }
        if (!source) return {};
        let read = visibilityReaders.get(source);
        if (!read) {
            const getter = world.resolveGetter(source);
            read = getter ? (entity) => getter(entity as never) : (entity) => world.get(entity as never, source);
            visibilityReaders.set(source, read);
        }
        // Only the flag escapes: direct getters borrow their component value.
        const field = source === UINode ? 'display' : source.renderableField!;
        const value = read(e) as Record<string, unknown> | null;
        const data = value && value[field] !== undefined ? value : world.get(e as never, source) as Record<string, unknown>;
        const hidden = source === UINode ? data.display === UIDisplay.None : data[field] === false;
        return { hideable: true, hidden };
    };
    // Only the entry scene's ids name documents an editor has open.
    const srcOf = (e: number): number | undefined => {
        if (opts.entryScene === undefined) return undefined;
        const owner = ownerDef ? (world.tryGet(e as never, ownerDef) as { scene?: string } | null) : null;
        if ((owner?.scene ?? '') !== opts.entryScene) return undefined;
        return sceneOriginOf(app, e as never);
    };
    const shape = (id: number, components: SnapshotComponent[], types: string[]): SnapshotEntity => {
        const src = srcOf(id);
        return {
            id, name: nameOf(id), parent: parentOf.get(id) ?? null, children: childrenOf.get(id) ?? [],
            components, ...visibilityOf(id, types), ...(src === undefined ? {} : { src }),
        };
    };

    let selectedTypes: string[] | null = null;
    const tree = withTree
        ? {
            version: '1.0' as const, name: 'live' as const,
            entities: all.map((e, index) => {
                const id = e as never as number;
                const types = treeTypes![index];
                if (id === selectedId) selectedTypes = types;
                return shape(id, filterInspectableTypes(types).map((type) => ({ type, data: {} })), types);
            }),
        }
        : null;

    let selected: SnapshotEntity | null = null;
    if (selectedId != null) {
        const types = selectedTypes ?? detailTypes ?? world.getComponentTypes(selectedId as never);
        const raw = filterInspectableTypes(types)
            .map((type) => {
                const def = getComponent(type);
                const data = def ? world.tryGet(selectedId as never, def) : null;
                return data ? { type, data: data as Record<string, unknown> } : null;
            })
            .filter((c): c is SnapshotComponent => !!c);
        const assets = app.hasResource(Assets) ? app.getResource(Assets) : null;
        const components = translateAssetHandles(raw, (kind, handle) => {
            const p = assets?.pathForHandle(kind, handle) ?? null;
            return p === null ? null : (opts.assetPath ? opts.assetPath(p) : p);
        });
        selected = shape(selectedId, components, types);
    }
    return { tree, selected };
}
