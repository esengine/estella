// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Douyin loads wasm through TTWebAssembly, by package path — the only loader that takes the `.wasm.br` a
 *        compressed export ships — and a host too old for it keeps the family loader.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { douyinProfile } from '../src/platform/douyin/profile';

const g = globalThis as { TTWebAssembly?: unknown };
afterEach(() => { delete g.TTWebAssembly; });

describe('Douyin wasm', () => {
  it('instantiates a package path through TTWebAssembly', async () => {
    const instance = {} as WebAssembly.Instance, module = {} as WebAssembly.Module;
    const instantiate = vi.fn(async () => ({ instance, module }));
    g.TTWebAssembly = { instantiate };
    const imports = { env: {} };
    await expect(douyinProfile.instantiateWasm!('/wasm/esengine.wxgame.wasm.br', imports)).resolves.toEqual({ instance, module });
    expect(instantiate).toHaveBeenCalledWith('wasm/esengine.wxgame.wasm.br', imports);
  });

  it('names the file when TTWebAssembly refuses it', async () => {
    g.TTWebAssembly = { instantiate: async () => { throw new Error('bad magic'); } };
    await expect(douyinProfile.instantiateWasm!('wasm/a.wasm', {})).rejects.toThrow(/wasm\/a\.wasm.*bad magic/);
  });

  it('leaves an older host to the family loader, except a compressed binary it cannot read', async () => {
    expect(douyinProfile.instantiateWasm!('wasm/a.wasm', {})).toBeUndefined();
    expect(douyinProfile.instantiateWasm!(new ArrayBuffer(8), {})).toBeUndefined();
    await expect(douyinProfile.instantiateWasm!('wasm/a.wasm.br', {})).rejects.toThrow(/3\.7\.0\.0/);
  });
});
