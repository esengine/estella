// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * A sound from layers, held to what can be counted: how often a tone crosses nothing, where its energy lies, when it
 * is heard, and that the same source is the same samples.
 */
import { describe, expect, it } from 'vitest';
import { applySoundEdits, validateSoundSource, type SoundLayer, type SoundSource } from '../src/sound/soundSource';
import { encodeWav, renderSound } from '../src/sound/soundRender';
import { soundBands, soundPicture } from '../src/sound/soundPicture';

const make = (layers: SoundLayer[], rest: Partial<SoundSource> = {}) => renderSound(validateSoundSource({ duration: 0.5, layers, ...rest }));
/** Times a second the wave crosses nothing going up, between two shares of the sound: its pitch, for a plain tone. */
function pitchOf(samples: Float32Array, rate: number, from = 0, to = 1): number {
    const [a, b] = [Math.floor(samples.length * from), Math.floor(samples.length * to)];
    let crossings = 0;
    for (let n = a + 1; n < b; n++) if (samples[n - 1]! <= 0 && samples[n]! > 0) crossings++;
    return crossings / ((b - a) / rate);
}
const level = (samples: Float32Array, from = 0, to = 1): number => {
    const [a, b] = [Math.floor(samples.length * from), Math.floor(samples.length * to)];
    let sum = 0;
    for (let n = a; n < b; n++) sum += samples[n]! * samples[n]!;
    return Math.sqrt(sum / Math.max(1, b - a));
};

