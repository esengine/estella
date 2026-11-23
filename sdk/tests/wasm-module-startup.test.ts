// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { expect, it, vi } from 'vitest';
import { instantiateWasmModule } from '../src/wasm/instantiateModule';

type Receive = (instance: WebAssembly.Instance, module?: WebAssembly.Module) => void;
function instantiate(opts: Record<string, unknown>, receive: Receive) {
    return (opts.instantiateWasm as (imports: WebAssembly.Imports, cb: Receive) => object)({}, receive);
}

it('passes the module when available and also boots with a file loader that supplies only the instance', async () => {
    const module = new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
    const instance = new WebAssembly.Instance(module);
    for (const result of [{ instance, module }, { instance }]) {
        const ready = instantiateWasmModule(opts => new Promise(resolve => {
            expect(opts.canvas).toBe('surface');
            expect(instantiate(opts, (core, compiled) => resolve([core, compiled]))).toEqual({});
        }), async () => result, { canvas: 'surface' });
        await expect(ready).resolves.toEqual([instance, 'module' in result ? module : undefined]);
    }
});

it('rejects a hanging factory when loading bytes or attaching the instance throws', async () => {
    const failure = Error('invalid engine');
    const factory = (opts: Record<string, unknown>) => new Promise<never>(() => {
        instantiate(opts, () => { throw failure; });
    });
    await expect(instantiateWasmModule(factory, () => { throw failure; })).rejects.toBe(failure);
    await expect(instantiateWasmModule(factory, async () => ({ instance: {} as WebAssembly.Instance }))).rejects.toBe(failure);
});

it('does not deliver a late instance after its factory rejected', async () => {
    let finish!: (value: { instance: WebAssembly.Instance }) => void;
    const load = new Promise<{ instance: WebAssembly.Instance }>(resolve => { finish = resolve; });
    const receive = vi.fn(), failure = Error('factory stopped');
    await expect(instantiateWasmModule(opts => {
        instantiate(opts, receive);
        throw failure;
    }, () => load)).rejects.toBe(failure);
    finish({ instance: {} as WebAssembly.Instance });
    await load;
    await Promise.resolve();
    expect(receive).not.toHaveBeenCalled();
});
