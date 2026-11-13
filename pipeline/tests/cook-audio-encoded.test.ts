// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A cook that re-encodes a clip says what the encoding did to it.
 *
 * A WAV becomes an MP3 on the way into a build, and an MP3 decodes with silence before its sound and after it: a loop
 * that was seamless has a gap every time round, and every effect is late. The cook cannot stop a decoder doing that,
 * so it says how long each clip really is and how much silence leads it, for the runtime to play round. Held here:
 * that it says so for the clips it re-encoded, by the path they are played by, and for no others.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { cookAssets } from '../src/assets/cookAssets';

let root: string;
const SCENE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const LOOP = '11111111-1111-4111-8111-111111111111';
const RAW = '22222222-2222-4222-8222-222222222222';
const UNUSED = '33333333-3333-4333-8333-333333333333';

/** One second of a tone as a 16-bit mono WAV at @p rate. */
function tone(rate: number, frames: number): Uint8Array {
  const out = new Uint8Array(44 + frames * 2);
  const view = new DataView(out.buffer);
  const text = (at: number, t: string): void => { for (let i = 0; i < t.length; i++) out[at + i] = t.charCodeAt(i); };
  text(0, 'RIFF'); view.setUint32(4, out.length - 8, true); text(8, 'WAVE');
  text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, frames * 2, true);
  for (let n = 0; n < frames; n++) view.setInt16(44 + n * 2, Math.round(9000 * Math.sin((2 * Math.PI * 440 * n) / rate)), true);
  return out;
}

function writeAsset(rel: string, type: string, uuid: string, body: string | Uint8Array, importer: Record<string, unknown> = {}): void {
  const abs = path.join(root, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, body);
  writeFileSync(`${abs}.meta`, JSON.stringify({ uuid, version: '2.0', type, importer }));
}

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'estella-cook-audio-'));
  writeAsset('assets/music/theme.wav', 'audio', LOOP, tone(44100, 88200));
  // Kept as it is by its import settings: nothing is done to it, so there is nothing to say of it.
  writeAsset('assets/music/raw.wav', 'audio', RAW, tone(22050, 22050), { compress: false });
  writeAsset('assets/music/unused.wav', 'audio', UNUSED, tone(44100, 44100));
  writeAsset('assets/scenes/main.esscene', 'scene', SCENE, JSON.stringify({ version: '1.0', name: 's', entities: [
    { id: 1, name: 'Music', parent: null, children: [], components: [{ type: 'AudioSource', data: { clip: `@uuid:${LOOP}`, loop: true } }] },
    { id: 2, name: 'Raw', parent: null, children: [], components: [{ type: 'AudioSource', data: { clip: `@uuid:${RAW}` } }] },
  ] }));
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

describe('a cook that re-encodes a clip', () => {
  it('says how long it really is and what silence leads it, for that clip and no other', async () => {
    const res = await cookAssets(root, { entryScenes: ['assets/scenes/main.esscene'], outDir: 'build', compressAudio: true });
    expect(res.ok).toBe(true);
    // Two seconds, and the 1105 samples an MP3 decodes with before its sound.
    expect(res.audioEncoded).toEqual({ 'assets/music/theme.wav': { seconds: 2, lead: 0.02506 } });
    const shipped = readdirSync(path.join(res.outDir, 'assets/music')).sort();
    expect(shipped).toEqual(['raw.wav', 'theme.mp3']);
  });

  it('says nothing where it encodes nothing', async () => {
    const res = await cookAssets(root, { entryScenes: ['assets/scenes/main.esscene'], outDir: 'build-plain' });
    expect(res.audioEncoded).toEqual({});
    expect(readdirSync(path.join(res.outDir, 'assets/music')).sort()).toEqual(['raw.wav', 'theme.wav']);
  });
});
