// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A mini-game player is handed a SOURCE, not a cache key, and the cook
 *        renamed the file: `tap.wav` ships as an MP3. The asset loader now asks
 *        the ref resolver for that name instead of fetching bytes it cannot use,
 *        so this holds the join — a real cook, the manifest the export writes,
 *        and the runtime's own resolver — rather than a stub on either side.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { exportGame } from '../src/export/exportGame';
import { runtimeConfigOf } from '../src/project/runtimeConfig';
import { ManifestModel } from '../../sdk/src/asset/AddressableManifest';
import { extractUuid } from '../../sdk/src/asset/AssetRegistry';
import type { AddressableManifest } from '../../sdk/src/asset/AddressableManifest';

let root: string;
let out: string;
const CLIP = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const SCN = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const meta = (uuid: string, type: string) => JSON.stringify({ uuid, version: '2.0', type, importer: {} });

/** A real RIFF/WAVE the LAME encoder will actually take: 16-bit mono, long
 *  enough that the MP3 comes out smaller (the cook keeps the smaller file). */
function wav(frames = 44100): Uint8Array {
  const bytes = frames * 2;
  const buf = new ArrayBuffer(44 + bytes);
  const v = new DataView(buf);
  const tag = (o: number, s: string) => { for (let i = 0; i < 4; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  tag(0, 'RIFF'); v.setUint32(4, 36 + bytes, true); tag(8, 'WAVE');
  tag(12, 'fmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 44100, true); v.setUint32(28, 88200, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  tag(36, 'data'); v.setUint32(40, bytes, true);
  for (let f = 0; f < frames; f++) v.setInt16(44 + f * 2, Math.round(Math.sin(f / 20) * 12000), true);
  return new Uint8Array(buf);
}

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'estella-wechat-audio-'));
  mkdirSync(path.join(root, 'assets', 'audio'), { recursive: true });
  writeFileSync(path.join(root, 'assets', 'audio', 'tap.wav'), wav());
  writeFileSync(path.join(root, 'assets', 'audio', 'tap.wav.meta'), meta(CLIP, 'audio'));
  mkdirSync(path.join(root, 'scenes'), { recursive: true });
  // An AudioSource's `clip` is an asset field, so the scene REACHES the clip and
  // the asset system is what loads it — the door the reported silence came in by.
  writeFileSync(
    path.join(root, 'scenes', 'main.esscene'),
    JSON.stringify({
      version: '1.0', name: 'Main',
      entities: [{ id: 0, components: [{ type: 'AudioSource', data: { clip: `@uuid:${CLIP}`, playOnAwake: true } }] }],
    }),
  );
  writeFileSync(path.join(root, 'scenes', 'main.esscene.meta'), meta(SCN, 'scene'));
  mkdirSync(path.join(root, '_sdk'), { recursive: true });
  writeFileSync(path.join(root, '_sdk', 'index.wechat.js'), 'export function initWeChatRuntime(){return Promise.resolve();}\n');
  mkdirSync(path.join(root, '_wxwasm'), { recursive: true });
  writeFileSync(path.join(root, '_wxwasm', 'esengine.js'), 'module.exports = () => Promise.resolve({});');
  writeFileSync(path.join(root, '_wxwasm', 'esengine.wasm'), 'wasmbytes');
  out = path.join(root, 'dist-wechat');
}, 60_000);

afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));

describe('the source a cooked mini-game hands its audio player', () => {
  it('is the file the package carries, resolved from the authored path', async () => {
    const res = await exportGame({
      root,
      entryScene: 'scenes/main.esscene',
      gameHostEntry: 'unused-for-wechat',
      sdkDistDir: path.join(root, '_sdk'),
      wasmDir: path.join(root, '_wxwasm'),
      outDir: out,
      title: 'Audio',
      platform: 'wechat',
      wechatAppid: 'wxTEST0123456789',
      orientation: 'landscape',
      compressAudio: true,
      runtime: runtimeConfigOf({ designResolution: { width: 1280, height: 720 } }),
    });
    expect(res.ok).toBe(true);

    // The cook renamed it, so the authored name is not what ships.
    const staged = readdirSync(path.join(out, 'assets', 'audio'));
    expect(staged).toContain('tap.mp3');
    expect(staged).not.toContain('tap.wav');

    // The runtime's OWN resolver, over the manifest the export wrote: this is
    // the channel `Audio.preload` asks, and a miss here is silence on device.
    // Spelled exactly as packagedRuntime spells it, so the two cannot disagree.
    const manifest = ManifestModel.fromJson(
      JSON.parse(readFileSync(path.join(out, 'asset-manifest.json'), 'utf8')) as AddressableManifest,
    );
    const resolve = (ref: string): string => manifest.resolvePath(extractUuid(ref) ?? ref);
    const src = resolve('assets/audio/tap.wav');
    expect(src).toBe('assets/audio/tap.mp3');
    expect(existsSync(path.join(out, src))).toBe(true);

    // And by uuid, which is how the scene names it.
    expect(resolve(`@uuid:${CLIP}`)).toBe('assets/audio/tap.mp3');
  }, 120_000);
});
