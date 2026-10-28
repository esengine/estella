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
import { runtimeConfigOf } from '../src/project/runtimeConfig';
import { BUILTIN_PLAYABLE_PROFILES, tiktokPlayableProfile, panglePlayableProfile } from '../src/export/playableAdProfile';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { exportGame } from '../src/export/exportGame';
import { runtimeHostPrebuild } from '../src/bundle/runtimeHosts';
import { build } from 'esbuild';
import { inflateRaw } from '../src/runtime/inflate';
import { OFFICIAL_PACKAGES } from './officialPackagesDir';
import { solidPng } from './fixtures/solidPng.mjs';
import { decodePngImage } from '../src/assets/atlasPacker';

/**
 * Read an inlined payload back out of the page, the way the host does.
 *
 * Payloads travel deflated, so looking for their base64 asks nothing. Through
 * the decoder is the stronger question: the bytes arrived AND what shipped can
 * be turned back into them.
 */
type Packed = { z: string; n: number };
type PackedModules = Record<string, { glue: Packed; wasm: Packed }>;

function inlinedText(html: string, global: string, pick?: (v: PackedModules) => Packed): string {
  const at = html.indexOf(`window.${global}=`);
  if (at < 0) throw new Error(`${global} is not in the page`);
  const json = html.slice(at + `window.${global}=`.length);
  // The globals are `window.X=<json>;` concatenated, so the value ends at the
  // `;` that leaves the JSON balanced — JSON.parse of the prefix finds it.
  for (let end = json.indexOf(';'); end > 0; end = json.indexOf(';', end + 1)) {
    try {
      const value: unknown = JSON.parse(json.slice(0, end));
      const packed = pick ? pick(value as PackedModules) : (value as Packed);
      const raw = Uint8Array.from(atob(packed.z), (c) => c.charCodeAt(0));
      return new TextDecoder().decode(inflateRaw(raw, packed.n));
    } catch { /* that `;` was inside the JSON — try the next one */ }
  }
  throw new Error(`${global} did not parse as a packed payload`);
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOSTS = path.join(HERE, '..', '..', 'pipeline', 'src', 'runtime');

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
    `export function createWebApp(){return{GL:{registerContext(){}}};}\nexport function setEditorMode(){}\nexport function setPlayMode(){}\nexport function initPlayableRuntime(){return Promise.resolve();}\nexport function createEmbeddedSideModuleHost(){return{acquire(){return Promise.resolve(null);}};}\nexport function defineComponent(){}\nexport function parseThemeOverrides(){}
export function packagedAppOptions(c){return c;}
export function packagedRuntimeInit(c){return c;}
export function glContextAttributes(){return {};}\n`);
  // Stub web wasm runtime (glue text + wasm) — playable inlines these, no separate build.
  mkdirSync(path.join(root, '_wasm'), { recursive: true });
  writeFileSync(path.join(root, '_wasm', 'esengine.js'), `export default function(){}/*WEB_GLUE*/\n`);
  writeFileSync(path.join(root, '_wasm', 'esengine.wasm'), 'WASMBYTES');

  out = path.join(root, 'dist-playable');
}, 60_000);

afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));

