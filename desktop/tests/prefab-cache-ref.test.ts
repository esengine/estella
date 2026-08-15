// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A prefab ref is a uuid OR a project path.
 *
 * The runtime loader takes both; the editor's cache took only the uuid, so a
 * scene whose instance names its prefab by path opened with the instance
 * missing — and the package, loaded by the runtime, still had it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PrefabCache } from '@/project/PrefabCache';
import { AssetRegistry } from '@/project/AssetRegistry';

const PREFAB = {
  version: '2', name: 'robot', rootEntityId: 'n0',
  entities: [{
    prefabEntityId: 'n0', name: 'Robot', parent: null, children: [],
    visible: true, components: [{ type: 'Transform', data: {} }],
  }],
};

const read = vi.fn(async () => JSON.stringify(PREFAB));

beforeEach(() => {
  (globalThis as { window?: unknown }).window = { estella: { fs: { read } } };
  PrefabCache.clear();
  read.mockClear();
});

afterEach(() => {
  PrefabCache.clear();
  delete (globalThis as { window?: unknown }).window;
});

describe('PrefabCache.load', () => {
  it('loads a prefab named by project path', async () => {
    const prefab = await PrefabCache.load('assets/models/robot.esprefab');
    expect(prefab?.name).toBe('robot');
    expect(read).toHaveBeenCalledWith('assets/models/robot.esprefab');
  });

  it('loads a prefab named by uuid, through the registry', async () => {
    AssetRegistry.rebuild([
      { uuid: '11111111-1111-4111-8111-111111111111', path: 'assets/models/robot.esprefab' },
    ]);
    const prefab = await PrefabCache.load('@uuid:11111111-1111-4111-8111-111111111111');
    expect(prefab?.name).toBe('robot');
    expect(read).toHaveBeenCalledWith('assets/models/robot.esprefab');
  });

  it('answers null for a uuid the registry does not know', async () => {
    expect(await PrefabCache.load('@uuid:22222222-2222-4222-8222-222222222222')).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });
});
