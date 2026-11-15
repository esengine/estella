// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeWav, fft, renderMusic, renderSound, validateMusicSource, validateSoundSource, type RenderedSound, type SoundSource } from '../src/sound';
import { BEAM_REACH, ENGINE_AT, ENGINE_REACH, MUSIC, MUSIC_VOLUME, SOUNDS, beamVoice, cuesBetween, engineVoice, type ShipSound } from '../../examples/space-frigate/src/soundMix';

const PROJECT = path.resolve(__dirname, '../../examples/space-frigate');
const AUDIO = path.join(PROJECT, 'assets/audio');

const source = (file: string): SoundSource => validateSoundSource(JSON.parse(readFileSync(path.join(PROJECT, file), 'utf8')));
const made = new Map<string, RenderedSound>();
const render = (file: string): RenderedSound => {
    if (!made.has(file)) made.set(file, renderSound(source(file)));
    return made.get(file)!;
};
const mono = (sound: Pick<RenderedSound, 'channels'>): Float32Array => {
    const [left, right] = sound.channels;
    if (!right) return left!;
    return left!.map((v, i) => (v + right[i]!) / 2);
};
const level = (samples: Float32Array, from = 0, to = samples.length): number => {
    let sum = 0;
    for (let i = from; i < to; i++) sum += samples[i]! * samples[i]!;
    return Math.sqrt(sum / Math.max(1, to - from));
};

const bend = (a: number, b: number, c: number): number => Math.abs(c - 2 * b + a);
const seamBend = (samples: Float32Array): number => {
    const n = samples.length;
    return Math.max(bend(samples[n - 2]!, samples[n - 1]!, samples[0]!), bend(samples[n - 1]!, samples[0]!, samples[1]!));
};
const sharpestBend = (samples: Float32Array): number => {
    let sharpest = 0;
    for (let i = 2; i < samples.length; i++) sharpest = Math.max(sharpest, bend(samples[i - 2]!, samples[i - 1]!, samples[i]!));
    return sharpest;
};

function shareAbove(sound: Pick<RenderedSound, 'channels' | 'rate'>, hz: number): number {
    const samples = mono(sound);
    const size = 1 << Math.floor(Math.log2(samples.length));
    const re = new Float64Array(size), im = new Float64Array(size);
    for (let i = 0; i < size; i++) re[i] = samples[i]!;
    fft(re, im);
    const split = Math.round((hz / sound.rate) * size);
    let below = 0, above = 0;
    for (let i = 1; i < size / 2; i++) {
        const power = re[i]! * re[i]! + im[i]! * im[i]!;
        if (i < split) below += power; else above += power;
    }
    return above / (below + above);
}

const FILES = Object.values(SOUNDS);
const LOOPS = [SOUNDS.engine, SOUNDS.beam];
const SHOTS = FILES.filter((file) => !LOOPS.includes(file as never));

describe('the space frigate\'s sounds, as recipes', () => {
    it('are the files its script names, each registered as a sound source', () => {
        const onDisk = readdirSync(AUDIO).filter((name) => name.endsWith('.essound')).map((name) => `assets/audio/${name}`).sort();
        expect(onDisk).toEqual([...FILES].sort());
        for (const file of FILES) {
            const meta = path.join(PROJECT, `${file}.meta`);
            expect(existsSync(meta), `${file}.meta`).toBe(true);
            expect(JSON.parse(readFileSync(meta, 'utf8')).type).toBe('soundSource');
        }
    });

    it.each(FILES)('%s is made whole, heard, and never clipped', (file) => {
        const written = source(file), sound = render(file);
        expect(sound.seconds).toBeCloseTo(written.duration, 2);
        for (const channel of sound.channels) expect(channel.every(Number.isFinite)).toBe(true);
        expect(sound.peak).toBeGreaterThan(0.3);
        expect(sound.peak).toBeLessThanOrEqual(1);
        expect(sound.rms).toBeGreaterThan(0.01);
        for (const layer of sound.layers) expect(layer.peak, `layer ${layer.id}`).toBeGreaterThan(0);
    });

    it.each(LOOPS)('%s goes round without a step at its seam or a swell along it', (file) => {
        expect(source(file).loop).toBe(true);
        const samples = mono(render(file));
        expect(seamBend(samples)).toBeLessThanOrEqual(sharpestBend(samples));
        const quarter = Math.floor(samples.length / 4);
        const quarters = [0, 1, 2, 3].map((q) => level(samples, q * quarter, (q + 1) * quarter));
        expect(Math.min(...quarters) / Math.max(...quarters)).toBeGreaterThan(0.7);
    });

    it.each(SHOTS)('%s speaks within a fifth of a second and is silent by its end', (file) => {
        const sound = render(file), samples = mono(sound);
        const opening = Math.min(samples.length, Math.round(0.2 * sound.rate)), closing = Math.round(0.02 * sound.rate);
        expect(level(samples, 0, opening)).toBeGreaterThan(0.01);
        expect(level(samples, samples.length - closing)).toBeLessThan(0.02);
    });

    it('keeps the engine a low drone and puts the beam above it, which is what the measured bands tell apart', () => {
        expect(shareAbove(render(SOUNDS.engine), 400)).toBeLessThan(0.05);
        expect(shareAbove(render(SOUNDS.engine), 3000)).toBeLessThan(0.0005);
        expect(shareAbove(render(SOUNDS.beam), 3000)).toBeGreaterThan(shareAbove(render(SOUNDS.engine), 3000) * 20);
    });

    it('lets nothing through that would be harsh: no sound has much above three kilohertz', () => {
        for (const file of FILES) expect(shareAbove(render(file), 3000), file).toBeLessThan(0.05);
    });
});

