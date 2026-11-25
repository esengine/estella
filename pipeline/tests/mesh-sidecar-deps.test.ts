// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A mesh keeps the distance field and surface cards written beside it in the cook: they are named by nothing, so the dependency scan
 *        links them from the mesh, and a build ships them whenever it ships the mesh.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { scanAssetDatabase, updateAssetIndex } from '../src/assets/assetDb';

let root: string;
const MESH = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', SDF = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', CARDS = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', OTHER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

function writeAsset(rel: string, type: string, uuid: string): void {
  const abs = path.join(root, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, 'x');
  writeFileSync(`${abs}.meta`, JSON.stringify({ uuid, version: '2.0', type, importer: {} }));
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'estella-meshdeps-'));
  writeAsset('assets/rock.esmesh', 'mesh', MESH);
  writeAsset('assets/rock.esmeshsdf', 'meshSdf', SDF);
  writeAsset('assets/rock.esmeshcards', 'meshCards', CARDS);
  writeAsset('assets/tree.esmesh', 'mesh', OTHER);
});
afterEach(() => { rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); });

describe('the files beside a mesh', () => {
  it('are dependencies of the mesh, and a mesh with none has no dependencies', async () => {
    const { index } = await scanAssetDatabase(root);
    expect(index.deps[MESH]).toEqual([SDF, CARDS].sort());
    expect(index.deps[OTHER]).toBeUndefined();
  });
  it('requires both typed inputs and honors a disabled or incomplete binding in the presence of a complete sibling pair', async () => {
    const set = (binding: unknown) => writeFileSync(path.join(root, 'assets/rock.esmesh.meta'),
      JSON.stringify({ type: 'mesh', uuid: MESH, version: '2.0', importer: { meshGI: binding } }));
    for (const binding of [false, { sdf: SDF, cards: CARDS, active: false }, { sdf: CARDS, cards: SDF }, { sdf: SDF }]) {
      set(binding);
      expect((await scanAssetDatabase(root)).index.deps[MESH]).toBeUndefined();
    }
    set({ sdf: '@uuid:' + SDF, cards: '@uuid:' + CARDS });
    const active = (await scanAssetDatabase(root)).index;
    expect(active.deps[MESH]).toEqual([SDF, CARDS].sort());
    rmSync(path.join(root, 'assets/rock.esmeshcards'));
    const incremental = (await updateAssetIndex(root, active, ['assets/rock.esmeshcards'])).index;
    const full = (await scanAssetDatabase(root)).index;
    expect(full).toEqual(incremental);
    expect(full.deps[MESH]).toBeUndefined();
    set(undefined);
    expect((await scanAssetDatabase(root)).index.deps[MESH]).toBeUndefined();
  });

});
