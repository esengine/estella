// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    partitionWorld.ts
 * @brief   Cutting one authored world into a persistent scene plus cells.
 *
 * @details Spatial partition is COOKED content. A packaged game that walked its
 *          whole world at boot to decide who lives where has already paid for the
 *          world it was trying not to load.
 *
 *          Only TOP-LEVEL entities are placed. That is what makes a subtree the
 *          residency atom rather than a rule to remember: a door cannot be sorted
 *          away from its house, because the door was never asked. Placing by each
 *          entity's own world position is the version of this that leaves children
 *          behind when their parent unloads, and it takes the hierarchy contract
 *          with it.
 *
 *          Pure: the caller supplies what only a project can answer — which
 *          fields hold entity references, and where a prefab's root sits.
 */

import { isPrefabEntry } from 'esengine';
import type {
    SceneData, SceneEntityData, SceneComponentData, SceneEntry, PrefabInstanceEntry,
} from 'esengine';

interface Vec3 { x: number; y: number; z: number }

/** Where a prefab asset's root sits, for an instance that does not override it. */
export interface PrefabRoot {
    rootId: string;
    position: Vec3;
}

export interface PartitionOptions {
    /** The entity-valued fields of a component type; empty for most. */
    entityFieldsOf(componentType: string): readonly string[];
    /** Resolve a scene's `@uuid:` prefab reference. Absent = instances must override. */
    resolvePrefab?(ref: string): PrefabRoot | null;
}

/** One cooked cell: what it covers, and the scene document that fills it. */
export interface PartitionedCell {
    name: string;
    x: number;
    z: number;
    minX: number;
    minZ: number;
    maxX: number;
    maxZ: number;
    entityCount: number;
    rootCount: number;
    data: SceneData;
}

export interface WorldPartition {
    cellSize: number;
    /** The entry scene as it now ships: everything residency never removes. */
    persistent: SceneData;
    cells: PartitionedCell[];
    /**
     * Authored ids a cell references in the persistent world. The runtime needs
     * exactly these to resolve across the document boundary.
     */
    persistentRefs: number[];
    /** Refuse the build. A dangling hard reference is not a warning. */
    errors: string[];
    warnings: string[];
}

const ORIGIN: Vec3 = { x: 0, y: 0, z: 0 };

/** A scene entry's authored name; a prefab instance carries one the type omits. */
function nameOf(entry: SceneEntry): string {
    return (entry as { name?: string }).name ?? '';
}

function componentsOf(entry: SceneEntry): SceneComponentData[] {
    return isPrefabEntry(entry) ? [] : (entry as SceneEntityData).components ?? [];
}

/**
 * Whether an entry carries a component, counting the one a prefab instance ADDS
 * — the only way to mark an instance, since its own list is the delta.
 */
function hasComponent(entry: SceneEntry, type: string): boolean {
    if (!isPrefabEntry(entry)) {
        return componentsOf(entry).some((component) => component.type === type);
    }
    return (entry as PrefabInstanceEntry).overrides.some(
        (override) => override.type === 'component_added' && override.componentType === type,
    );
}

function componentData(entry: SceneEntry, type: string): Record<string, unknown> | null {
    for (const component of componentsOf(entry)) {
        if (component.type === type) return component.data as Record<string, unknown>;
    }
    return null;
}

function vec3(value: unknown, fallback: Vec3): Vec3 {
    if (value === null || typeof value !== 'object') return fallback;
    const v = value as Partial<Vec3>;
    return {
        x: typeof v.x === 'number' ? v.x : fallback.x,
        y: typeof v.y === 'number' ? v.y : fallback.y,
        z: typeof v.z === 'number' ? v.z : fallback.z,
    };
}

/**
 * The position an entry declares, in its parent's space.
 *
 * A prefab instance's is an override over the asset's root, which is why the
 * asset has to be resolvable: an instance placed at the origin and an instance
 * that never said where it goes are the same document without it.
 */
