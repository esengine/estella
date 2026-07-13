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

interface ParsedWav {
  channels: Float32Array[];
  sampleRate: number;
}

/** Parse a RIFF/WAVE file into normalized float channels; null if not parseable. */
export function parseWav(bytes: Uint8Array): ParsedWav | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 44) return null;
  if (view.getUint32(0, false) !== 0x52494646 /* RIFF */) return null;
  if (view.getUint32(8, false) !== 0x57415645 /* WAVE */) return null;

  let formatTag = 0;
  let channelCount = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let dataOffset = -1;
  let dataLength = 0;

  let off = 12;
  while (off + 8 <= bytes.byteLength) {
    const id = view.getUint32(off, false);
    const size = view.getUint32(off + 4, true);
    const body = off + 8;
    if (id === 0x666d7420 /* fmt  */) {
      formatTag = view.getUint16(body, true);
      channelCount = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bitsPerSample = view.getUint16(body + 14, true);
      // WAVE_FORMAT_EXTENSIBLE: the real format sits in the SubFormat GUID.
      if (formatTag === 0xfffe && size >= 40) {
        formatTag = view.getUint16(body + 24, true);
      }
    } else if (id === 0x64617461 /* data */) {
      dataOffset = body;
      dataLength = Math.min(size, bytes.byteLength - body);
    }
    off = body + size + (size & 1); // chunks are word-aligned
  }

  if (dataOffset < 0 || channelCount < 1 || sampleRate <= 0) return null;
  const isFloat = formatTag === 3;
  const isPcm = formatTag === 1;
  if (!isFloat && !isPcm) return null;
  if (isFloat && bitsPerSample !== 32) return null;
  if (isPcm && ![8, 16, 24, 32].includes(bitsPerSample)) return null;

  const bytesPerSample = bitsPerSample / 8;
  const frameSize = bytesPerSample * channelCount;
  const frames = Math.floor(dataLength / frameSize);
  // MP3 is mono/stereo; fold extra channels away by keeping the first two.
  const outChannels = Math.min(2, channelCount);
  const channels = Array.from({ length: outChannels }, () => new Float32Array(frames));

  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < outChannels; c++) {
      const p = dataOffset + f * frameSize + c * bytesPerSample;
      let v: number;
      if (isFloat) {
        v = view.getFloat32(p, true);
      } else if (bitsPerSample === 16) {
        v = view.getInt16(p, true) / 0x8000;
      } else if (bitsPerSample === 8) {
        v = (view.getUint8(p) - 128) / 128;
      } else if (bitsPerSample === 24) {
        const u = view.getUint8(p) | (view.getUint8(p + 1) << 8) | (view.getUint8(p + 2) << 16);
        v = (u >= 0x800000 ? u - 0x1000000 : u) / 0x800000;
      } else {
        v = view.getInt32(p, true) / 0x80000000;
      }
      channels[c][f] = Math.max(-1, Math.min(1, v));
    }
  }
  return { channels, sampleRate };
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
  const head = encoder.encode(parsed.channels);
  const tail = encoder.finalize();
  const out = new Uint8Array(head.byteLength + tail.byteLength);
  out.set(head, 0);
  out.set(tail, head.byteLength);
  return out;
}

/** Per-asset audio import settings from the `.meta` importer block (tolerant). */
export function audioImportSettings(importer: Record<string, unknown> | undefined): {
  compress: boolean; bitrateKbps: number;
} {
  const compress = importer?.compress;
  const bitrate = importer?.bitrateKbps;
  return {
    compress: typeof compress === 'boolean' ? compress : true,
    bitrateKbps: bitrate === 96 || bitrate === 128 || bitrate === 192 ? (bitrate as number) : 128,
  };
}
