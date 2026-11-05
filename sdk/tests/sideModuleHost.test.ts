// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The realm-agnostic side-module acquirer: id→descriptor mapping, caching,
 *        and failure-as-null. Transport-specific instantiation (fetch / inlined /
 *        WeChat) is exercised by the per-realm export + runtime paths.
 */
import { describe, it, expect, vi } from 'vitest';
import { createSideModuleHost, SideModuleAbsent } from '../src/sideModules/host';
import { SIDE_MODULES, SPINE_VERSIONS, spineModuleId } from '../src/sideModules/registry';

describe('side-module registry', () => {
  it('maps every id to a stable artifact base name', () => {
    expect(SIDE_MODULES.physics.file).toBe('physics');
    expect(SIDE_MODULES['spine:3.8'].file).toBe('spine38');
    expect(SIDE_MODULES['spine:4.1'].file).toBe('spine41');
    expect(SIDE_MODULES['spine:4.2'].file).toBe('spine42');
    // Physics glue is ES6 default-export; spine glue is a named global.
    expect(SIDE_MODULES.physics.globalName).toBeUndefined();
    expect(SIDE_MODULES['spine:4.2'].globalName).toBe('ESSpineModule');
  });

  it('spineModuleId covers every shipped version', () => {
    expect(SPINE_VERSIONS.map(spineModuleId))
      .toEqual(['spine:2.1', 'spine:3.8', 'spine:4.1', 'spine:4.2', 'spine:4.3']);
    // Every id the versions produce has to be a module the loader knows how to fetch.
    for (const version of SPINE_VERSIONS) {
      expect(SIDE_MODULES[spineModuleId(version)]).toBeDefined();
    }
  });
});

describe('createSideModuleHost', () => {
  it('passes the descriptor + id to the transport and returns its module', async () => {
    const mod = { _physics_init: () => {} };
    const instantiate = vi.fn().mockResolvedValue(mod);
    const host = createSideModuleHost(instantiate);

    expect(await host.acquire('physics')).toBe(mod);
    expect(instantiate).toHaveBeenCalledWith(SIDE_MODULES.physics, 'physics');
  });

  it('caches per id — the transport runs once across repeat acquires', async () => {
    const instantiate = vi.fn().mockResolvedValue({});
    const host = createSideModuleHost(instantiate);

    const [a, b] = await Promise.all([host.acquire('spine:4.2'), host.acquire('spine:4.2')]);
    expect(a).toBe(b);
    expect(instantiate).toHaveBeenCalledTimes(1);
  });

  it('degrades a failed load to null (and caches the null) instead of throwing', async () => {
    const instantiate = vi.fn().mockRejectedValue(new Error('boom'));
    const host = createSideModuleHost(instantiate);

    expect(await host.acquire('physics')).toBeNull();
    expect(await host.acquire('physics')).toBeNull();
    expect(instantiate).toHaveBeenCalledTimes(1);
  });

  // Both answer null; only one of them is a fault. A native host carries no
  // `basis` by design, and calling that a failed load made every game with a
  // Spine atlas print an error and read as a broken boot on a device.
  it('reports a module the realm never carried without calling it a failure', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const absent = createSideModuleHost(
        vi.fn().mockRejectedValue(new SideModuleAbsent('basis', 'decoded in C++ here')));
      expect(await absent.acquire('basis')).toBeNull();
      expect(spy).not.toHaveBeenCalled();

      const broke = createSideModuleHost(vi.fn().mockRejectedValue(new Error('boom')));
      expect(await broke.acquire('basis')).toBeNull();
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  // The engine's JavaScript build runs where there is no WebAssembly, and a side
  // module is a wasm binary: say so by name, once, and never call the transport.
  it('answers null without instantiating on a host with no WebAssembly', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const saved = globalThis.WebAssembly;
    try {
      delete (globalThis as { WebAssembly?: unknown }).WebAssembly;
      const instantiate = vi.fn().mockResolvedValue({});
      const host = createSideModuleHost(instantiate, { requiresWebAssembly: true });
      expect(await host.acquire('physics')).toBeNull();
      expect(await host.acquire('physics')).toBeNull();
      expect(instantiate).not.toHaveBeenCalled();
      expect(spy).toHaveBeenCalledTimes(1);
      expect(String(spy.mock.calls[0].join(' '))).toMatch(/no WebAssembly/);
    } finally {
      globalThis.WebAssembly = saved;
      spy.mockRestore();
    }
  });

  // iOS runs QuickJS and WeChat has WXWebAssembly: neither realm has the global, and
  // neither transport needs it. A native host's modules are linked in C++.
  it('still loads through a transport that does not need WebAssembly, on a host without it', async () => {
    const saved = globalThis.WebAssembly;
    try {
      delete (globalThis as { WebAssembly?: unknown }).WebAssembly;
      const module = { tag: 'linked' };
      const instantiate = vi.fn().mockResolvedValue(module);
      const host = createSideModuleHost(instantiate);
      expect(await host.acquire('physics')).toBe(module);
      expect(instantiate).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.WebAssembly = saved;
    }
  });

});
