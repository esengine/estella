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

import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { encodeMesh, type FarProxyHost } from 'esengine';
import { assembleFarProxies, type CutWorld, type FarProxySettings } from 'esengine/node';
import { simplifyFarProxyMesh } from '../assets/meshSimplify';

/** What baking a world's far proxies did, for the build's report. */
export interface FarProxyCookResult {
    /** Cells that got a proxy. */
    cells: number;
    surfaces: number;
    trianglesBefore: number;
    trianglesAfter: number;
    warnings: string[];
}

/** Bake every cell of `cut` a far proxy, write it into `payloadDir`, and name it on the cut's manifest. */
export async function cookFarProxies(
    payloadDir: string, cut: CutWorld, settings: FarProxySettings, assets: FarProxyHost,
): Promise<FarProxyCookResult> {
    const proxies = await assembleFarProxies(cut, settings, {
        ...assets,
        simplify: simplifyFarProxyMesh,
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
