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
import { createSideModuleHost, instantiateFromGlueText, type SideModuleHost, type SideModuleSource } from './host';
import { sideModuleDescriptor, type SideModuleDescriptor, type SideModuleId } from './registry';

export function createFetchSideModuleHost(baseUrl: string): SideModuleHost {
    const base = baseUrl.replace(/\/+$/, '');
    // Kept after instantiation: a worker that instantiates its own copy asks for
    // the same bytes, and fetching them twice is the one thing to avoid.
    const fetched = new Map<string, Promise<{ glueText: string; wasmBytes: ArrayBuffer }>>();
    const fetchPair = (descriptor: SideModuleDescriptor) => {
        let pair = fetched.get(descriptor.file);
        if (!pair) {
            pair = (async () => {
                const [glueRes, wasmRes] = await Promise.all([
                    fetch(`${base}/${descriptor.file}.js`),
                    fetch(`${base}/${descriptor.file}.wasm`),
                ]);
                if (!glueRes.ok) throw new Error(`fetch ${base}/${descriptor.file}.js → ${glueRes.status}`);
                if (!wasmRes.ok) throw new Error(`fetch ${base}/${descriptor.file}.wasm → ${wasmRes.status}`);
                const [glueText, wasmBytes] = await Promise.all([glueRes.text(), wasmRes.arrayBuffer()]);
                return { glueText, wasmBytes };
            })();
            fetched.set(descriptor.file, pair);
        }
        return pair;
    };
    const host = createSideModuleHost(async (descriptor) => {
        const { glueText, wasmBytes } = await fetchPair(descriptor);
        // Instantiation may detach the buffer it is given; the kept one stays whole.
        return instantiateFromGlueText(glueText, wasmBytes.slice(0), descriptor);
    });
    return {
        ...host,
        async source(id: SideModuleId): Promise<SideModuleSource | null> {
            const descriptor = sideModuleDescriptor(id);
            if (!descriptor?.globalName) return null;
            const { glueText, wasmBytes } = await fetchPair(descriptor);
            return { glueText, globalName: descriptor.globalName, wasmBytes };
        },
    };
}
