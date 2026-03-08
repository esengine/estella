import type { PrefabData } from './types';

export function collectNestedPrefabPaths(
    prefab: PrefabData,
    loadPrefab: (path: string) => PrefabData | null,
    visited?: Set<string>,
): string[] {
    const paths: string[] = [];
    const seen = visited ?? new Set<string>();

    if (prefab.basePrefab && !seen.has(prefab.basePrefab)) {
        seen.add(prefab.basePrefab);
        paths.push(prefab.basePrefab);
        const base = loadPrefab(prefab.basePrefab);
        if (base) {
            paths.push(...collectNestedPrefabPaths(base, loadPrefab, seen));
        }
    }

    for (const entity of prefab.entities) {
        if (!entity.nestedPrefab) continue;
        const path = entity.nestedPrefab.prefabPath;
        if (seen.has(path)) continue;
        seen.add(path);
        paths.push(path);

        const nested = loadPrefab(path);
        if (nested) {
            paths.push(...collectNestedPrefabPaths(nested, loadPrefab, seen));
        }
    }

    return paths;
}

const MAX_PRELOAD_DEPTH = 10;

export async function preloadNestedPrefabs(
    prefab: PrefabData,
    loadPrefab: (path: string) => Promise<PrefabData>,
    cache: Map<string, PrefabData>,
    visited?: Set<string>,
    depth: number = 0,
): Promise<void> {
    if (depth > MAX_PRELOAD_DEPTH) return;
    const seen = visited ?? new Set<string>();

    if (prefab.basePrefab && !seen.has(prefab.basePrefab) && !cache.has(prefab.basePrefab)) {
        seen.add(prefab.basePrefab);
        const base = await loadPrefab(prefab.basePrefab);
        cache.set(prefab.basePrefab, base);
        await preloadNestedPrefabs(base, loadPrefab, cache, seen, depth + 1);
    }

    for (const entity of prefab.entities) {
        if (!entity.nestedPrefab) continue;
        const path = entity.nestedPrefab.prefabPath;
        if (seen.has(path) || cache.has(path)) continue;
        seen.add(path);

        const nested = await loadPrefab(path);
        cache.set(path, nested);
        await preloadNestedPrefabs(nested, loadPrefab, cache, seen, depth + 1);
    }
}
