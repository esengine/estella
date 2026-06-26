// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    wechatHost.ts
 * @brief   The WeChat MiniGame transport. WeChat has no `fetch`, no blob URLs and
 *          no dynamic `import()` — JS is pulled in with `require()` and wasm with
 *          `WXWebAssembly.instantiate(path)`. So the generated `game.js` requires
 *          each side module's glue and hands the factories in here; this host
 *          instantiates them by file path through the platform shim.
 */
import { platformInstantiateWasm } from '../platform';
import { createSideModuleHost, type EmscriptenFactory, type SideModule, type SideModuleHost } from './host';
import type { SideModuleId } from './registry';

/** id → the emscripten factory `require('./wasm/<file>.js')` returned. */
export type WeChatSideModuleFactories = Partial<Record<SideModuleId, EmscriptenFactory>>;

export function createWeChatSideModuleHost(factories: WeChatSideModuleFactories): SideModuleHost {
    return createSideModuleHost(async (descriptor, id) => {
        const factory = factories[id];
        if (!factory) throw new Error(`side module "${id}" (${descriptor.file}) has no WeChat factory`);
        return instantiateViaPlatform(factory, `${descriptor.file}.wasm`);
    });
}

function instantiateViaPlatform(factory: EmscriptenFactory, wasmPath: string): Promise<SideModule> {
    let rejectOnError: (e: unknown) => void = () => {};
    const errorGate = new Promise<never>((_, reject) => {
        rejectOnError = reject;
    });
    const opts: Record<string, unknown> = {
        instantiateWasm(imports: WebAssembly.Imports, cb: (inst: WebAssembly.Instance, mod?: WebAssembly.Module) => void) {
            platformInstantiateWasm(wasmPath, imports).then(
                (r) => cb(r.instance, r.module),
                (e) => rejectOnError(e),
            );
            return {};
        },
    };
    return Promise.race([factory(opts), errorGate]);
}
