// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { collectNestedPrefabPaths, preloadNestedPrefabs } from './collect';
import { migratePrefabData } from './migrate';
import type { PrefabData } from './types';

/** The asset and the versions of its bases and nested prefabs used by one expansion. */
export interface PrefabSource {
    readonly prefab: PrefabData;
    readonly dependencies: ReadonlyMap<string, PrefabData>;
}

export class PrefabSourceUnavailable extends Error {
    constructor(readonly ref: string, cause?: unknown) {
        super(`Could not load prefab "${ref}"${cause instanceof Error ? `: ${cause.message}` : ''}`);
    }
}

/** Capture the sources already resident when constructing or updating an editor instance. */
export function capturePrefabSource(prefab: PrefabData, resolve: (ref: string) => PrefabData | null): PrefabSource {
    const dependencies = new Map<string, PrefabData>();
    collectNestedPrefabPaths(prefab, ref => {
        const asset = resolve(ref);
        if (!asset) throw new PrefabSourceUnavailable(ref);
        dependencies.set(ref, asset);
        return asset;
    });
    return { prefab, dependencies };
}

/** One scene read. Each referenced document, including a failed read, is resolved once for the pass. */
export function createPrefabSourceLoader(load: (ref: string) => Promise<PrefabData | null>): (ref: string) => Promise<PrefabSource> {
    const documents = new Map<string, Promise<PrefabData>>();
    const sources = new Map<string, Promise<PrefabSource>>();
    const read = (ref: string): Promise<PrefabData> => {
        let pending = documents.get(ref);
        if (!pending) {
            pending = (async () => {
                try {
                    const data = await load(ref);
                    if (data) return migratePrefabData(data).data;
                } catch (error) {
                    throw new PrefabSourceUnavailable(ref, error);
                }
                throw new PrefabSourceUnavailable(ref);
            })();
            documents.set(ref, pending);
        }
        return pending;
    };
    return ref => {
        let pending = sources.get(ref);
        if (!pending) {
            pending = (async () => {
                const prefab = await read(ref);
                const dependencies = new Map<string, PrefabData>();
                await preloadNestedPrefabs(prefab, read, dependencies);
                return { prefab, dependencies };
            })();
            sources.set(ref, pending);
        }
        return pending;
    };
}
