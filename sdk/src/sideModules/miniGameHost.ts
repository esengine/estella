// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    miniGameHost.ts
 * @brief   The mini-game side-module transport. Mini-game hosts have no `fetch`,
 *          no blob URLs and no dynamic `import()` — JS is pulled in with
 *          `require()` and the wasm binary is instantiated from a package path.
 *          So the generated `game.js` requires each side module's glue and hands
 *          the factories in here; this host instantiates them by file path
 *          through the platform shim, which is where the per-vendor WASM
 *          divergence already lives.
 */
import { platformInstantiateWasm } from '../platform';
import { createSideModuleHost, type EmscriptenFactory, type SideModule, type SideModuleHost } from './host';
import type { SideModuleId } from './registry';

/** id → the emscripten factory `require('./wasm/<file>.js')` returned. */
export type MiniGameSideModuleFactories = Partial<Record<SideModuleId, EmscriptenFactory>>;

export function createMiniGameSideModuleHost(factories: MiniGameSideModuleFactories): SideModuleHost {
    return createSideModuleHost(async (descriptor, id) => {
        const factory = factories[id];
        if (!factory) throw new Error(`side module "${id}" (${descriptor.file}) has no mini-game factory`);
        // The exporter stages every runtime artifact under wasm/ — same registry,
        // same layout, so the binary sits beside the glue game.js require()'d.
        return instantiateViaPlatform(factory, `wasm/${descriptor.file}.wasm`);
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
