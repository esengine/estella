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
import type { Entity } from '../types';
import { isLiveEntity, liveEntities } from '../ecs/liveEntityHandles';
import { getComponent, type AnyComponentDef } from '../ecs/component';
import { entityVisibilityIndex, entityVisibilitySource } from '../ecs/entityUtils';
import { getComponentAssetFieldDescriptors, withoutTransientComponentFields } from '../scene/scene';
import { Assets } from '../asset/AssetPlugin';
import { sceneOriginOf } from '../scene/sceneOrigins';

/** Kept as the tree's own shape (name, parent, children) rather than as rows. */
const STRUCTURAL = new Set(['Name', 'Parent', 'Children', 'WorldTransform']);

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
    return types.filter(type => inspectableDefinition(type, includeTransient) !== undefined);
}

function inspectableDefinition(type: string, includeTransient = false): AnyComponentDef | undefined {
    if (STRUCTURAL.has(type)) return undefined;
    const def = getComponent(type);
    return def && (includeTransient || !def.transient) ? def : undefined;
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
        let c: { entities?: Entity[] } | null = null;
        if (!hasChildren) {
            c = world.tryGet(selectedId as never, childrenDef) as { entities?: Entity[] } | null;
        } else if (hasChildren(selectedId as never)) {
            const read = world.resolveGetter(childrenDef, 'retained');
            c = (read ? read(selectedId as never) : world.tryGet(selectedId as never, childrenDef)) as { entities?: Entity[] } | null;
        }
        if (c?.entities?.length) {
            // Children is maintained with Parent. The inspector's order is the
            // world's storage order, which can differ from attachment order.
            childrenOf.set(selectedId, world.entitySubsetInStorageOrder(c.entities).filter(e => isLiveEntity(world, e)));
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
    const visibilityIndex = entityVisibilityIndex();
    const visibilityReaders = new Map<AnyComponentDef, (entity: number) => unknown>();
    const visibilityOf = (e: number, types: string[], components?: readonly SnapshotComponent[]): Pick<SnapshotEntity, 'hideable' | 'hidden'> => {
        const source = entityVisibilitySource(types, visibilityIndex);
        if (!source) return {};
        const { definition, name, field, hiddenValue } = source;
        const sampled = components?.find(component => component.type === name)?.data[field];
        if (sampled !== undefined) return { hideable: true, hidden: sampled === hiddenValue };
        let read = visibilityReaders.get(definition);
        if (!read) {
            const getter = world.resolveGetter(definition);
            read = getter ? (entity) => getter(entity as never) : (entity) => world.get(entity as never, definition);
            visibilityReaders.set(definition, read);
        }
        // Only the flag escapes: direct getters borrow their component value.
        const value = read(e) as Record<string, unknown> | null;
        const data = value && value[field] !== undefined ? value : world.get(e as never, definition) as Record<string, unknown>;
        return { hideable: true, hidden: data[field] === hiddenValue };
    };
    // Only the entry scene's ids name documents an editor has open.
    const srcOf = (e: number): number | undefined => {
        if (opts.entryScene === undefined) return undefined;
        const owner = ownerDef ? (world.tryGet(e as never, ownerDef) as { scene?: string } | null) : null;
        if ((owner?.scene ?? '') !== opts.entryScene) return undefined;
        return sceneOriginOf(app, e as never);
    };
    const shape = (id: number, components: SnapshotComponent[], visibility: Pick<SnapshotEntity, 'hideable' | 'hidden'>): SnapshotEntity => {
        const src = srcOf(id);
        return {
            id, name: nameOf(id), parent: parentOf.get(id) ?? null, children: childrenOf.get(id) ?? [],
            components, ...visibility, ...(src === undefined ? {} : { src }),
        };
    };

    let selectedIndex = -1;
    const tree = withTree
        ? {
            version: '1.0' as const, name: 'live' as const,
            entities: all.map((e, index) => {
                const id = e as never as number;
                const types = treeTypes![index];
                if (id === selectedId) selectedIndex = index;
                return shape(id, filterInspectableTypes(types).map((type) => ({ type, data: {} })), visibilityOf(id, types));
            }),
        }
        : null;

    let selected: SnapshotEntity | null = null;
    if (selectedId != null) {
        const types = treeTypes?.[selectedIndex] ?? detailTypes ?? world.getComponentTypes(selectedId as never);
        const raw: SnapshotComponent[] = [];
        for (const type of types) {
            const def = inspectableDefinition(type);
            if (!def) continue;
            // The current registry already confirmed membership. Read without the SDK's cached membership check.
            const data = world.get(selectedId as never, def) as Record<string, unknown> | undefined;
            if (data) raw.push({ type, data: withoutTransientComponentFields(def, data) });
        }
        const assets = app.hasResource(Assets) ? app.getResource(Assets) : null;
        const components = assets ? translateAssetHandles(raw, (kind, handle) => {
            const p = assets.pathForHandle(kind, handle);
            return p === null ? null : (opts.assetPath ? opts.assetPath(p) : p);
        }) : raw;
        const treeRow = tree?.entities[selectedIndex];
        selected = treeRow ? { ...treeRow, components } : shape(selectedId, components, visibilityOf(selectedId, types, raw));
    }
    return { tree, selected };
}