function localPosition(
    entry: SceneEntry, options: PartitionOptions, problems: string[],
): Vec3 {
    if (!isPrefabEntry(entry)) {
        const transform = componentData(entry, 'Transform');
        return transform ? vec3(transform.position, ORIGIN) : ORIGIN;
    }
    const instance = entry as PrefabInstanceEntry;
    const asset = options.resolvePrefab?.(instance.prefab) ?? null;
    if (asset === null) {
        problems.push(
            `entity ${instance.id} ("${nameOf(instance)}") instances a prefab this cook cannot read `
            + `(${instance.prefab}), so where it stands is unknown`,
        );
        return ORIGIN;
    }
    for (const override of instance.overrides) {
        if (override.type !== 'property' || override.prefabEntityId !== asset.rootId) continue;
        if (override.componentType === 'Transform' && override.propertyName === 'position') {
            return vec3(override.value, asset.position);
        }
    }
    return asset.position;
}

/** Rotation and scale, for composing where a CHILD ends up. Identity by default. */
function localRotation(entry: SceneEntry): [number, number, number, number] {
    const transform = isPrefabEntry(entry) ? null : componentData(entry, 'Transform');
    const r = transform?.rotation as Partial<{ x: number; y: number; z: number; w: number }> | undefined;
    if (!r) return [0, 0, 0, 1];
    return [r.x ?? 0, r.y ?? 0, r.z ?? 0, r.w ?? 1];
}

function localScale(entry: SceneEntry): Vec3 {
    const transform = isPrefabEntry(entry) ? null : componentData(entry, 'Transform');
    return transform ? vec3(transform.scale, { x: 1, y: 1, z: 1 }) : { x: 1, y: 1, z: 1 };
}

/** Rotate `v` by the quaternion `q`. */
function rotate(q: readonly [number, number, number, number], v: Vec3): Vec3 {
    const [qx, qy, qz, qw] = q;
    const tx = 2 * (qy * v.z - qz * v.y);
    const ty = 2 * (qz * v.x - qx * v.z);
    const tz = 2 * (qx * v.y - qy * v.x);
    return {
        x: v.x + qw * tx + (qy * tz - qz * ty),
        y: v.y + qw * ty + (qz * tx - qx * tz),
        z: v.z + qw * tz + (qx * ty - qy * tx),
    };
}

function multiplyQuat(
    a: readonly [number, number, number, number], b: readonly [number, number, number, number],
): [number, number, number, number] {
    const [ax, ay, az, aw] = a;
    const [bx, by, bz, bw] = b;
    return [
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
        aw * bw - ax * bx - ay * by - az * bz,
    ];
}

interface Placement {
    /** Grid coordinate, or null for the persistent world. */
    cell: { x: number; z: number } | null;
    root: number;
}

/**
 * Cut `scene` into a persistent scene plus cells, or answer null when the scene
 * never declared itself streamed — which is every scene that came before this
 * and every small one that should stay whole.
 */
