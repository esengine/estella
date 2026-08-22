// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Which optional modules a web package carries: the ones its content can
 *        ask for, and no others. A dropped module is a 404 at boot.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportGame } from '../src/export/exportGame';
import { runtimeConfigOf } from '../src/project/runtimeConfig';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAME_HOST = path.join(HERE, '..', '..', 'pipeline', 'src', 'runtime', 'gameHost.ts');

const SCN = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const PFB = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const meta = (uuid: string, type: string) => JSON.stringify({ uuid, version: '2.0', type, importer: {} });

/** Every module the engine ships, so a test can assert what did NOT come along. */
const ALL_MODULES = [
  'physics', 'physics3d', 'basis', 'videodec', 'dragonbones',
  'spine21', 'spine38', 'spine41', 'spine42', 'spine43',
];

interface Fixture { root: string; out: string }

function setup(scene: unknown, extra?: (root: string) => void): Fixture {
  const root = mkdtempSync(path.join(tmpdir(), 'estella-sidemod-'));
  mkdirSync(path.join(root, 'scenes'), { recursive: true });
  writeFileSync(path.join(root, 'scenes', 'main.esscene'), JSON.stringify(scene));
  writeFileSync(path.join(root, 'scenes', 'main.esscene.meta'), meta(SCN, 'scene'));

  mkdirSync(path.join(root, '_sdk'), { recursive: true });
  writeFileSync(path.join(root, '_sdk', 'index.js'), 'export const x = 1;');

  mkdirSync(path.join(root, '_wasm'), { recursive: true });
  writeFileSync(path.join(root, '_wasm', 'esengine.js'), 'export default () => {};');
  writeFileSync(path.join(root, '_wasm', 'esengine.wasm'), 'ENGINE');
  writeFileSync(path.join(root, '_wasm', 'wasm.manifest.json'), JSON.stringify({ schema: 1 }));
  for (const m of ALL_MODULES) {
    writeFileSync(path.join(root, '_wasm', `${m}.js`), `export default () => {};/*${m}*/`);
    writeFileSync(path.join(root, '_wasm', `${m}.wasm`), m.toUpperCase());
  }
  extra?.(root);
  return { root, out: path.join(root, 'dist') };
}

const run = (f: Fixture, runtime?: Parameters<typeof exportGame>[0]['runtime']) => exportGame({
  root: f.root, entryScene: 'scenes/main.esscene', gameHostEntry: GAME_HOST,
  sdkDistDir: path.join(f.root, '_sdk'), wasmDir: path.join(f.root, '_wasm'),
  outDir: f.out, ...(runtime ? { runtime } : {}),
});

/** The module artifact base names the package actually carries. */
function shipped(out: string): string[] {
  return ALL_MODULES.filter((m) => existsSync(path.join(out, 'wasm', `${m}.wasm`)));
}

const entities = (...components: Array<{ type: string; data?: unknown }>) =>
  [{ id: 0, components }];

describe('web package side modules', () => {
  it('carries the engine and nothing optional for a scene that asks for nothing', async () => {
    const f = setup({ version: '1.0', name: 'Main', entities: entities({ type: 'Sprite', data: {} }) });
    try {
      const res = await run(f);
      expect(res.errors).toEqual([]);
      expect(shipped(f.out)).toEqual([]);
      // The engine core and the dir's other contents are never the scan's to drop.
      expect(existsSync(path.join(f.out, 'wasm', 'esengine.wasm'))).toBe(true);
      expect(existsSync(path.join(f.out, 'wasm', 'esengine.js'))).toBe(true);
      expect(existsSync(path.join(f.out, 'wasm', 'wasm.manifest.json'))).toBe(true);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  }, 60_000);

  it('carries the 2D solver for a scene with a body', async () => {
    const f = setup({ version: '1.0', name: 'Main', entities: entities({ type: 'RigidBody', data: { bodyType: 1 } }) });
    try {
      expect(shipped((await run(f), f.out))).toEqual(['physics']);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  }, 60_000);

  it('carries the 2D solver a project declares but no scene uses', async () => {
    const f = setup({ version: '1.0', name: 'Main', entities: entities({ type: 'Sprite', data: {} }) });
    try {
      await run(f, runtimeConfigOf({ features: { physics: { enabled: true } } }));
      expect(shipped(f.out)).toEqual(['physics']);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  }, 60_000);

  it('carries the 3D solver for a 3D body, and never implies it from the 2D flag', async () => {
    const f = setup({ version: '1.0', name: 'Main', entities: entities({ type: 'RigidBody3D', data: {} }) });
    try {
      await run(f);
      expect(shipped(f.out)).toEqual(['physics3d']);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  }, 60_000);

  // Joints and mesh colliders are 3D physics components like the bodies are;
  // the scan answers for every type the runtime's own gate counts.
  it('carries the 3D solver for a joint, not only for a body', async () => {
    const f = setup({ version: '1.0', name: 'Main', entities: entities({ type: 'HingeJoint3D', data: {} }) });
    try {
      await run(f);
      expect(shipped(f.out)).toEqual(['physics3d']);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  }, 60_000);

  it('carries the 3D solver for a mesh collider', async () => {
    const f = setup({ version: '1.0', name: 'Main', entities: entities({ type: 'MeshCollider3D', data: {} }) });
    try {
      await run(f);
      expect(shipped(f.out)).toEqual(['physics3d']);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  }, 60_000);

  // The runtime expands prefabs before it asks whether the scene needs physics,
  // so a body reachable only through a prefab is one the package must carry.
  it('carries what a shipped prefab needs, not only what a scene holds', async () => {
    const f = setup(
      { version: '1.0', name: 'Main', entities: entities({ type: 'Spawner', data: { prefab: `@uuid:${PFB}` } }) },
      (root) => {
        mkdirSync(path.join(root, 'prefabs'), { recursive: true });
        writeFileSync(path.join(root, 'prefabs', 'enemy.esprefab'), JSON.stringify({
          version: '1.0', name: 'Enemy', rootEntityId: 'r',
          entities: [{ prefabEntityId: 'r', name: 'Enemy', parent: null, children: [], visible: true, components: [{ type: 'RigidBody', data: { bodyType: 1 } }] }],
        }));
        writeFileSync(path.join(root, 'prefabs', 'enemy.esprefab.meta'), meta(PFB, 'prefab'));
      },
    );
    try {
      const res = await run(f);
      expect(res.errors).toEqual([]);
      expect(shipped(f.out)).toEqual(['physics']);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  }, 60_000);

  it('fails the export when the content needs a module the wasm dir has not built', async () => {
    const f = setup({ version: '1.0', name: 'Main', entities: entities({ type: 'RigidBody3D', data: {} }) });
    rmSync(path.join(f.root, '_wasm', 'physics3d.js'));
    try {
      const res = await run(f);
      expect(res.ok).toBe(false);
      expect(res.errors.join('\n')).toMatch(/physics3d/);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  }, 60_000);
});
