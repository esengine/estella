// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { optimizePlayableAssets, playableAssetsJsonBytes, type PlayablePayload, type PlayableOptimizationAsset } from '../src/export/playableOptimization';
import { makeZip } from '../../build-tools/utils/zip.js';
import { noisePng } from './fixtures/solidPng.mjs';
import { decodePngImage, encodeRgbaPng } from '../src/assets/atlasPacker';
import { resolveFfmpeg } from '../src/assets/videoCook';
import { encodeWavToMp3 } from '../src/assets/audioCook';
import { PNG } from 'pngjs';

let root: string;
beforeAll(() => { root = mkdtempSync(path.join(tmpdir(), 'estella-playable-budget-')); });
afterAll(() => {
  if (path.dirname(path.resolve(root)) !== path.resolve(tmpdir()) || !path.basename(root).startsWith('estella-playable-budget-')) throw new Error('Unexpected fixture directory');
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});
function measure(payloads: ReadonlyMap<string, PlayablePayload>) {
  const html = Buffer.from(`<html><script>window.assets=${JSON.stringify(Object.fromEntries([...payloads].map(([key, payload]) =>
    [key, `data:${payload.mime};base64,${Buffer.from(payload.data).toString('base64')}`])))}</script></html>`);
  return { htmlBytes: html.byteLength, deliveryBytes: makeZip([{ name: 'index.html', data: html },
    { name: 'config.json', data: Buffer.from('{"orientation":0}') }]).byteLength };
}
const image = (importer: Record<string, unknown> = {}): PlayableOptimizationAsset => ({
  key: 'image', path: 'art.png', data: noisePng(128, 64), mime: 'image/png', importer,
});
const run = (assets: PlayableOptimizationAsset[], extra = {}) => optimizePlayableAssets({ root, assets, textures: true,
  audio: true, targetDeliveryBytes: 1, measure, warnings: [], ...extra });

describe('playable network budget optimization', () => {
  it('retains lossless dimensions, colors and every alpha sample', async () => {
    const original = decodePngImage('alpha', noisePng(128, 64));
    for (let i = 0; i < original.rgba.length; i += 4) original.rgba[i + 3] = (i / 4) % 256;
    const asset = { ...image(), data: encodeRgbaPng(128, 64, original.rgba), losslessOnly: true };
    const result = await run([asset]);
    expect(result.report.changes[0]?.codec).toBe('webp-lossless');
    const container = Buffer.from(result.payloads.get('image')!.data);
    expect(container.readUInt32LE(4)).toBe(container.length - 8);
    const bin = await resolveFfmpeg(); expect(bin).not.toBeNull();
    const decoded = decodePngImage('webp', execFileSync(bin!, ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0',
      '-frames:v', '1', '-f', 'image2pipe', '-c:v', 'png', 'pipe:1'], { input: result.payloads.get('image')!.data, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }));
    expect([decoded.width, decoded.height]).toEqual([128, 64]);
    for (let i = 0; i < original.rgba.length; i += 4) {
      expect(decoded.rgba[i + 3]).toBe(original.rgba[i + 3]);
      if (original.rgba[i + 3] !== 0) expect(Array.from(decoded.rgba.slice(i, i + 3))).toEqual(Array.from(original.rgba.slice(i, i + 3)));
    }
    expect(result.report.selected).toEqual(measure(result.payloads));
  }, 60_000);

  it('tries bounded lossy quality when needed, never resizes and reports an unmet target', async () => {
    const result = await run([image()]);
    expect(result.report.changes[0]?.codec).toBe('webp-80');
    const container = Buffer.from(result.payloads.get('image')!.data);
    expect(container.readUInt32LE(4)).toBe(container.length - 8);
    expect(result.report.selected.deliveryBytes).toBeLessThan(result.report.baseline.deliveryBytes);
    expect(result.report.meetsTarget).toBe(false);
    const bin = await resolveFfmpeg();
    const decoded = decodePngImage('webp', execFileSync(bin!, ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0',
      '-frames:v', '1', '-f', 'image2pipe', '-c:v', 'png', 'pipe:1'], { input: result.payloads.get('image')!.data, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }));
    expect([decoded.width, decoded.height]).toEqual([128, 64]);
  }, 60_000);

  it('keeps texture opt-outs and restricts pixel art, font pages and data images to lossless', async () => {
    const optedOut = image({ compress: 'off' });
    const untouched = await run([optedOut]);
    expect(untouched.report.changes).toEqual([]);
    expect(untouched.payloads.get('image')!.data).toEqual(optedOut.data);
    for (const asset of [image({ filterMode: 'nearest' }), image({ sRGB: false }), { ...image(), losslessOnly: true }]) {
      const result = await run([asset]);
      expect(result.report.changes.every(change => change.codec === 'webp-lossless')).toBe(true);
    }
  }, 60_000);
  it('preserves gamma-managed PNGs rather than labeling a color-profile conversion lossless', async () => {
    const png = PNG.sync.read(noisePng(128, 64));
    png.gamma = 0.45455;
    const asset = { ...image(), data: PNG.sync.write(png) };
    const warnings: string[] = [];
    const result = await run([asset], { warnings });
    expect(result.report.changes).toEqual([]);
    expect(result.payloads.get('image')!.data).toEqual(asset.data);
    expect(warnings.some(warning => warning.includes('color-profile'))).toBe(true);
  });

  it('does no quality work when under budget or when the build skips optimization', async () => {
    for (const extra of [{ targetDeliveryBytes: 1024 * 1024 }, { textures: false, audio: false }]) {
      const asset = image(); const result = await run([asset], extra);
      expect(result.report.changes).toEqual([]);
      expect(result.report.selected).toEqual(result.report.baseline);
      expect(result.payloads.get('image')!.data).toEqual(asset.data);
    }
  });
  it('keeps assembled binary buffers out of the persisted size report', async () => {
    const result = await run([image()], { targetDeliveryBytes: 1024 * 1024,
      measure: (payloads: ReadonlyMap<string, PlayablePayload>) => ({ ...measure(payloads), html: Buffer.alloc(1024), delivery: Buffer.alloc(1024) }) });
    expect(Object.keys(result.report.baseline).sort()).toEqual(['deliveryBytes', 'htmlBytes']);
    expect(Object.keys(result.report.selected).sort()).toEqual(['deliveryBytes', 'htmlBytes']);
    expect(JSON.stringify(result.report).length).toBeLessThan(1000);
  });

  it('observes the uncompressed HTML limit independently of the ZIP target', async () => {
    const result = await run([image()], { targetDeliveryBytes: 1024 * 1024, maxHtmlBytes: 10000 });
    expect(result.report.baseline.deliveryBytes).toBeLessThan(1024 * 1024);
    expect(result.report.baseline.htmlBytes).toBeGreaterThan(10000);
    expect(result.report.changes.length).toBeGreaterThan(0);
    expect(result.report.selected.htmlBytes).toBeLessThan(result.report.baseline.htmlBytes);
    expect(result.report.selected).toEqual(measure(result.payloads));
  });

  it('selects 96 kbps from source WAV and respects audio opt-outs and authored 96 kbps', async () => {
    const wav = Buffer.alloc(44 + 44100 * 2);
    wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVE', 8);
    wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(44100, 24); wav.writeUInt32LE(88200, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
    wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
    for (let i = 0; i < 44100; i++) wav.writeInt16LE(Math.round(Math.sin(i / 20) * 12000), 44 + i * 2);
    const asset = { key: 'audio', path: 'sound.wav', data: (await encodeWavToMp3(wav, 128))!, mime: 'audio/mpeg', sourceWav: wav };
    const selected = await run([asset]);
    expect(selected.report.changes[0]?.codec).toBe('mp3-96');
    expect(selected.report.selected.deliveryBytes).toBeLessThan(selected.report.baseline.deliveryBytes);
    const high = { ...asset, data: (await encodeWavToMp3(wav, 192))!, importer: { bitrateKbps: 192 } };
    const midBudget = measure(new Map([['audio', asset]])).deliveryBytes + 1;
    const moderate = await run([high], { targetDeliveryBytes: midBudget });
    expect(moderate.report.changes[0]?.codec).toBe('mp3-128');
    expect(moderate.report.meetsTarget).toBe(true);
    for (const importer of [{ compress: false }, { bitrateKbps: 96 }]) {
      const retained = await run([{ ...asset, importer }]);
      expect(retained.report.changes).toEqual([]);
      expect(retained.payloads.get('audio')!.data).toEqual(asset.data);
    }
  }, 60_000);
});

