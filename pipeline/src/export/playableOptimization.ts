// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveFfmpeg } from '../assets/videoCook';
import { cookCached, encoderIdentity } from '../assets/cookCache';
import { readTextureCookSettings } from '../project/importSettings';
import type { WebpImages } from '../project/format';

export interface PlayablePayload { data: Uint8Array; mime: string }
export interface PlayableOptimizationAsset extends PlayablePayload {
  key: string;
  path: string;
  importer?: Record<string, unknown>;
  /** Font pages, nearest-filtered art and data textures must retain their samples. */
  losslessOnly?: boolean;
}
export interface PlayableMeasuredSize { deliveryBytes: number; htmlBytes: number }
export type PlayableSelectedCodec = 'webp-lossless' | 'webp-90' | 'webp-80';
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
 * A playable's PNGs in the WebP encoding the person chose, and nothing else: no size budget picks an encoding or lowers
 * one. Font pages, nearest-filtered art and non-colour data keep every sample, so they take lossless whatever was
 * chosen; a PNG WebP cannot carry faithfully (a colour profile, gamma, animation, 16-bit samples) stays PNG, and so does
 * one WebP would make larger. The report is what was done and how the package stands against its budget.
 */
export async function optimizePlayableAssets(opts: {
  root: string;
  assets: PlayableOptimizationAsset[];
  /** Absent: every image ships as it was cooked. */
  webp?: WebpImages;
  targetDeliveryBytes: number;
  maxHtmlBytes?: number;
  measure: (payloads: ReadonlyMap<string, PlayablePayload>) => PlayableMeasuredSize;
  warnings: string[];
  /** Called as the encoding begins, so a long one is not a silent spinner. */
  onStage?: (stage: string, assets: number) => void;
}): Promise<{ payloads: Map<string, PlayablePayload>; report: PlayableOptimizationReport }> {
  const payloads = new Map<string, PlayablePayload>(opts.assets.map(asset => [asset.key, { data: asset.data, mime: asset.mime }]));
  // Only the two numbers: a measure may hand back the assembled buffers too, and the report is persisted.
  const measure = (): PlayableMeasuredSize => { const size = opts.measure(payloads); return { deliveryBytes: size.deliveryBytes, htmlBytes: size.htmlBytes }; };
  const baseline = measure();
  const changes: PlayableOptimizationReport['changes'] = [];
  const images = opts.webp === undefined ? [] : opts.assets.filter(asset => asset.mime === 'image/png');
  let encoder: { bin: string; id: string } | null = null;
  if (images.length > 0) {
    const bin = await resolveFfmpeg();
    encoder = bin ? { bin, id: encoderIdentity(bin) } : null;
    if (!encoder) opts.warnings.push('WebP images were chosen, but the bundled ffmpeg encoder was not found; images ship as PNG.');
    else opts.onStage?.(String(opts.webp), images.length);
  }
  for (const asset of encoder ? images : []) {
    const settings = readTextureCookSettings(asset.importer, 'playable');
    // A texture whose Import Settings say not to compress it is shipped as authored.
    if (settings.compress === 'off') continue;
    if (!canReencodePng(asset.data)) {
      opts.warnings.push(`${asset.path}: kept PNG, as WebP cannot carry its colour profile, gamma, animation or sample depth.`);
      continue;
    }
    const keepsSamples = asset.losslessOnly || asset.importer?.filterMode === 'nearest' || !settings.srgb;
    const quality = keepsSamples ? 'lossless' : opts.webp!;
    try {
      const bytes = (await cookCached(opts.root, [asset.data, `playable-webp:v3:${quality}`, encoder!.id],
        () => webp(encoder!.bin, asset.data, quality))).bytes;
      if (bytes.byteLength >= asset.data.byteLength) continue;
      payloads.set(asset.key, { data: bytes, mime: 'image/webp' });
      changes.push({ path: asset.path, codec: quality === 'lossless' ? 'webp-lossless' : quality === 90 ? 'webp-90' : 'webp-80',
        inputBytes: asset.data.byteLength, outputBytes: bytes.byteLength });
    } catch (error) {
      opts.warnings.push(`${asset.path}: kept PNG, WebP encoding failed — ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const selected = images.length > 0 ? measure() : baseline;
  const meetsTarget = selected.deliveryBytes <= opts.targetDeliveryBytes && selected.htmlBytes <= (opts.maxHtmlBytes ?? Infinity);
  return { payloads, report: { mode: opts.webp === undefined ? 'skip' : 'auto', targetDeliveryBytes: opts.targetDeliveryBytes,
    maxHtmlBytes: opts.maxHtmlBytes, baseline, selected, meetsTarget, changes } };
}
