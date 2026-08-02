// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * Cook-time audio: WAV parsing (PCM16/24/float, extensible, word-aligned
 * chunks) and the WAV→MP3 transcode through the real LAME wasm encoder.
 */
import { describe, it, expect } from 'vitest';
import { parseWav, encodeWavToMp3, audioImportSettings } from '../electron/audioCook';

/** Build a minimal RIFF/WAVE file. */
function makeWav(opts: {
  formatTag?: number; channels?: number; sampleRate?: number; bits?: number;
  frames?: number; sample?: (frame: number, ch: number) => number;
}): Uint8Array {
  const formatTag = opts.formatTag ?? 1;
  const channels = opts.channels ?? 1;
  const rate = opts.sampleRate ?? 44100;
  const bits = opts.bits ?? 16;
  const frames = opts.frames ?? 100;
  const sample = opts.sample ?? ((f) => Math.sin(f / 10) * 0.5);
  const bytesPer = bits / 8;
  const dataSize = frames * channels * bytesPer;
  const buf = new ArrayBuffer(44 + dataSize);
  const v = new DataView(buf);
  const w4 = (o: number, s: string) => { for (let i = 0; i < 4; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w4(0, 'RIFF'); v.setUint32(4, 36 + dataSize, true); w4(8, 'WAVE');
  w4(12, 'fmt '); v.setUint32(16, 16, true);
  v.setUint16(20, formatTag, true); v.setUint16(22, channels, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * channels * bytesPer, true);
  v.setUint16(32, channels * bytesPer, true); v.setUint16(34, bits, true);
  w4(36, 'data'); v.setUint32(40, dataSize, true);
  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < channels; c++) {
      const off = 44 + (f * channels + c) * bytesPer;
      const s = sample(f, c);
      if (formatTag === 3) v.setFloat32(off, s, true);
      else if (bits === 16) v.setInt16(off, Math.round(s * 0x7fff), true);
      else if (bits === 24) {
        const u = (Math.round(s * 0x7fffff) + 0x1000000) & 0xffffff;
        v.setUint8(off, u & 0xff); v.setUint8(off + 1, (u >> 8) & 0xff); v.setUint8(off + 2, (u >> 16) & 0xff);
      }
    }
  }
  return new Uint8Array(buf);
}

describe('parseWav', () => {
  it('parses PCM16 stereo', () => {
    const wav = makeWav({ channels: 2, frames: 50, sample: (_f, c) => (c === 0 ? 0.5 : -0.5) });
    const parsed = parseWav(wav)!;
    expect(parsed.sampleRate).toBe(44100);
    expect(parsed.channels).toHaveLength(2);
    expect(parsed.channels[0][10]).toBeCloseTo(0.5, 2);
    expect(parsed.channels[1][10]).toBeCloseTo(-0.5, 2);
  });

  it('parses 32-bit float and 24-bit PCM', () => {
    const f32 = parseWav(makeWav({ formatTag: 3, bits: 32, sample: () => 0.25 }))!;
    expect(f32.channels[0][5]).toBeCloseTo(0.25, 5);
    const p24 = parseWav(makeWav({ bits: 24, sample: () => 0.25 }))!;
    expect(p24.channels[0][5]).toBeCloseTo(0.25, 3);
  });

  it('rejects non-WAV bytes', () => {
    expect(parseWav(new Uint8Array(100))).toBeNull();
    expect(parseWav(new TextEncoder().encode('OggS' + 'x'.repeat(60)))).toBeNull();
  });
});

describe('encodeWavToMp3', () => {
  it('re-encodes a WAV to a smaller MP3', async () => {
    const wav = makeWav({ frames: 44100, sample: (f) => Math.sin((f / 44100) * 2 * Math.PI * 440) * 0.7 });
    const mp3 = await encodeWavToMp3(wav, 128);
    expect(mp3).not.toBeNull();
    // MP3 frame sync at the start (0xFFEx) or an ID3/LAME header.
    expect(mp3!.byteLength).toBeGreaterThan(1000);
    expect(mp3!.byteLength).toBeLessThan(wav.byteLength);
  }, 30000);

  it('returns null for unparseable input', async () => {
    expect(await encodeWavToMp3(new Uint8Array(64), 128)).toBeNull();
  });
});

describe('audioImportSettings', () => {
  it('defaults and validates', () => {
    expect(audioImportSettings(undefined)).toEqual({ compress: true, bitrateKbps: 128 });
    expect(audioImportSettings({ compress: false, bitrateKbps: 192 })).toEqual({ compress: false, bitrateKbps: 192 });
    expect(audioImportSettings({ bitrateKbps: 999 })).toEqual({ compress: true, bitrateKbps: 128 });
  });
});