describe('a sound from layers', () => {
    it('makes a tone of the pitch asked, in every shape of wave', () => {
        for (const source of ['sine', 'triangle', 'saw', 'square'] as const) {
            const s = make([{ source, freq: 440 }]);
            expect(pitchOf(s.channels[0]!, s.rate, 0.1, 0.9), source).toBeCloseTo(440, -1);
        }
    });

    it('glides between the points of a pitch curve by ratio', () => {
        const s = make([{ source: 'sine', freq: [[0, 200], [0.5, 800]] }]);
        expect(pitchOf(s.channels[0]!, s.rate, 0, 0.1)).toBeLessThan(260);
        expect(pitchOf(s.channels[0]!, s.rate, 0.9, 1)).toBeGreaterThan(680);
        // Halfway it is at 400, the pitch an octave up, not at the 500 a straight line would give.
        expect(pitchOf(s.channels[0]!, s.rate, 0.45, 0.55)).toBeGreaterThan(360);
        expect(pitchOf(s.channels[0]!, s.rate, 0.45, 0.55)).toBeLessThan(440);
    });

    it('is the same samples for the same source, and other noise for another seed', () => {
        const noise = (seed: number) => make([{ source: 'noise', seed }]).channels[0]!;
        expect(Buffer.from(noise(3).buffer).equals(Buffer.from(noise(3).buffer))).toBe(true);
        expect(Buffer.from(noise(3).buffer).equals(Buffer.from(noise(4).buffer))).toBe(false);
    });

    it('colours noise: white lies high, brown lies low', () => {
        const share = (color: 'white' | 'pink' | 'brown') => soundBands(make([{ source: 'noise', color }]));
        expect(share('white').high).toBeGreaterThan(0.8);
        expect(share('brown').low).toBeGreaterThan(0.5);
        expect(share('brown').high).toBeLessThan(0.1);
        expect(share('pink').high).toBeLessThan(share('white').high);
    });

    it('filters: a low-pass takes the top off, a high-pass the bottom, and a corner can move', () => {
        const through = (filters: SoundLayer['filters']) => soundBands(make([{ source: 'noise', filters }]));
        expect(through([{ type: 'lowpass', freq: 300 }]).high).toBeLessThan(0.1);
        expect(through([{ type: 'highpass', freq: 4000 }]).low).toBeLessThan(0.01);
        const swept = make([{ source: 'noise', filters: [{ type: 'lowpass', freq: [[0, 8000], [0.5, 100]] }] }], { normalize: false }).channels[0]!;
        expect(level(swept, 0.8, 1)).toBeLessThan(level(swept, 0, 0.2) * 0.4);
    });

    it('shapes loudness: a decay dies away, an attack rises, a curve is followed', () => {
        const dying = make([{ source: 'sine', freq: 300, decay: 0.05 }]).channels[0]!;
        expect(level(dying, 0.6, 0.8)).toBeLessThan(level(dying, 0, 0.1) * 0.05);
        const rising = make([{ source: 'sine', freq: 300, attack: 0.4 }]).channels[0]!;
        expect(level(rising, 0, 0.1)).toBeLessThan(level(rising, 0.7, 0.9) * 0.3);
        const shaped = make([{ source: 'sine', freq: 300, gain: [[0, 1], [0.25, 0], [0.5, 1]] }]).channels[0]!;
        expect(level(shaped, 0.45, 0.55)).toBeLessThan(level(shaped, 0, 0.1) * 0.3);
    });

    it('places a layer in time, and says so in the report', () => {
        const s = make([{ id: 'late', source: 'sine', freq: 500, start: 0.3, length: 0.1 }]);
        expect(level(s.channels[0]!, 0, 0.55)).toBe(0);
        expect(level(s.channels[0]!, 0.62, 0.78)).toBeGreaterThan(0.3);
        expect(level(s.channels[0]!, 0.85, 1)).toBe(0);
        expect(s.layers).toEqual([{ id: 'late', source: 'sine', from: 0.3, to: 0.4, peak: 1 }]);
    });

    it('strikes a layer again, each time quieter and higher if told', () => {
        const s = make([{ source: 'sine', freq: 400, length: 0.04, repeat: { count: 4, every: 0.1, gain: 0.5, pitch: 1.5 } }], { normalize: false }).channels[0]!;
        const hit = (k: number): number => level(s, k * 0.2 + 0.01, k * 0.2 + 0.07);
        expect(hit(1)).toBeCloseTo(hit(0) * 0.5, 1);
        expect(hit(3)).toBeCloseTo(hit(0) * 0.125, 1);
        expect(level(s, 0.12, 0.18)).toBe(0);
        expect(pitchOf(s, 44100, 0.21, 0.27)).toBeGreaterThan(pitchOf(s, 44100, 0.01, 0.07) * 1.3);
    });

    it('rings the tones of a struck thing, each dying at its own rate', () => {
        const s = make([{ source: 'modes', modes: [[600, 1, 0.3], [5000, 1, 0.06]] }], { normalize: false });
        const early = soundBands({ ...s, channels: [s.channels[0]!.subarray(0, 2048)] });
        const late = soundBands({ ...s, channels: [s.channels[0]!.subarray(18000, 20048)] });
        expect(early.high).toBeGreaterThan(0.3);
        expect(late.high).toBeLessThan(0.01);
        expect(late.mid).toBeGreaterThan(0.95);
    });

    it('bends a tone with another: more index, more of it above', () => {
        const top = (index: number): number => soundBands(make([{ source: 'sine', freq: 300, fm: { ratio: 3.5, index } }])).high;
        expect(top(0)).toBeLessThan(0.01);
        expect(top(8)).toBeGreaterThan(top(1));
        expect(top(8)).toBeGreaterThan(0.2);
    });

    it('is one channel until something is off-centre, and then the side it was sent to is the louder', () => {
        expect(make([{ source: 'sine', freq: 300 }]).channels).toHaveLength(1);
        const s = make([{ source: 'sine', freq: 300, pan: -1 }]);
        expect(s.channels).toHaveLength(2);
        expect(level(s.channels[0]!)).toBeGreaterThan(0.5);
        expect(level(s.channels[1]!)).toBeLessThan(1e-6);
    });

    it('brings its loudest moment to the level asked, or leaves the sum and says when it is too much', () => {
        expect(make([{ source: 'sine', freq: 300, gain: 0.1 }]).peak).toBeCloseTo(0.9, 5);
        expect(make([{ source: 'sine', freq: 300, gain: 0.1 }], { gain: 0.5 }).peak).toBeCloseTo(0.5, 5);
        const raw = make([{ source: 'sine', freq: 300, gain: 0.1 }], { normalize: false });
        expect(raw.peak).toBeCloseTo(0.1, 2);
        const over = make([{ source: 'sine', freq: 300 }, { source: 'sine', freq: 300 }], { normalize: false });
        expect(over.peak).toBe(1);
        expect(over.notes.join(' ')).toMatch(/sum to 2\.00 times full/);
    });

    it('adds an echo after the sound, and a room round it', () => {
        const dry = make([{ source: 'noise', length: 0.05 }], { normalize: false }).channels[0]!;
        const echoed = make([{ source: 'noise', length: 0.05 }], { normalize: false, echo: { time: 0.2, feedback: 0, mix: 0.5 } }).channels[0]!;
        expect(level(dry, 0.4, 0.5)).toBe(0);
        expect(level(echoed, 0.4, 0.5)).toBeGreaterThan(0.1);
        const roomy = make([{ source: 'noise', length: 0.05 }], { normalize: false, reverb: { size: 0.8, mix: 0.5 } });
        expect(roomy.channels).toHaveLength(2);
        expect(level(roomy.channels[0]!, 0.5, 0.9)).toBeGreaterThan(0.001);
    });

    it('runs the end of a loop into its start', () => {
        const jump = (loop: boolean): number => {
            const s = make([{ source: 'noise', color: 'brown', attack: 0, release: 0 }], { loop, normalize: false }).channels[0]!;
            return Math.abs(s[0]! - s[s.length - 1]!);
        };
        // Brown noise wanders, so where it ends is far from where it began; folded over, the last sample and the first
        // are no further apart than any two neighbours in it, which is 0.07 at the most.
        expect(jump(true)).toBeLessThan(0.08);
        const steady = make([{ source: 'sine', freq: 100, attack: 0, release: 0 }], { loop: true, normalize: false }).channels[0]!;
        expect(level(steady, 0, 0.1)).toBeGreaterThan(0.5);
        expect(level(steady, 0.9, 1)).toBeGreaterThan(0.5);
    });

    it('says what is silent, and what is cut short', () => {
        expect(make([{ source: 'sine', freq: 300, gain: 0 }]).notes.join(' ')).toMatch(/layer 0 makes no sound.*the sound is silent/);
        expect(make([{ id: 'tail', source: 'sine', freq: 300, start: 0.4, length: 0.5 }]).notes.join(' ')).toMatch(/layer 0 "tail" is cut short/);
    });
});

