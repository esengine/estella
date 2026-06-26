// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The realm-agnostic side-module acquirer: id→descriptor mapping, caching,
 *        and failure-as-null. Transport-specific instantiation (fetch / inlined /
 *        WeChat) is exercised by the per-realm export + runtime paths.
 */
import { describe, it, expect, vi } from 'vitest';
import { createSideModuleHost } from '../src/sideModules/host';
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
    expect(SPINE_VERSIONS.map(spineModuleId)).toEqual(['spine:3.8', 'spine:4.1', 'spine:4.2']);
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
});