describe('exportGame (playable)', () => {
  it('honors image platform overrides, audio settings and the build opt-out without changing sources', async () => {
    const imageId = '11111111-1111-4111-8111-111111111111';
    const audioId = '22222222-2222-4222-8222-222222222222';
    const loopId = '33333333-3333-4333-8333-333333333333';
    const png = solidPng(128, 64, [40, 90, 200, 128]);
    const wav = Buffer.alloc(44 + 44100 * 2);
    wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVE', 8);
    wav.write('fmt ', 12); wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(44100, 24); wav.writeUInt32LE(88200, 28);
    wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
    wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
    for (let f = 0; f < 44100; f++) wav.writeInt16LE(Math.round(Math.sin(f / 20) * 12000), 44 + f * 2);
    const put = (file: string, bytes: Buffer, uuid: string, type: string, importer: object) => {
      writeFileSync(path.join(root, file), bytes);
      writeFileSync(path.join(root, `${file}.meta`), JSON.stringify({ uuid, version: '2.0', type, importer }));
    };
    put('assets/ad-image.png', png, imageId, 'texture', {
      maxSize: 64, compress: 'off', overrides: { playable: { enabled: true, maxSize: 32 } },
    });
    put('assets/ad-sound.wav', wav, audioId, 'audio', { compress: true, bitrateKbps: 96 });
    put('assets/ad-loop.wav', wav, loopId, 'audio', { compress: false });
    const scene = 'scenes/optimized.esscene';
    writeFileSync(path.join(root, scene), JSON.stringify({ version: '1.0', name: 'Optimized', entities: [
      { id: 0, components: [{ type: 'Sprite', data: { texture: `@uuid:${imageId}` } }] },
      { id: 1, components: [{ type: 'AudioSource', data: { clip: `@uuid:${audioId}` } }] },
      { id: 2, components: [{ type: 'AudioSource', data: { clip: `@uuid:${loopId}` } }] },
    ] }));
    writeFileSync(path.join(root, `${scene}.meta`), meta('44444444-4444-4444-8444-444444444444', 'scene'));
    const optimized = await exportGame({
      root, entryScene: scene, hostsDir: HOSTS, packagesDir: OFFICIAL_PACKAGES,
      sdkDistDir: path.join(root, '_sdk'), wasmDir: path.join(root, '_wasm'),
      outDir: path.join(root, 'optimized'), platform: 'playable', compressTextures: true, compressAudio: true,
    });
    const raw = await exportGame({
      root, entryScene: scene, hostsDir: HOSTS, packagesDir: OFFICIAL_PACKAGES,
      sdkDistDir: path.join(root, '_sdk'), wasmDir: path.join(root, '_wasm'),
      outDir: path.join(root, 'raw'), platform: 'playable', compressTextures: false, compressAudio: false,
    });
    const assetsIn = (dir: string): Record<string, string> => {
      const html = readFileSync(path.join(dir, 'index.html'), 'utf8');
      const json = html.split('window.__GAME_ASSETS__=')[1].split(';window.__GAME_PATHMAP__=')[0];
      return JSON.parse(json);
    };
    expect(optimized.ok, optimized.errors.join('\n')).toBe(true);
    expect(raw.ok, raw.errors.join('\n')).toBe(true);
    const encoded = assetsIn(optimized.outDir), original = assetsIn(raw.outDir);
    const resized = decodePngImage('ad-image', Buffer.from(encoded[`@uuid:${imageId}`].split(',')[1], 'base64'));
    expect([resized.width, resized.height]).toEqual([32, 16]);
    expect(Array.from(resized.rgba.slice(0, 4))).toEqual([40, 90, 200, 128]);
    expect(encoded[`@uuid:${imageId}`]).toMatch(/^data:image\/png;/);
    expect(encoded[`@uuid:${audioId}`]).toMatch(/^data:audio\/mpeg;/);
    expect(encoded[`@uuid:${loopId}`]).toBe(`data:audio/wav;base64,${wav.toString('base64')}`);
    expect(original[`@uuid:${imageId}`]).toBe(`data:image/png;base64,${png.toString('base64')}`);
    expect(original[`@uuid:${audioId}`]).toBe(encoded[`@uuid:${loopId}`]);
    expect(readFileSync(path.join(optimized.outDir, 'index.html')).byteLength)
      .toBeLessThan(readFileSync(path.join(raw.outDir, 'index.html')).byteLength);
    expect(readFileSync(path.join(root, 'assets/ad-image.png'))).toEqual(png);
    expect(readFileSync(path.join(root, 'assets/ad-sound.wav'))).toEqual(wav);
  }, 60_000);

  it('fails when an authored image resize cannot produce a reached asset', async () => {
    const id = '55555555-5555-4555-8555-555555555555';
    writeFileSync(path.join(root, 'assets/broken.png'), solidPng(128, 64, [20, 30, 40, 255]).subarray(0, 33));
    writeFileSync(path.join(root, 'assets/broken.png.meta'), JSON.stringify({ uuid: id, version: '2.0', type: 'texture', importer: { maxSize: 32 } }));
    writeFileSync(path.join(root, 'scenes/broken.esscene'), JSON.stringify({ version: '1.0', name: 'Broken', entities: [
      { id: 0, components: [{ type: 'Sprite', data: { texture: `@uuid:${id}` } }] },
    ] }));
    writeFileSync(path.join(root, 'scenes/broken.esscene.meta'), meta('66666666-6666-4666-8666-666666666666', 'scene'));
    const result = await exportGame({ root, entryScene: 'scenes/broken.esscene', hostsDir: HOSTS,
      packagesDir: OFFICIAL_PACKAGES, sdkDistDir: path.join(root, '_sdk'), wasmDir: path.join(root, '_wasm'),
      outDir: path.join(root, 'broken'), platform: 'playable', compressTextures: true });
    expect(result.ok).toBe(false);
    expect(result.errors.some(error => error.includes('assets/broken.png'))).toBe(true);
  });

  it('produces one self-contained index.html with everything inlined', async () => {
    const res = await exportGame({
      root,
      entryScene: 'scenes/main.esscene',
      hostsDir: HOSTS, packagesDir: OFFICIAL_PACKAGES,
      scriptsEntry: 'src/main.ts',
      sdkDistDir: path.join(root, '_sdk'),
      wasmDir: path.join(root, '_wasm'),
      outDir: out,
      title: 'Playable Demo',
      platform: 'playable',
      // Structure, so the unminified shape. The stub SDK's `defineComponent(){}`
      // is empty, and esbuild is right to drop a call to one — taking
      // `SpawnMarker` with it. The real SDK's writes a registry. Default below.
      minify: false,
    });

    expect(res.ok).toBe(true);
    expect(res.playableCheck?.status).toBe('needs-runtime');
    expect(res.playableCheck?.htmlSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(res.playableCheck?.checks.find(check => check.id === 'cta-interaction')?.status).toBe('needs-runtime');
    expect(res.platform).toBe('playable');

    // Single file: only index.html, temp cook dir removed, no staged assets dir.
    expect(existsSync(path.join(out, 'index.html'))).toBe(true);
    expect(existsSync(path.join(out, '.playable-cook'))).toBe(false);
    expect(existsSync(path.join(out, 'assets'))).toBe(false);

    const html = readFileSync(path.join(out, 'index.html'), 'utf8');
    expect(inlinedText(html, '__ENGINE_GLUE__')).toContain('WEB_GLUE');   // web glue text inlined
    expect(html).toContain('__ENGINE_GLUE__');                       // glue + wasm inlined as globals
    expect(html).toContain('__ENGINE_WASM__');
    // Through the decoder, both of them: the game travels deflated now, so the
    // page's own text would answer for the loader and not for what it starts.
    expect(inlinedText(html, '__GAME_BUNDLE__')).toContain('createObjectURL'); // real host bundled
    expect(inlinedText(html, '__GAME_BUNDLE__')).toContain('SpawnMarker');     // project script bundled
    // And it travels deflated. Inlining the source again would satisfy every
    // assertion above — this is the one that would notice, and the 5MB cap is
    // spent on this span more than on any other.
    const game = inlinedText(html, '__GAME_BUNDLE__');
    expect(html).not.toContain(game.slice(0, 200));
    expect(res.inlineParts?.find((p) => p.path === 'game-bundle.js')?.bytes ?? 0)
      .toBeLessThan(game.length);
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

  // The editor never bundles the hosts from their sources: a packaged app ships
  // none, so it exports from the tree it prebuilt. Every other test here reads the
  // sources, where a host the prebuild never emitted is still right beside them.
  it('packages from the host tree an editor prebuilds', async () => {
    const prebuilt = path.join(root, '_prebuilt-hosts');
    await build({ ...runtimeHostPrebuild(HOSTS, prebuilt), logLevel: 'silent' });
    const dir = path.join(root, 'dist-prebuilt');
    const res = await exportGame({
      root, entryScene: 'scenes/main.esscene', hostsDir: prebuilt, packagesDir: OFFICIAL_PACKAGES, scriptsEntry: 'src/main.ts',
      sdkDistDir: path.join(root, '_sdk'), wasmDir: path.join(root, '_wasm'),
      outDir: dir, platform: 'playable', minify: false,
    });

    expect(res.errors).toEqual([]);
    const html = readFileSync(path.join(dir, 'index.html'), 'utf8');
    expect(inlinedText(html, '__GAME_BUNDLE__')).toContain('createObjectURL');
    // Outside the payload: the loader is the one script that starts it.
    expect(html).toContain('atob(__GAME_BUNDLE__.z)');
  }, 60_000);

  // No dev build of a playable exists, so this target minifies unless told not
  // to — the opposite default from every other. Unminified spent 0.31MB of a
  // 5MB budget on whitespace.
  it('minifies by default, and still honours an explicit no', async () => {
    const run = async (minify: boolean | undefined, dir: string): Promise<number> => {
      const res = await exportGame({
        root,
        entryScene: 'scenes/main.esscene',
        hostsDir: HOSTS, packagesDir: OFFICIAL_PACKAGES,
        scriptsEntry: 'src/main.ts',
        sdkDistDir: path.join(root, '_sdk'),
        wasmDir: path.join(root, '_wasm'),
        outDir: path.join(out, dir),
        platform: 'playable',
        minify,
      });
      expect(res.ok).toBe(true);
      return res.inlineParts?.find((p) => p.path === 'game-bundle.js')?.bytes ?? 0;
    };
    const [byDefault, askedFor, refused] = [await run(undefined, 'd'), await run(true, 'y'), await run(false, 'n')];
    expect(byDefault).toBeGreaterThan(0);
    expect(byDefault).toBe(askedFor);            // the default IS the shipping shape
    expect(byDefault).toBeLessThan(refused);     // and an explicit false still opts out
  }, 120_000);

  // The ad network is a PROFILE, not a branch: what it contributes is head markup, a
  // CTA bridge, and the size it accepts. A project profile and a built-in one reach
  // the pipeline the same way, so this exercises the contract with a bespoke one.
  it('injects the ad network profile head + CTA bridge, and warns against ITS limit', async () => {
    const o = path.join(root, 'dist-playable-network');
    const res = await exportGame({
      root, entryScene: 'scenes/main.esscene', hostsDir: HOSTS, packagesDir: OFFICIAL_PACKAGES, scriptsEntry: 'src/main.ts',
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
    // The verdict cites THIS network's cap and where it came from — not a constant,
    // and not an English sentence composed in the main process: the export reports
    // the fact and the build dialog writes it in the editor's language.
    const verdict = res.size?.verdicts.find((v) => v.budget.scope === 'deliverable');
    expect(verdict?.status).toBe('over');
    expect(verdict?.budget.maxBytes).toBe(16);
    expect(verdict?.budget.note).toBe('Acme caps playables at 16 bytes');
    // Measured against index.html itself, which is what this network takes.
    expect(verdict?.measuredBytes).toBe(res.size?.deliverableBytes);
    expect(res.size?.deliverableName).toBe('index.html');
  }, 60_000);

  // A zip-delivery network gets an archive with index.html at the root, and the cap
  // then applies to the ARCHIVE — the file actually being uploaded.
  it.each([undefined, 'index.zip'])('writes the selected ZIP filename (%s) and measures that', async (zipFileName) => {
    const o = path.join(root, 'dist-playable-zip');
    const res = await exportGame({
      root, entryScene: 'scenes/main.esscene', hostsDir: HOSTS, packagesDir: OFFICIAL_PACKAGES, scriptsEntry: 'src/main.ts',
      sdkDistDir: path.join(root, '_sdk'), wasmDir: path.join(root, '_wasm'),
      outDir: o, platform: 'playable',
      playableAdProfile: {
        id: 'zipnet', label: 'Zip Net', maxBytes: 5 * 1024 * 1024,
        limitNote: 'Zip Net docs', delivery: 'zip', zipFileName,
      },
    });
    expect(res.ok).toBe(true);

    const zip = path.join(o, zipFileName ?? 'playable.zip');
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
    const sized = res as unknown as { bytes: number; htmlBytes: number };
    expect(sized.bytes).toBeLessThan(sized.htmlBytes);
    // The archive is what the limit is measured against, and it is NOT counted a
    // second time as a file sitting in the output dir.
    expect(res.size?.deliverableName).toBe(zipFileName ?? 'playable.zip');
    expect(res.size?.deliverableBytes).toBe(sized.bytes);
  }, 60_000);

  it.each([tiktokPlayableProfile, panglePlayableProfile])('ships $id config and its literal SDK before game scripts', async (profile) => {
    const o = path.join(root, 'network-' + profile.id);
    const res = await exportGame({
      root, entryScene: 'scenes/main.esscene', hostsDir: HOSTS, packagesDir: OFFICIAL_PACKAGES,
      scriptsEntry: 'src/main.ts', sdkDistDir: path.join(root, '_sdk'), wasmDir: path.join(root, '_wasm'),
      outDir: o, platform: 'playable', playableAdProfile: profile,
    });
    expect(res.ok).toBe(true);
    const html = readFileSync(path.join(o, 'index.html'), 'utf8');
    expect(res.playableCheck?.checks.find(check => check.id === 'host-sdk')?.status).toBe('pass');
    const sdk = profile.emitBody!({ title: 'T', orientation: 'portrait' });
    expect(html.indexOf(sdk)).toBeGreaterThan(html.indexOf('<body>'));
    expect(html.indexOf(sdk)).toBeLessThan(html.indexOf('window.__ESTELLA_PLAYABLE__'));
    expect(html).not.toContain('mraid');
    const files = execFileSync('unzip', ['-Z1', res.zipFile!], { encoding: 'utf8' }).trim().split('\n');
    expect(files).toEqual(['index.html', 'config.json']);
    const config = JSON.parse(execFileSync('unzip', ['-p', res.zipFile!, 'config.json'], { encoding: 'utf8' }));
    expect(config).toEqual(profile.id === 'tiktok' ? { Playable_orientation: 0 } : { playable_orientation: 0 });
    expect(res.size?.verdicts.find(v => v.budget.scope === 'deliverable')?.budget.maxBytes).toBe(5 * 1024 * 1024 - 1);
  }, 60_000);

  it.each(['../config.json', 'INDEX.html', 'CON.json'])('rejects unsafe or colliding ZIP metadata: %s', async name => {
    const res = await exportGame({
      root, entryScene: 'scenes/main.esscene', hostsDir: HOSTS, packagesDir: OFFICIAL_PACKAGES,
      scriptsEntry: 'src/main.ts', sdkDistDir: path.join(root, '_sdk'), wasmDir: path.join(root, '_wasm'),
      outDir: path.join(root, 'bad-extra'), platform: 'playable',
      playableAdProfile: { ...tiktokPlayableProfile, emitZipFiles: () => [{ name, content: '{}' }] },
    });
    expect(res.ok).toBe(false);
    expect(res.errors.join('\n')).toMatch(/unique portable root filenames/);
  }, 60_000);

  it('builds an oversized HTML anyway and says how big it is, even when a ZIP is the uploaded file', async () => {
    const res = await exportGame({
      root, entryScene: 'scenes/main.esscene', hostsDir: HOSTS, packagesDir: OFFICIAL_PACKAGES,
      scriptsEntry: 'src/main.ts', sdkDistDir: path.join(root, '_sdk'), wasmDir: path.join(root, '_wasm'),
      outDir: path.join(root, 'html-cap'), platform: 'playable',
      playableAdProfile: { id: 'htmlcap', label: 'HTML cap', maxBytes: 5 * 1024 * 1024,
        maxHtmlBytes: 1, limitNote: 'HTML cap docs', delivery: 'zip' },
    });
    // The file is there and its size is on the screen; slimming it or shipping it is the developer's call, so this is not a failed build.
    expect(res.ok).toBe(true);
    expect(res.errors).toEqual([]);
    expect(res.warnings.join('\n')).toMatch(/index\.html is \d+ bytes, exceeding the uncompressed HTML limit/);
    expect(res.htmlBytes).toBeGreaterThan(1);
  }, 60_000);

  it('injects nothing and keeps the default cap with no network selected', async () => {
    const o = path.join(root, 'dist-playable-generic');
    const res = await exportGame({
      root, entryScene: 'scenes/main.esscene', hostsDir: HOSTS, packagesDir: OFFICIAL_PACKAGES, scriptsEntry: 'src/main.ts',
      sdkDistDir: path.join(root, '_sdk'), wasmDir: path.join(root, '_wasm'),
      outDir: o, platform: 'playable',
    });
    expect(res.ok).toBe(true);
    const html = readFileSync(path.join(o, 'index.html'), 'utf8');
    expect(html).not.toContain('__ESTELLA_PLAYABLE__');
    // A fixture this small is under every cap, so nothing to report.
    expect(res.warnings).toEqual([]);
    // …but it is still judged, against the same fallback the pipeline packages
    // with: the strictest cap we know of. A build with no network selected that
    // reported no limit at all would be the one that surprises you at upload.
    const verdict = res.size?.verdicts.find((v) => v.budget.scope === 'deliverable');
    expect(verdict?.status).toBe('ok');
    expect(verdict?.budget.maxBytes).toBe(5 * 1024 * 1024);
  }, 60_000);

  it('inlines the project camera fit as __GAME_SCREENFIT__ (only when opted in)', async () => {
    const o = path.join(root, 'dist-playable-fit');
    const res = await exportGame({
      root, entryScene: 'scenes/main.esscene', hostsDir: HOSTS, packagesDir: OFFICIAL_PACKAGES, scriptsEntry: 'src/main.ts',
      sdkDistDir: path.join(root, '_sdk'), wasmDir: path.join(root, '_wasm'),
      outDir: o, platform: 'playable',
      runtime: runtimeConfigOf({
        designResolution: { width: 750, height: 1334 },
        features: { rendering: { cameraScaleMode: 'fixed-height', depthLayers: [2] } },
      }),
    });
    expect(res.ok).toBe(true);
    const html = readFileSync(path.join(o, 'index.html'), 'utf8');
    expect(html).toContain('__GAME_RUNTIME__');
    expect(html).toMatch(/"scaleMode":1/);
    expect(html).toMatch(/"designWidth":750/);
    // The 2.5D opt-in ships too: it used to reach the play realm and no build.
    expect(html).toMatch(/"depthLayers":4/);
  }, 60_000);

  // A portrait project must ALSO stay playable in a landscape container: the page
  // adapts rather than demanding a rotation the SDK may not honour. The orientation
  // reaches the network profile, which is free to declare it to the platform.
  it('does not pin the page even when the project is portrait', async () => {
    const o = path.join(root, 'dist-playable-portrait');
    const res = await exportGame({
      root, entryScene: 'scenes/main.esscene', hostsDir: HOSTS, packagesDir: OFFICIAL_PACKAGES, scriptsEntry: 'src/main.ts',
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
    // A RigidBody2D makes sceneUsesPhysics() true → the runtime needs physics.
    writeFileSync(path.join(r, 'scenes', 'main.esscene'),
      JSON.stringify({ version: '1.0', name: 'Main', entities: [{ id: 0, components: [{ type: 'RigidBody2D', data: { bodyType: 1 } }] }] }));
    writeFileSync(path.join(r, 'scenes', 'main.esscene.meta'), meta(PSCN, 'scene'));
    mkdirSync(path.join(r, '_sdk'), { recursive: true });
    writeFileSync(path.join(r, '_sdk', 'index.js'),
      `export function createWebApp(){return{GL:{registerContext(){}}};}\nexport function setEditorMode(){}\nexport function setPlayMode(){}\nexport function initPlayableRuntime(){return Promise.resolve();}\nexport function createEmbeddedSideModuleHost(){return{acquire(){return Promise.resolve(null);}};}\nexport function parseThemeOverrides(){}
export function packagedAppOptions(c){return c;}
export function packagedRuntimeInit(c){return c;}
export function glContextAttributes(){return {};}\n`);
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
    root: r, entryScene: 'scenes/main.esscene', hostsDir: HOSTS, packagesDir: OFFICIAL_PACKAGES,
    sdkDistDir: path.join(r, '_sdk'), wasmDir: path.join(r, '_wasm'), outDir: o, platform: 'playable',
  });

  // A game that spawns its bodies from script has none in the scene, so the scan
  // sees nothing — and the package used to ship without physics.wasm while the
  // config told the runtime to install physics. Both halves or neither.
  it('inlines physics for a declared physics project whose scene has no bodies', async () => {
    const { r, o } = setupRoot(true);
    try {
      writeFileSync(path.join(r, 'scenes', 'main.esscene'),
        JSON.stringify({ version: '1.0', name: 'Main', entities: [{ id: 0, components: [] }] }));
      const res = await exportGame({
        root: r, entryScene: 'scenes/main.esscene', hostsDir: HOSTS, packagesDir: OFFICIAL_PACKAGES,
        sdkDistDir: path.join(r, '_sdk'), wasmDir: path.join(r, '_wasm'), outDir: o, platform: 'playable',
        // The project's declaration, which is what the build reads; `runtime` is
        // the packaged game's copy of the same manifest, not a second authority.
        features: { physics: { enabled: true, gravity: { x: 0, y: -20 } } },
        runtime: runtimeConfigOf({ features: { physics: { enabled: true, gravity: { x: 0, y: -20 } } } }),
      });
      expect(res.ok).toBe(true);
      const html = readFileSync(path.join(o, 'index.html'), 'utf8');
      expect(html).toContain('"physics"');
      expect(inlinedText(html, '__SIDE_MODULES__', (v) => v['physics'].wasm)).toBe('PHYSWASM');
      // ...and the runtime is told to install it, plus the world it declared.
      expect(html).toMatch(/"physicsEnabled":true/);
      expect(html).toMatch(/"y":-20/);
    } finally {
      rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  }, 60_000);

  it('inlines physics into __SIDE_MODULES__ when the scene uses physics', async () => {
    const { r, o } = setupRoot(true);
    try {
      const res = await run(r, o);
      expect(res.ok).toBe(true);
      const html = readFileSync(path.join(o, 'index.html'), 'utf8');
      expect(html).toContain('__SIDE_MODULES__');
      expect(html).toContain('"physics"');
      expect(inlinedText(html, '__SIDE_MODULES__', (v) => v['physics'].wasm)).toBe('PHYSWASM');
    } finally {
      rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  }, 60_000);

  it('fails the export when the scene needs physics but physics.wasm is absent', async () => {
    const { r, o } = setupRoot(false);
    try {
      const res = await run(r, o);
      expect(res.ok).toBe(false);
      expect(res.errors.join('\n')).toMatch(/physics/);
    } finally {
      rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
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
      `export function createWebApp(){return{GL:{registerContext(){}}};}\nexport function setEditorMode(){}\nexport function setPlayMode(){}\nexport function initPlayableRuntime(){return Promise.resolve();}\nexport function createEmbeddedSideModuleHost(){return{acquire(){return Promise.resolve(null);}};}\nexport function parseThemeOverrides(){}
export function packagedAppOptions(c){return c;}
export function packagedRuntimeInit(c){return c;}
export function glContextAttributes(){return {};}\n`);
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
    root: r, entryScene: 'scenes/main.esscene', hostsDir: HOSTS, packagesDir: OFFICIAL_PACKAGES,
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
      expect(inlinedText(html, '__SIDE_MODULES__', (v) => v['spine:4.2'].wasm)).toBe('SPINE42WASM');
      // The atlas page image is embedded + path-mapped (the dep the cook now follows).
      expect(html).toMatch(/"assets\/spine\/hero\.png":"@uuid:/);
    } finally {
      rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  }, 60_000);

  it('fails the export when the scene needs spine but spine42.wasm is absent', async () => {
    const { r, o } = setupRoot(false);
    try {
      const res = await run(r, o);
      expect(res.ok).toBe(false);
      expect(res.errors.join('\n')).toMatch(/spine/i);
    } finally {
      rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  }, 60_000);
});

describe('playable ad profiles', () => {
  // The cap enforced and the sentence quoted to the developer are two copies of
  // one fact, and only the sentence is checkable against the network's docs.
  // Meta's note said 5MB while it refused at 2MB, and no test read the number.
  it('every built-in network enforces the number its note quotes', () => {
    for (const p of BUILTIN_PLAYABLE_PROFILES) {
      const quoted = /(\d+(?:\.\d+)?)\s*MB/i.exec(p.limitNote);
      expect(quoted, `${p.id}: limitNote must quote the cap it enforces — "${p.limitNote}"`).not.toBeNull();
      expect(p.maxBytes, `${p.id} enforces ${p.maxBytes}B, its note says ${quoted?.[1]}MB`)
        .toBe(Number(quoted?.[1]) * 1024 * 1024 - (p.limitNote.includes('less than') ? 1 : 0));
    }
  });
});
