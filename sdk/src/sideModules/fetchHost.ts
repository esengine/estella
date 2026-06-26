// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    fetchHost.ts
 * @brief   The web/editor transport: fetch a side module's `<file>.js` glue and
 *          `<file>.wasm` from a base URL (the directory esengine.wasm is served
 *          from) and instantiate it. Used by the editor edit/play realms and the
 *          exported web/desktop game — anywhere the artifacts sit next to the
 *          engine and can be fetched. The glue text is fetched (not bare-imported)
 *          so privileged custom schemes (`estella://`, `game://`) that refuse
 *          cross-origin module imports still work.
 */
import { createSideModuleHost, instantiateFromGlueText, type SideModuleHost } from './host';

export function createFetchSideModuleHost(baseUrl: string): SideModuleHost {
    const base = baseUrl.replace(/\/+$/, '');
    return createSideModuleHost(async (descriptor) => {
        const [glueRes, wasmRes] = await Promise.all([
            fetch(`${base}/${descriptor.file}.js`),
            fetch(`${base}/${descriptor.file}.wasm`),
        ]);
        if (!glueRes.ok) throw new Error(`fetch ${base}/${descriptor.file}.js → ${glueRes.status}`);
        if (!wasmRes.ok) throw new Error(`fetch ${base}/${descriptor.file}.wasm → ${wasmRes.status}`);
        const [glueText, wasmBytes] = await Promise.all([glueRes.text(), wasmRes.arrayBuffer()]);
        return instantiateFromGlueText(glueText, wasmBytes, descriptor);
    });
}
