// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Importing a model produces the assets a scene can reference. The engine
 *        loads none of the source formats, so a `.glb` that only lands in the
 *        project is a file nothing can draw — these cover what has to come with it.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { importAssets } from '../electron/importAssets';

let root: string;
let outside: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'estella-model-'));
  outside = mkdtempSync(path.join(tmpdir(), 'estella-src-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

const meta = (abs: string): { uuid: string; type: string } =>
  JSON.parse(readFileSync(`${abs}.meta`, 'utf8'));

/** One triangle, one material — with an image uri when `image` names one. */
function gltf(image?: string): string {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const uvs = new Float32Array([0, 0, 1, 0, 0, 1]);
  const indices = new Uint16Array([0, 1, 2]);
  const bytes = Buffer.concat([
    Buffer.from(positions.buffer), Buffer.from(uvs.buffer), Buffer.from(indices.buffer),
  ]);
  return JSON.stringify({
    asset: { version: '2.0' },
    buffers: [{ byteLength: bytes.length, uri: `data:application/octet-stream;base64,${bytes.toString('base64')}` }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 24 },
      { buffer: 0, byteOffset: 60, byteLength: 6 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 1, componentType: 5126, count: 3, type: 'VEC2' },
      { bufferView: 2, componentType: 5123, count: 3, type: 'SCALAR' },
    ],
    ...(image ? { images: [{ uri: image }], textures: [{ source: 0 }] } : {}),
    materials: [{
      pbrMetallicRoughness: {
        baseColorFactor: [1, 0.5, 0.25, 1], metallicFactor: 0,
        ...(image ? { baseColorTexture: { index: 0 } } : {}),
      },
    }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, indices: 2, material: 0, mode: 4 }] }],
    nodes: [{ name: 'Body', mesh: 0, translation: [3, 0, 0] }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  });
}

const prefabOf = (abs: string): { entities: { components: { type: string; data: Record<string, string> }[] }[] } =>
  JSON.parse(readFileSync(abs, 'utf8'));

