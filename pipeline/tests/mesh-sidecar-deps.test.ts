// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A mesh keeps the distance field and surface cards written beside it in the cook: they are named by nothing, so the dependency scan
 *        links them from the mesh, and a build ships them whenever it ships the mesh.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { scanAssetDatabase } from '../src/assets/assetDb';

let root: string;
const MESH = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', SDF = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', CARDS = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', OTHER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

function writeAsset(rel: string, type: string, uuid: string): void {
  const abs = path.join(root, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, 'x');
  writeFileSync(`${abs}.meta`, JSON.stringify({ uuid, version: '2.0', type, importer: {} }));
}

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'estella-meshdeps-'));
  writeAsset('assets/rock.esmesh', 'mesh', MESH);
  writeAsset('assets/rock.esmeshsdf', 'meshSdf', SDF);
  writeAsset('assets/rock.esmeshcards', 'meshCards', CARDS);
  writeAsset('assets/tree.esmesh', 'mesh', OTHER);
});
afterAll(() => { rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); });

describe('the files beside a mesh', () => {
  it('are dependencies of the mesh, and a mesh with none has no dependencies', async () => {
    const { index } = await scanAssetDatabase(root);
    expect(index.deps[MESH]).toEqual([SDF, CARDS].sort());
    expect(index.deps[OTHER]).toBeUndefined();
  });
});
