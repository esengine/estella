// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A project chooses the solver behind its 3D world: Jolt by default, or
 *        PhysX, the one Unity runs. The choice is read from the project, carried
 *        into every packaged build, and decides the ONE module the package ships.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseManifest } from '../src/project/format';
import { packagedRuntimeFields, runtimeConfigOf } from '../src/project/runtimeConfig';
import { scanSideModuleIds, sideModuleFiles } from '../src/bundle/sideModuleScan';

const manifest = (backend3d?: unknown) =>
  parseManifest({ formatVersion: '1', name: 'g', features: { physics: backend3d === undefined ? {} : { backend3d } } });

describe('3D physics backend', () => {
  it('is Jolt unless the project names PhysX, and only PhysX is written into a build', () => {
    expect(runtimeConfigOf(manifest()).physics3dBackend).toBe('jolt');
    expect(runtimeConfigOf(manifest('nope')).physics3dBackend).toBe('jolt');
    expect(packagedRuntimeFields(runtimeConfigOf(manifest('jolt')))).not.toHaveProperty('physics3dBackend');
    const physx = manifest('physx');
    expect(physx.features?.physics?.backend3d).toBe('physx');
    expect(packagedRuntimeFields(runtimeConfigOf(physx)).physics3dBackend).toBe('physx');
  });

  it('ships the module of the chosen backend and never the other', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'p3d-backend-'));
    try {
      writeFileSync(path.join(root, 'level.esscene'), JSON.stringify({ entities: [
        { id: 1, components: [{ type: 'RigidBody3D', data: {} }, { type: 'BoxCollider3D', data: {} }] },
      ] }));
      const scan = (physics3dBackend?: 'jolt' | 'physx') => scanSideModuleIds({
        root, includedPaths: ['level.esscene'], cookEntries: [], stagedDir: root, physics3dBackend,
      });
      expect([...await scan()]).toEqual(['physics3d']);
      const physx = await scan('physx');
      expect([...physx]).toEqual(['physics3d:physx']);
      expect(sideModuleFiles(physx).files).toEqual([{ id: 'physics3d:physx', file: 'physics3d-physx' }]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
