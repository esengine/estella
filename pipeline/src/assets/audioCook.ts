// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    audioCook.ts
 * @brief   Cook-time WAV → MP3 transcode. WAV parsing is plain RIFF walking
 *          (PCM 8/16/24/32-int and 32-float); encoding goes through the
 *          wasm-media-encoders LAME build (self-contained wasm, loaded lazily
 *          the first time a cook actually compresses audio). Already-compressed
 *          formats never come through here — the cook only routes `.wav`.
 */

import { readImporterField } from '../project/importSettings';
import { readWav } from '../sound/soundRender';

interface ParsedWav {
  channels: Float32Array[];
  sampleRate: number;
}

export function parseWav(bytes: Uint8Array): ParsedWav | null {
  let read: { rate: number; channels: Float32Array[] };
  try {
    read = readWav(bytes);
  } catch {
    return null;
  }
  const channels = read.channels.slice(0, 2);
  for (const channel of channels) {
    for (let i = 0; i < channel.length; i++) channel[i] = Math.max(-1, Math.min(1, channel[i]));
  }
  return { channels, sampleRate: read.rate };
}

/**
 * Samples of silence an MP3 has before its sound once it is decoded: what the encoder holds back and what a decoder
 * holds back, 576 and 529. It is the same at every rate and bitrate, and no player takes it off a file with no tag
 * to say so, which these have not: a clip encoded here begins a fortieth of a second late and is longer than it was.
 */
export const MP3_LEAD_SAMPLES = 1105;

/** How long a clip was before it was encoded, and the silence the encoding puts in front of it, in seconds; null if it is not a WAV. */
export function encodedClipTrim(wav: Uint8Array): { seconds: number; lead: number } | null {
  const parsed = parseWav(wav);
  if (!parsed || !parsed.channels[0]?.length) return null;
  return { seconds: parsed.channels[0].length / parsed.sampleRate, lead: MP3_LEAD_SAMPLES / parsed.sampleRate };
}

type Mp3Encoder = {
  configure(opts: { sampleRate: number; channels: 1 | 2; bitrate: number }): void;
  encode(channels: Float32Array[]): Uint8Array;
  finalize(): Uint8Array;
};
let encoderPromise: Promise<Mp3Encoder> | null = null;

/** Transcode a WAV buffer to MP3 at `bitrateKbps`; null when the WAV doesn't parse. */
export async function encodeWavToMp3(wav: Uint8Array, bitrateKbps: number): Promise<Uint8Array | null> {
  const parsed = parseWav(wav);
  if (!parsed) return null;
  encoderPromise ??= import('wasm-media-encoders').then((m) => m.createMp3Encoder() as Promise<Mp3Encoder>);
  const encoder = await encoderPromise;
  encoder.configure({
    sampleRate: parsed.sampleRate,
    channels: parsed.channels.length as 1 | 2,
    bitrate: bitrateKbps,
  });
  // Both calls answer with a view of the encoder's own wasm memory, valid only
  // until its next call: finalize() writes its last frames over the bytes encode()
  // returned. Read without a copy, the file began with flush bytes and no frame
  // sync, and a decoder dropped tens of milliseconds hunting for one — the attack
  // of a short effect.
  const head = encoder.encode(parsed.channels).slice();
  const tail = encoder.finalize().slice();
  const out = new Uint8Array(head.byteLength + tail.byteLength);
  out.set(head, 0);
  out.set(tail, head.byteLength);
  return out;
}

/** What the importer asked of a clip when it is not left to the length, or null for `auto`. Read here, beside the other audio importer settings. */
export function audioLoadTypeOf(importer: Record<string, unknown> | undefined): 'streaming' | 'decompress' | null {
  const type = importer?.loadType;
  return type === 'streaming' || type === 'decompress' ? type : null;
}

export function audioImportSettings(importer: Record<string, unknown> | undefined): {
  compress: boolean; bitrateKbps: number;
} {
  return {
    compress: readImporterField('audio', importer, 'compress') as boolean,
    bitrateKbps: readImporterField('audio', importer, 'bitrateKbps') as number,
  };
}
