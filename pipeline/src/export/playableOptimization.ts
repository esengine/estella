// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveFfmpeg } from '../assets/videoCook';
import { cookCached, encoderIdentity } from '../assets/cookCache';
import { audioImportSettings, encodeWavToMp3 } from '../assets/audioCook';
import { readTextureCookSettings } from '../project/importSettings';

export interface PlayablePayload { data: Uint8Array; mime: string }
export interface PlayableOptimizationAsset extends PlayablePayload {
  key: string;
  path: string;
  importer?: Record<string, unknown>;
  sourceWav?: Uint8Array;
  /** Font pages, nearest-filtered art and data textures must retain their samples. */
  losslessOnly?: boolean;
}
export interface PlayableMeasuredSize { deliveryBytes: number; htmlBytes: number }
export type PlayableSelectedCodec = 'webp-lossless' | 'webp-90' | 'webp-80' | 'mp3-128' | 'mp3-96';
export interface PlayableOptimizationReport {
  mode: 'auto' | 'skip';
  targetDeliveryBytes: number;
  maxHtmlBytes?: number;
  baseline: PlayableMeasuredSize;
  selected: PlayableMeasuredSize;
  meetsTarget: boolean;
  changes: { path: string; codec: PlayableSelectedCodec; inputBytes: number; outputBytes: number }[];
}

/**
 * The bytes `JSON.stringify` writes for a `key -> data URL` map, worked out from the payload sizes alone. The page carries
 * every asset as one such JSON object, so its size is a fixed part plus this; measuring it by building the object (a base64
 * copy of every asset) for each candidate encoding made the search cost the whole package once per candidate.
 */
export function playableAssetsJsonBytes(payloads: ReadonlyMap<string, PlayablePayload>): number {
  if (payloads.size === 0) return 2;
  let bytes = 1 + (payloads.size - 1) + 1;                                   // { , , }
  for (const [key, payload] of payloads) {
    const url = 'data:'.length + payload.mime.length + ';base64,'.length + 4 * Math.ceil(payload.data.byteLength / 3);
    bytes += Buffer.byteLength(JSON.stringify(key)) + 1 + (url + 2);         // "key":"url"
  }
  return bytes;
}

/** WebP cannot retain PNG gamma/profile chunks, animation or 16-bit samples. */
function canReencodePng(data: Uint8Array): boolean {
  const png = Buffer.from(data);
  if (png.length < 33 || !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || png[24] === 16) return false;
  for (let offset = 8; offset + 12 <= png.length;) {
    const size = png.readUInt32BE(offset);
    if (size > png.length - offset - 12) return false;
    const tag = png.toString('ascii', offset + 4, offset + 8);
    if (['gAMA', 'iCCP', 'cHRM', 'acTL'].includes(tag)) return false;
    offset += 12 + size;
  }
  return true;
}

/** Encode one PNG with no resizing; alpha remains a full-resolution channel. */
async function webp(bin: string, png: Uint8Array, quality: 'lossless' | 90 | 80): Promise<Uint8Array> {
  const tempRoot = path.resolve(tmpdir());
  const dir = await mkdtemp(path.join(tempRoot, 'estella-playable-webp-'));
  try {
    const file = path.join(dir, 'texture.webp');
    // The WebP muxer must seek to finalize alpha chunks and RIFF length. Its
    // pipe output can decode in ffmpeg but is rejected by browsers.
    await new Promise<void>((resolve, reject) => {
      const child = spawn(bin, ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-frames:v', '1',
        '-c:v', 'libwebp', '-lossless', quality === 'lossless' ? '1' : '0', '-quality',
        quality === 'lossless' ? '100' : String(quality), '-compression_level', '6',
        '-pix_fmt', 'bgra', '-f', 'webp', file], { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
      let stderr = '';
      const timeout = setTimeout(() => { child.kill(); reject(new Error('WebP encoding timed out')); }, 30_000);
      child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-4096); });
      child.on('error', error => { clearTimeout(timeout); reject(error); });
      child.stdin.on('error', error => { clearTimeout(timeout); reject(error); child.kill(); });
      child.on('close', code => {
        clearTimeout(timeout);
        if (code !== 0) reject(new Error(stderr || `WebP encoder exited ${code}`));
        else resolve();
      });
      child.stdin.end(png);
    });
    const encoded = await readFile(file);
    if (encoded.length < 12 || encoded.toString('ascii', 0, 4) !== 'RIFF' || encoded.toString('ascii', 8, 12) !== 'WEBP'
      || encoded.readUInt32LE(4) !== encoded.byteLength - 8) throw new Error('WebP encoder returned an invalid container');
    return encoded;
  } finally {
    if (path.dirname(path.resolve(dir)) !== tempRoot || !path.basename(dir).startsWith('estella-playable-webp-')) throw new Error('Unexpected WebP temporary directory');
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}

/**
 * Select against the actual assembled HTML/archive, rather than source file sizes.
 * Every candidate is derived from the authored cook, never an earlier lossy result.
 */
