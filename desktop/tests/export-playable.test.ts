// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Playable-ad export — structure. Asserts ONE self-contained index.html
 *        inlines the SINGLE_FILE glue, the host+scripts IIFE bundle, and the
 *        assets (base64 data URLs keyed by @uuid:) + scenes as globals; and that
 *        the temp cook dir is cleaned (single-file output). Runtime is validated
 *        by the user in a browser / ad preview (no playable simulator here).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { exportGame } from '../electron/exportGame';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLAYABLE_HOST = path.join(HERE, '..', 'src', 'playableHost.ts');

let root: string;
let out: string;
const TEX = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const SCN = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const meta = (uuid: string, type: string) => JSON.stringify({ uuid, version: '2.0', type, importer: {} });

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'estella-export-playable-'));
  mkdirSync(path.join(root, 'assets'), { recursive: true });
  writeFileSync(path.join(root, 'assets', 'hero.png'), 'PNGDATA');
  writeFileSync(path.join(root, 'assets', 'hero.png.meta'), meta(TEX, 'texture'));
  mkdirSync(path.join(root, 'scenes'), { recursive: true });
  writeFileSync(
    path.join(root, 'scenes', 'main.esscene'),
    JSON.stringify({ version: '1.0', name: 'Main', entities: [{ id: 0, components: [{ type: 'Sprite', data: { texture: `@uuid:${TEX}` } }] }] }),
  );
  writeFileSync(path.join(root, 'scenes', 'main.esscene.meta'), meta(SCN, 'scene'));
  // Project script imports 'esengine' (aliased to the stub SDK below); the REAL
  // playableHost is bundled too — so this exercises actual esengine resolution +
  // host bundling (the old stub host hid the resolution bug).
  mkdirSync(path.join(root, 'src'), { recursive: true });
  writeFileSync(path.join(root, 'src', 'main.ts'), `import { defineComponent } from 'esengine';\ndefineComponent('SpawnMarker', {});\n`);
  // Stub SDK dist exporting what the real host + scripts import (bundles for real).
  mkdirSync(path.join(root, '_sdk'), { recursive: true });
  writeFileSync(path.join(root, '_sdk', 'index.js'),
    `export function createWebApp(){return{GL:{registerContext(){}}};}\nexport function setEditorMode(){}\nexport function setPlayMode(){}\nexport function initPlayableRuntime(){return Promise.resolve();}\nexport function createEmbeddedSideModuleHost(){return{acquire(){return Promise.resolve(null);}};}\nexport function defineComponent(){}\nexport function parseThemeOverrides(){}\n`);
  // Stub web wasm runtime (glue text + wasm) — playable inlines these, no separate build.
  mkdirSync(path.join(root, '_wasm'), { recursive: true });
  writeFileSync(path.join(root, '_wasm', 'esengine.js'), `export default function(){}/*WEB_GLUE*/\n`);
  writeFileSync(path.join(root, '_wasm', 'esengine.wasm'), 'WASMBYTES');

  out = path.join(root, 'dist-playable');
}, 60_000);

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('exportGame (playable)', () => {
  it('produces one self-contained index.html with everything inlined', async () => {
    const res = await exportGame({
      root,
      entryScene: 'scenes/main.esscene',
      gameHostEntry: 'unused-for-playable',
      playableHostEntry: PLAYABLE_HOST,
      scriptsEntry: 'src/main.ts',
      sdkDistDir: path.join(root, '_sdk'),
      wasmDir: path.join(root, '_wasm'),
      outDir: out,
      title: 'Playable Demo',
      platform: 'playable',
    });

    expect(res.ok).toBe(true);
    expect(res.platform).toBe('playable');

    // Single file: only index.html, temp cook dir removed, no staged assets dir.
    expect(existsSync(path.join(out, 'index.html'))).toBe(true);
    expect(existsSync(path.join(out, '.playable-cook'))).toBe(false);
    expect(existsSync(path.join(out, 'assets'))).toBe(false);

    const html = readFileSync(path.join(out, 'index.html'), 'utf8');
    expect(html).toContain('WEB_GLUE');                              // web glue text inlined
    expect(html).toContain('__ENGINE_GLUE__');                       // glue + wasm inlined as globals
    expect(html).toContain('__ENGINE_WASM__');
    expect(html).toContain('createObjectURL');                       // real host bundled (blob loader)
    expect(html).toContain('SpawnMarker');                           // project script bundled
    expect(html).toContain(`@uuid:${TEX}`);                          // asset keyed by ref
    expect(html).toContain('data:image/png;base64,');               // asset inlined as data URL
    // Logical path → embedded key map (path refs alias in memory at runtime;
    // the data URL itself ships once, under the uuid key).
    expect(html).toContain('__GAME_PATHMAP__');
    expect(html).toMatch(new RegExp(`"assets/hero\\.png":"@uuid:${TEX}"`));
    expect(html).toContain('__GAME_FIRST__');
    expect(html).toContain('"main"');                                // first scene name
    expect(html).toContain('__GAME_SCENES__');
    expect(html).toContain('<title>Playable Demo</title>');
    // NO rotate-to-fit overlay, unlike the web export. Inside an ad SDK the media
    // query reports the CONTAINER's aspect, which turning the phone need not change,
    // so an overlay keyed on it hid the canvas forever — a playable nobody could play.
    expect(html).not.toContain('rotate-hint');
    expect(html).not.toContain('@media (orientation');
    expect(html).not.toContain('screen.orientation');
  }, 60_000);

  // The ad network is a PROFILE, not a branch: what it contributes is head markup, a
  // CTA bridge, and the size it accepts. A project profile and a built-in one reach
  // the pipeline the same way, so this exercises the contract with a bespoke one.
  it('injects the ad network profile head + CTA bridge, and warns against ITS limit', async () => {
    const o = path.join(root, 'dist-playable-network');
    const res = await exportGame({
      root, entryScene: 'scenes/main.esscene', gameHostEntry: 'unused-for-playable',
      playableHostEntry: PLAYABLE_HOST, scriptsEntry: 'src/main.ts',
      sdkDistDir: path.join(root, '_sdk'), wasmDir: path.join(root, '_wasm'),
      outDir: o, platform: 'playable',
      playableAdProfile: {
        id: 'acme', label: 'Acme Ads',
        // Tiny cap so this fixture's few KB trip the warning.
        maxBytes: 16, limitNote: 'Acme caps playables at 16 bytes',
        emitHead: (ctx) => `<meta name="acme.orientation" content="${ctx.orientation}">`,
        emitBridge: () => 'window.__ESTELLA_PLAYABLE__={cta:function(){AcmeSDK.openStore();}};',
      },
    });
    expect(res.ok).toBe(true);

    const html = readFileSync(path.join(o, 'index.html'), 'utf8');
    expect(html).toContain('<meta name="acme.orientation" content="landscape">');
    expect(html).toContain('AcmeSDK.openStore()');
    // The bridge must precede the game bundle, or a CTA fired during boot finds nothing.
    expect(html.indexOf('__ESTELLA_PLAYABLE__')).toBeLessThan(html.indexOf('__ENGINE_GLUE__'));
    // The warning cites this network's cap and where it came from — not a constant.
    expect(res.warnings.join('\n')).toMatch(/over the 0\.0MB limit for Acme Ads \(Acme caps playables at 16 bytes\)/);
  }, 60_000);

  // A zip-delivery network gets an archive with index.html at the root, and the cap
  // then applies to the ARCHIVE — the file actually being uploaded.
  it('writes playable.zip for a zip-delivery network and measures that', async () => {
    const o = path.join(root, 'dist-playable-zip');
    const res = await exportGame({
      root, entryScene: 'scenes/main.esscene', gameHostEntry: 'unused-for-playable',
      playableHostEntry: PLAYABLE_HOST, scriptsEntry: 'src/main.ts',
      sdkDistDir: path.join(root, '_sdk'), wasmDir: path.join(root, '_wasm'),
      outDir: o, platform: 'playable',
      playableAdProfile: {
        id: 'zipnet', label: 'Zip Net', maxBytes: 5 * 1024 * 1024,
        limitNote: 'Zip Net docs', delivery: 'zip',
      },
    });
    expect(res.ok).toBe(true);

    const zip = path.join(o, 'playable.zip');
    expect(existsSync(zip)).toBe(true);
    // The HTML stays: it is what "Preview over http" serves.
    expect(existsSync(path.join(o, 'index.html'))).toBe(true);
    expect(execFileSync('unzip', ['-t', zip], { encoding: 'utf8' })).toContain('No errors detected');
    expect(execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).trim()).toBe('index.html');
    // What the entry unpacks to IS the exported page, byte for byte.
    const unpacked = execFileSync('unzip', ['-p', zip, 'index.html'], { encoding: 'utf8', maxBuffer: 1 << 26 });
    expect(unpacked).toBe(readFileSync(path.join(o, 'index.html'), 'utf8'));
    // `bytes` is the upload, not the page — they differ, and the compressed one is smaller.
    expect(res.zipFile).toBe(zip);
    expect(res.bytes).toBeLessThan(res.htmlBytes!);
  }, 60_000);

  it('injects nothing and keeps the default cap with no network selected', async () => {
    const o = path.join(root, 'dist-playable-generic');
    const res = await exportGame({
      root, entryScene: 'scenes/main.esscene', gameHostEntry: 'unused-for-playable',
      playableHostEntry: PLAYABLE_HOST, scriptsEntry: 'src/main.ts',
      sdkDistDir: path.join(root, '_sdk'), wasmDir: path.join(root, '_wasm'),
      outDir: o, platform: 'playable',
    });
    expect(res.ok).toBe(true);
    const html = readFileSync(path.join(o, 'index.html'), 'utf8');
    expect(html).not.toContain('__ESTELLA_PLAYABLE__');
    // A fixture this small is under every cap, so nothing to report.
    expect(res.warnings).toEqual([]);
  }, 60_000);

  it('inlines the project camera fit as __GAME_SCREENFIT__ (only when opted in)', async () => {
    const o = path.join(root, 'dist-playable-fit');
    const res = await exportGame({
      root, entryScene: 'scenes/main.esscene', gameHostEntry: 'unused-for-playable',
      playableHostEntry: PLAYABLE_HOST, scriptsEntry: 'src/main.ts',
      sdkDistDir: path.join(root, '_sdk'), wasmDir: path.join(root, '_wasm'),
      outDir: o, platform: 'playable', screenFit: { designWidth: 750, designHeight: 1334, scaleMode: 1, matchWidthOrHeight: 0.5 },
    });
    expect(res.ok).toBe(true);
    const html = readFileSync(path.join(o, 'index.html'), 'utf8');
    expect(html).toContain('__GAME_SCREENFIT__');
    expect(html).toMatch(/"scaleMode":1/);
    expect(html).toMatch(/"designWidth":750/);
  }, 60_000);

  // A portrait project must ALSO stay playable in a landscape container: the page
  // adapts rather than demanding a rotation the SDK may not honour. The orientation
  // reaches the network profile, which is free to declare it to the platform.
  it('does not pin the page even when the project is portrait', async () => {
    const o = path.join(root, 'dist-playable-portrait');
    const res = await exportGame({
      root, entryScene: 'scenes/main.esscene', gameHostEntry: 'unused-for-playable',
      playableHostEntry: PLAYABLE_HOST, scriptsEntry: 'src/main.ts',
      sdkDistDir: path.join(root, '_sdk'), wasmDir: path.join(root, '_wasm'),
      outDir: o, title: 'Playable Demo', platform: 'playable', orientation: 'portrait',
      playableAdProfile: {
        id: 'declares', label: 'Declares Orientation', maxBytes: 5 * 1024 * 1024,
        limitNote: 'test', emitHead: (ctx) => `<meta name="ad.orientation" content="${ctx.orientation}">`,
      },
    });
    expect(res.ok).toBe(true);
    const html = readFileSync(path.join(o, 'index.html'), 'utf8');
    expect(html).not.toContain('rotate-hint');
    expect(html).not.toContain('@media (orientation');
    // Declared to the platform, not enforced on the player.
    expect(html).toContain('<meta name="ad.orientation" content="portrait">');
  }, 60_000);
});