describe('the space frigate\'s music, as a recipe', () => {
    const written = validateMusicSource(JSON.parse(readFileSync(path.join(PROJECT, MUSIC), 'utf8')));
    const recordings = [...new Set(Object.values(written.instruments).flatMap((instrument) => (instrument.samples ?? []).map((sample) => sample.file)))];
    const given = Object.fromEntries(recordings.map((file) => {
        const wav = decodeWav(new Uint8Array(readFileSync(path.join(PROJECT, file))));
        return [file, { rate: wav.rate, channels: wav.channels }];
    }));
    const piece = renderMusic(written, given);
    const samples = mono(piece);

    it('is the file the script names, registered as a music source, and played under the sounds', () => {
        expect(JSON.parse(readFileSync(path.join(PROJECT, `${MUSIC}.meta`), 'utf8')).type).toBe('musicSource');
        expect(MUSIC_VOLUME).toBeGreaterThan(0.1);
        expect(MUSIC_VOLUME).toBeLessThan(0.6);
    });

    it('plays a piano that is recordings in the project, each registered, with the licence they came under beside them', () => {
        expect(recordings.length).toBeGreaterThan(4);
        for (const file of recordings) {
            expect(file).toMatch(/^assets\/audio\/piano\/.+\.wav$/);
            expect(JSON.parse(readFileSync(path.join(PROJECT, `${file}.meta`), 'utf8')).type).toBe('audio');
        }
        expect(readdirSync(path.join(AUDIO, 'piano')).filter((name) => name.endsWith('.wav')).map((name) => `assets/audio/piano/${name}`).sort()).toEqual([...recordings].sort());
        expect(readFileSync(path.join(AUDIO, 'piano/LICENSE.txt'), 'utf8')).toMatch(/CC0 1\.0/);
    });

    it('is a loop of a minute or so, whole and never clipped', () => {
        expect(written.loop).not.toBe(false);
        expect(piece.seconds).toBeGreaterThan(45);
        expect(piece.seconds).toBeLessThan(180);
        for (const channel of piece.channels) expect(channel.every(Number.isFinite)).toBe(true);
        expect(piece.peak).toBeGreaterThan(0.3);
        expect(piece.peak).toBeLessThanOrEqual(1);
    });

    it('is calm: little above two kilohertz, and no stretch of it silent or far louder than the rest', () => {
        expect(shareAbove(piece, 2000)).toBeLessThan(0.05);
        const span = Math.round(5 * piece.rate);
        const levels: number[] = [];
        for (let from = 0; from + span <= samples.length; from += span) levels.push(level(samples, from, from + span));
        expect(Math.min(...levels)).toBeGreaterThan(0.03);
        expect(Math.min(...levels) / Math.max(...levels)).toBeGreaterThan(0.2);
    });

    it('goes round without a step at its seam', () => {
        expect(seamBend(samples)).toBeLessThanOrEqual(sharpestBend(samples));
    });
});

