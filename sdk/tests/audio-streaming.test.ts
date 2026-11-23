// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebAudioBackend } from '../src/audio/WebAudioBackend';
import { AudioAPI } from '../src/audio/Audio';
import { AUTO_STREAM_SECONDS, decodedPcmBytes, estimateAudioSeconds, shouldStream } from '../src/audio/audioStreaming';
import { parseAudioProjectConfig, applyAudioProjectConfig } from '../src/audio/AudioProjectConfig';
import { setPlatform } from '../src/platform/base';
import type { PlatformAdapter } from '../src/platform/types';

/** An 8 kHz mono 8-bit WAV of `seconds`: 8000 bytes a second keeps a long clip small. */
function wav(seconds: number): ArrayBuffer {
  const data = Math.round(seconds * 8000);
  const buf = new ArrayBuffer(44 + data);
  const v = new DataView(buf);
  const tag = (o: number, s: string) => { for (let i = 0; i < 4; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  tag(0, 'RIFF'); v.setUint32(4, 36 + data, true); tag(8, 'WAVE'); tag(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
  tag(36, 'data'); v.setUint32(40, data, true);
  return buf;
}

/** A constant-bitrate MP3: an MPEG-1 Layer III frame header at 128 kbps, then padding to the length. */
function mp3(seconds: number): ArrayBuffer {
  const bytes = new Uint8Array(Math.round((seconds * 128000) / 8));
  bytes.set([0xff, 0xfb, 0x90, 0x00]);
  return bytes.buffer;
}

describe('estimating a clip\'s length without decoding it', () => {
  it('reads a WAV exactly and a constant-bitrate MP3 from its size', () => {
    expect(estimateAudioSeconds(wav(12))).toBeCloseTo(12, 3);
    expect(estimateAudioSeconds(mp3(180))).toBeCloseTo(180, 0);
  });

  it('skips an ID3 tag, and says nothing about a container it does not know', () => {
    const tagged = new Uint8Array(10 + 1000 + (30 * 128000) / 8);
    tagged.set([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0x07, 0x68]); // 1000-byte tag
    tagged.set([0xff, 0xfb, 0x90, 0x00], 1010);
    expect(estimateAudioSeconds(tagged.buffer)).toBeCloseTo(30, 0);
    expect(estimateAudioSeconds(new Uint8Array(64).buffer)).toBeNull();
  });

  it('prices the PCM a streamed clip does not take — 69MB for three stereo minutes', () => {
    expect(decodedPcmBytes(180)).toBe(180 * 48000 * 2 * 4);
    expect(decodedPcmBytes(180) / 1e6).toBeCloseTo(69.1, 0);
  });
});

describe('which clips stream', () => {
  it('auto streams from the threshold up, and an explicit choice overrides the length', () => {
    expect(shouldStream('auto', wav(AUTO_STREAM_SECONDS - 1))).toBe(false);
    expect(shouldStream(undefined, wav(AUTO_STREAM_SECONDS))).toBe(true);
    expect(shouldStream('streaming', wav(1))).toBe(true);
    expect(shouldStream('decompress', wav(300))).toBe(false);
  });

  it('streams an unknown container when the file is large, and decodes it when small', () => {
    expect(shouldStream('auto', new ArrayBuffer(900 * 1024))).toBe(true);
    expect(shouldStream('auto', new ArrayBuffer(40 * 1024))).toBe(false);
  });
});

// ── the backend ────────────────────────────────────────────────────────────────

interface FakeElement {
  src: string; loop: boolean; playbackRate: number; currentTime: number; preload: string; duration: number;
  onended: (() => void) | null; onloadedmetadata: (() => void) | null; onerror: (() => void) | null;
  play: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn>; load: ReturnType<typeof vi.fn>;
  removeAttribute: ReturnType<typeof vi.fn>;
}
let elements: FakeElement[] = [];
let objectUrls: string[] = [];
let revoked: string[] = [];
let metadataDuration = 180;
let contextState = 'running';
const media: any[] = [];

function install(): any {
  elements = []; objectUrls = []; revoked = []; media.length = 0; contextState = 'running';
  class FakeAudio {
    src = ''; loop = false; playbackRate = 1; currentTime = 0; preload = ''; duration = metadataDuration;
    onended: (() => void) | null = null; onloadedmetadata: (() => void) | null = null; onerror: (() => void) | null = null;
    play = vi.fn().mockResolvedValue(undefined); pause = vi.fn(); load = vi.fn(); removeAttribute = vi.fn();
    constructor() { elements.push(this as unknown as FakeElement); setTimeout(() => this.onloadedmetadata?.(), 0); }
  }
  (globalThis as any).Audio = FakeAudio;
  let n = 0;
  (globalThis as any).URL.createObjectURL = vi.fn(() => { const u = `blob:clip-${++n}`; objectUrls.push(u); return u; });
  (globalThis as any).URL.revokeObjectURL = vi.fn((u: string) => { revoked.push(u); });
  const gain = (c: any) => ({ gain: { value: 1, setTargetAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn(), context: c });
  const ctx: any = {
    get state() { return contextState; }, currentTime: 0, destination: {},
    createGain: vi.fn(() => gain(ctx)), createStereoPanner: vi.fn(() => ({ pan: { value: 0 }, connect: vi.fn(), disconnect: vi.fn() })),
    createBufferSource: vi.fn(), createAnalyser: vi.fn(() => ({ fftSize: 0, smoothingTimeConstant: 0, connect: vi.fn(), disconnect: vi.fn(), getByteFrequencyData: vi.fn() })),
    createMediaElementSource: vi.fn((el: unknown) => { const node = { el, connect: vi.fn(), disconnect: vi.fn() }; media.push(node); return node; }),
    decodeAudioData: vi.fn().mockResolvedValue({ duration: 2, length: 96000, numberOfChannels: 2 }),
    resume: vi.fn().mockResolvedValue(undefined), suspend: vi.fn().mockResolvedValue(undefined), close: vi.fn(),
  };
  (globalThis as any).AudioContext = vi.fn(() => ctx);
  setPlatform({ name: 'web', readFile: vi.fn(), now: vi.fn() } as unknown as PlatformAdapter);
  return ctx;
}

describe('WebAudioBackend streaming', () => {
  let backend: WebAudioBackend;
  let ctx: any;

  beforeEach(async () => {
    metadataDuration = 180;
    ctx = install();
    backend = new WebAudioBackend();
    await backend.initialize();
  });
  afterEach(() => backend.dispose());

  it('keeps a long clip as compressed bytes: nothing decoded, the length from the element', async () => {
    const handle = await backend.loadBufferFromData('bgm.mp3', mp3(180));
    expect(ctx.decodeAudioData).not.toHaveBeenCalled();
    expect(handle).toMatchObject({ streamed: true, bytes: 0, duration: 180 });
    expect(handle.savedBytes).toBe(decodedPcmBytes(180));
  });

  it('still decodes a short effect, and honours an explicit choice either way', async () => {
    expect((await backend.loadBufferFromData('click.wav', wav(0.4))).streamed).toBeUndefined();
    expect(ctx.decodeAudioData).toHaveBeenCalledTimes(1);
    expect((await backend.loadBufferFromData('tiny.wav', wav(0.4), { loadType: 'streaming' })).streamed).toBe(true);
    expect((await backend.loadBufferFromData('long.mp3', mp3(120), { loadType: 'decompress' })).streamed).toBeUndefined();
  });

  it.each(['effect.wav', 'music.wav'])('keeps authored load modes when %s loads first from the same bytes', async first => {
    const audio = new AudioAPI(backend);
    audio.setRefResolver(() => 'cooked/shared.wav');
    audio.setLoadTypes({ 'effect.wav': 'decompress', 'music.wav': 'streaming', 'theme.wav': 'streaming' });
    const bytes = wav(2);
    const byteLength = bytes.byteLength;
    ctx.decodeAudioData.mockImplementation(async (input: ArrayBuffer) => {
      structuredClone(input, { transfer: [input] }); // Web Audio takes ownership of its input.
      return { duration: 2, length: 96000, numberOfChannels: 2 };
    });
    metadataDuration = 2;
    await audio.preloadFromData(first, bytes);
    await audio.preloadFromData(first === 'effect.wav' ? 'music.wav' : 'effect.wav', bytes);
    await audio.preloadFromData('theme.wav', bytes);
    expect(bytes.byteLength).toBe(byteLength);
    const effect = audio.getBufferHandle('effect.wav')!;
    const music = audio.getBufferHandle('music.wav')!;
    expect(effect).toMatchObject({ duration: 2, bytes: 768000 });
    expect(music).toMatchObject({ duration: 2, streamed: true, bytes: 0 });
    expect(music.id).not.toBe(effect.id);
    expect(audio.getBufferHandle('theme.wav')).toBe(music);
    expect(audio.getBufferStats()).toMatchObject({ bufferCount: 3, streamedCount: 1, bufferBytes: effect.bytes });
    const voice = audio.playSFX('music.wav')!;
    expect(audio.invalidateBuffer('effect.wav')).toBe(true);
    expect(audio.getBufferStats()).toMatchObject({ bufferCount: 0, streamedCount: 0, bufferBytes: 0 });
    expect(voice.isPlaying).toBe(true);
    expect(revoked).toEqual([]);
    voice.stop();
    expect(revoked).toEqual(objectUrls);
  });

  it('plays through the pooled gain into the bus, loops, and ends the voice when the element ends', async () => {
    const handle = await backend.loadBufferFromData('bgm.mp3', mp3(180));
    const voice = backend.play(handle, { volume: 0.5, loop: true, bus: 'music' });
    const el = elements.at(-1)!;
    expect(el.src).toBe(objectUrls[0]);
    expect(el.loop).toBe(true);
    expect(el.play).toHaveBeenCalledTimes(1);
    expect(media).toHaveLength(1);
    expect(voice.isPlaying).toBe(true);
    expect(voice.duration).toBe(180);
    voice.setVolume(0.25);
    voice.setPlaybackRate(1.5);
    expect(el.playbackRate).toBe(1.5);
    voice.pause();
    expect(el.pause).toHaveBeenCalled();
    expect(voice.isPlaying).toBe(false);
    voice.resume();
    expect(voice.isPlaying).toBe(true);

    voice.setLoop(false);
    const ended = vi.fn();
    voice.onEnd = ended;
    el.onended?.();
    expect(ended).toHaveBeenCalledTimes(1);
    expect(voice.isPlaying).toBe(false);
  });

  it('lets a second play of the same clip end the first, and a different clip play beside it', async () => {
    const a = await backend.loadBufferFromData('a.mp3', mp3(60));
    const b = await backend.loadBufferFromData('b.mp3', mp3(60));
    const first = backend.play(a, {});
    const second = backend.play(a, {});
    expect(first.isPlaying).toBe(false);
    expect(second.isPlaying).toBe(true);
    const other = backend.play(b, {});
    expect(second.isPlaying).toBe(true);
    expect(other.isPlaying).toBe(true);
  });

  it('holds the object URL until a clip unloaded mid-play has stopped', async () => {
    const handle = await backend.loadBufferFromData('bgm.mp3', mp3(60));
    const voice = backend.play(handle, {});
    backend.unloadBuffer(handle);
    expect(revoked).toEqual([]);
    voice.stop();
    expect(revoked).toEqual([objectUrls[0]]);
    const idle = await backend.loadBufferFromData('idle.mp3', mp3(60));
    backend.unloadBuffer(idle);
    expect(revoked).toHaveLength(2);
  });

  it('pauses a streamed voice when the device suspends and starts it again on resume', async () => {
    const handle = await backend.loadBufferFromData('bgm.mp3', mp3(60));
    const voice = backend.play(handle, {});
    const el = elements.at(-1)!;
    backend.suspend();
    expect(el.pause).toHaveBeenCalled();
    el.play.mockClear();
    backend.resume();
    expect(el.play).toHaveBeenCalledTimes(1);
    expect(voice.isPlaying).toBe(true);
  });

  it('retries a start the browser blocked once the context is allowed to run', async () => {
    const handle = await backend.loadBufferFromData('bgm.mp3', mp3(60));
    contextState = 'suspended';
    const blocked = vi.fn().mockRejectedValueOnce(new Error('NotAllowedError')).mockResolvedValue(undefined);
    const spy = vi.spyOn(globalThis as any, 'Audio').mockImplementation(function (this: any) {
      Object.assign(this, { src: '', loop: false, playbackRate: 1, currentTime: 0, play: blocked, pause: vi.fn(), load: vi.fn(), removeAttribute: vi.fn() });
      return this;
    } as never);
    backend.play(handle, {});
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(blocked).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });
});

describe('what the API reports', () => {
  it('counts streamed clips and the memory they did not take, and takes importer choices by path', async () => {
    metadataDuration = 180;
    install();
    const backend = new WebAudioBackend();
    await backend.initialize();
    const audio = new AudioAPI(backend, backend.mixer);
    applyAudioProjectConfig(audio, parseAudioProjectConfig({ loadTypes: { 'assets/audio/short.wav': 'streaming', 'assets/audio/long.mp3': 'decompress', junk: 'auto' } }));

    await audio.preloadFromData('assets/audio/bgm.mp3', mp3(180));
    await audio.preloadFromData('./assets/audio/short.wav', wav(0.4));
    await audio.preloadFromData('assets/audio/long.mp3', mp3(120));
    await audio.preloadFromData('assets/audio/click.wav', wav(0.4));

    const stats = audio.getBufferStats();
    expect(stats.streamedCount).toBe(2);
    expect(stats.streamedSavedBytes).toBeGreaterThan(decodedPcmBytes(180));
    expect(stats.bufferBytes).toBeGreaterThan(0);
    backend.dispose();
  });

  it('keeps only the choices a person can make, and leaves auto to the length', () => {
    expect(parseAudioProjectConfig({ loadTypes: { 'a.mp3': 'streaming', 'b.mp3': 'auto', 'c.mp3': 3, '': 'streaming' } }).loadTypes)
      .toEqual({ 'a.mp3': 'streaming' });
    expect(parseAudioProjectConfig({}).loadTypes).toBeUndefined();
  });
});
