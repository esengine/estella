// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { WorldManifest } from './cells';
import { farProxySceneName } from './farProxy';

/** Check a manifest before it can change scene registrations or retire a loaded world. */
export function assertWorldManifest(value: unknown, expected: {
    scene?: string;
    path?: string;
    sceneNames?: ReadonlySet<string>;
} = {}): asserts value is WorldManifest {
    const manifest = value as WorldManifest;
    const fail = (reason: string): never => {
        const location = expected.path ? ` "${expected.path}"` : '';
        const scene = expected.scene ?? manifest?.scene;
        throw new Error(`Invalid world manifest${location}${scene ? ` for scene "${scene}"` : ''}: ${reason}`);
    };
    if (manifest?.version !== 1 || typeof manifest.scene !== 'string' || !manifest.scene
        || (expected.scene !== undefined && manifest.scene !== expected.scene)
        || !Array.isArray(manifest.cells) || !Array.isArray(manifest.persistentRefs)) {
        fail('expected a version 1 manifest for the persistent scene with cells and persistentRefs');
    }
    if (!Number.isFinite(manifest.cellSize) || manifest.cellSize <= 0) fail('cellSize must be finite and positive');
    if (manifest.plane !== undefined && manifest.plane !== 'xz' && manifest.plane !== 'xy') fail('plane must be xz or xy');
    if (manifest.farDistance !== undefined && (!Number.isFinite(manifest.farDistance) || manifest.farDistance < 0)) {
        fail('farDistance must be finite and nonnegative');
    }

    const names = new Set([manifest.scene]);
    const reserve = (name: string): void => {
        if (names.has(name) || expected.sceneNames?.has(name)) fail(`scene name "${name}" is already used`);
        names.add(name);
    };
    for (const [index, cell] of manifest.cells.entries()) {
        if (!cell || typeof cell.name !== 'string' || !cell.name || typeof cell.path !== 'string' || !cell.path) {
            fail(`cell at index ${index} needs a scene name and path`);
        }
        const { x, z, minX, minZ, maxX, maxZ } = cell;
        if (!Number.isSafeInteger(x) || !Number.isSafeInteger(z)) fail(`cell "${cell.name}" has invalid grid coordinates`);
        if (!Number.isFinite(minX) || !Number.isFinite(minZ) || !Number.isFinite(maxX) || !Number.isFinite(maxZ)
            || minX > maxX || minZ > maxZ) {
            fail(`cell "${cell.name}" has invalid bounds`);
        }
        reserve(cell.name);
        if (cell.proxy !== undefined) {
            if (typeof cell.proxy !== 'string' || !cell.proxy) fail(`cell "${cell.name}" has an invalid far proxy path`);
            if (manifest.farDistance !== undefined) reserve(farProxySceneName(cell.name));
        }
    }
}
