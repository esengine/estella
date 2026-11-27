// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { MAX_PREFAB_NESTING_DEPTH, type PrefabData } from './types';

type PrefabReads<T = void> = Generator<string, T, PrefabData | null>;

/** One traversal for the editor's resident sources and async asset loaders. */
function* dependencyReads(root: PrefabData, depth: number): PrefabReads {
    const documents = new Map<string, PrefabData | null>();
    const mountDepths = new Map<string, number>();

    function* read(ref: string): PrefabReads<PrefabData | null> {
        if (!documents.has(ref)) documents.set(ref, yield ref);
        return documents.get(ref) ?? null;
    }

    function* walk(prefab: PrefabData, depth: number): PrefabReads {
        if (depth > MAX_PREFAB_NESTING_DEPTH) return;
        let entities = prefab.entities;
        if (prefab.basePrefab) {
            const layers = [prefab];
            const bases = new Set<string>();
            for (let ref: string | undefined = prefab.basePrefab; ref;) {
                if (depth + layers.length - 1 > MAX_PREFAB_NESTING_DEPTH || bases.has(ref)) return;
                bases.add(ref);
                const base: PrefabData | null = yield* read(ref);
                if (!base) break;
                layers.push(base);
                ref = base.basePrefab;
            }
            // Variant entries replace their base entries by stable ID. Only
            // the resulting mounts are reachable when the variant is assembled.
            const effective = new Map<string, (typeof entities)[number]>();
            for (const layer of layers.reverse()) {
                for (const entity of layer.entities) effective.set(entity.prefabEntityId, entity);
            }
            entities = [...effective.values()];
        }

        // Assembly counts the merged variant as one layer regardless of the
        // inheritance chain length. Read one extra row so flatten can report
        // its depth error with the prefab that exceeds the limit.
        const nestedDepth = depth + (prefab.basePrefab ? 2 : 1);
        if (nestedDepth > MAX_PREFAB_NESTING_DEPTH + 1) return;
        for (const entity of entities) {
            const ref = entity.nestedPrefab?.prefabPath;
            if (ref === undefined || (mountDepths.get(ref) ?? Infinity) <= nestedDepth) continue;
            mountDepths.set(ref, nestedDepth);
            const nested = yield* read(ref);
            if (nested) yield* walk(nested, nestedDepth);
        }
    }

    yield* walk(root, depth);
}

export function collectNestedPrefabPaths(
    prefab: PrefabData,
    loadPrefab: (path: string) => PrefabData | null,
    visited?: Set<string>,
): string[] {
    const paths: string[] = [];
    const reads = dependencyReads(prefab, 0);
    for (let step = reads.next(); !step.done;) {
        const ref = step.value;
        let data = null;
        if (!visited?.has(ref)) {
            visited?.add(ref);
            paths.push(ref);
            data = loadPrefab(ref);
        }
        step = reads.next(data);
    }

    return paths;
}

export async function preloadNestedPrefabs(
    prefab: PrefabData,
    loadPrefab: (path: string) => Promise<PrefabData>,
    cache: Map<string, PrefabData>,
    visited?: Set<string>,
    depth: number = 0,
): Promise<void> {
    const reads = dependencyReads(prefab, depth);
    for (let step = reads.next(); !step.done;) {
        const ref = step.value;
        let data = cache.get(ref) ?? null;
        if (!data && !visited?.has(ref)) {
            visited?.add(ref);
            data = await loadPrefab(ref);
            cache.set(ref, data);
        }
        step = reads.next(data);
    }
}
