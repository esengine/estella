// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { beforeEach, expect, it, vi } from 'vitest';
import { platformInstantiateWasm, platformLoadSubpackage } from '../src/platform';
import { createMiniGameSideModuleHost } from '../src/sideModules/miniGameHost';

vi.mock('../src/platform', () => ({ platformLoadSubpackage: vi.fn(), platformInstantiateWasm: vi.fn() }));
const instance = { simulated: true };
function factory(options: Record<string, unknown>) {
    const instantiate = options.instantiateWasm as (imports: WebAssembly.Imports, receive: () => void) => void;
    return new Promise<typeof instance>(resolve => instantiate({}, () => resolve(instance)));
}
beforeEach(async () => {
    vi.resetAllMocks();
    const emptyWasm = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
    vi.mocked(platformInstantiateWasm).mockResolvedValue(await WebAssembly.instantiate(emptyWasm));
});

it('shares the download and allows another acquire after a subpackage failed', async () => {
    vi.mocked(platformLoadSubpackage).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const path = 'wasm/physics3d/physics3d.wasm';
    const host = createMiniGameSideModuleHost({ physics3d: factory }, '.wasm', {
        physics3d: { path, subpackage: 'solver' },
    });
    expect(await Promise.all([host.acquire('physics3d'), host.acquire('physics3d')])).toEqual([null, null]);
    expect(platformInstantiateWasm).not.toHaveBeenCalled();
    expect(await Promise.all([host.acquire('physics3d'), host.acquire('physics3d')])).toEqual([instance, instance]);
    expect(platformLoadSubpackage).toHaveBeenCalledTimes(2);
    expect(platformLoadSubpackage).toHaveBeenCalledWith('solver');
    expect(platformInstantiateWasm).toHaveBeenCalledTimes(1);
    expect(platformInstantiateWasm).toHaveBeenCalledWith(path, {});
});

it('reads an explicit raw binary and legacy suffix-based packages from the main package', async () => {
    const host = createMiniGameSideModuleHost({ physics: factory, physics3d: factory }, '.wasm.br', {
        physics: { path: 'wasm/physics.wasm' },
    });
    await host.acquire('physics');
    await host.acquire('physics3d');
    expect(platformInstantiateWasm).toHaveBeenNthCalledWith(1, 'wasm/physics.wasm', {});
    expect(platformInstantiateWasm).toHaveBeenNthCalledWith(2, 'wasm/physics3d.wasm.br', {});
    expect(platformLoadSubpackage).not.toHaveBeenCalled();
});
