// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// The platform catalog: what the Package dialog can offer, and whether each
// target can actually run. Two behaviours worth pinning down —
//
//   1. Readiness is a PROBE, not a constant. The dialog used to carry static
//      "requires the X runtime" prose that was true whether or not you had built
//      it (and, for playable, was simply wrong).
//   2. A project can add a platform the editor never heard of, and a broken one
//      must not take the dialog down with it.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { listPlatforms, loadProjectPlatform, createProjectPlatform, PROJECT_PLATFORM_DIR } from '../electron/platformCatalog';
import { BUILTIN_PLATFORMS } from '../src/project/platforms';

let root: string;
let webDir: string;
let wxDir: string;

const dirs = () => ({ web: webDir, wechat: wxDir });

function writePlatform(name: string, source: string): void {
  const dir = path.join(root, PROJECT_PLATFORM_DIR);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, name), source);
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'es-platcat-'));
  webDir = path.join(root, 'rt-web');
  wxDir = path.join(root, 'rt-wechat');
  mkdirSync(webDir, { recursive: true });
  mkdirSync(wxDir, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('listPlatforms — built-in readiness is probed', () => {
  it('web/desktop/playable are not ready without the web engine glue', async () => {
    const rows = await listPlatforms(root, dirs());
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));

    expect(byId.web.ready).toBe(false);
    expect(byId.desktop.ready).toBe(false);
    expect(byId.playable.ready).toBe(false);
    expect(byId.web.prereq?.command).toContain('build -t web');
  });

  it('the web glue makes playable ready too — it inlines the WEB runtime, not a -t playable one', async () => {
    writeFileSync(path.join(webDir, 'esengine.js'), '//');
    const rows = await listPlatforms(root, dirs());
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));

    expect(byId.web.ready).toBe(true);
    expect(byId.playable.ready).toBe(true);
    expect(byId.playable.prereq).toBeUndefined();
    // WeChat has its own runtime and is unaffected by the web one.
    expect(byId.wechat.ready).toBe(false);
    expect(byId.wechat.prereq?.command).toContain('build -t wechat');
  });

  it('WeChat accepts either its own glue or a web-aligned one', async () => {
    writeFileSync(path.join(wxDir, 'esengine.wxgame.js'), '//');
    expect((await listPlatforms(root, dirs())).find((r) => r.id === 'wechat')?.ready).toBe(true);

    rmSync(path.join(wxDir, 'esengine.wxgame.js'));
    writeFileSync(path.join(wxDir, 'esengine.js'), '//');
    expect((await listPlatforms(root, dirs())).find((r) => r.id === 'wechat')?.ready).toBe(true);
  });

  it('reports paths with forward slashes, whatever the platform separator', async () => {
    const wx = (await listPlatforms(root, dirs())).find((r) => r.id === 'wechat');
    expect(wx?.prereq?.dir).not.toContain('\\');
  });
});

describe('listPlatforms — platforms the project defines', () => {
  it('finds a profile and lifts its display data', async () => {
    writePlatform('acme.mjs', `export default {
      id: 'acme', label: 'ACME Play', blurb: 'ACME package.', defaultOut: 'dist-acme',
      emitConfigFiles: () => [{ file: 'game.json', content: '{}' }],
    };`);
    writeFileSync(path.join(webDir, 'esengine.js'), '//');

    const rows = await listPlatforms(root, dirs());
    const acme = rows.find((r) => r.id === 'acme');
    expect(acme).toBeDefined();
    expect(acme!.source).toBe('project');
    expect(acme!.label).toBe('ACME Play');
    expect(acme!.defaultOut).toBe('dist-acme');
    // No wasmDir of its own → the editor's web runtime, which exists here.
    expect(acme!.ready).toBe(true);
  });

  it('probes the profile\'s own runtime dir when it names one', async () => {
    writePlatform('acme.mjs', `export default {
      id: 'acme', label: 'ACME Play', wasmDir: 'build/wasm/acme',
      emitConfigFiles: () => [],
    };`);
    writeFileSync(path.join(webDir, 'esengine.js'), '//');

    const acme = (await listPlatforms(root, dirs())).find((r) => r.id === 'acme');
    expect(acme!.ready).toBe(false);
    expect(acme!.prereq?.dir).toBe('build/wasm/acme');
    // The editor does not know how a project builds its own runtime, so it
    // reports where it looked and offers no command.
    expect(acme!.prereq?.command).toBeUndefined();
  });

  it('a broken profile is listed with its error, not silently dropped', async () => {
    writePlatform('bad.mjs', 'export default { this is not valid javascript');
    const rows = await listPlatforms(root, dirs());
    const bad = rows.find((r) => r.id === 'bad');
    expect(bad).toBeDefined();
    expect(bad!.ready).toBe(false);
    expect(bad!.error).toBeTruthy();
    // Every built-in still came through.
    expect(rows.filter((r) => r.source === 'builtin').map((r) => r.id)).toEqual([...BUILTIN_PLATFORMS]);
  });

  it('rejects a profile that shadows a built-in, or has no id/label/emitter', async () => {
    writePlatform('a.mjs', `export default { id: 'wechat', label: 'Fake', emitConfigFiles: () => [] };`);
    writePlatform('b.mjs', `export default { id: 'Bad Id', label: 'X', emitConfigFiles: () => [] };`);
    writePlatform('c.mjs', `export default { id: 'ok-id', emitConfigFiles: () => [] };`);
    writePlatform('d.mjs', `export default { id: 'ok-id2', label: 'X' };`);

    const rows = await listPlatforms(root, dirs());
    const errs = rows.filter((r) => r.source === 'project').map((r) => r.error);
    expect(errs).toHaveLength(4);
    expect(errs[0]).toContain('built-in');
    expect(errs[1]).toContain('lowercase');
    expect(errs[2]).toContain('label');
    expect(errs[3]).toContain('emitConfigFiles');
    // The real WeChat row is untouched by the impostor.
    expect(rows.filter((r) => r.id === 'wechat' && r.source === 'builtin')).toHaveLength(1);
  });

  it('lists only built-ins when no project is open', async () => {
    const rows = await listPlatforms(null, dirs());
    expect(rows.every((r) => r.source === 'builtin')).toBe(true);
  });
});