export async function optimizePlayableAssets(opts: {
  root: string;
  assets: PlayableOptimizationAsset[];
  textures: boolean;
  audio: boolean;
  targetDeliveryBytes: number;
  maxHtmlBytes?: number;
  measure: (payloads: ReadonlyMap<string, PlayablePayload>) => PlayableMeasuredSize;
  warnings: string[];
  /** Called as each stage of the search begins, so a long one is not a silent spinner. */
  onStage?: (stage: string, assets: number) => void;
}): Promise<{ payloads: Map<string, PlayablePayload>; report: PlayableOptimizationReport }> {
  const payloads = new Map<string, PlayablePayload>(opts.assets.map(asset => [asset.key, { data: asset.data, mime: asset.mime }]));
  const measure = () => {
    const size = opts.measure(payloads);
    return { deliveryBytes: size.deliveryBytes, htmlBytes: size.htmlBytes };
  };
  const baseline = measure();
  let selected = baseline;
  const score = (size: PlayableMeasuredSize) => Math.max(size.deliveryBytes / opts.targetDeliveryBytes,
    opts.maxHtmlBytes === undefined ? 0 : size.htmlBytes / opts.maxHtmlBytes);
  const changes = new Map<string, PlayableOptimizationReport['changes'][number]>();
  const sorted = [...opts.assets].sort((a, b) => b.data.byteLength - a.data.byteLength || a.path.localeCompare(b.path));
  const protectedPngs = new Set<string>();
  if (opts.textures && score(selected) > 1) {
    for (const asset of sorted) {
      if (asset.mime === 'image/png' && readTextureCookSettings(asset.importer, 'playable').compress !== 'off' && !canReencodePng(asset.data)) {
        protectedPngs.add(asset.key);
        opts.warnings.push(`${asset.path}: kept PNG to preserve color-profile, animation or sample-depth semantics (or an unrecognized PNG layout).`);
      }
    }
  }
  // What no encoder here can shrink (fonts, data, anything that is not a PNG or a WAV) is a floor under the page. When that
  // part alone, weighed the way the page is weighed, is already over the target, no search will get there: the package is
  // made as it is and the size is reported, instead of trying every image at every quality to arrive at the same answer.
  const fixed = opts.assets.filter(a => !(a.mime === 'image/png' || a.sourceWav));
  if (fixed.length > 0 && score(selected) > 1) {
    const floor = opts.measure(new Map(fixed.map(a => [a.key, { data: a.data, mime: a.mime }])));
    if (score(floor) > 1) {
      opts.warnings.push(`Playable size cannot reach the target: the parts no encoder can shrink (fonts and other files) alone come to ${(floor.deliveryBytes / 1048576).toFixed(1)} MB, against a target of ${(opts.targetDeliveryBytes / 1048576).toFixed(1)} MB. The package is built as it is; its size and what it is made of are reported.`);
      return { payloads, report: { mode: opts.textures || opts.audio ? 'auto' : 'skip', targetDeliveryBytes: opts.targetDeliveryBytes,
        maxHtmlBytes: opts.maxHtmlBytes, baseline, selected, meetsTarget: false, changes: [] } };
    }
  }
  let encoder: { bin: string; id: string } | null | undefined;
  const failures = new Set<string>();
  for (const stage of ['lossless', 'audio-128', 'audio-96', 90, 80] as const) {
    if (score(selected) <= 1) break;
    opts.onStage?.(String(stage), sorted.length);
    for (const asset of sorted) {
      if (score(selected) <= 1) break;
      const previous = payloads.get(asset.key)!;
      let candidate: PlayablePayload | undefined;
      let codec: PlayableSelectedCodec;
      try {
        if (stage === 'audio-128' || stage === 'audio-96') {
          const settings = audioImportSettings(asset.importer);
          const bitrate = stage === 'audio-128' ? 128 : 96;
          if (!opts.audio || !asset.sourceWav || !settings.compress || settings.bitrateKbps <= bitrate) continue;
          const bytes = await encodeWavToMp3(asset.sourceWav, bitrate);
          if (!bytes) continue;
          candidate = { data: bytes, mime: 'audio/mpeg' }; codec = stage === 'audio-128' ? 'mp3-128' : 'mp3-96';
        } else {
          const settings = readTextureCookSettings(asset.importer, 'playable');
          if (!opts.textures || asset.mime !== 'image/png' || settings.compress === 'off'
            || (stage !== 'lossless' && (asset.losslessOnly || asset.importer?.filterMode === 'nearest' || !settings.srgb))) continue;
          if (failures.has(asset.key) || protectedPngs.has(asset.key)) continue;
          if (encoder === undefined) {
            const bin = await resolveFfmpeg();
            encoder = bin ? { bin, id: encoderIdentity(bin) } : null;
            if (!encoder) opts.warnings.push('Playable WebP optimization unavailable: the bundled ffmpeg encoder was not found; images remain unchanged.');
          }
          if (!encoder) continue;
          const quality = stage;
          const bytes = (await cookCached(opts.root, [asset.data, `playable-webp:v3:${quality}`, encoder.id],
            () => webp(encoder!.bin, asset.data, quality))).bytes;
          candidate = { data: bytes, mime: 'image/webp' };
          codec = stage === 'lossless' ? 'webp-lossless' : stage === 90 ? 'webp-90' : 'webp-80';
        }
        payloads.set(asset.key, candidate);
        const measured = measure();
        if (score(measured) < score(selected)) {
          selected = measured;
          changes.set(asset.key, { path: asset.path, codec, inputBytes: asset.data.byteLength, outputBytes: candidate.data.byteLength });
        } else payloads.set(asset.key, previous);
      } catch (error) {
        payloads.set(asset.key, previous);
        failures.add(asset.key);
        opts.warnings.push(`${asset.path}: playable optimization retained the previous payload — ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  const report: PlayableOptimizationReport = { mode: opts.textures || opts.audio ? 'auto' : 'skip',
    targetDeliveryBytes: opts.targetDeliveryBytes, maxHtmlBytes: opts.maxHtmlBytes,
    baseline, selected, meetsTarget: score(selected) <= 1, changes: [...changes.values()] };
  return { payloads, report };
}
