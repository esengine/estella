// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// Exporting for a platform the EDITOR DOES NOT SHIP: the project supplies a
// profile and the vendor-neutral mini-game pipeline runs with it.
//
// The case worth pinning down is the join between a vendor's two halves. The
// packaging profile is data; the runtime profile is where the host global and
// any replaced capability live (a game writing its own video decoder puts it
// there). They are separate objects in separate processes, and the generated
// entry is the only thing that can bring them together — `esengine/minigame`
// deliberately installs no platform until the game names a host, so if the entry
// does not install one, the package builds cleanly and then throws on device.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { exportGame } from '../electron/exportGame';
import { loadProjectPlatform } from '../electron/platformCatalog';

const TEX = '11111111-1111-4111-8111-111111111111';
const SCN = '22222222-2222-4222-8222-222222222222';

const meta = (uuid: string, type: string) => JSON.stringify({ uuid, type, importer: {} });

let root: string;
let out: string;

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'es-projplat-'));

  mkdirSync(path.join(root, 'assets'), { recursive: true });
  writeFileSync(path.join(root, 'assets', 'hero.png'), 'PNGDATA');
  writeFileSync(path.join(root, 'assets', 'hero.png.meta'), meta(TEX, 'texture'));

  mkdirSync(path.join(root, 'scenes'), { recursive: true });
  writeFileSync(
    path.join(root, 'scenes', 'main.esscene'),
    JSON.stringify({ version: '1.0', name: 'Main', entities: [{ id: 0, components: [{ type: 'Sprite', data: { texture: `@uuid:${TEX}` } }] }] }),
  );
  writeFileSync(path.join(root, 'scenes', 'main.esscene.meta'), meta(SCN, 'scene'));

  // The runtime half: the host global plus a capability this vendor replaces.
  mkdirSync(path.join(root, 'src'), { recursive: true });
  writeFileSync(path.join(root, 'src', 'acme-runtime.js'), `
export default {
  id: 'acme-play',
  hostLabel: 'ACME Play',
  get global() { return globalThis.acme; },
  // The point of the exercise: this vendor ships its own video decoding.
  createVideoBackend(ctx) { return { name: 'acme-software', createStream() {}, dispose() {} }; },
};
`);

  // The packaging half, naming the runtime one.
  mkdirSync(path.join(root, '.esengine', 'platforms'), { recursive: true });
  writeFileSync(path.join(root, '.esengine', 'platforms', 'acme-play.mjs'), `
export default {
  id: 'acme-play',
  label: 'ACME Play',
  defaultOut: 'dist-acme',
  runtimeProfile: 'src/acme-runtime.js',
  emitConfigFiles(ctx) {
    return [{ file: 'game.json', content: JSON.stringify({ appName: ctx.title, orientation: ctx.orientation }) + '\\n' }];
  },
};
`);

  // Stub SDK dist: the bundle aliases `esengine` → <sdkDir>/index.minigame.js,
  // the family entry that installs nothing on import.
  mkdirSync(path.join(root, '_sdk'), { recursive: true });
  writeFileSync(
    path.join(root, '_sdk', 'index.minigame.js'),
    `export function initMiniGameRuntime(){return Promise.resolve();}\nexport function installMiniGamePlatform(){}\nexport function defineComponent(){}\n`,
  );
  // Stub engine runtime — the default glue candidate is the standard esengine.js.
  mkdirSync(path.join(root, '_wasm'), { recursive: true });
  writeFileSync(path.join(root, '_wasm', 'esengine.js'), 'module.exports = () => Promise.resolve({});');
  writeFileSync(path.join(root, '_wasm', 'esengine.wasm'), 'wasmbytes');

  out = path.join(root, 'dist-acme');
}, 60_000);

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('exportGame — a platform the project defines', () => {
  it('packages through the mini-game pipeline and joins the vendor\'s two halves', async () => {
    const platform = await loadProjectPlatform(root, 'acme-play', { web: path.join(root, '_wasm'), wechat: path.join(root, '_wasm') });
    expect(platform).not.toBeNull();

    const res = await exportGame({
      root,
      entryScene: 'scenes/main.esscene',
      gameHostEntry: 'unused',
      sdkDistDir: path.join(root, '_sdk'),
      wasmDir: platform!.wasmDir,
      outDir: out,
      title: 'ACME Game',
      platform: 'acme-play',
      miniGameProfile: platform!.profile,
      orientation: 'portrait',
    });

    expect(res.errors).toEqual([]);
    expect(res.ok).toBe(true);
    // The result carries the project's id — which is also the cook's per-platform
    // Import Settings key, so this vendor's texture overrides would apply.
    expect(res.platform).toBe('acme-play');

    // The project's own config emitter ran.
    const gameJson = JSON.parse(readFileSync(path.join(out, 'game.json'), 'utf8'));
    expect(gameJson).toEqual({ appName: 'ACME Game', orientation: 'portrait' });

    // The default entry emitter ran (no vendor override needed for game.js).
    const entry = readFileSync(path.join(out, 'game.js'), 'utf8');
    expect(entry).toContain("require('./wasm/esengine.js')");
    expect(entry).toContain("require('./game-bundle.js')");

    // THE JOIN: the bundle installs the runtime profile before booting, and the
    // vendor's replaced capability rode in with it.
    const bundle = readFileSync(path.join(out, 'game-bundle.js'), 'utf8');
    expect(bundle).toContain('installMiniGamePlatform');
    expect(bundle).toContain('acme-software');
    expect(bundle).toContain('initMiniGameRuntime');

    // Scene + manifest assembled the same way as any other mini-game target.
    expect(readFileSync(path.join(out, 'scenes', 'Main.json'), 'utf8')).toContain(TEX);
    expect(readFileSync(path.join(out, 'asset-manifest.json'), 'utf8')).toContain(TEX);
  }, 60_000);

  it('omits the install when the project installs its own platform', async () => {
    // Same vendor, minus the runtimeProfile link: the game is then responsible
    // for calling installMiniGamePlatform itself, so the entry must not guess.
    const bare = { ...(await loadProjectPlatform(root, 'acme-play', { web: path.join(root, '_wasm'), wechat: path.join(root, '_wasm') }))!.profile };
    delete (bare as { runtimeProfileModule?: string }).runtimeProfileModule;

    const outBare = path.join(root, 'dist-bare');
    const res = await exportGame({
      root,
      entryScene: 'scenes/main.esscene',
      gameHostEntry: 'unused',
      sdkDistDir: path.join(root, '_sdk'),
      wasmDir: path.join(root, '_wasm'),
      outDir: outBare,
      title: 'ACME Game',
      platform: 'acme-play',
      miniGameProfile: bare,
    });

    expect(res.ok).toBe(true);
    const bundle = readFileSync(path.join(outBare, 'game-bundle.js'), 'utf8');
    expect(bundle).not.toContain('installMiniGamePlatform');
    expect(bundle).toContain('initMiniGameRuntime');
  }, 60_000);
});
