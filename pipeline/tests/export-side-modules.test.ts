// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Which optional modules a web package carries: the ones its content can
 *        ask for, and no others. A dropped module is a 404 at boot.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportGame } from '../src/export/exportGame';
import { runtimeConfigOf } from '../src/project/runtimeConfig';
import { writeFakeSdkDist } from './fixtures/fakeSdkDist';
import { OFFICIAL_PACKAGES } from './officialPackagesDir';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOSTS = path.join(HERE, '..', '..', 'pipeline', 'src', 'runtime');

const SCN = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const PFB = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const meta = (uuid: string, type: string) => JSON.stringify({ uuid, version: '2.0', type, importer: {} });

/** Every module the engine ships, so a test can assert what did NOT come along. */
const ALL_MODULES = [
  'physics', 'physics3d', 'physics3d-physx', 'basis', 'videodec', 'dragonbones',
  'spine21', 'spine38', 'spine41', 'spine42', 'spine43',
];

interface Fixture { root: string; out: string }

function setup(scene: unknown, extra?: (root: string) => void): Fixture {
  const root = mkdtempSync(path.join(tmpdir(), 'estella-sidemod-'));
  mkdirSync(path.join(root, 'scenes'), { recursive: true });
  writeFileSync(path.join(root, 'scenes', 'main.esscene'), JSON.stringify(scene));
  writeFileSync(path.join(root, 'scenes', 'main.esscene.meta'), meta(SCN, 'scene'));

  writeFakeSdkDist(path.join(root, '_sdk'));

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

const run = (
  f: Fixture,
  runtime?: Parameters<typeof exportGame>[0]['runtime'],
  features?: Parameters<typeof exportGame>[0]['features'],
  packAssets?: boolean,
) => exportGame({
  root: f.root, entryScene: 'scenes/main.esscene', hostsDir: HOSTS, packagesDir: OFFICIAL_PACKAGES,
  sdkDistDir: path.join(f.root, '_sdk'), wasmDir: path.join(f.root, '_wasm'),
  outDir: f.out, ...(runtime ? { runtime } : {}), ...(features ? { features } : {}),
  ...(packAssets === undefined ? {} : { packAssets }),
});

/** The module artifact base names the package actually carries. */
function shipped(out: string): string[] {
  return ALL_MODULES.filter((m) => existsSync(path.join(out, 'wasm', `${m}.wasm`)));
}

const entities = (...components: Array<{ type: string; data?: unknown }>) =>
  [{ id: 0, components }];

describe.each(['wechat', 'douyin'] as const)('%s 3D solver artifacts', (platform) => {
  it.each([
    { backend3d: 'jolt', file: 'physics3d' },
    { backend3d: 'physx', file: 'physics3d-physx' },
  ] as const)('reports the build needed for incompatible or incomplete $backend3d artifacts', async ({ backend3d, file }) => {
    const f = setup({ version: 4, entities: [{ id: 1, components: [{ type: 'RigidBody3D', data: {} }] }] });
    try {
      const wasmDir = path.join(f.root, '_wasm');
      writeFileSync(path.join(wasmDir, 'esengine.js'), 'module.exports = () => {};');
      const build = () => exportGame({
        platform, root: f.root, entryScene: 'scenes/main.esscene', outDir: f.out,
        hostsDir: HOSTS, packagesDir: OFFICIAL_PACKAGES, sdkDistDir: path.join(f.root, '_sdk'), wasmDir,
        features: { physics: { backend3d } },
      });
      // Douyin's runtime is the build without wasm SIMD (its iOS host refuses it), so its hint names that build.
      const command = `node build-tools/cli.js build -t ${file}-${platform === 'douyin' ? 'quickgame' : 'wechat'}`;
      const wrongFormat = await build();
      expect(wrongFormat.ok).toBe(false);
      expect(wrongFormat.errors.join('\n')).toContain(`${file}.js is an ES module`);
      expect(wrongFormat.errors.join('\n')).toContain(command + ' --no-cache');

      writeFileSync(path.join(wasmDir, `${file}.js`), 'module.exports = () => {};');
      rmSync(path.join(wasmDir, `${file}.wasm`));
      const incomplete = await build();
      expect(incomplete.ok).toBe(false);
      expect(incomplete.errors.join('\n')).toContain(`${file}.wasm is missing`);
      expect(incomplete.errors.join('\n')).toContain(command);
      expect(existsSync(path.join(f.out, 'game.js'))).toBe(false);
    } finally {
      rmSync(f.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  });
});

describe('web package side modules', () => {
  it('removes old texture hashes after editing and unreferencing a sprite texture', async () => {
    const tex = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const f = setup({ version: '1.0', name: 'Main', entities: entities({ type: 'Sprite', data: { texture: `@uuid:${tex}` } }) }, (root) => {
      mkdirSync(path.join(root, 'assets'));
      writeFileSync(path.join(root, 'assets/hero.png'), 'PNGDATA');
      writeFileSync(path.join(root, 'assets/hero.png.meta'), meta(tex, 'texture'));
    });
    const texturePath = () => JSON.parse(readFileSync(path.join(f.out, 'asset-manifest.json'), 'utf8')).groups.main.assets[tex].path as string;
    try {
      expect((await run(f)).ok).toBe(true);
      const first = texturePath();
      writeFileSync(path.join(f.out, 'host-config.json'), 'KEEP');
      writeFileSync(path.join(f.out, 'assets/custom.txt'), 'KEEP');
      writeFileSync(path.join(f.root, 'assets/hero.png'), 'CHANGEDPNGDATA');
      expect((await run(f)).ok).toBe(true);
      const second = texturePath();
      expect(second).not.toBe(first);
      expect(existsSync(path.join(f.out, first))).toBe(false);
      expect(existsSync(path.join(f.out, second))).toBe(true);
      writeFileSync(path.join(f.root, 'scenes/main.esscene'), JSON.stringify({ version: '1.0', entities: [] }));
      expect((await run(f)).ok).toBe(true);
      expect(existsSync(path.join(f.out, second))).toBe(false);
      expect(existsSync(path.join(f.out, 'assets/custom.txt'))).toBe(true);
      expect(existsSync(path.join(f.out, 'host-config.json'))).toBe(true);
      expect(readFileSync(path.join(f.root, 'assets/hero.png'), 'utf8')).toBe('CHANGEDPNGDATA');
    } finally { rmSync(f.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
  }, 60_000);

  it('removes an old pack when exporting its materials as separate files', async () => {
    const a = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', b = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    const f = setup({ version: '1.0', entities: [{ id: 0, components: [{ type: 'Sprite', data: { material: `@uuid:${a}` } }] },
      { id: 1, components: [{ type: 'Sprite', data: { material: `@uuid:${b}` } }] }] }, (root) => {
      mkdirSync(path.join(root, 'assets'));
      for (const [name, uuid, value] of [['a', a, 1], ['b', b, 2]]) {
        writeFileSync(path.join(root, `assets/${name}.esmaterial`), JSON.stringify({ shader: 'builtin:sprite', properties: { value } }));
        writeFileSync(path.join(root, `assets/${name}.esmaterial.meta`), meta(uuid as string, 'material'));
      }
    });
    try {
      expect((await run(f)).ok).toBe(true);
      const old = JSON.parse(readFileSync(path.join(f.out, 'asset-manifest.json'), 'utf8')).groups.main.assets[a].pack.file as string;
      expect(existsSync(path.join(f.out, old))).toBe(true);
      expect((await run(f, undefined, undefined, false)).ok).toBe(true);
      expect(existsSync(path.join(f.out, old))).toBe(false);
      const current = JSON.parse(readFileSync(path.join(f.out, 'asset-manifest.json'), 'utf8')).groups.main.assets[a];
      expect(current.pack).toBeUndefined();
      expect(existsSync(path.join(f.out, current.path))).toBe(true);
    } finally { rmSync(f.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
  }, 60_000);

  it('drops a removed solver and preserves output-root files on re-export', async () => {
    const f = setup({ version: '1.0', name: 'Main', entities: entities({ type: 'RigidBody2D', data: {} }) });
    try {
      expect((await run(f)).ok).toBe(true);
      expect(shipped(f.out)).toEqual(['physics']);
      writeFileSync(path.join(f.out, 'host-config.json'), 'KEEP');
      writeFileSync(path.join(f.root, 'scenes', 'main.esscene'), JSON.stringify({ version: '1.0', name: 'Main', entities: [] }));
      expect((await run(f)).ok).toBe(true);
      expect(shipped(f.out)).toEqual([]);
      expect(existsSync(path.join(f.out, 'wasm', 'physics.js'))).toBe(false);
      expect(existsSync(path.join(f.out, 'host-config.json'))).toBe(true);
    } finally { rmSync(f.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
  }, 60_000);

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
    } finally { rmSync(f.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
  }, 60_000);

  it('carries the 2D solver for a scene with a body', async () => {
    const f = setup({ version: '1.0', name: 'Main', entities: entities({ type: 'RigidBody2D', data: { bodyType: 1 } }) });
    try {
      expect(shipped((await run(f), f.out))).toEqual(['physics']);
    } finally { rmSync(f.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
  }, 60_000);

  it('carries the 2D solver a project declares but no scene uses', async () => {
    const f = setup({ version: '1.0', name: 'Main', entities: entities({ type: 'Sprite', data: {} }) });
    try {
      // The project's declaration, which is what the build reads: `runtime` is
      // the packaged game's copy of the same manifest, not a second authority.
      const features = { physics: { enabled: true } };
      await run(f, runtimeConfigOf({ features }), features);
      expect(shipped(f.out)).toEqual(['physics']);
    } finally { rmSync(f.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
  }, 60_000);

  it('carries the 3D solver for a 3D body, and never implies it from the 2D flag', async () => {
    const f = setup({ version: '1.0', name: 'Main', entities: entities({ type: 'RigidBody3D', data: {} }) });
    try {
      await run(f);
      expect(shipped(f.out)).toEqual(['physics3d']);
    } finally { rmSync(f.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
  }, 60_000);

  // Joints and mesh colliders are 3D physics components like the bodies are;
  // the scan answers for every type the runtime's own gate counts.
  it.each(['HingeJoint3D', 'SwingTwistJoint3D', 'SixDOFJoint3D'])('carries the 3D solver for %s, not only for a body', async (type) => {
    const f = setup({ version: '1.0', name: 'Main', entities: entities({ type, data: {} }) });
    try {
      await run(f);
      expect(shipped(f.out)).toEqual(['physics3d']);
    } finally { rmSync(f.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
  }, 60_000);

  it('carries the 3D solver for a mesh collider', async () => {
    const f = setup({ version: '1.0', name: 'Main', entities: entities({ type: 'MeshCollider3D', data: {} }) });
    try {
      await run(f);
      expect(shipped(f.out)).toEqual(['physics3d']);
    } finally { rmSync(f.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
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
          entities: [{ prefabEntityId: 'r', name: 'Enemy', parent: null, children: [], visible: true, components: [{ type: 'RigidBody2D', data: { bodyType: 1 } }] }],
        }));
        writeFileSync(path.join(root, 'prefabs', 'enemy.esprefab.meta'), meta(PFB, 'prefab'));
      },
    );
    try {
      const res = await run(f);
      expect(res.errors).toEqual([]);
      expect(shipped(f.out)).toEqual(['physics']);
    } finally { rmSync(f.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
  }, 60_000);

  it('fails the export when the content needs a module the wasm dir has not built', async () => {
    const f = setup({ version: '1.0', name: 'Main', entities: entities({ type: 'RigidBody3D', data: {} }) });
    rmSync(path.join(f.root, '_wasm', 'physics3d.js'));
    try {
      const res = await run(f);
      expect(res.ok).toBe(false);
      expect(res.errors.join('\n')).toMatch(/physics3d/);
    } finally { rmSync(f.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
  }, 60_000);
});
