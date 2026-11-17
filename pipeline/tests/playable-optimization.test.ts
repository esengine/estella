// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { optimizePlayableAssets, playableAssetsJsonBytes, type PlayablePayload, type PlayableOptimizationAsset } from '../src/export/playableOptimization';
import { makeZip } from '../../build-tools/utils/zip.js';
import { noisePng } from './fixtures/solidPng.mjs';
import { decodePngImage } from '../src/assets/atlasPacker';
import { encodeRgbaPng } from '../src/assets/png';
import { resolveFfmpeg } from '../src/assets/videoCook';
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
const run = (assets: PlayableOptimizationAsset[], extra = {}) => optimizePlayableAssets({ root, assets, webp: 'lossless',
  targetDeliveryBytes: 1, measure, warnings: [], ...extra });
const decode = async (data: Uint8Array) => {
  const bin = await resolveFfmpeg(); expect(bin).not.toBeNull();
  return decodePngImage('webp', execFileSync(bin!, ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0',
    '-frames:v', '1', '-f', 'image2pipe', '-c:v', 'png', 'pipe:1'], { input: data, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }));
};

// Nothing is compressed that the person did not choose: the encoding is theirs, and no size budget picks or lowers it.
describe('a playable images in the WebP encoding chosen for them', () => {
  it('ships every image as cooked when no WebP encoding was chosen, over budget or not', async () => {
    const asset = image(); const stages: string[] = [];
    const result = await run([asset], { webp: undefined, onStage: (s: string) => stages.push(s) });
    expect(stages).toEqual([]);
    expect(result.report.mode).toBe('skip');
    expect(result.report.changes).toEqual([]);
    expect(result.payloads.get('image')!.data).toEqual(asset.data);
    expect(result.report.meetsTarget).toBe(false);
  });

  it('lossless keeps dimensions, colours and every alpha sample', async () => {
    const original = decodePngImage('alpha', noisePng(128, 64));
    for (let i = 0; i < original.rgba.length; i += 4) original.rgba[i + 3] = (i / 4) % 256;
    const asset = { ...image(), data: encodeRgbaPng(128, 64, original.rgba) };
    const result = await run([asset], { targetDeliveryBytes: 1024 * 1024 });
    expect(result.report.changes[0]?.codec).toBe('webp-lossless');
    const container = Buffer.from(result.payloads.get('image')!.data);
    expect(container.readUInt32LE(4)).toBe(container.length - 8);
    const decoded = await decode(result.payloads.get('image')!.data);
    expect([decoded.width, decoded.height]).toEqual([128, 64]);
    for (let i = 0; i < original.rgba.length; i += 4) {
      expect(decoded.rgba[i + 3]).toBe(original.rgba[i + 3]);
      if (original.rgba[i + 3] !== 0) expect(Array.from(decoded.rgba.slice(i, i + 3))).toEqual(Array.from(original.rgba.slice(i, i + 3)));
    }
    expect(result.report.selected).toEqual(measure(result.payloads));
  }, 60_000);

  it('uses the lossy quality chosen, whatever the budget, and never resizes', async () => {
    for (const webp of [90, 80] as const) {
      const result = await run([image()], { webp, targetDeliveryBytes: 1024 * 1024 * 1024 });
      expect(result.report.changes[0]?.codec).toBe(`webp-${webp}`);
      expect(result.report.meetsTarget).toBe(true);
      const decoded = await decode(result.payloads.get('image')!.data);
      expect([decoded.width, decoded.height]).toEqual([128, 64]);
    }
  }, 60_000);

  it('keeps a texture that opted out as it is, and keeps pixel art, font pages and data images lossless', async () => {
    const optedOut = image({ compress: 'off' });
    const untouched = await run([optedOut], { webp: 80 });
    expect(untouched.report.changes).toEqual([]);
    expect(untouched.payloads.get('image')!.data).toEqual(optedOut.data);
    for (const asset of [image({ filterMode: 'nearest' }), image({ sRGB: false }), { ...image(), losslessOnly: true }]) {
      const result = await run([asset], { webp: 80 });
      expect(result.report.changes.map(change => change.codec)).toEqual(['webp-lossless']);
    }
  }, 60_000);

  it('keeps a gamma-managed PNG rather than call a colour-profile conversion lossless', async () => {
    const png = PNG.sync.read(noisePng(128, 64));
    png.gamma = 0.45455;
    const asset = { ...image(), data: PNG.sync.write(png) };
    const warnings: string[] = [];
    const result = await run([asset], { warnings });
    expect(result.report.changes).toEqual([]);
    expect(result.payloads.get('image')!.data).toEqual(asset.data);
    expect(warnings.some(warning => warning.includes('colour profile'))).toBe(true);
  });

  it('keeps assembled binary buffers out of the persisted size report', async () => {
    const result = await run([image()], { targetDeliveryBytes: 1024 * 1024,
      measure: (payloads: ReadonlyMap<string, PlayablePayload>) => ({ ...measure(payloads), html: Buffer.alloc(1024), delivery: Buffer.alloc(1024) }) });
    expect(Object.keys(result.report.baseline).sort()).toEqual(['deliveryBytes', 'htmlBytes']);
    expect(Object.keys(result.report.selected).sort()).toEqual(['deliveryBytes', 'htmlBytes']);
    expect(JSON.stringify(result.report).length).toBeLessThan(1000);
  });

  it('reports the uncompressed HTML limit apart from the ZIP target', async () => {
    const result = await run([image()], { targetDeliveryBytes: 1024 * 1024, maxHtmlBytes: 100 });
    expect(result.report.selected.deliveryBytes).toBeLessThan(1024 * 1024);
    expect(result.report.meetsTarget).toBe(false);
  });
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

});