describe('a sound as a file and as a picture', () => {
    it('writes 16-bit PCM that says what it is', () => {
        const s = make([{ source: 'sine', freq: 300, pan: 0.5 }], { rate: 22050 });
        const wav = encodeWav(s);
        const view = new DataView(wav.buffer);
        expect(String.fromCharCode(...wav.subarray(0, 4), ...wav.subarray(8, 12))).toBe('RIFFWAVE');
        expect(view.getUint16(22, true)).toBe(2);
        expect(view.getUint32(24, true)).toBe(22050);
        expect(view.getUint16(34, true)).toBe(16);
        expect(view.getUint32(40, true)).toBe(11025 * 2 * 2);
        expect(wav.length).toBe(44 + 11025 * 4);
    });

    it('draws a tone as a line at its pitch, and a higher tone higher', () => {
        const brightestRow = (freq: number): number => {
            const p = soundPicture(make([{ source: 'sine', freq }]), 128);
            let [best, at] = [0, 0];
            for (let y = 120; y < p.height; y++) {
                const v = p.rgba[(y * p.width + 64) * 4]! + p.rgba[(y * p.width + 64) * 4 + 1]!;
                if (v > best) [best, at] = [v, y];
            }
            return at;
        };
        expect(soundPicture(make([{ source: 'sine', freq: 300 }])).width).toBe(768);
        expect(brightestRow(2000)).toBeLessThan(brightestRow(200) - 60);
    });
});