describe('createProjectPlatform — scaffolding', () => {
  it('writes both halves, already joined, and the result is discoverable', async () => {
    const res = await createProjectPlatform(root, 'acme-play', 'ACME Play', 'src');
    expect(res.ok).toBe(true);
    expect(res.packagingFile).toBe('.esengine/platforms/acme-play.mjs');
    expect(res.runtimeFile).toBe('src/platforms/acme-play.runtime.ts');
    // Reported with forward slashes, like every other path the dialog shows.
    expect(res.packagingFile).not.toContain('\\');

    const packaging = readFileSync(path.join(root, res.packagingFile!), 'utf8');
    const runtime = readFileSync(path.join(root, res.runtimeFile!), 'utf8');
    // THE JOIN: the packaging half names the runtime half.
    expect(packaging).toContain(`runtimeProfile: 'src/platforms/acme-play.runtime.ts'`);
    expect(runtime).toContain(`id: 'acme-play'`);
    expect(runtime).toContain(`hostLabel: 'ACME Play'`);
    // The overrides a vendor might want are present as guidance, commented out.
    expect(runtime).toContain('createVideoBackend');
    expect(runtime).toContain('instantiateWasm');

    // What was scaffolded is immediately a real platform.
    writeFileSync(path.join(webDir, 'esengine.js'), '//');
    const rows = await listPlatforms(root, dirs());
    const acme = rows.find((r) => r.id === 'acme-play');
    expect(acme?.source).toBe('project');
    expect(acme?.label).toBe('ACME Play');
    expect(acme?.error).toBeUndefined();
    expect(acme?.ready).toBe(true);

    // And it loads into a complete export profile.
    const loaded = await loadProjectPlatform(root, 'acme-play', dirs());
    expect(loaded!.profile.runtimeProfileModule).toBe(path.join(root, 'src', 'platforms', 'acme-play.runtime.ts'));
    expect(loaded!.defaultOut).toBe('dist-acme-play');
    expect(loaded!.profile.emitConfigFiles({ title: 'T', appid: '', orientation: 'portrait', subPackages: [], includeSuffixes: [] })[0].file)
      .toBe('game.json');
  });

  it('refuses an id that shadows a built-in or is malformed', async () => {
    expect((await createProjectPlatform(root, 'wechat', 'Fake', 'src')).error).toContain('built-in');
    expect((await createProjectPlatform(root, 'Bad Id', 'X', 'src')).error).toContain('lowercase');
    expect((await createProjectPlatform(root, 'ok-id', '  ', 'src')).error).toContain('label');
  });

  it('never clobbers an existing platform, or a runtime half already written', async () => {
    await createProjectPlatform(root, 'acme', 'ACME', 'src');
    const runtimeAbs = path.join(root, 'src', 'platforms', 'acme.runtime.ts');
    writeFileSync(runtimeAbs, 'export default { mine: true };');

    const again = await createProjectPlatform(root, 'acme', 'ACME', 'src');
    expect(again.ok).toBe(false);
    expect(again.error).toContain('already exists');
    expect(readFileSync(runtimeAbs, 'utf8')).toBe('export default { mine: true };');
  });
});

