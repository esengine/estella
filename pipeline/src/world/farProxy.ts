// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    farProxy.ts
 * @brief   Writing each cell of a cut world its far proxy, simplified, beside the cell.
 *
 * @details The proxy is assembled by the SDK (`assembleFarProxies`), which the editor's Play shares; the build adds the
 *          simplifier and the files. Mesh bytes are read from the project, as prefab documents already are: by the time a world
 *          is cut a web build has packed its meshes, and the project holds the same bytes.
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { decodeMesh, encodeMesh, type MeshData } from 'esengine';
import { assembleFarProxies, type CutWorld, type FarProxySettings } from 'esengine/node';
import type { AssetIndex } from '../assets/assetDb';
import { simplifyMesh } from '../assets/meshSimplify';

/** What baking a world's far proxies did, for the build's report. */
export interface FarProxyCookResult {
    /** Cells that got a proxy. */
    cells: number;
    surfaces: number;
    trianglesBefore: number;
    trianglesAfter: number;
    warnings: string[];
}

/** Reads a `.esmesh` reference (`@uuid:` or a project path) from the project. */
function meshReader(root: string, index: AssetIndex): (ref: string) => Promise<MeshData | null> {
    const byUuid = new Map<string, string>();
    for (const entry of index.entries) byUuid.set(entry.uuid.toLowerCase(), entry.path);
    return async (ref) => {
        const uuid = ref.startsWith('@uuid:') ? ref.slice('@uuid:'.length).toLowerCase() : null;
        const relative = uuid !== null ? byUuid.get(uuid) : ref.replace(/^\/+/, '');
        if (!relative || !relative.endsWith('.esmesh')) return null;
        return decodeMesh(new Uint8Array(await readFile(path.join(root, relative))));
    };
}

/** Bake every cell of `cut` a far proxy, write it into `payloadDir`, and name it on the cut's manifest. */
export async function cookFarProxies(
    root: string, payloadDir: string, cut: CutWorld, settings: FarProxySettings, index: AssetIndex,
    readPrefab: (ref: string) => Promise<unknown | null>,
): Promise<FarProxyCookResult> {
    const proxies = await assembleFarProxies(cut, settings, {
        loadPrefab: async (ref) => await readPrefab(ref) as never,
        readMesh: meshReader(root, index),
        simplify: async (mesh, ratio, maxError) => (await simplifyMesh(mesh, {
            ratio, maxError, flags: ['ErrorAbsolute', 'Permissive'],
        }))?.data ?? mesh,
    });
    const result: FarProxyCookResult = { cells: proxies.length, surfaces: 0, trianglesBefore: 0, trianglesAfter: 0, warnings: [] };
    for (const proxy of proxies) {
        for (const { path: meshPath, mesh } of proxy.meshes) await writeFile(path.join(payloadDir, meshPath), encodeMesh(mesh));
        await writeFile(path.join(payloadDir, proxy.path), JSON.stringify(proxy.document) + '\n');
        result.surfaces += proxy.surfaces;
        result.trianglesBefore += proxy.trianglesBefore;
        result.trianglesAfter += proxy.trianglesAfter;
        if (proxy.unread > 0) {
            result.warnings.push(`cell "${proxy.cell}": ${proxy.unread} surface(s) name a mesh the far proxy cannot read`);
        }
    }
    return result;
}