/**
 * The fix this whole path delivers: the exporter runs the runtime's physics/spine
 * gating and inlines exactly those modules — so a physics scene ships with physics,
 * and a missing module fails the export loudly instead of shipping silently broken.
 */
describe('exportGame (playable) — side-module embedding', () => {
  const PSCN = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

  function setupRoot(withPhysicsArtifact: boolean): { r: string; o: string } {
    const r = mkdtempSync(path.join(tmpdir(), 'estella-playable-phys-'));
    mkdirSync(path.join(r, 'scenes'), { recursive: true });
    // A RigidBody makes sceneUsesPhysics() true → the runtime needs physics.
    writeFileSync(path.join(r, 'scenes', 'main.esscene'),
      JSON.stringify({ version: '1.0', name: 'Main', entities: [{ id: 0, components: [{ type: 'RigidBody', data: { bodyType: 1 } }] }] }));
    writeFileSync(path.join(r, 'scenes', 'main.esscene.meta'), meta(PSCN, 'scene'));
    mkdirSync(path.join(r, '_sdk'), { recursive: true });
    writeFileSync(path.join(r, '_sdk', 'index.js'),
      `export function createWebApp(){return{GL:{registerContext(){}}};}\nexport function setEditorMode(){}\nexport function setPlayMode(){}\nexport function initPlayableRuntime(){return Promise.resolve();}\nexport function createEmbeddedSideModuleHost(){return{acquire(){return Promise.resolve(null);}};}\nexport function parseThemeOverrides(){}\n`);
    mkdirSync(path.join(r, '_wasm'), { recursive: true });
    writeFileSync(path.join(r, '_wasm', 'esengine.js'), `export default function(){}\n`);
    writeFileSync(path.join(r, '_wasm', 'esengine.wasm'), 'WASMBYTES');
    if (withPhysicsArtifact) {
      writeFileSync(path.join(r, '_wasm', 'physics.js'), `export default function(){}/*PHYS_GLUE*/\n`);
      writeFileSync(path.join(r, '_wasm', 'physics.wasm'), 'PHYSWASM');
    }
    return { r, o: path.join(r, 'dist') };
  }

  const run = (r: string, o: string) => exportGame({
    root: r, entryScene: 'scenes/main.esscene', gameHostEntry: 'x', playableHostEntry: PLAYABLE_HOST,
    sdkDistDir: path.join(r, '_sdk'), wasmDir: path.join(r, '_wasm'), outDir: o, platform: 'playable',
  });

  it('inlines physics into __SIDE_MODULES__ when the scene uses physics', async () => {
    const { r, o } = setupRoot(true);
    try {
      const res = await run(r, o);
      expect(res.ok).toBe(true);
      const html = readFileSync(path.join(o, 'index.html'), 'utf8');
      expect(html).toContain('__SIDE_MODULES__');
      expect(html).toContain('"physics"');
      expect(html).toContain(Buffer.from('PHYSWASM').toString('base64')); // physics.wasm inlined
    } finally {
      rmSync(r, { recursive: true, force: true });
    }
  }, 60_000);

  it('fails the export when the scene needs physics but physics.wasm is absent', async () => {
    const { r, o } = setupRoot(false);
    try {
      const res = await run(r, o);
      expect(res.ok).toBe(false);
      expect(res.errors.join('\n')).toMatch(/physics/);
    } finally {
      rmSync(r, { recursive: true, force: true });
    }
  }, 60_000);
});

