// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * Cook-time audio: WAV parsing (PCM16/24/float, extensible, word-aligned
 * chunks) and the WAV→MP3 transcode through the real LAME wasm encoder.
 */
import { describe, it, expect } from 'vitest';
import { parseWav, encodeWavToMp3, audioImportSettings, encodedClipTrim, MP3_LEAD_SAMPLES } from '../src/assets/audioCook';

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

  it('is a chain of whole MPEG frames from the first byte to the last', async () => {
    // finalize() reuses the memory encode() answered with; without a copy the
    // stream's head was flush bytes, and a decoder lost the attack of a short
    // effect hunting for the first sync.
    for (const frames of [Math.round(44100 * 0.07), 44100]) {
      const wav = makeWav({ frames, sample: (f) => Math.sin((f / 44100) * 2 * Math.PI * 440) * 0.7 });
      const mp3 = (await encodeWavToMp3(wav, 128))!;
      const BITRATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
      const RATES = [44100, 48000, 32000];
      let at = 0;
      let count = 0;
      while (at < mp3.byteLength) {
        expect(mp3[at]).toBe(0xff);
        expect(mp3[at + 1] & 0xe0).toBe(0xe0);
        const bitrate = BITRATES[mp3[at + 2] >> 4] * 1000;
        const rate = RATES[(mp3[at + 2] >> 2) & 3];
        const padding = (mp3[at + 2] >> 1) & 1;
        at += Math.floor((144 * bitrate) / rate) + padding;
        count++;
      }
      expect(at).toBe(mp3.byteLength);
      expect(count).toBeGreaterThan(1);
    }
  }, 30000);

  it('returns null for unparseable input', async () => {
    expect(await encodeWavToMp3(new Uint8Array(64), 128)).toBeNull();
  });
});

describe('what encoding does to a clip', () => {
  it('says how long the clip really is, and the silence an MP3 has before its sound', () => {
    expect(encodedClipTrim(makeWav({ sampleRate: 44100, frames: 88200 }))).toEqual({ seconds: 2, lead: 1105 / 44100 });
    expect(encodedClipTrim(makeWav({ sampleRate: 22050, channels: 2, frames: 11025 }))).toEqual({ seconds: 0.5, lead: 1105 / 22050 });
    expect(encodedClipTrim(new Uint8Array(64))).toBeNull();
    expect(MP3_LEAD_SAMPLES).toBe(1105);
  });

  it('is what the encoder here does: the file it makes is longer than the clip by more than the lead', async () => {
    // The number is the encoder's and a decoder's together, and is only true of this encoder: were it swapped for one
    // that writes its own tag or holds back another amount, what the runtime is told would be wrong and this says so.
    const wav = makeWav({ sampleRate: 44100, frames: 44100, sample: (n) => 0.3 * Math.sin((2 * Math.PI * 440 * n) / 44100) });
    const mp3 = (await encodeWavToMp3(wav, 128))!;
    // Frames of 1152 samples: enough of them to hold the clip and the lead, and no tag frame in front that a decoder would read the lead from.
    let frames = 0;
    for (let at = 0; at + 4 <= mp3.length;) {
      if (mp3[at] !== 0xff || (mp3[at + 1]! & 0xe0) !== 0xe0) { at++; continue; }
      const [bitrate, rate, padding] = [[0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320][mp3[at + 2]! >> 4]!, [44100, 48000, 32000][(mp3[at + 2]! >> 2) & 3]!, (mp3[at + 2]! >> 1) & 1];
      if (!bitrate || !rate) { at++; continue; }
      frames++;
      at += Math.floor((144000 * bitrate) / rate) + padding;
    }
    expect(frames * 1152).toBeGreaterThanOrEqual(44100 + MP3_LEAD_SAMPLES - 529);
    expect(frames * 1152).toBeLessThan(44100 + MP3_LEAD_SAMPLES + 1152 * 2);
    const head = Buffer.from(mp3.subarray(0, 600)).toString('latin1');
    expect(head.includes('Xing') || head.includes('Info')).toBe(false);
  });
});

describe('audioImportSettings', () => {
  it('defaults and validates', () => {
    expect(audioImportSettings(undefined)).toEqual({ compress: true, bitrateKbps: 128 });
    expect(audioImportSettings({ compress: false, bitrateKbps: 192 })).toEqual({ compress: false, bitrateKbps: 192 });
    expect(audioImportSettings({ bitrateKbps: 999 })).toEqual({ compress: true, bitrateKbps: 128 });
  });
});
