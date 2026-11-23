// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { WasmInstantiateResult } from '../platform/types';

/** Run an Emscripten factory with the host's byte, stream, or file loader.
 *  Emscripten's callback only reports success. Reject the caller's promise if
 *  either the loader, the callback, or the factory fails. @experimental */
export function instantiateWasmModule<T>(
    factory: (options: Record<string, unknown>) => Promise<T>,
    load: (imports: WebAssembly.Imports) => Promise<WasmInstantiateResult>,
    options: Record<string, unknown> = {},
): Promise<T> {
    // Also emitted into the Basis worker. Keep the implementation self-contained.
    return new Promise<T>((resolve, reject) => {
        let failed = false;
        const fail = (reason: unknown) => { failed = true; reject(reason); };
        function instantiateWasm(imports: WebAssembly.Imports, receive: (instance: WebAssembly.Instance, module?: WebAssembly.Module) => void) {
            Promise.resolve().then(() => load(imports)).then(result => {
                if (!failed) receive(result.instance, result.module);
            }).catch(fail);
            return {};
        }
        try { factory(Object.assign({}, options, { instantiateWasm })).then(resolve, fail); }
        catch (error) { fail(error); }
    });
}