describe('loadProjectPlatform — the profile handed to exportMiniGame', () => {
  it('merges over the family defaults, so a minimal profile is complete', async () => {
    writePlatform('acme.mjs', `export default {
      id: 'acme', label: 'ACME Play',
      emitConfigFiles: (ctx) => [{ file: 'game.json', content: JSON.stringify({ t: ctx.title }) }],
    };`);

    const loaded = await loadProjectPlatform(root, 'acme', dirs());
    expect(loaded).not.toBeNull();
    const p = loaded!.profile;

    // Supplied by the project.
    expect(p.id).toBe('acme');
    // Defaulted — a standard mini-game host needs none of these spelled out.
    expect(p.sdkEntryFile).toBe('index.minigame.js');
    expect(p.runtimeInit).toBe('initMiniGameRuntime');
    expect(p.engineGlueCandidates).toEqual(['esengine.js']);
    expect(p.esTarget).toBe('es2017');
    expect(p.subpackageDir).toBe('subpackages');
    expect(typeof p.emitEntry).toBe('function');

    // The default entry is the same CommonJS shape WeChat ships.
    const entry = p.emitEntry({ sideModules: [{ id: 'physics', file: 'physics' }], engineGlueFile: 'esengine.js' });
    expect(entry).toContain("require('./wasm/esengine.js')");
    expect(entry).toContain(`"physics": asFactory(require('./wasm/physics.js'))`);
    expect(entry).toContain("require('./game-bundle.js')");

    // And the project's own emitter is what runs for config.
    expect(p.emitConfigFiles({ title: 'T', appid: '', orientation: 'portrait', subPackages: [], includeSuffixes: [] }))
      .toEqual([{ file: 'game.json', content: '{"t":"T"}' }]);
  });

  it('resolves wasmDir against the project root, defaulting to the web runtime', async () => {
    writePlatform('a.mjs', `export default { id: 'a', label: 'A', wasmDir: 'rt/a', emitConfigFiles: () => [] };`);
    writePlatform('b.mjs', `export default { id: 'b', label: 'B', emitConfigFiles: () => [] };`);

    expect((await loadProjectPlatform(root, 'a', dirs()))!.wasmDir).toBe(path.join(root, 'rt', 'a'));
    expect((await loadProjectPlatform(root, 'b', dirs()))!.wasmDir).toBe(webDir);
    expect((await loadProjectPlatform(root, 'b', dirs()))!.defaultOut).toBe('dist-b');
  });

  // A vendor has two halves: the .mjs describes packaging, a runtime module
  // describes the host (and any capability it replaces — its own video decoder,
  // audio backend, socket). Naming the second from the first is what joins them,
  // and the generated entry installs it before booting.
  it('resolves the runtime half to an absolute module path', async () => {
    mkdirSync(path.join(root, 'src'), { recursive: true });
    writeFileSync(path.join(root, 'src', 'acme-runtime.ts'), 'export default {};');
    writePlatform('acme.mjs', `export default {
      id: 'acme', label: 'ACME Play', runtimeProfile: 'src/acme-runtime.ts',
      emitConfigFiles: () => [],
    };`);

    const loaded = await loadProjectPlatform(root, 'acme', dirs());
    expect(loaded!.profile.runtimeProfileModule).toBe(path.join(root, 'src', 'acme-runtime.ts'));
  });

  it('leaves runtimeProfileModule undefined when the project installs its own platform', async () => {
    writePlatform('acme.mjs', `export default { id: 'acme', label: 'A', emitConfigFiles: () => [] };`);
    const loaded = await loadProjectPlatform(root, 'acme', dirs());
    expect(loaded!.profile.runtimeProfileModule).toBeUndefined();
  });

  it('flags a runtime half that points nowhere, instead of shipping a broken import', async () => {
    writePlatform('acme.mjs', `export default {
      id: 'acme', label: 'ACME Play', runtimeProfile: 'src/missing.ts',
      emitConfigFiles: () => [],
    };`);
    const acme = (await listPlatforms(root, dirs())).find((r) => r.id === 'acme');
    expect(acme!.ready).toBe(false);
    expect(acme!.error).toContain('runtimeProfile');
  });

  it('accepts a runtime half written without its extension', async () => {
    mkdirSync(path.join(root, 'src'), { recursive: true });
    writeFileSync(path.join(root, 'src', 'rt.ts'), 'export default {};');
    writePlatform('acme.mjs', `export default {
      id: 'acme', label: 'A', runtimeProfile: 'src/rt', emitConfigFiles: () => [],
    };`);
    writeFileSync(path.join(webDir, 'esengine.js'), '//');
    const acme = (await listPlatforms(root, dirs())).find((r) => r.id === 'acme');
    expect(acme!.error).toBeUndefined();
    expect(acme!.ready).toBe(true);
  });

  it('is null for a built-in id, so the built-in pipeline keeps it', async () => {
    expect(await loadProjectPlatform(root, 'wechat', dirs())).toBeNull();
    expect(await loadProjectPlatform(root, 'nope', dirs())).toBeNull();
  });
});