describe('importing a model', () => {
  it('writes the mesh and the prefab beside the copied source, each registered', async () => {
    const src = path.join(outside, 'robot.gltf');
    writeFileSync(src, gltf());
    const res = await importAssets(root, 'assets/models', [src]);

    expect(res.imported).toEqual([
      'assets/models/robot.gltf',
      'assets/models/robot.esmesh',
      'assets/models/robot.esprefab',
    ]);
    expect(meta(path.join(root, 'assets/models/robot.esmesh')).type).toBe('mesh');
    expect(meta(path.join(root, 'assets/models/robot.esprefab')).type).toBe('prefab');

    const prefab = prefabOf(path.join(root, 'assets/models/robot.esprefab'));
    expect(prefab.entities[0]!.components[1]!.data.mesh).toBe('assets/models/robot.esmesh');
  });

  it('produces beside an in-project source, not in the browser’s folder', async () => {
    const abs = path.join(root, 'assets/sub/tree.gltf');
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, gltf());
    const res = await importAssets(root, 'assets/elsewhere', [abs]);
    expect(res.imported).toContain('assets/sub/tree.esmesh');
    expect(existsSync(path.join(root, 'assets/elsewhere/tree.esmesh'))).toBe(false);
  });

  it('brings an outside image in at the path the model names it by', async () => {
    mkdirSync(path.join(outside, 'textures'), { recursive: true });
    writeFileSync(path.join(outside, 'textures/skin.png'), 'PNG');
    const src = path.join(outside, 'robot.gltf');
    writeFileSync(src, gltf('textures/skin.png'));
    await importAssets(root, 'assets/models', [src]);

    // The same relative path, so the copied .gltf still points at its own image.
    const copied = path.join(root, 'assets/models/textures/skin.png');
    expect(existsSync(copied)).toBe(true);
    expect(meta(copied).type).toBe('texture');
    const prefab = prefabOf(path.join(root, 'assets/models/robot.esprefab'));
    expect(prefab.entities[0]!.components[1]!.data.texture)
      .toBe('assets/models/textures/skin.png');
  });

  it('brings the .bin with it, so the copy can be imported again', async () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const uvs = new Float32Array([0, 0, 1, 0, 0, 1]);
    const indices = new Uint16Array([0, 1, 2]);
    const bin = Buffer.concat([
      Buffer.from(positions.buffer), Buffer.from(uvs.buffer), Buffer.from(indices.buffer),
    ]);
    writeFileSync(path.join(outside, 'robot.bin'), bin);
    const doc = JSON.parse(gltf()) as { buffers: { uri: string; byteLength: number }[] };
    doc.buffers = [{ uri: 'robot.bin', byteLength: bin.length }];
    const src = path.join(outside, 'robot.gltf');
    writeFileSync(src, JSON.stringify(doc));

    const first = await importAssets(root, 'assets/models', [src]);
    expect(first.imported).toContain('assets/models/robot.bin');
    expect(first.warnings ?? []).toEqual([]);

    // The copy, imported on its own terms: the geometry has to come out again.
    rmSync(outside, { recursive: true, force: true });
    const again = await importAssets(root, 'assets/models',
                                     [path.join(root, 'assets/models/robot.gltf')]);
    expect(again.imported).toContain('assets/models/robot.esmesh');
    expect(again.warnings ?? []).toEqual([]);
  });

  it('says so when a dependency cannot keep its shape inside the project', async () => {
    mkdirSync(path.join(outside, 'model'), { recursive: true });
    writeFileSync(path.join(outside, 'shared.png'), 'PNG');
    const src = path.join(outside, 'model/robot.gltf');
    writeFileSync(src, gltf('../shared.png'));
    const res = await importAssets(root, 'assets/models', [src]);

    expect(existsSync(path.join(root, 'assets/models/shared.png'))).toBe(true);
    expect(res.warnings?.join('\n')).toContain("outside the model's folder");
  });

  it('never writes a dependency outside the project', async () => {
    mkdirSync(path.join(outside, 'model'), { recursive: true });
    writeFileSync(path.join(outside, 'evil.png'), 'PNG');
    const src = path.join(outside, 'model/robot.gltf');
    // Escapes without starting with "..", which is what a hand-rolled check misses.
    writeFileSync(src, gltf('sub/../../evil.png'));
    await importAssets(root, 'assets/models', [src]);

    expect(existsSync(path.join(root, 'assets/models/evil.png'))).toBe(true);
    expect(existsSync(path.join(root, '../evil.png'))).toBe(false);
  });

  it('leaves an image that is already in the project where it lies', async () => {
    const abs = path.join(root, 'assets/models/robot.gltf');
    mkdirSync(path.join(root, 'assets/models/textures'), { recursive: true });
    writeFileSync(path.join(root, 'assets/models/textures/skin.png'), 'PNG');
    writeFileSync(abs, gltf('textures/skin.png'));
    await importAssets(root, 'assets/models', [abs]);

    const prefab = prefabOf(path.join(root, 'assets/models/robot.esprefab'));
    expect(prefab.entities[0]!.components[1]!.data.texture)
      .toBe('assets/models/textures/skin.png');
    expect(existsSync(path.join(root, 'assets/models/robot_skin.png'))).toBe(false);
  });

  it('keeps a product’s identity across a re-import', async () => {
    const abs = path.join(root, 'assets/models/robot.gltf');
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, gltf());
    await importAssets(root, 'assets/models', [abs]);
    const first = meta(path.join(root, 'assets/models/robot.esmesh')).uuid;

    await importAssets(root, 'assets/models', [abs]);
    expect(meta(path.join(root, 'assets/models/robot.esmesh')).uuid).toBe(first);
  });

  it('reports what the source says and this engine cannot draw', async () => {
    const src = path.join(outside, 'metal.gltf');
    const doc = JSON.parse(gltf()) as { materials: { pbrMetallicRoughness: { metallicFactor: number } }[] };
    doc.materials[0]!.pbrMetallicRoughness.metallicFactor = 1;
    writeFileSync(src, JSON.stringify(doc));
    const res = await importAssets(root, 'assets/models', [src]);
    expect(res.warnings?.join('\n')).toContain('metallic-roughness');
  });
});
