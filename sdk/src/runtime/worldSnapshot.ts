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
import { getComponent } from '../ecs/component';
import { getComponentAssetFieldDescriptors } from '../scene/scene';
import { Assets } from '../asset/AssetPlugin';
import { hasVisibility, isEntityVisible } from '../ecs/entityUtils';
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

/** The component types an inspector shows for @p entity: not the tree's own
 *  structure, and never per-frame transient state. */
export function inspectableTypes(world: World, entity: number): string[] {
    return world.getComponentTypes(entity as never).filter((t) => {
        if (STRUCTURAL.has(t)) return false;
        const def = getComponent(t);
        return !!def && !def.transient;
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
    const nameDef = getComponent('Name');
    const parentDef = getComponent('Parent');
    const ownerDef = getComponent('SceneOwner');
    const all = world.getAllEntities();

    const parentOf = new Map<number, number>();
    if (parentDef) {
        for (const e of all) {
            const p = world.tryGet(e, parentDef) as { entity?: number } | null;
            if (p && p.entity !== undefined) parentOf.set(e as never as number, p.entity);
        }
    }
    const childrenOf = new Map<number, number[]>();
    for (const [child, parent] of parentOf) (childrenOf.get(parent) ?? childrenOf.set(parent, []).get(parent)!).push(child);

    const nameOf = (e: number): string =>
        (nameDef ? (world.tryGet(e as never, nameDef) as { value?: string } | null)?.value : undefined) ?? `Entity_${e}`;
    const visibilityOf = (e: number): Pick<SnapshotEntity, 'hideable' | 'hidden'> =>
        hasVisibility(world, e as never) ? { hideable: true, hidden: !isEntityVisible(world, e as never) } : {};
    // Only the entry scene's ids name documents an editor has open.
    const srcOf = (e: number): number | undefined => {
        if (opts.entryScene === undefined) return undefined;
        const owner = ownerDef ? (world.tryGet(e as never, ownerDef) as { scene?: string } | null) : null;
        if ((owner?.scene ?? '') !== opts.entryScene) return undefined;
        return sceneOriginOf(app, e as never);
    };
    const shape = (id: number, components: SnapshotComponent[]): SnapshotEntity => {
        const src = srcOf(id);
        return {
            id, name: nameOf(id), parent: parentOf.get(id) ?? null, children: childrenOf.get(id) ?? [],
            components, ...visibilityOf(id), ...(src === undefined ? {} : { src }),
        };
    };

    const tree = withTree
        ? {
            version: '1.0' as const, name: 'live' as const,
            entities: all.map((e) => {
                const id = e as never as number;
                return shape(id, inspectableTypes(world, id).map((type) => ({ type, data: {} })));
            }),
        }
        : null;

    let selected: SnapshotEntity | null = null;
    if (selectedId != null) {
        const raw = inspectableTypes(world, selectedId)
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
        selected = shape(selectedId, components);
    }
    return { tree, selected };
}