export function partitionWorld(
    scene: SceneData, sceneName: string, options: PartitionOptions,
): WorldPartition | null {
    const entries = (scene.entities ?? []) as unknown as SceneEntry[];
    let cellSize = 0;
    for (const entry of entries) {
        if (!hasComponent(entry, 'StreamedWorld')) continue;
        const declaration = componentData(entry, 'StreamedWorld');
        if (declaration && declaration.enabled === false) return null;
        cellSize = typeof declaration?.cellSize === 'number' ? declaration.cellSize : 0;
        break;
    }
    if (cellSize <= 0) {
        // A declaration with no usable size is a mistake worth naming, but a
        // scene with no declaration at all is simply not a streamed world.
        return entries.some((entry) => hasComponent(entry, 'StreamedWorld'))
            ? {
                cellSize: 0, persistent: scene, cells: [], persistentRefs: [],
                errors: [`StreamedWorld in "${sceneName}" declares no positive cellSize`],
                warnings: [],
            }
            : null;
    }

    const errors: string[] = [];
    const warnings: string[] = [];
    const byId = new Map<number, SceneEntry>();
    for (const entry of entries) byId.set(entry.id, entry);

    const childrenOf = new Map<number, number[]>();
    const roots: number[] = [];
    for (const entry of entries) {
        const parent = entry.parent;
        if (parent === null || parent === undefined || !byId.has(parent)) {
            if (parent !== null && parent !== undefined) {
                warnings.push(`entity ${entry.id} names a parent (${parent}) the scene does not hold`);
            }
            roots.push(entry.id);
            continue;
        }
        const siblings = childrenOf.get(parent);
        if (siblings) siblings.push(entry.id);
        else childrenOf.set(parent, [entry.id]);
    }

    // Subtree membership and composed world positions in one walk: the placement
    // comes from the ROOT, and the positions are what the cell's box has to cover.
    const placement = new Map<number, Placement>();
    const worldPosition = new Map<number, Vec3>();
    const members = new Map<number, number[]>();
    for (const root of roots) {
        const entry = byId.get(root)!;
        const streamed = !hasComponent(entry, 'WorldPersistent')
            && !hasComponent(entry, 'StreamedWorld')
            && (isPrefabEntry(entry) || componentData(entry, 'Transform') !== null);
        const rootPosition = localPosition(entry, options, errors);
        const cell = streamed
            ? { x: Math.floor(rootPosition.x / cellSize), z: Math.floor(rootPosition.z / cellSize) }
            : null;

        const subtree: number[] = [];
        const stack: Array<{ id: number; position: Vec3; rotation: [number, number, number, number]; scale: Vec3 }> = [
            { id: root, position: rootPosition, rotation: localRotation(entry), scale: localScale(entry) },
        ];
        while (stack.length > 0) {
            const node = stack.pop()!;
            subtree.push(node.id);
            placement.set(node.id, { cell, root });
            worldPosition.set(node.id, node.position);
            for (const child of childrenOf.get(node.id) ?? []) {
                const childEntry = byId.get(child)!;
                const local = localPosition(childEntry, options, errors);
                const scaled = { x: local.x * node.scale.x, y: local.y * node.scale.y, z: local.z * node.scale.z };
                const turned = rotate(node.rotation, scaled);
                stack.push({
                    id: child,
                    position: { x: node.position.x + turned.x, y: node.position.y + turned.y, z: node.position.z + turned.z },
                    rotation: multiplyQuat(node.rotation, localRotation(childEntry)),
                    scale: {
                        x: node.scale.x * localScale(childEntry).x,
                        y: node.scale.y * localScale(childEntry).y,
                        z: node.scale.z * localScale(childEntry).z,
                    },
                });
            }
        }
        members.set(root, subtree);
    }

    for (const entry of entries) {
        if (roots.includes(entry.id)) continue;
        if (hasComponent(entry, 'WorldPersistent')) {
            errors.push(
                `entity ${entry.id} ("${nameOf(entry)}") carries WorldPersistent but is not top-level — `
                + 'a subtree is the residency atom, so persistence is its root\'s answer',
            );
        }
        if (hasComponent(entry, 'StreamedWorld')) {
            errors.push(`entity ${entry.id} ("${nameOf(entry)}") carries StreamedWorld but is not top-level`);
        }
    }

    const persistentRefs = new Set<number>();
    checkReferences(entries, byId, placement, options, persistentRefs, errors);

    // Sorted, so two cooks of one world produce the same manifest.
    const cellKeys = new Map<string, number[]>();
    const persistentRoots: number[] = [];
    for (const root of roots) {
        const cell = placement.get(root)!.cell;
        if (cell === null) { persistentRoots.push(root); continue; }
        const key = `${cell.x}_${cell.z}`;
        const bucket = cellKeys.get(key);
        if (bucket) bucket.push(root);
        else cellKeys.set(key, [root]);
    }

    const order = new Map<number, number>();
    entries.forEach((entry, index) => order.set(entry.id, index));
    const documentOf = (ids: number[], name: string): SceneData => {
        const kept = new Set(ids);
        const list = entries.filter((entry) => kept.has(entry.id))
            .map((entry) => ({ ...entry, parent: byId.has(entry.parent as number) ? entry.parent : null }));
        return {
            version: scene.version,
            name,
            ...(scene.generator ? { generator: scene.generator } : {}),
            entities: list as unknown as SceneEntityData[],
            ...(scene.textureMetadata ? { textureMetadata: scene.textureMetadata } : {}),
        };
    };

    const persistentIds: number[] = [];
    for (const root of persistentRoots) persistentIds.push(...members.get(root)!);
    persistentIds.sort((a, b) => order.get(a)! - order.get(b)!);

    const cells: PartitionedCell[] = [];
    const keys = [...cellKeys.keys()].sort((a, b) => {
        const [ax, az] = a.split('_').map(Number);
        const [bx, bz] = b.split('_').map(Number);
        return ax - bx || az - bz;
    });
    for (const key of keys) {
        const [x, z] = key.split('_').map(Number);
        const ids: number[] = [];
        for (const root of cellKeys.get(key)!) ids.push(...members.get(root)!);
        ids.sort((a, b) => order.get(a)! - order.get(b)!);
        let minX = x * cellSize;
        let minZ = z * cellSize;
        let maxX = minX + cellSize;
        let maxZ = minZ + cellSize;
        // The grid square unioned with where the content actually is: a prop
        // hanging over the edge is part of the place the box stands for, and a
        // box that stops short of it pops the prop in at the boundary.
        for (const id of ids) {
            const at = worldPosition.get(id)!;
            minX = Math.min(minX, at.x); maxX = Math.max(maxX, at.x);
            minZ = Math.min(minZ, at.z); maxZ = Math.max(maxZ, at.z);
        }
        const name = `${sceneName}.cell_${x}_${z}`;
        cells.push({
            name, x, z, minX, minZ, maxX, maxZ,
            entityCount: ids.length,
            rootCount: cellKeys.get(key)!.length,
            data: documentOf(ids, name),
        });
    }

    return {
        cellSize,
        persistent: documentOf(persistentIds, scene.name),
        cells,
        persistentRefs: [...persistentRefs].sort((a, b) => a - b),
        errors,
        warnings,
    };
}

