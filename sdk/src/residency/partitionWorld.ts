// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    partitionWorld.ts
 * @brief   Cutting one authored world into a persistent scene plus cells.
 *
 * @details Lives in the runtime rather than the pipeline because a packaged build
 *          is not the only host that has to cut a world: an editor Play session
 *          cuts the unsaved document the same way, and two implementations of
 *          "which cell is this in" is two worlds.
 *
 *          The RESULT is still cooked content. A packaged game that walked its
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

import { isPrefabEntry, visitSceneEntryEntityReferences } from '../scene/sceneEntry';
import { cellAt, cellSquare, planeSecond } from './cells';
import { StreamPlane } from './components';
import { applyOverrides } from '../prefab/override';
import { composeTRS, multiplyAffine } from '../math/mat4';
import { INVALID_ENTITY } from '../types';
import type { SceneData, SceneEntityData, SceneComponentData } from '../scene/scene';
import type { SceneEntry } from '../scene/sceneEntry';
import type { PrefabInstanceEntry } from '../prefab/sceneInstance';
import type { PrefabOverride } from '../prefab/types';

interface Vec3 { x: number; y: number; z: number }

/** Placement of a prefab asset's root before scene instance overrides. */
export interface PrefabRoot {
    rootId: string;
    position: Vec3;
    /** Root component after asset-level overrides. Null means it has no Transform. */
    transform?: Readonly<Record<string, unknown>> | null;
    /** Whether the asset root carries WorldPersistent after asset-level overrides. */
    worldPersistent?: boolean;
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
    /** The plane the cells lie on. */
    plane: 'xz' | 'xy';
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

interface WorldDeclaration {
    entry: SceneEntry;
    data: Record<string, unknown>;
    prefabEntityId?: string;
}

function declarationsOn(entry: SceneEntry): WorldDeclaration[] | undefined {
    let declarations: WorldDeclaration[] | undefined;
    if (!isPrefabEntry(entry)) {
        for (const component of componentsOf(entry)) {
            if (component.type === 'StreamedWorld') (declarations ??= []).push({ entry, data: component.data ?? {} });
        }
        return declarations;
    }

    // A scene can declare streaming on the instance itself. Replay only its
    // authored StreamedWorld edits, in the same order as prefab expansion.
    let byTarget: Map<string, PrefabOverride[]> | undefined;
    for (const override of entry.overrides ?? []) {
        if (overriddenComponentType(override) !== 'StreamedWorld') continue;
        byTarget ??= new Map();
        const target = byTarget.get(override.prefabEntityId);
        if (target) target.push(override);
        else byTarget.set(override.prefabEntityId, [override]);
    }
    for (const [prefabEntityId, overrides] of byTarget ?? []) {
        if (entry.removed?.includes(prefabEntityId)) continue;
        const target = { prefabEntityId, name: '', visible: true, components: [] as SceneComponentData[] };
        applyOverrides(target, overrides);
        const component = target.components[0];
        if (component) (declarations ??= []).push({ entry, data: component.data ?? {}, prefabEntityId });
    }
    return declarations;
}

/** Scene-authored settings, including overrides. Ordinary scenes need no prefab reads to opt out. */
export function streamedWorldDeclaration(scene: SceneData): WorldDeclaration | undefined {
    for (const entry of scene.entities ?? []) {
        const declaration = declarationsOn(entry)?.[0];
        if (declaration) return declaration;
    }
    return undefined;
}

function componentData(entry: SceneEntry, type: string): Record<string, unknown> | null {
    for (const component of componentsOf(entry)) {
        if (component.type === type) return component.data as Record<string, unknown>;
    }
    return null;
}

/** Read the settings from the same authored declaration used to select a streamed scene. */
export function streamedWorldData(scene: SceneData): Record<string, unknown> | null {
    return streamedWorldDeclaration(scene)?.data ?? null;
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

function localPlacement(
    entry: SceneEntry, options: PartitionOptions, problems: string[],
): { transform: Readonly<Record<string, unknown>> | null; worldPersistent: boolean } {
    if (!isPrefabEntry(entry)) {
        return { transform: componentData(entry, 'Transform'),
            worldPersistent: componentsOf(entry).some(component => component.type === 'WorldPersistent') };
    }
    const instance = entry as PrefabInstanceEntry;
    const asset = options.resolvePrefab?.(instance.prefab) ?? null;
    if (asset === null) {
        problems.push(
            `entity ${instance.id} ("${nameOf(instance)}") instances a prefab this cook cannot read `
            + `(${instance.prefab}), so where it stands is unknown`,
        );
        return { transform: null, worldPersistent: false };
    }
    const transform = asset.transform === undefined ? { position: asset.position } : asset.transform;
    const worldPersistent = asset.worldPersistent ?? false;
    const overrides = instance.overrides?.filter(override => {
        if (override.prefabEntityId !== asset.rootId) return false;
        const type = overriddenComponentType(override);
        return type === 'Transform' || type === 'WorldPersistent';
    });
    if (!overrides?.length) return { transform, worldPersistent };
    const root = { prefabEntityId: asset.rootId, name: '', visible: true,
        components: transform ? [{ type: 'Transform', data: { ...transform } }] : [] };
    if (worldPersistent) root.components.push({ type: 'WorldPersistent', data: {} });
    applyOverrides(root, overrides);
    return {
        transform: root.components.find(component => component.type === 'Transform')?.data ?? null,
        worldPersistent: root.components.some(component => component.type === 'WorldPersistent'),
    };
}

function overriddenComponentType(override: PrefabOverride): string | undefined {
    switch (override.type) {
        case 'property':
        case 'component_removed':
            return override.componentType;
        case 'component_added':
        case 'component_replaced':
            return override.componentData?.type;
        default:
            return undefined;
    }
}

const UNIT_SCALE: Vec3 = { x: 1, y: 1, z: 1 };

function localMatrix(transform: Readonly<Record<string, unknown>>, position: Vec3): number[] {
    const r = transform.rotation as Partial<{ x: number; y: number; z: number; w: number }> | undefined;
    return composeTRS(position, { x: r?.x ?? 0, y: r?.y ?? 0, z: r?.z ?? 0, w: r?.w ?? 1 },
        vec3(transform.scale, UNIT_SCALE));
}

function transformPoint(matrix: readonly number[], { x, y, z }: Vec3): Vec3 {
    return {
        x: matrix[0]! * x + matrix[4]! * y + matrix[8]! * z + matrix[12]!,
        y: matrix[1]! * x + matrix[5]! * y + matrix[9]! * z + matrix[13]!,
        z: matrix[2]! * x + matrix[6]! * y + matrix[10]! * z + matrix[14]!,
    };
}

interface CellEntries {
    x: number;
    z: number;
    minX: number;
    minZ: number;
    maxX: number;
    maxZ: number;
    rootCount: number;
    entries: SceneEntry[];
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
    const found = streamedWorldDeclaration(scene);
    if (!found) return null;
    const { entry: declared, data: declaration, prefabEntityId } = found;
    const cellSize = typeof declaration?.cellSize === 'number' ? declaration.cellSize : 0;
    const plane = declaration?.plane === StreamPlane.Screen ? 'xy' : 'xz';
    if (!Number.isFinite(cellSize) || cellSize <= 0) {
        return {
            cellSize: 0, plane, persistent: scene, cells: [], persistentRefs: [],
            errors: [`StreamedWorld in "${sceneName}" needs a finite, positive cellSize`], warnings: [],
        };
    }

    const errors: string[] = [];
    const warnings: string[] = [];
    const byId = new Map<number, SceneEntry>();
    let otherDeclaration: SceneEntry | undefined;
    for (const entry of entries) {
        if (byId.has(entry.id)) {
            return { cellSize, plane, persistent: scene, cells: [], persistentRefs: [], warnings,
                errors: [`StreamedWorld in "${sceneName}" has duplicate entity id ${entry.id}`] };
        }
        byId.set(entry.id, entry);
        if (!otherDeclaration && declarationsOn(entry)?.[entry === declared ? 1 : 0]) otherDeclaration = entry;
    }
    if (otherDeclaration) {
        const first = `entity ${declared.id} ("${nameOf(declared)}")`;
        const locations = otherDeclaration !== declared
            ? `${first} and entity ${otherDeclaration.id} ("${nameOf(otherDeclaration)}")`
            : first;
        return { cellSize, plane, persistent: scene, cells: [], persistentRefs: [], warnings,
            errors: [`Scene "${sceneName}" can have only one StreamedWorld declaration; found multiple on ${locations}`] };
    }
    if (prefabEntityId !== undefined && isPrefabEntry(declared)
        && options.resolvePrefab?.(declared.prefab)?.rootId !== prefabEntityId) {
        return { cellSize, plane, persistent: scene, cells: [], persistentRefs: [], warnings,
            errors: [`StreamedWorld on entity ${declared.id} ("${nameOf(declared)}") must target its prefab root; cannot match "${prefabEntityId}"`] };
    }

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

    // Assign whole subtrees to shared cell buckets and expand their bounds in
    // the same walk. Null identifies the persistent document.
    const placement = new Map<number, CellEntries | null>();
    const cellEntries = new Map<string, CellEntries>();
    for (const root of roots) {
        const entry = byId.get(root)!;
        const { transform, worldPersistent } = localPlacement(entry, options, errors);
        const streamed = !worldPersistent
            && entry !== declared
            && (isPrefabEntry(entry) || transform !== null);
        const rootPosition = vec3(transform?.position, ORIGIN);
        let cell = streamed ? cellAt(rootPosition.x, planeSecond(rootPosition, plane), cellSize) : null;
        if (cell && (!Number.isSafeInteger(cell.x) || !Number.isSafeInteger(cell.z))) {
            errors.push(`entity ${root} ("${nameOf(entry)}") is outside the representable cell grid`);
            cell = null;
        }

        let bucket: CellEntries | null = null;
        if (cell) {
            const { x, z } = cell;
            const key = `${x}_${z}`;
            bucket = cellEntries.get(key) ?? null;
            if (!bucket) {
                bucket = { x, z, ...cellSquare(x, z, cellSize), rootCount: 0, entries: [] };
                cellEntries.set(key, bucket);
            }
            bucket.rootCount++;
        }
        const rootMatrix = transform && childrenOf.has(root) ? localMatrix(transform, rootPosition) : null;
        const stack: Array<{ id: number; position: Vec3; matrix: readonly number[] | null }> = [
            { id: root, position: rootPosition, matrix: rootMatrix },
        ];
        while (stack.length > 0) {
            const node = stack.pop()!;
            placement.set(node.id, bucket);
            if (bucket) {
                const { x } = node.position;
                const second = planeSecond(node.position, plane);
                bucket.minX = Math.min(bucket.minX, x);
                bucket.maxX = Math.max(bucket.maxX, x);
                bucket.minZ = Math.min(bucket.minZ, second);
                bucket.maxZ = Math.max(bucket.maxZ, second);
            }
            for (const child of childrenOf.get(node.id) ?? []) {
                const childEntry = byId.get(child)!;
                const { transform: childTransform, worldPersistent: childPersistent } = localPlacement(childEntry, options, errors);
                if (childPersistent) {
                    errors.push(
                        `entity ${child} ("${nameOf(childEntry)}") carries WorldPersistent but is not top-level — `
                        + 'a subtree is the residency atom, so persistence is its root\'s answer',
                    );
                }
                const local = vec3(childTransform?.position, ORIGIN);
                const position = node.matrix ? transformPoint(node.matrix, local) : local;
                // As in the runtime, a folder passes its parent's matrix on,
                // and a leaf never needs a matrix to hand to its children.
                let matrix = node.matrix;
                if (childTransform && childrenOf.has(child)) {
                    const localChild = localMatrix(childTransform, local);
                    matrix = matrix ? multiplyAffine(matrix, localChild) : localChild;
                }
                stack.push({ id: child, position, matrix });
            }
        }
    }

    if (declared.parent != null && byId.has(declared.parent)) {
        errors.push(`entity ${declared.id} ("${nameOf(declared)}") carries StreamedWorld but is not top-level`);
    }

    const persistentRefs = new Set<number>();
    checkReferences(entries, byId, placement, options, persistentRefs, errors);

    // Fill the output buckets in authored order. A cell can now assemble its
    // document directly from its own entries, even when roots are interleaved.
    const persistentEntries: SceneEntry[] = [];
    let firstUnplaced: number | undefined;
    for (const entry of entries) {
        const bucket = placement.get(entry.id);
        if (bucket === undefined) { firstUnplaced ??= entry.id; continue; }
        (bucket === null ? persistentEntries : bucket.entries).push(entry);
    }
    if (firstUnplaced !== undefined) {
        errors.push(`StreamedWorld in "${sceneName}" cannot place ${entries.length - placement.size} entities `
            + `because of a parent cycle (first affected entity: ${firstUnplaced})`);
    }

    const documentOf = (members: readonly SceneEntry[], name: string): SceneData => {
        const list = members.map(entry => {
            const parent = entry.parent != null && byId.has(entry.parent) ? entry.parent : null;
            // A compact prefab record need not carry a redundant child list.
            if (isPrefabEntry(entry) && !('children' in entry)) return { ...entry, parent };
            return { ...entry, parent, children: childrenOf.get(entry.id) ?? [] };
        });
        return {
            version: scene.version,
            name,
            ...(scene.generator ? { generator: scene.generator } : {}),
            entities: list as unknown as SceneEntityData[],
            ...(scene.textureMetadata ? { textureMetadata: scene.textureMetadata } : {}),
            ...(scene.textureImporterSettings ? { textureImporterSettings: scene.textureImporterSettings } : {}),
        };
    };

    const cells: PartitionedCell[] = [];
    const orderedCells = [...cellEntries.values()].sort((a, b) => a.x - b.x || a.z - b.z);
    for (const { x, z, minX, minZ, maxX, maxZ, entries: members, rootCount } of orderedCells) {
        if (!Number.isFinite(minX) || !Number.isFinite(minZ) || !Number.isFinite(maxX) || !Number.isFinite(maxZ)) {
            errors.push(`cell (${x}, ${z}) in "${sceneName}" has non-finite bounds`);
            continue;
        }
        const name = `${sceneName}.cell_${x}_${z}`;
        cells.push({
            name, x, z, minX, minZ, maxX, maxZ,
            entityCount: members.length,
            rootCount,
            data: documentOf(members, name),
        });
    }

    return {
        cellSize,
        plane,
        persistent: documentOf(persistentEntries, scene.name),
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
    placement: ReadonlyMap<number, CellEntries | null>,
    options: PartitionOptions,
    persistentRefs: Set<number>,
    errors: string[],
): void {
    for (const holder of entries) {
        const from = placement.get(holder.id);
        if (from === undefined) continue;
        visitSceneEntryEntityReferences(holder, options.entityFieldsOf, (componentType, field, candidate) => {
            // Strings in a prefab delta refer to instance-local IDs. Zero and
            // legacy negative values are empty references even in old scenes.
            if (typeof candidate !== 'number' || candidate <= INVALID_ENTITY || !byId.has(candidate)) return;
            const to = placement.get(candidate);
            if (to === undefined || from === to) return;
            if (from !== null && to === null) { persistentRefs.add(candidate); return; }
            const where = to === null ? 'the persistent world' : `cell ${to.x},${to.z}`;
            errors.push(
                `${componentType}.${field} on entity ${holder.id} ("${nameOf(holder)}") references `
                + `entity ${candidate} ("${nameOf(byId.get(candidate)!)}") in ${where} — `
                + 'residency may delete one without the other',
            );
        });
    }
}