describe('what the space frigate sounds like, from its state', () => {
    const still: ShipSound = { throttle: 0.5, order: 0.5, rudder: 0, elevation: 0, mode: 'manual', arrivals: 0, firing: false, heat: 0, overheated: false, broken: 0 };
    const names = (now: Partial<ShipSound>, before: Partial<ShipSound> = {}): string[] => cuesBetween({ ...still, ...before }, { ...still, ...now }).map((cue) => cue.sound);

    it('the engine is never silent, and louder and higher the more it is driven', () => {
        const idle = engineVoice(0), half = engineVoice(0.5), full = engineVoice(1);
        expect(idle.playing && full.playing).toBe(true);
        expect(idle.volume).toBeGreaterThan(0.1);
        expect(half.volume).toBeGreaterThan(idle.volume);
        expect(full.volume).toBeGreaterThan(half.volume);
        expect(full.volume).toBeLessThanOrEqual(1);
        expect(half.pitch).toBeGreaterThan(idle.pitch);
        expect(full.pitch).toBeGreaterThan(half.pitch);
        expect(engineVoice(-3)).toEqual(idle);
        expect(engineVoice(7)).toEqual(full);
    });

    it('the engine and the beam are placed on the ship and fall away with distance', () => {
        expect(ENGINE_AT.z).toBeLessThan(0);
        expect(ENGINE_REACH.near).toBeGreaterThan(0);
        expect(ENGINE_REACH.far).toBeGreaterThan(ENGINE_REACH.near);
        expect(BEAM_REACH.far).toBeGreaterThan(BEAM_REACH.near);
    });

    it('the beam sounds only while it fires, higher as the emitter heats', () => {
        expect(beamVoice(false, 0.9).playing).toBe(false);
        expect(beamVoice(true, 0).playing).toBe(true);
        expect(beamVoice(true, 1).pitch).toBeGreaterThan(beamVoice(true, 0).pitch);
    });

    it('nothing is cued while nothing changes', () => {
        expect(names({})).toEqual([]);
        expect(names({ throttle: 0.9, heat: 0.4, firing: true })).toEqual([]);
    });

    it('an engine order ticks, up higher than down', () => {
        const [up] = cuesBetween(still, { ...still, order: 0.75 }), [down] = cuesBetween(still, { ...still, order: 0.25 });
        expect([up!.sound, down!.sound]).toEqual(['helmOrder', 'helmOrder']);
        expect(up!.pitch).toBeGreaterThan(1);
        expect(down!.pitch).toBeLessThan(1);
    });

    it('a rudder or elevation order ticks by hand, and not while the helm steers itself', () => {
        expect(names({ rudder: 1 / 3 })).toEqual(['helmOrder']);
        expect(names({ elevation: 15 })).toEqual(['helmOrder']);
        expect(names({ mode: 'approach', rudder: 0.41, elevation: 7.3 }, { mode: 'approach' })).toEqual([]);
    });

    it('taking or leaving a helm mode is one chime, whatever else the change moved', () => {
        const engaged = cuesBetween(still, { ...still, mode: 'align', rudder: 0.2 });
        const released = cuesBetween({ ...still, mode: 'align', rudder: 0.2 }, { ...still, mode: 'manual', rudder: 0 });
        expect(engaged.map((cue) => cue.sound)).toEqual(['helmMode']);
        expect(released.map((cue) => cue.sound)).toEqual(['helmMode']);
        expect(released[0]!.pitch).toBeLessThan(engaged[0]!.pitch);
    });

    it('an arrival, an overheat and a broken rock are each heard once, when they happen', () => {
        expect(names({ arrivals: 1 })).toEqual(['arrival']);
        expect(names({ overheated: true })).toEqual(['alarm']);
        expect(names({ overheated: true }, { overheated: true })).toEqual([]);
        expect(names({ broken: 3 }, { broken: 2 })).toEqual(['rockBreak']);
        expect(names({ broken: 1, arrivals: 1, order: 1 })).toEqual(['helmOrder', 'arrival', 'rockBreak']);
    });

    it('every cue names a sound that exists and plays it at a level and pitch a voice can take', () => {
        const all = cuesBetween(still, { ...still, mode: 'approach', arrivals: 1, overheated: true, broken: 1 });
        expect(all).toHaveLength(4);
        for (const cue of all) {
            expect(SOUNDS[cue.sound]).toMatch(/^assets\/audio\/.+\.essound$/);
            expect(cue.volume).toBeGreaterThan(0);
            expect(cue.volume).toBeLessThanOrEqual(1);
            expect(cue.pitch).toBeGreaterThan(0.5);
            expect(cue.pitch).toBeLessThan(2);
        }
    });
});
