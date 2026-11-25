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
import { platformInstantiateWasm, platformLoadSubpackage } from '../platform';
import { createSideModuleHost, SideModuleDownloadError, type EmscriptenFactory, type SideModuleHost } from './host';
import { instantiateWasmModule } from '../wasm/instantiateModule';
import type { SideModuleId } from './registry';

/** id → the emscripten factory `require('./wasm/<file>.js')` returned. */
export type MiniGameSideModuleFactories = Partial<Record<SideModuleId, EmscriptenFactory>>;

/** Package-relative binary path and the subpackage to mount before reading it. */
export interface MiniGameSideModuleBinary {
    path: string;
    subpackage?: string;
}

/**
 * `binarySuffix` is what the EXPORT staged, not what this guesses: a host whose
 * loader takes `.wasm.br` gets a package with only the compressed binary in it,
 * and a loader that appended `.wasm` itself would name a file that is not there.
 */
export function createMiniGameSideModuleHost(
    factories: MiniGameSideModuleFactories, binarySuffix = '.wasm',
    binaries?: Readonly<Record<string, MiniGameSideModuleBinary>>,
): SideModuleHost {
    return createSideModuleHost(async (descriptor, id) => {
        const factory = factories[id];
        if (!factory) throw new Error(`side module "${id}" (${descriptor.file}) has no mini-game factory`);
        const binary = binaries?.[id];
        if (binary?.subpackage) {
            try {
                await platformLoadSubpackage(binary.subpackage);
            } catch (cause) {
                throw new SideModuleDownloadError(`could not load subpackage "${binary.subpackage}": ${cause}`);
            }
        }
        const path = binary?.path ?? `wasm/${descriptor.file}${binarySuffix}`;
        return instantiateWasmModule(factory, imports => platformInstantiateWasm(path, imports));
    });
}