/**
 * Hard entity references, held to what residency can keep true.
 *
 * Same cell is fine, and so is streamed-to-persistent (the persistent world
 * outlives every cell). The other two directions point at something residency is
 * entitled to delete, and are refused.
 */
function checkReferences(
    entries: readonly SceneEntry[],
    byId: ReadonlyMap<number, SceneEntry>,
    placement: ReadonlyMap<number, Placement>,
    options: PartitionOptions,
    persistentRefs: Set<number>,
    errors: string[],
): void {
    // One document, whether that is the persistent scene or one cell: everything
    // in it comes and goes together, so a reference inside it can never dangle.
    const sameDocument = (a: Placement, b: Placement): boolean =>
        a.cell === null
            ? b.cell === null
            : b.cell !== null && a.cell.x === b.cell.x && a.cell.z === b.cell.z;

    const check = (holder: SceneEntry, componentType: string, field: string, value: unknown): void => {
        const one = (candidate: unknown): void => {
            if (typeof candidate !== 'number' || !byId.has(candidate)) return;
            const from = placement.get(holder.id);
            const to = placement.get(candidate);
            if (!from || !to || from.root === to.root || sameDocument(from, to)) return;
            if (from.cell !== null && to.cell === null) { persistentRefs.add(candidate); return; }
            const where = to.cell === null ? 'the persistent world' : `cell ${to.cell.x},${to.cell.z}`;
            errors.push(
                `${componentType}.${field} on entity ${holder.id} ("${nameOf(holder)}") references `
                + `entity ${candidate} ("${nameOf(byId.get(candidate)!)}") in ${where} — `
                + 'residency may delete one without the other',
            );
        };
        if (Array.isArray(value)) value.forEach(one);
        else one(value);
    };

    for (const entry of entries) {
        if (!isPrefabEntry(entry)) {
            for (const component of (entry as SceneEntityData).components ?? []) {
                for (const field of options.entityFieldsOf(component.type)) {
                    check(entry, component.type, field, (component.data as Record<string, unknown>)[field]);
                }
            }
            continue;
        }
        // An instance's references live in its overrides; the asset's own are
        // internal to the instance and cannot cross a cell.
        for (const override of (entry as PrefabInstanceEntry).overrides) {
            if (override.type !== 'property' || !override.componentType || !override.propertyName) continue;
            if (!options.entityFieldsOf(override.componentType).includes(override.propertyName)) continue;
            check(entry, override.componentType, override.propertyName, override.value);
        }
    }
}
