// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * A sound from layers, held to what can be counted: how often a tone crosses nothing, where its energy lies, when it
 * is heard, and that the same source is the same samples.
 */
import { describe, expect, it } from 'vitest';
import { applySoundEdits, validateSoundSource, type SoundLayer, type SoundSource } from '../src/sound/soundSource';
import { decodeWav, encodeWav, renderSound, renderSoundVariants } from '../src/sound/soundRender';
import { comparePicture, soundBands, soundPicture } from '../src/sound/soundPicture';

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

describe('what makes a made sound pass for a real one', () => {
    const raw = (layers: SoundLayer[], rest: Partial<SoundSource> = {}) => make(layers, { normalize: false, ...rest });

    it('cuts noise to a band and brings it back to the level of the whole', () => {
        const whole = level(raw([{ source: 'noise' }]).channels[0]!, 0.1, 0.9);
        for (const band of [[250, 800], [2500, 6000]] as const) {
            const s = raw([{ source: 'noise', band }]);
            expect(level(s.channels[0]!, 0.1, 0.9)).toBeCloseTo(whole, 1);
        }
        expect(soundBands(raw([{ source: 'noise', band: [2500, 6000] }])).high).toBeGreaterThan(0.95);
        expect(soundBands(raw([{ source: 'noise', band: [40, 150] }])).low).toBeGreaterThan(0.8);
    });

    it('lets a share of a decay linger as a tail', () => {
        const plain = raw([{ source: 'noise', decay: 0.01 }]).channels[0]!;
        const tailed = raw([{ source: 'noise', decay: 0.01, tail: { decay: 0.2, mix: 0.3 } }]).channels[0]!;
        expect(level(plain, 0.3, 0.5)).toBeLessThan(1e-6);
        expect(level(tailed, 0.3, 0.5)).toBeGreaterThan(0.02);
        // The start is the same sound: the tail takes its share, it does not add to it.
        expect(level(tailed, 0, 0.005)).toBeCloseTo(level(plain, 0, 0.005), 1);
    });

    it('makes a spike that is up at once and gone in its width', () => {
        const s = raw([{ source: 'impulse', width: 0.0002 }]).channels[0]!;
        expect(s[0]).toBeCloseTo(1, 5);
        expect(Math.abs(s[30]!)).toBeLessThan(0.1);
        expect(level(s, 0.01, 1)).toBe(0);
    });

    it('lifts what lies round a peak', () => {
        const share = (gain: number) => soundBands(raw([{ source: 'noise', filters: [{ type: 'peak', freq: 600, q: 1.5, gain }] }])).mid;
        expect(share(12)).toBeGreaterThan(share(0) * 1.5);
        expect(share(-12)).toBeLessThan(share(0));
    });

    it('scatters strikes in time and pitch, the same way each time, crowded early when told', () => {
        const scattered = (early: number) => raw([{ source: 'sine', freq: 2000, length: 0.01, decay: 0.002, scatter: { count: 200, over: 0.45, early, pitch: [1, 4], pan: 1 } }]);
        const even = scattered(1), crowded = scattered(3);
        expect(even.layers[0]!.strikes).toBe(200);
        expect(even.channels).toHaveLength(2);
        const mono = (s: typeof even): Float32Array => s.channels[0]!.map((v, i) => v + s.channels[1]![i]!);
        expect(level(mono(even), 0.5, 0.9)).toBeGreaterThan(level(mono(even), 0, 0.4) * 0.75);
        expect(level(mono(crowded), 0.5, 0.9)).toBeLessThan(level(mono(crowded), 0, 0.4) * 0.65);
        expect(Buffer.from(scattered(1).channels[0]!.buffer).equals(Buffer.from(even.channels[0]!.buffer))).toBe(true);
        // Pitches between one and four times 2 kHz: all of it above 2 kHz, none of it a single line.
        expect(soundBands(even).high).toBeGreaterThan(0.95);
    });

    it('bounces: each gap shorter than the last', () => {
        const s = raw([{ source: 'impulse', width: 0.0002, length: 0.002, repeat: { count: 4, every: 0.2, faster: 0.5 } }]).channels[0]!;
        const hits: number[] = [];
        for (let n = 0; n < s.length; n++) if (s[n]! > 0.9) hits.push(n / 44100);
        expect(hits).toHaveLength(4);
        expect(hits[1]! - hits[0]!).toBeCloseTo(0.2, 2);
        expect(hits[2]! - hits[1]!).toBeCloseTo(0.1, 2);
        expect(hits[3]! - hits[2]!).toBeCloseTo(0.05, 2);
    });

    it('gives a wide noise two sides that differ, and a narrow one two that do not', () => {
        const differ = (wide: number): number => {
            const s = raw([{ source: 'noise', wide, pan: 0 }]);
            if (s.channels.length === 1) return 0;
            return level(s.channels[0]!.map((v, i) => v - s.channels[1]![i]!));
        };
        expect(differ(0)).toBe(0);
        expect(differ(0.8)).toBeGreaterThan(differ(0.2) * 2);
    });

    it('puts a sound in a place: a room whose top dies before its bottom, open ground with its slaps', () => {
        const click: SoundLayer = { source: 'impulse', width: 0.0002, length: 0.01 };
        const room = raw([click], { duration: 1.5, reverb: { kind: 'room', size: 0.7, mix: 0.5 } });
        expect(room.channels).toHaveLength(2);
        const part = (from: number, to: number) => soundBands({ ...room, channels: [room.channels[0]!.subarray(Math.floor(from * 44100), Math.floor(to * 44100))] });
        expect(level(room.channels[0]!, 0.3, 0.6)).toBeGreaterThan(1e-4);
        expect(part(0.7, 1.2).high).toBeLessThan(part(0.02, 0.2).high * 0.5);
        const open = raw([click], { duration: 1.5, reverb: { kind: 'open', size: 0.5, mix: 0.5 } }).channels[0]!;
        // Nothing comes back from far walls before the first slap, where a room answers at once.
        expect(level(open, 0.012, 0.05)).toBeLessThan(level(room.channels[0]!, 0.012, 0.05) * 0.5);
        expect(level(open, 0.06, 0.2)).toBeGreaterThan(1e-4);
    });

    it('says what is wrong with the new fields', () => {
        const bad = (layer: unknown, rest: object = {}) => () => validateSoundSource({ duration: 1, layers: [layer], ...rest });
        expect(bad({ source: 'sine', freq: 300, band: [100, 200] })).toThrow(/band is a noise's/);
        expect(bad({ source: 'noise', band: [800, 200] })).toThrow(/band must be \[low Hz, high Hz\]/);
        expect(bad({ source: 'noise', tail: { decay: 0.1, mix: 0.2 } })).toThrow(/tail is the slow part of a decay: give decay too/);
        expect(bad({ source: 'impulse', width: 0.5 })).toThrow(/an impulse's width is seconds/);
        expect(bad({ source: 'noise', filters: [{ type: 'peak', freq: 500 }] })).toThrow(/gain is a peak's, in dB/);
        expect(bad({ source: 'noise', filters: [{ type: 'lowpass', freq: 500, gain: 3 }] })).toThrow(/gain is a peak's, in dB/);
        expect(bad({ source: 'noise', scatter: { count: 5, over: 1 }, repeat: { count: 2, every: 0.1 } })).toThrow(/by repeat or by scatter, not both/);
        expect(bad({ source: 'noise', scatter: { count: 5, over: 1, pitch: [3, 1] } })).toThrow(/scatter\.pitch must be \[low, high\]/);
        expect(bad({ source: 'noise', repeat: { count: 3, every: 0.1, faster: 2 } })).toThrow(/repeat\.faster/);
        expect(bad({ source: 'noise' }, { reverb: { kind: 'cave' } })).toThrow(/reverb\.kind must be one of room, open/);
    });
});

describe('layers struck together, sounds that differ, and a recording to be like', () => {
    const raw = (layers: SoundLayer[], rest: Partial<SoundSource> = {}) => make(layers, { normalize: false, ...rest });
    // A knock: a spike, and a ring that starts a hundredth of a second after it.
    const knock: SoundLayer[] = [
        { source: 'impulse', width: 0.0002, length: 0.002 },
        { source: 'sine', freq: 1000, start: 0.01, length: 0.03, decay: 0.01 },
    ];

    it('is the same sound as its layers written out, when a group is struck once', () => {
        const flat = raw(knock.map((l) => ({ ...l, start: (l.start ?? 0) + 0.1 }))).channels[0]!;
        const grouped = raw([{ source: 'group', start: 0.1, layers: knock }]).channels[0]!;
        let worst = 0;
        for (let n = 0; n < flat.length; n++) worst = Math.max(worst, Math.abs(flat[n]! - grouped[n]!));
        expect(worst).toBeLessThan(1e-6);
    });

    it('strikes the whole group again, each of its layers keeping its place in the event', () => {
        const s = raw([{ id: 'knocks', source: 'group', layers: knock, repeat: { count: 3, every: 0.15, gain: 0.5 } }]);
        const ring = (k: number): number => level(s.channels[0]!, (k * 0.15 + 0.012) / 0.5, (k * 0.15 + 0.03) / 0.5);
        expect(ring(0)).toBeGreaterThan(0.05);
        expect(ring(1)).toBeCloseTo(ring(0) * 0.5, 1);
        expect(ring(2)).toBeCloseTo(ring(0) * 0.25, 1);
        // Between one knock and the next there is nothing.
        expect(level(s.channels[0]!, 0.1 / 0.5, 0.14 / 0.5)).toBeLessThan(1e-3);
        expect(s.layers).toEqual([{ id: 'knocks', source: 'group', from: 0, to: expect.any(Number), peak: 1, strikes: 3 }]);
    });

    it('gives each striking of a group its own noise', () => {
        const s = raw([{ source: 'group', layers: [{ source: 'noise', length: 0.05 }], repeat: { count: 2, every: 0.2 } }]).channels[0]!;
        const [first, second] = [s.subarray(0, 2000), s.subarray(8820, 10820)];
        let same = 0;
        for (let n = 100; n < 1900; n++) if (Math.abs(first[n]! - second[n]!) < 1e-6) same++;
        expect(same).toBeLessThan(20);
    });

    it('scatters a group, and hands its pitch, loudness and side down to its layers', () => {
        const s = raw([{ source: 'group', gain: 0.5, pan: -1, layers: [{ source: 'sine', freq: 500, length: 0.02 }], scatter: { count: 12, over: 0.4, pitch: [2, 2] } }]);
        expect(s.channels).toHaveLength(2);
        expect(level(s.channels[1]!)).toBeLessThan(1e-6);
        expect(s.layers[0]!.strikes).toBe(12);
        expect(s.layers[0]!.peak).toBeLessThanOrEqual(0.5);
        expect(soundBands(s).mid).toBeGreaterThan(0.9);
    });

    it('finds a layer inside a group by its id, to change it, add beside it or put one in', () => {
        const source = validateSoundSource({ duration: 1, layers: [{ id: 'step', source: 'group', layers: [{ id: 'heel', source: 'noise', length: 0.01 }] }] });
        const edited = applySoundEdits(source, [
            { op: 'set', layer: 'heel', fields: { band: [3800, 16000] } },
            { op: 'insert', layer: { id: 'toe', source: 'noise', length: 0.01, start: 0.008 }, after: 'heel' },
            { op: 'insert', layer: { id: 'thud', source: 'noise', color: 'brown', length: 0.05 }, into: 'step' },
        ]);
        expect(edited.layers[0]!.layers!.map((l) => l.id)).toEqual(['heel', 'toe', 'thud']);
        expect(edited.layers[0]!.layers![0]!.band).toEqual([3800, 16000]);
        expect(applySoundEdits(edited, [{ op: 'remove', layer: 'toe' }]).layers[0]!.layers).toHaveLength(2);
        expect(() => applySoundEdits(source, [{ op: 'insert', layer: { source: 'noise' }, into: 'heel' }])).toThrow(/"heel" is not a group/);
        expect(() => applySoundEdits(source, [{ op: 'set', layer: 'ankle', fields: {} }])).toThrow(/no layer "ankle"; 1 layers, ids: step, heel/);
    });

    it('refuses what a group cannot be', () => {
        const bad = (layer: unknown) => () => validateSoundSource({ duration: 1, layers: [layer] });
        expect(bad({ source: 'group' })).toThrow(/a group needs `layers`/);
        expect(bad({ source: 'group', layers: [{ source: 'noise' }], decay: 0.1 })).toThrow(/"decay" belongs on the layers in it/);
        expect(bad({ source: 'noise', layers: [] })).toThrow(/`layers` goes with source "group"/);
        expect(bad({ source: 'group', layers: [{ source: 'sine' }] })).toThrow(/layer 0 > layer 0: a sine needs freq/);
        expect(bad({ source: 'group', id: 'a', layers: [{ id: 'a', source: 'noise' }] })).toThrow(/the id "a" is already used/);
    });

    it('makes variants that are the same sound and not the same samples', () => {
        const source = validateSoundSource({
            duration: 0.5, variants: 4,
            layers: [{ source: 'noise', band: [800, 2500], decay: 0.03 }, { source: 'sine', freq: 400, decay: 0.05 }, { source: 'sine', freq: 1200, start: 0.2, length: 0.05 }],
        });
        const all = renderSoundVariants(source);
        expect(all).toHaveLength(4);
        // The first is the sound as written, the same as asking for no variants at all.
        expect(Buffer.from(all[0]!.channels[0]!.buffer).equals(Buffer.from(renderSound({ ...source, variants: 1 }).channels[0]!.buffer))).toBe(true);
        for (let k = 1; k < 4; k++) {
            expect(Buffer.from(all[k]!.channels[0]!.buffer).equals(Buffer.from(all[0]!.channels[0]!.buffer))).toBe(false);
            // Alike in what can be measured: as long, as loud at its loudest, its energy in the same place.
            expect(all[k]!.seconds).toBe(all[0]!.seconds);
            expect(all[k]!.peak).toBeCloseTo(all[0]!.peak, 5);
            expect(Math.abs(soundBands(all[k]!).mid - soundBands(all[0]!).mid)).toBeLessThan(0.2);
        }
        expect(Buffer.from(all[2]!.channels[0]!.buffer).equals(Buffer.from(renderSoundVariants(source)[2]!.channels[0]!.buffer))).toBe(true);
        expect(Buffer.from(all[1]!.channels[0]!.buffer).equals(Buffer.from(all[2]!.channels[0]!.buffer))).toBe(false);
    });

    it('strays no further than `vary` says', () => {
        const pitches = (vary: number): number[] => renderSoundVariants(validateSoundSource({ duration: 0.5, variants: 6, vary, layers: [{ source: 'sine', freq: 1000 }] }))
            .map((s) => pitchOf(s.channels[0]!, s.rate, 0.1, 0.9));
        const spread = (v: number[]): number => Math.max(...v) - Math.min(...v);
        expect(spread(pitches(0))).toBeLessThan(3);
        expect(spread(pitches(0.2))).toBeGreaterThan(spread(pitches(0.03)) * 2);
        for (const p of pitches(0.03)) expect(Math.abs(p - 1000)).toBeLessThan(35);
        expect(() => validateSoundSource({ duration: 1, variants: 9, layers: [{ source: 'noise' }] })).toThrow(/variants must be a whole number, 1\.\.8/);
        expect(() => validateSoundSource({ duration: 1, vary: 0.5, layers: [{ source: 'noise' }] })).toThrow(/vary must be 0\.\.0\.3/);
    });

    it('reads back the file it writes, and other kinds of .wav', () => {
        const s = make([{ source: 'sine', freq: 300, pan: 0.5 }], { rate: 22050 });
        const back = decodeWav(encodeWav(s));
        expect(back.rate).toBe(22050);
        expect(back.channels).toHaveLength(2);
        expect(back.seconds).toBeCloseTo(0.5, 3);
        let worst = 0;
        for (let n = 0; n < s.channels[0]!.length; n++) worst = Math.max(worst, Math.abs(back.channels[0]![n]! - s.channels[0]![n]!));
        expect(worst).toBeLessThan(1 / 16000);
        // Floats, with a chunk before the format that a reader has to step over.
        const floats = new Uint8Array(12 + 12 + 24 + 8 + 16);
        const view = new DataView(floats.buffer);
        const text = (at: number, t: string): void => { for (let i = 0; i < t.length; i++) floats[at + i] = t.charCodeAt(i); };
        text(0, 'RIFF'); view.setUint32(4, floats.length - 8, true); text(8, 'WAVE');
        text(12, 'LIST'); view.setUint32(16, 4, true);
        text(24, 'fmt '); view.setUint32(28, 16, true); view.setUint16(32, 3, true); view.setUint16(34, 1, true); view.setUint32(36, 48000, true); view.setUint16(46, 32, true);
        text(48, 'data'); view.setUint32(52, 16, true);
        [0.25, -0.5, 1, 0].forEach((v, i) => view.setFloat32(56 + i * 4, v, true));
        expect([...decodeWav(floats).channels[0]!]).toEqual([0.25, -0.5, 1, 0]);
        expect(() => decodeWav(new Uint8Array(64))).toThrow(/not a \.wav/);
    });

    it('draws a recording over the made sound, a second as wide in the one as in the other', () => {
        const long = make([{ source: 'sine', freq: 300 }], { duration: 1 });
        const short = make([{ source: 'sine', freq: 3000 }], { duration: 0.25 });
        const p = comparePicture(long, short, 400);
        expect(p.width).toBe(400);
        expect(p.height).toBe(384 * 2 + 22);
        const lit = (x: number, y: number): boolean => p.rgba[(y * p.width + x) * 4]! + p.rgba[(y * p.width + x) * 4 + 1]! + p.rgba[(y * p.width + x) * 4 + 2]! > 60;
        // The pale bar runs the whole width over the long one; the blue bar a quarter of it over the short one.
        expect(lit(390, 2)).toBe(true);
        expect(lit(90, 384 + 6 + 10 + 2)).toBe(true);
        expect(lit(110, 384 + 6 + 10 + 2)).toBe(false);
        expect(lit(300, 384 + 6 + 10 + 60)).toBe(false);
    });
});