/**
 * Spine: the skeleton + atlas share the authored meta type `spine`, so the exporter
 * must discriminate by extension (`.skel` binary skeleton carries the version) — and
 * the atlas's page image is a dependency the cook has to embed. A playable that lost
 * either shipped a broken spine (module "not embedded" / texture 404) — this is that fix.
 */
describe('exportGame (playable) — spine embedding', () => {
  const SSCN = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const SKEL = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  const ATLAS = '99999999-9999-4999-8999-999999999999';
  const PAGE = '88888888-8888-4888-8888-888888888888';

  // A minimal spine 4.x binary skeleton header: 8 bytes, then a varint length (7)
  // and the version string "4.2.00" — exactly what detectSpineVersion reads.
  const skel = Buffer.concat([Buffer.alloc(8), Buffer.from([7]), Buffer.from('4.2.00')]);
  const atlas = ['hero.png', '\tsize: 64, 64', 'region', '\tbounds: 0, 0, 32, 32', ''].join('\n');

  function setupRoot(withSpineArtifact: boolean): { r: string; o: string } {
    const r = mkdtempSync(path.join(tmpdir(), 'estella-playable-spine-'));
    mkdirSync(path.join(r, 'assets', 'spine'), { recursive: true });
    writeFileSync(path.join(r, 'assets', 'spine', 'hero.png'), 'PNGDATA');
    writeFileSync(path.join(r, 'assets', 'spine', 'hero.png.meta'), meta(PAGE, 'texture'));
    writeFileSync(path.join(r, 'assets', 'spine', 'hero.atlas'), atlas);
    writeFileSync(path.join(r, 'assets', 'spine', 'hero.atlas.meta'), meta(ATLAS, 'spine'));
    writeFileSync(path.join(r, 'assets', 'spine', 'hero.skel'), skel);
    writeFileSync(path.join(r, 'assets', 'spine', 'hero.skel.meta'), meta(SKEL, 'spine'));
    mkdirSync(path.join(r, 'scenes'), { recursive: true });
    writeFileSync(path.join(r, 'scenes', 'main.esscene'),
      JSON.stringify({ version: '1.0', name: 'Main', entities: [{ id: 0, components: [{ type: 'SpineAnimation', data: { skeletonPath: 'assets/spine/hero.skel', atlasPath: 'assets/spine/hero.atlas' } }] }] }));
    writeFileSync(path.join(r, 'scenes', 'main.esscene.meta'), meta(SSCN, 'scene'));
    mkdirSync(path.join(r, '_sdk'), { recursive: true });
    writeFileSync(path.join(r, '_sdk', 'index.js'),
      `export function createWebApp(){return{GL:{registerContext(){}}};}\nexport function setEditorMode(){}\nexport function setPlayMode(){}\nexport function initPlayableRuntime(){return Promise.resolve();}\nexport function createEmbeddedSideModuleHost(){return{acquire(){return Promise.resolve(null);}};}\nexport function parseThemeOverrides(){}\n`);
    mkdirSync(path.join(r, '_wasm'), { recursive: true });
    writeFileSync(path.join(r, '_wasm', 'esengine.js'), `export default function(){}\n`);
    writeFileSync(path.join(r, '_wasm', 'esengine.wasm'), 'WASMBYTES');
    if (withSpineArtifact) {
      writeFileSync(path.join(r, '_wasm', 'spine42.js'), `export default function(){}/*SPINE_GLUE*/\n`);
      writeFileSync(path.join(r, '_wasm', 'spine42.wasm'), 'SPINE42WASM');
    }
    return { r, o: path.join(r, 'dist') };
  }

  const run = (r: string, o: string) => exportGame({
    root: r, entryScene: 'scenes/main.esscene', gameHostEntry: 'x', playableHostEntry: PLAYABLE_HOST,
    sdkDistDir: path.join(r, '_sdk'), wasmDir: path.join(r, '_wasm'), outDir: o, platform: 'playable',
  });

  it('inlines spine:4.2 (detected from the .skel) and embeds the atlas page texture', async () => {
    const { r, o } = setupRoot(true);
    try {
      const res = await run(r, o);
      expect(res.ok).toBe(true);
      const html = readFileSync(path.join(o, 'index.html'), 'utf8');
      expect(html).toContain('__SIDE_MODULES__');
      expect(html).toContain('"spine:4.2"');
      expect(html).toContain(Buffer.from('SPINE42WASM').toString('base64')); // spine42.wasm inlined
      // The atlas page image is embedded + path-mapped (the dep the cook now follows).
      expect(html).toMatch(/"assets\/spine\/hero\.png":"@uuid:/);
    } finally {
      rmSync(r, { recursive: true, force: true });
    }
  }, 60_000);

  it('fails the export when the scene needs spine but spine42.wasm is absent', async () => {
    const { r, o } = setupRoot(false);
    try {
      const res = await run(r, o);
      expect(res.ok).toBe(false);
      expect(res.errors.join('\n')).toMatch(/spine/i);
    } finally {
      rmSync(r, { recursive: true, force: true });
    }
  }, 60_000);
});