describe('playable size is worked out, not rebuilt', () => {
  it('the arithmetic size of the assets object is the size JSON.stringify writes', () => {
    const maps: Array<Map<string, PlayablePayload>> = [
      new Map(),
      new Map([['@uuid:a', { data: new Uint8Array(0), mime: 'image/png' }]]),
      new Map([['@uuid:a', { data: new Uint8Array([1]), mime: 'image/png' }], ['@uuid:b', { data: new Uint8Array([1, 2]), mime: 'font/woff2' }],
        ['@uuid:c', { data: new Uint8Array(1000).fill(7), mime: 'image/webp' }], ['@uuid:汉字', { data: new Uint8Array(4097), mime: 'audio/mpeg' }]]),
    ];
    for (const m of maps) {
      const urls = Object.fromEntries([...m].map(([k, v]) => [k, `data:${v.mime};base64,${Buffer.from(v.data).toString('base64')}`]));
      expect(playableAssetsJsonBytes(m)).toBe(Buffer.byteLength(JSON.stringify(urls)));
    }
  });

  it('gives up the search at once when what cannot be shrunk is already over the target, and still reports the size', async () => {
    const font: PlayableOptimizationAsset = { key: 'font', path: 'font.woff2', data: new Uint8Array(randomBytes(300_000)), mime: 'font/woff2' };
    const warnings: string[] = []; const stages: string[] = [];
    const t0 = Date.now();
    const result = await run([font, image()], { targetDeliveryBytes: 100_000, warnings, onStage: (s: string) => stages.push(s) });
    expect(stages).toEqual([]);
    expect(result.report.changes).toEqual([]);
    expect(result.report.meetsTarget).toBe(false);
    expect(result.report.selected).toEqual(result.report.baseline);
    expect(result.payloads.get('image')!.mime).toBe('image/png');
    expect(warnings.some(w => /cannot reach the target/.test(w))).toBe(true);
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it('reports each stage it starts', async () => {
    const stages: string[] = [];
    await run([image()], { onStage: (s: string) => stages.push(s) });
    expect(stages[0]).toBe('lossless');
    expect(stages.length).toBeGreaterThan(1);
  }, 60_000);
});
