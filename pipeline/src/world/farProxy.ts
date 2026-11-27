// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    farProxy.ts
 * @brief   Writing each cell of a cut world its far proxy, simplified, beside the cell.
 *
 * @details The SDK assembles the proxy documents. This writes the assembled
 *          documents and meshes after the world cooker validates the manifest.
 */

import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { encodeMesh, type AssembledFarProxy } from 'esengine';

/** What baking a world's far proxies did, for the build's report. */
export interface FarProxyCookResult {
    /** Cells that got a proxy. */
    cells: number;
    surfaces: number;
    trianglesBefore: number;
    trianglesAfter: number;
    warnings: string[];
}

/** Write the proxies already named by the validated manifest, and summarize their output. */
export async function writeFarProxies(
    payloadDir: string, proxies: readonly AssembledFarProxy[],
): Promise<FarProxyCookResult> {
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