describe('a sound source', () => {
    const tone = { source: 'sine', freq: 300 };
    const bad = (source: unknown) => () => validateSoundSource(source);

    it('says what is wrong with one', () => {
        expect(bad({ layers: [tone] })).toThrow(/duration must be seconds/);
        expect(bad({ duration: 1, layers: [] })).toThrow(/layers must be a list of one or more/);
        expect(bad({ duration: 1, speed: 2, layers: [tone] })).toThrow(/unknown field "speed"; a sound has/);
        expect(bad({ duration: 1, rate: 8000, layers: [tone] })).toThrow(/rate must be one of 22050, 44100, 48000/);
        expect(bad({ duration: 1, layers: [{ source: 'sine' }] })).toThrow(/layer 0: a sine needs freq/);
        expect(bad({ duration: 1, layers: [{ source: 'noise', freq: 300 }] })).toThrow(/freq is a tone's pitch; a noise has none/);
        expect(bad({ duration: 1, layers: [{ source: 'bell', freq: 300 }] })).toThrow(/source "bell" must be one of sine, triangle, saw, square, noise, modes/);
        expect(bad({ duration: 1, layers: [{ ...tone, freq: [[0, 300], [0, 400]] }] })).toThrow(/freq: its times must rise/);
        expect(bad({ duration: 1, layers: [{ ...tone, filters: [{ type: 'lowpass', freq: 5 }] }] })).toThrow(/filter 0: freq must be 20\.\.20000/);
        expect(bad({ duration: 1, layers: [{ source: 'modes' }] })).toThrow(/modes needs `modes`/);
        expect(bad({ duration: 1, layers: [{ ...tone, start: 2 }] })).toThrow(/start must be 0\.\.1, inside the sound/);
        expect(bad({ duration: 1, layers: [{ ...tone, id: 'a' }, { ...tone, id: 'a' }] })).toThrow(/layer 1 "a": the id "a" is already used/);
        expect(bad({ duration: 1, layers: [{ ...tone, repeat: { count: 1, every: 0.1 } }] })).toThrow(/repeat\.count must be a whole number, 2\.\.200/);
        expect(bad({ duration: 1, layers: [tone], echo: { time: 5 } })).toThrow(/echo must be/);
    });

    it('is changed by edits, by id or by place, and refuses a bad one whole', () => {
        const source = validateSoundSource({ duration: 1, layers: [{ id: 'body', ...tone }, { source: 'noise' }] });
        const edited = applySoundEdits(source, [
            { op: 'set', layer: 'body', fields: { freq: 150, decay: 0.2 } },
            { op: 'set', layer: 1, fields: { color: 'pink' } },
            { op: 'insert', layer: { id: 'click', source: 'noise', length: 0.01 }, before: 'body' },
            { op: 'settings', fields: { duration: 2, reverb: { size: 0.3 } } },
        ]);
        expect(edited.layers.map((l) => l.id ?? l.color)).toEqual(['click', 'body', 'pink']);
        expect(edited.layers[1]).toMatchObject({ freq: 150, decay: 0.2 });
        expect(edited.duration).toBe(2);
        expect(applySoundEdits(edited, [{ op: 'remove', layer: 'click' }, { op: 'set', layer: 'body', fields: { decay: null } }]).layers[0]).toEqual({ id: 'body', source: 'sine', freq: 150 });
        expect(() => applySoundEdits(source, [{ op: 'set', layer: 'nobody', fields: {} }])).toThrow(/no layer "nobody"; 2 layers, ids: body/);
        expect(() => applySoundEdits(source, [{ op: 'set', layer: 'body', fields: { freq: -1 } }])).toThrow(/freq must be 10\.\.20000/);
        expect(source.layers[0]!.freq).toBe(300);
    });
});
