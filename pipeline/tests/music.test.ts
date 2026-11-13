// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * Music from instruments and patterns, held to what can be counted: which notes a line of steps is, when each sounds,
 * what pitch comes out, that a loop runs into itself and that the instruments written apart add up to the whole.
 */
import { describe, expect, it } from 'vitest';
import { applyMusicEdits, midiOf, musicSampleFiles, validateMusicSource, type MusicSource } from '../src/music/musicSource';
import { compileMusic, noteName, renderMusic, samplePitch, sampleZone, type SampleData } from '../src/music/musicRender';
import { musicPicture } from '../src/music/musicPicture';

const tone = { layers: [{ source: 'sine', freq: 440 }] } as const;
const click = { layers: [{ source: 'noise', length: 0.02, decay: 0.005 }] } as const;
/** One bar of four beats at 120: two seconds, each of its sixteen steps an eighth of a second. */
const piece = (tracks: Record<string, string>, rest: Record<string, unknown> = {}, pattern: Record<string, unknown> = {}): MusicSource => validateMusicSource({
    tempo: 120, key: 'A', scale: 'minor', humanize: 0, loop: false,
    instruments: { tone, click, low: { ...tone, octave: -1, follow: true } },
    patterns: { a: { bars: 1, tracks, ...pattern } },
    song: ['a'],
    ...rest,
});
const REST = '. . . . . . . . . . . . . . . .';
const steps = (...first: string[]): string => [...first, ...REST.split(' ')].slice(0, 16).join(' ');
function pitchOf(samples: Float32Array, rate: number, from: number, to: number): number {
    const [a, b] = [Math.floor(from * rate), Math.floor(to * rate)];
    let crossings = 0;
    for (let n = a + 1; n < b; n++) if (samples[n - 1]! <= 0 && samples[n]! > 0) crossings++;
    return crossings / ((b - a) / rate);
}
const level = (samples: Float32Array, rate: number, from: number, to: number): number => {
    let sum = 0;
    for (let n = Math.floor(from * rate); n < Math.floor(to * rate); n++) sum += samples[n]! * samples[n]!;
    return Math.sqrt(sum / Math.max(1, Math.floor((to - from) * rate)));
};

describe('music from instruments and patterns', () => {
    it('reads a degree as a note of the key, with octaves and accidentals', () => {
        const notes = (line: string, rest = {}) => compileMusic(piece({ tone: line }, rest)).events.map((e) => noteName(e.midi!));
        expect(notes(steps('1', '2', '3', '4', '5', '6', '7', "1'"))).toEqual(['A4', 'B4', 'C5', 'D5', 'E5', 'F5', 'G5', 'A5']);
        expect(notes(steps('1', '2', '3'), { key: 'C', scale: 'major' })).toEqual(['C4', 'D4', 'E4']);
        expect(notes(steps("5,", "3''", '#7', 'b2'))).toEqual(['E4', 'C7', 'G#5', 'A#4']);
        expect(notes(steps('[1 3 5]'))).toEqual(['A4', 'C5', 'E5']);
    });

    it('holds a note for as many steps as are dashes after it, and starts each step on time', () => {
        const e = compileMusic(piece({ tone: steps('1', '-', '-', '.', '3', '5', '-') })).events;
        expect(e.map((x) => [x.at, x.seconds])).toEqual([[0, 0.375], [0.5, 0.125], [0.625, 0.25]]);
        // Triplets: three steps to a beat.
        const t = compileMusic(piece({ tone: '1 . 1 . . . . . . . . .' }, {}, { div: 3 })).events;
        expect(t[1]!.at).toBeCloseTo(1 / 3, 6);
    });

    it('moves a line that follows with the chords, and keeps their roots near the tonic', () => {
        const source = validateMusicSource({
            tempo: 120, key: 'A', humanize: 0, instruments: { low: { ...tone, follow: true }, tone },
            patterns: { a: { bars: 4, chords: [1, 6, 3, 7], tracks: { low: Array(4).fill(steps('1', '3', '5')).join(' | '), tone: Array(4).fill(steps('1')).join('|') } } },
            song: ['a'],
        });
        const e = compileMusic(source).events;
        const of = (name: string) => e.filter((x) => x.instrument === name).map((x) => noteName(x.midi!));
        // A minor, F below it, C above, G below: each bar the same three steps, on another chord.
        expect(of('low')).toEqual(['A4', 'C5', 'E5', 'F4', 'A4', 'C5', 'C5', 'E5', 'G5', 'G4', 'B4', 'D5']);
        // What does not follow stays where it is written.
        expect(of('tone')).toEqual(['A4', 'A4', 'A4', 'A4']);
    });

    it('plays the pitch it says', () => {
        const m = renderMusic(piece({ tone: steps('1', '-', '-', '-', '-', '-', '-', '-', "1'", '-', '-', '-', '-', '-', '-', '-'), low: REST }));
        expect(pitchOf(m.channels[0]!, m.rate, 0.1, 0.9)).toBeCloseTo(440, -1);
        expect(pitchOf(m.channels[0]!, m.rate, 1.1, 1.9)).toBeCloseTo(880, -1.3);
        expect(m.instruments.tone).toMatchObject({ notes: 2, low: 'A4', high: 'A5' });
    });

    it('strikes a drum at its own pitch, and a layer with a length keeps it however long the step', () => {
        const m = renderMusic(piece({ click: steps('x', '-', '-', '-', '.', '.', '.', '.', 'x!') }));
        expect(m.events.map((e) => e.midi)).toEqual([null, null]);
        expect(level(m.channels[0]!, m.rate, 0, 0.02)).toBeGreaterThan(0.02);
        expect(level(m.channels[0]!, m.rate, 0.1, 0.9)).toBeLessThan(1e-4);
        // The second is marked louder.
        expect(level(m.channels[0]!, m.rate, 1, 1.02)).toBeGreaterThan(level(m.channels[0]!, m.rate, 0, 0.02) * 1.15);
    });

    it('lets a held note go over the release, and no longer', () => {
        const m = renderMusic(piece({ tone: steps('1', '-', '-', '-') }, { instruments: { tone: { ...tone, release: 0.2 }, click, low: tone } }));
        expect(level(m.channels[0]!, m.rate, 0.1, 0.45)).toBeGreaterThan(0.3);
        expect(level(m.channels[0]!, m.rate, 0.75, 1.5)).toBeLessThan(1e-4);
    });

    it('brings what rings past the end of a loop in at its start', () => {
        // One long note on the last step: nearly all of it is past the end.
        const last = `${REST.slice(0, -1)}1`;
        const instruments = { tone: { layers: [{ source: 'sine', freq: 440, length: 0.8, decay: 0.3 }] }, click, low: tone };
        const open = renderMusic(piece({ tone: last }, { loop: false, instruments }));
        const round = renderMusic(piece({ tone: last }, { loop: true, instruments }));
        // The one that ends rings on past its last bar; the loop is its bars and no more.
        expect(round.channels[0]!.length).toBe(2 * round.rate);
        expect(open.channels[0]!.length).toBeGreaterThan(round.channels[0]!.length);
        expect(level(open.channels[0]!, open.rate, 0.05, 0.4)).toBeLessThan(1e-4);
        expect(level(round.channels[0]!, round.rate, 0.05, 0.4)).toBeGreaterThan(0.05);
        expect(pitchOf(round.channels[0]!, round.rate, 0.05, 0.4)).toBeCloseTo(440, -1);
        // And where the end meets the start there is no step in the wave.
        const c = round.channels[0]!;
        expect(Math.abs(c[0]! - c[c.length - 1]!)).toBeLessThan(0.08);
    });

    it('writes instruments apart that add up to the whole, room and all', () => {
        const m = renderMusic(piece({ tone: steps('1', '-', '.', '.', '5'), click: steps('x', '.', 'x') }, { stems: true, reverb: { size: 0.3, mix: 0.3 } }));
        expect(Object.keys(m.stems!)).toEqual(['tone', 'click', 'low']);
        let worst = 0;
        for (const c of [0, 1]) for (let n = 0; n < m.channels[c]!.length; n += 7) {
            const sum = Object.values(m.stems!).reduce((s, stem) => s + stem[c]![n]!, 0);
            worst = Math.max(worst, Math.abs(sum - m.channels[c]![n]!));
        }
        expect(worst).toBeLessThan(1e-4);
        // The room goes on after the note is over.
        expect(level(m.stems!.tone![0]!, m.rate, 0.9, 1.2)).toBeGreaterThan(1e-4);
        expect(renderMusic(piece({ tone: steps('1') })).stems).toBeNull();
    });

    it('is the same samples from the same source, humanized or not', () => {
        const source = piece({ tone: steps('1', '3', '5'), click: steps('x', 'x') }, { humanize: 0.5, seed: 7 });
        const [a, b] = [renderMusic(source), renderMusic(source)];
        expect(Buffer.from(a.channels[0]!.buffer).equals(Buffer.from(b.channels[0]!.buffer))).toBe(true);
        const second = compileMusic(source).events.filter((e) => e.instrument === 'tone')[1]!;
        expect(second.at).not.toBe(0.125);
        expect(Math.abs(second.at - 0.125)).toBeLessThan(0.007);
    });

    it('makes every second step late when it swings', () => {
        const e = compileMusic(piece({ tone: steps('1', '1', '1', '1') }, { swing: 0.4 })).events;
        expect(e.map((x) => Math.round(x.at * 1000))).toEqual([0, 175, 250, 425]);
    });

    it('leaves instruments out of a part of the song, or keeps only some', () => {
        const source = piece({ tone: steps('1'), click: steps('x') }, { song: [{ pattern: 'a', without: ['click'] }, 'a', { pattern: 'a', only: ['click'] }] });
        const m = compileMusic(source);
        expect(m.seconds).toBe(6);
        expect(m.parts.map((p) => p.at)).toEqual([0, 2, 4]);
        expect(m.events.map((e) => `${e.part}${e.instrument}`)).toEqual(['0tone', '1tone', '1click', '2click']);
    });

    it('says what is wrong with the notes without hearing them', () => {
        const notes = (tracks: Record<string, string>, rest = {}) => compileMusic(piece(tracks, rest)).notes;
        expect(notes({ tone: steps('1'), click: steps('x'), low: steps('1') })).toEqual(['"low" follows the chords, and pattern "a" has none: it plays every bar on chord 1']);
        expect(notes({ tone: steps('1') })).toEqual(expect.arrayContaining(['instrument "click" is never played', 'instrument "low" is never played']));
        expect(notes({ tone: steps('.', '-') }).join()).toMatch(/a "-" at step 2 of bar 1 has no note before it/);
        expect(notes({ tone: steps('#1', 'b3', '5') }).join()).toMatch(/"tone" plays 2 notes outside the key/);
        expect(notes({ tone: steps("1,,,,") }).join()).toMatch(/"tone" goes down to A0, below where a pitch can be told/);
        // Two lines in one octave at one time.
        const crowded = { instruments: { tone, click, low: tone, other: tone } };
        expect(notes({ tone: steps('1', '-', '-', '-'), other: steps('3', '-', '-', '-') }, crowded).join()).toMatch(/"tone" and "other" sound together in the same octave/);
        expect(notes({ tone: steps('1', '-', '-', '-'), other: steps("3'", '-', '-', '-') }, crowded).join()).not.toMatch(/same octave/);
        expect(compileMusic(piece({ tone: steps('1') }, { patterns: { a: { bars: 1, tracks: { tone: steps('1') } }, b: { bars: 1, tracks: { tone: REST } } }, song: ['a', 'b'] })).notes)
            .toEqual(expect.arrayContaining(['part 2 of the song ("b") plays nothing']));
    });

    it('refuses a source that is not well formed, naming where', () => {
        const bad = (tracks: Record<string, string>, rest = {}, pattern = {}) => () => piece(tracks, rest, pattern);
        expect(bad({ tone: '1 . . .' })).toThrow(/pattern "a", track "tone", bar 1 has 4 steps; a bar here is 16/);
        expect(bad({ tone: `${REST} | ${REST}` })).toThrow(/has 2 bars between its \| marks; the pattern is 1/);
        expect(bad({ tone: steps('8') })).toThrow(/"8" is not a step/);
        expect(bad({ tone: steps('[1 9]') })).toThrow(/"\[1 9\]" is not a step/);
        expect(bad({ drums: REST })).toThrow(/a track for "drums", which is not an instrument; the instruments are tone, click, low/);
        expect(bad({ tone: REST }, { key: 'H' })).toThrow(/key must be a tonic/);
        expect(bad({ tone: REST }, { song: ['b'] })).toThrow(/song part 1: "b" is not a pattern; the patterns are a/);
        expect(bad({ tone: REST }, { instruments: { tone: { layers: [{ source: 'sine' }] } } })).toThrow(/instrument "tone": layer 0: a sine needs freq/);
        expect(bad({ tone: REST }, {}, { chords: [1, 8] })).toThrow(/chords must be the degree of each bar's root/);
        expect(bad({ tone: REST }, { tempo: 40, song: Array(64).fill('a') })).toThrow(/the song lasts 384 s; at most 240/);
    });

    it('changes a track, an instrument or a setting without the rest restated', () => {
        const source = piece({ tone: steps('1') });
        const edited = applyMusicEdits(source, [
            { op: 'track', pattern: 'a', track: 'click', steps: steps('x') },
            { op: 'instrument', name: 'bell', value: { layers: [{ source: 'modes', modes: [[440, 1, 0.4]] }] } },
            { op: 'settings', fields: { tempo: 90, humanize: null } },
        ]);
        expect(Object.keys(edited.patterns.a!.tracks)).toEqual(['tone', 'click']);
        expect(edited.tempo).toBe(90);
        expect(edited.humanize).toBeUndefined();
        expect(Object.keys(edited.instruments)).toContain('bell');
        expect(source.tempo).toBe(120);
        expect(() => applyMusicEdits(source, [{ op: 'track', pattern: 'b', track: 'tone', steps: REST }])).toThrow(/no pattern "b"; there are a/);
        expect(() => applyMusicEdits(source, [{ op: 'instrument', name: 'tone', value: null }])).toThrow(/a track for "tone", which is not an instrument/);
        expect(() => applyMusicEdits(source, [{ op: 'track', pattern: 'a', track: 'tone', steps: '1 2' }])).toThrow(/has 2 steps/);
    });

    it('draws every note where it sounds and as high as it is', () => {
        const m = renderMusic(piece({ tone: steps('1', '-', '-', '-', '.', '.', '.', '.', "1'", '-', '-', '-'), click: steps('x') }));
        const p = musicPicture(m);
        expect(p.colours).toEqual({ tone: 'blue', click: 'orange', low: 'green' });
        expect([p.low, p.high]).toEqual([67, 83]);
        const at = (x: number, y: number): number[] => [...p.rgba.subarray((y * p.width + x) * 4, (y * p.width + x) * 4 + 3)];
        const row = (p.height - 48 - 6 - 12) / (p.high - p.low + 1);
        const yOf = (midi: number): number => 48 + (p.high - midi) * row + 1;
        const blue = (c: number[]): boolean => c[2]! > 150 && c[2]! > c[0]! + 40;
        // The low A in the first quarter of the bar, the high one in the third, and neither anywhere else.
        expect(blue(at(Math.round(p.width * 0.1), yOf(69)))).toBe(true);
        expect(blue(at(Math.round(p.width * 0.6), yOf(69)))).toBe(false);
        expect(blue(at(Math.round(p.width * 0.6), yOf(81)))).toBe(true);
        expect(blue(at(Math.round(p.width * 0.1), yOf(81)))).toBe(false);
        // The drum on its own row at the bottom, in its own colour.
        const drum = at(1, p.height - 6);
        expect(drum[0]! > 150 && drum[0]! > drum[2]! + 40).toBe(true);
    });
});

describe('an instrument made of recordings', () => {
    /** A recording of a plain tone: @p hz for @p seconds, as loud at its end as at its start. */
    const recorded = (hz: number, seconds: number, rate = 44100): SampleData => ({ rate, channels: [Float32Array.from({ length: Math.round(seconds * rate) }, (_, n) => 0.5 * Math.sin((2 * Math.PI * hz * n) / rate))] });
    const given = { 'a4.wav': recorded(440, 1), 'a2.wav': recorded(110, 1), 'half.wav': recorded(440, 1, 22050) };
    const played = (samples: unknown[], line: string, rest: Record<string, unknown> = {}, more: Record<string, unknown> = {}) => renderMusic(validateMusicSource({
        tempo: 120, key: 'A', humanize: 0, loop: false, gain: 0.5,
        instruments: { keys: { samples, ...more } }, patterns: { a: { bars: 1, tracks: { keys: line } } }, song: ['a'], ...rest,
    }), given);
    const HELD = '- - - - - - -';
    const one = (note: string): string => `${note} ${HELD} . . . . . . . .`;

    it('plays a recording faster to be higher and slower to be lower', () => {
        const zone = [{ file: 'a4.wav', note: 'A4' }];
        expect(pitchOf(played(zone, one('1')).channels[0]!, 44100, 0.1, 0.9)).toBeCloseTo(440, -1);
        expect(pitchOf(played(zone, one("1'")).channels[0]!, 44100, 0.1, 0.4)).toBeCloseTo(880, -1.3);
        expect(pitchOf(played(zone, one('1,')).channels[0]!, 44100, 0.1, 0.9)).toBeCloseTo(220, -1);
        // A fifth up is half as much again.
        expect(pitchOf(played(zone, one('5')).channels[0]!, 44100, 0.1, 0.6)).toBeCloseTo(659.3, -1);
    });

    it('is the same pitch whatever rate the recording was made at', () => {
        expect(pitchOf(played([{ file: 'half.wav', note: 'A4' }], one('1')).channels[0]!, 44100, 0.1, 0.9)).toBeCloseTo(440, -1);
        expect(pitchOf(played([{ file: 'a4.wav', note: 'A4' }], one('1'), { rate: 22050 }).channels[0]!, 22050, 0.1, 0.9)).toBeCloseTo(440, -1);
    });

    it('takes each note from the recording nearest it, or from the one whose range holds it', () => {
        // The recordings are two octaves apart and each plays the notes round it.
        const near = [{ file: 'a4.wav', note: 'A4' }, { file: 'a2.wav', note: 'A2' }];
        expect(pitchOf(played(near, one('1')).channels[0]!, 44100, 0.1, 0.9)).toBeCloseTo(440, -1);
        expect(pitchOf(played(near, one('1,,')).channels[0]!, 44100, 0.1, 0.9)).toBeCloseTo(110, -1);
        expect(pitchOf(played(near, one('4,')).channels[0]!, 44100, 0.1, 0.6)).toBeCloseTo(293.7, -1);
        expect(pitchOf(played(near, one('4,,')).channels[0]!, 44100, 0.1, 0.6)).toBeCloseTo(146.8, -1);
        // Which one played is heard when one of them is called a note it is not: told it is A3 and given every note
        // up to C5, the recording of A4 plays an A4 an octave high.
        const moved = [{ file: 'a2.wav', note: 'A2' }, { file: 'a4.wav', note: 'A3', low: 'C1', high: 'C5' }];
        expect(pitchOf(played(moved, one('1')).channels[0]!, 44100, 0.1, 0.4)).toBeCloseTo(880, -1.3);
        // And without the range the nearer recording has it: A2, three octaves up from where it is said to be.
        const unranged = [{ file: 'a2.wav', note: 'A4' }, { file: 'a4.wav', note: 'A1' }];
        expect(pitchOf(played(unranged, one('1')).channels[0]!, 44100, 0.1, 0.9)).toBeCloseTo(110, -1);
    });

    it('stops where the recording ends, unless it goes round', () => {
        const short = { 'a4.wav': recorded(440, 0.3) };
        const line = `1 ${HELD} ${HELD} -`;
        const render = (loop?: unknown) => renderMusic(validateMusicSource({
            tempo: 120, key: 'A', humanize: 0, loop: false, gain: 0.5,
            instruments: { keys: { samples: [{ file: 'a4.wav', note: 'A4', ...(loop !== undefined ? { loop } : {}) }] } }, patterns: { a: { bars: 1, tracks: { keys: line } } }, song: ['a'],
        }), short);
        const once = render().channels[0]!;
        expect(level(once, 44100, 0.05, 0.25)).toBeGreaterThan(0.1);
        expect(level(once, 44100, 0.4, 1.9)).toBeLessThan(1e-4);
        for (const loop of [true, [0.1, 0.25]]) {
            const round = render(loop).channels[0]!;
            expect(level(round, 44100, 1.5, 1.9)).toBeGreaterThan(0.1);
            expect(pitchOf(round, 44100, 0.5, 1.9)).toBeCloseTo(440, -1);
            // Going round does not step: no sample leaps from the one before by more than the tone itself does.
            let leap = 0;
            for (let n = 1; n < round.length; n++) leap = Math.max(leap, Math.abs(round[n]! - round[n - 1]!));
            expect(leap).toBeLessThan(0.06);
        }
    });

    it('comes in over the attack and is let go over the release', () => {
        const m = played([{ file: 'a4.wav', note: 'A4' }], '1 - - - . . . . . . . . . . . .', {}, { attack: 0.2, release: 0.25 }).channels[0]!;
        expect(level(m, 44100, 0, 0.05)).toBeLessThan(level(m, 44100, 0.3, 0.45) * 0.3);
        expect(level(m, 44100, 0.55, 0.7)).toBeGreaterThan(1e-3);
        expect(level(m, 44100, 0.8, 1.9)).toBeLessThan(1e-4);
    });

    it('keeps both sides of a recording made in stereo, and plays a drum as it was recorded', () => {
        const stereo = { 'two.wav': { rate: 44100, channels: [recorded(440, 0.5).channels[0]!, new Float32Array(22050)] } };
        const m = renderMusic(validateMusicSource({
            tempo: 120, key: 'C', scale: 'major', humanize: 0, loop: false,
            instruments: { hit: { samples: [{ file: 'two.wav', note: 'C4' }] } }, patterns: { a: { bars: 1, tracks: { hit: 'x . . . . . . . . . . . . . . .' } } }, song: ['a'],
        }), stereo);
        expect(pitchOf(m.channels[0]!, 44100, 0.02, 0.1)).toBeCloseTo(440, -1);
        expect(level(m.channels[1]!, 44100, 0, 0.5)).toBeLessThan(1e-6);
    });

    it('names its recordings, and says which is missing', () => {
        const source = validateMusicSource({
            tempo: 120, key: 'A', instruments: { keys: { samples: [{ file: 'a.wav', note: 60 }, { file: 'b.ogg', note: 'F#3' }] }, more: { samples: [{ file: 'a.wav', note: 'Bb2' }] }, tone },
            patterns: { a: { bars: 1, tracks: { keys: one('1') } } }, song: ['a'],
        });
        expect(musicSampleFiles(source)).toEqual(['a.wav', 'b.ogg']);
        expect(() => renderMusic(source, {})).toThrow(/instrument "keys": the recording (a\.wav|b\.ogg) was not found/);
        expect([midiOf('C4'), midiOf('A4'), midiOf('F#3'), midiOf('Bb2'), midiOf('C-1'), midiOf('H2'), midiOf(128)]).toEqual([60, 69, 54, 46, 0, null, null]);
    });

    it('hears the pitch of a recording, and says when it is not the note it is called', () => {
        // A tone with overtones, as an instrument has: the pitch is the lowest of them, not the loudest.
        const rich = (hz: number): SampleData => ({ rate: 44100, channels: [Float32Array.from({ length: 44100 }, (_, n) => { const t = (2 * Math.PI * hz * n) / 44100; return 0.2 * Math.sin(t) + 0.3 * Math.sin(2 * t) + 0.15 * Math.sin(3 * t); })] });
        expect(samplePitch(rich(220), 220)).toBeCloseTo(220, -0.5);
        // Told it is an octave lower or higher than it is, it still finds what it is.
        expect(samplePitch(rich(220), 110)).toBeCloseTo(220, -0.5);
        expect(samplePitch(rich(220), 440)).toBeCloseTo(220, -0.5);
        let seed = 12345;
        // A high note recorded at a low rate: its period is twelve samples and a half, and twice that is not its pitch.
        const coarse = { rate: 11025, channels: [Float32Array.from({ length: 2874 }, (_, n) => { const t = (2 * Math.PI * 883 * n) / 11025; return 0.4 * Math.sin(t) + 0.1 * Math.sin(3 * t); })] };
        expect(samplePitch(coarse, 880)).toBeCloseTo(883, -1);
        const noise = { rate: 44100, channels: [Float32Array.from({ length: 44100 }, () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2147483648 - 1; })] };
        expect(samplePitch(noise, 220)).toBeNull();

        const notes = (samples: unknown[], files: Record<string, SampleData>): string[] => renderMusic(validateMusicSource({
            tempo: 120, key: 'A', humanize: 0, instruments: { keys: { samples } }, patterns: { a: { bars: 1, tracks: { keys: one('1') } } }, song: ['a'],
        }), files).notes;
        const files = { 'a.wav': rich(220), 'e.wav': rich(329.63) };
        expect(notes([{ file: 'a.wav', note: 'A3' }, { file: 'e.wav', note: 'E4' }], files)).toEqual([]);
        expect(notes([{ file: 'a.wav', note: 'A3' }, { file: 'e.wav', note: 'D4' }], files)).toEqual(['"keys": e.wav is said to be D4 and sounds as E4: every note played from it is 2 semitones higher than written. Set its note to "E4"']);
        // A library that counts its octaves from another C is out everywhere, and that is said once.
        const octave = notes([{ file: 'a.wav', note: 'A2' }, { file: 'e.wav', note: 'E3' }], files);
        expect(octave).toHaveLength(1);
        expect(octave[0]).toMatch(/every one of its 2 recordings sounds 12 semitones higher than the note it is said to be \(a\.wav is said to be A2 and sounds as A3\), as a library does that counts its octaves from another C/);
    });

    it('refuses samples that are not well formed', () => {
        const bad = (instrument: unknown) => () => validateMusicSource({ tempo: 120, key: 'A', instruments: { keys: instrument }, patterns: { a: { bars: 1, tracks: { keys: one('1') } } }, song: ['a'] });
        expect(bad({})).toThrow(/instrument "keys" needs layers \(a made sound\) or samples \(recordings\), one of the two/);
        expect(bad({ layers: [{ source: 'noise' }], samples: [{ file: 'a.wav', note: 'C4' }] })).toThrow(/one of the two/);
        expect(bad({ samples: [] })).toThrow(/samples must be 1\.\.256/);
        expect(bad({ samples: [{ file: 'a.txt', note: 'C4' }] })).toThrow(/sample 1: file must be a project path to a recording/);
        expect(bad({ samples: [{ file: 'a.wav', note: 'C' }] })).toThrow(/note must be the note recorded, as "C4"/);
        expect(bad({ samples: [{ file: 'a.wav', note: 'C4', low: 'C5', high: 'C3' }] })).toThrow(/low is above high/);
        expect(bad({ samples: [{ file: 'a.wav', note: 'C4', loop: [0.5, 0.5] }] })).toThrow(/loop must be true, or \[from, to\]/);
        expect(bad({ samples: [{ file: 'a.wav', note: 'C4', root: 'C4' }] })).toThrow(/unknown "root"; a sample has file, note, low, high, loop, dynamic, tune/);
        expect(bad({ layers: [{ source: 'noise' }], attack: 0.1 })).toThrow(/attack is for samples/);
    });
});

describe('how a piece begins, ends and meets itself', () => {
    const long = { layers: [{ source: 'sine', freq: 440, length: 0.8, decay: 0.3 }] };
    const last = `${REST.slice(0, -1)}1`;
    const FULL = '1 - - - 1 - - - 1 - - - 1 - - -';

    it('rings out past its last bar when it ends, and the file is that much longer', () => {
        const m = renderMusic(piece({ tone: last }, { instruments: { tone: long, click, low: tone } }));
        // The note starts an eighth of a second before the end and lasts 0.8.
        expect(m.seconds).toBe(2);
        expect(m.tailSeconds).toBeGreaterThan(0.5);
        expect(m.tailSeconds).toBeLessThan(0.8);
        expect(m.channels[0]!.length).toBe(Math.round((2 + m.tailSeconds) * m.rate));
        expect(level(m.channels[0]!, m.rate, 2.05, 2.3)).toBeGreaterThan(0.01);
        // And it ends on nothing.
        expect(Math.abs(m.channels[0]!.at(-1)!)).toBeLessThan(1e-3);
        // A piece with nothing left over is as long as its bars.
        expect(renderMusic(piece({ click: steps('x') })).tailSeconds).toBe(0);
        expect(renderMusic(piece({ tone: last }, { loop: true, instruments: { tone: long, click, low: tone } })).tailSeconds).toBe(0);
    });

    it('comes up from nothing and goes down to nothing over the seconds asked', () => {
        const m = renderMusic(piece({ tone: '1 - - - - - - - - - - - - - - -' }, { fadeIn: 0.5, fadeOut: 0.5 }));
        const c = m.channels[0]!;
        const middle = level(c, m.rate, 0.9, 1.1);
        expect(level(c, m.rate, 0, 0.1)).toBeLessThan(middle * 0.05);
        expect(level(c, m.rate, 0.2, 0.3)).toBeLessThan(middle * 0.5);
        expect(level(c, m.rate, 0.6, 0.8)).toBeCloseTo(middle, 2);
        expect(level(c, m.rate, 1.7, 1.8)).toBeLessThan(middle * 0.5);
        expect(level(c, m.rate, 1.9, 2)).toBeLessThan(middle * 0.05);
        // Faded to nothing by the end of the bar, it has nothing to ring.
        expect(m.tailSeconds).toBe(0);
        expect(c.length).toBe(2 * m.rate);
    });

    it('will not write a fade into a loop, and says who fades one', () => {
        expect(() => piece({ tone: FULL }, { loop: true, fadeIn: 1 })).toThrow(/fadeIn is for a piece that ends \(loop: false\).*playBGM\(url, \{ fadeIn \}\).*stopBGM\(seconds\)/);
        expect(() => validateMusicSource({ tempo: 120, key: 'A', instruments: { tone }, patterns: { a: { bars: 1, tracks: { tone: FULL } } }, song: ['a'], fadeOut: 1 })).toThrow(/fadeOut is for a piece that ends/);
        expect(() => piece({ tone: FULL }, { fadeOut: 3 })).toThrow(/fadeOut must be seconds, above 0 and no longer than the piece \(2 s\)/);
    });

    it('says where a loop meets itself, and when the music changes at once there', () => {
        const instruments = { tone, click, low: tone, pad: tone, bass: tone };
        const thin = { pattern: 'a', only: ['tone'] };
        const tracks = { tone: FULL, pad: FULL.replace(/1/g, '3'), bass: FULL.replace(/1/g, "5,"), click: steps('x', '.', 'x', '.', 'x') };
        const of = (song: unknown[]) => renderMusic(piece(tracks, { loop: true, instruments, song }));
        // Thin first and full last: the join is a drop.
        const drop = of([thin, 'a', 'a']);
        expect(drop.join).toMatchObject({ begins: ['tone'], ends: ['tone', 'click', 'pad', 'bass'] });
        expect(drop.join!.endDb).toBeGreaterThan(drop.join!.startDb + 3);
        expect(drop.notes.join()).toMatch(/where the loop meets itself the music changes at once: its last bar has tone, click, pad, bass at .* and its first has tone at .*, so click, pad, bass stop dead/);
        // As full at its end as at its start, or thin at both: nothing to say.
        expect(of(['a', 'a', 'a']).notes.join()).not.toMatch(/meets itself/);
        expect(of([thin, 'a', thin]).notes.join()).not.toMatch(/meets itself/);
        // A piece that ends has no join.
        expect(renderMusic(piece(tracks, { instruments, song: [thin, 'a'] })).join).toBeNull();
    });
});

describe('recordings played soft and loud, and taking turns', () => {
    const recorded = (hz: number, loud = 0.5): SampleData => ({ rate: 44100, channels: [Float32Array.from({ length: 22050 }, (_, n) => loud * Math.sin((2 * Math.PI * hz * n) / 44100))] });
    // Each recording is of another pitch, so which one played is heard in what comes out.
    const given = { 'n.wav': recorded(440), 's.wav': recorded(330, 0.2), 'l.wav': recorded(660), 'n2.wav': recorded(550), 'n3.wav': recorded(770), 'sharp.wav': recorded(440 * Math.pow(2, 50 / 1200)) };
    const play = (samples: unknown[], line: string) => renderMusic(validateMusicSource({
        tempo: 120, key: 'A', humanize: 0, loop: false, gain: 0.5,
        instruments: { keys: { samples } }, patterns: { a: { bars: 1, tracks: { keys: line } } }, song: ['a'],
    }), given);
    const FOUR = (a: string, b: string, c: string, d: string): string => `${a} - - . ${b} - - . ${c} - - . ${d} - - .`;
    const heard = (m: ReturnType<typeof play>, beat: number): number => Math.round(pitchOf(m.channels[0]!, 44100, beat * 0.5 + 0.05, beat * 0.5 + 0.3) / 10) * 10;

    it('plays a step marked soft or loud from a recording made that way', () => {
        const zones = [{ file: 'n.wav', note: 'A4' }, { file: 's.wav', note: 'A4', dynamic: 'soft' }, { file: 'l.wav', note: 'A4', dynamic: 'loud' }];
        const m = play(zones, FOUR('1', '1?', '1!', '1'));
        expect([0, 1, 2, 3].map((b) => heard(m, b))).toEqual([440, 330, 660, 440]);
        expect(sampleZone({ samples: zones } as never, 69, -1, 0)).toEqual({ index: 1, matched: true });
        expect(sampleZone({ samples: zones } as never, 69, 0, 0)).toEqual({ index: 0, matched: false });
    });

    it('does not count the mark twice when the recording is already that hard', () => {
        // The soft recording is 0.2 where the normal one is 0.5: played from it, a soft step is 0.2, not 0.2 times 0.6.
        const both = play([{ file: 'n.wav', note: 'A4' }, { file: 's.wav', note: 'A4', dynamic: 'soft' }], FOUR('1', '1?', '.', '.')).channels[0]!;
        expect(level(both, 44100, 0.55, 0.8) / level(both, 44100, 0.05, 0.3)).toBeCloseTo(0.4, 1);
        // With no soft recording the normal one is turned down.
        const one = play([{ file: 'n.wav', note: 'A4' }], FOUR('1', '1?', '.', '.')).channels[0]!;
        expect(level(one, 44100, 0.55, 0.8) / level(one, 44100, 0.05, 0.3)).toBeCloseTo(0.6, 1);
    });

    it('falls back on the nearest in hardness where there is none as hard', () => {
        // No loud recording: a loud step takes the normal one, never the soft.
        const m = play([{ file: 's.wav', note: 'A4', dynamic: 'soft' }, { file: 'n.wav', note: 'A4' }], FOUR('1!', '1?', '1', '.'));
        expect([0, 1, 2].map((b) => heard(m, b))).toEqual([440, 330, 440]);
    });

    it('takes turns between recordings of one note, counted for each note apart', () => {
        const zones = [{ file: 'n.wav', note: 'A4' }, { file: 'n2.wav', note: 'A4' }, { file: 'n3.wav', note: 'A4' }];
        const m = play(zones, FOUR('1', '1', '1', '1'));
        expect([0, 1, 2, 3].map((b) => heard(m, b))).toEqual([440, 550, 770, 440]);
        // Another note between does not use up a turn of this one.
        const mixed = play(zones, FOUR('1', "1'", '1', '1'));
        expect([0, 2, 3].map((b) => heard(mixed, b))).toEqual([440, 550, 770]);
        // Two recordings as near, one below and one above, are not turns of each other.
        const beside = [{ file: 'n.wav', note: 'G4' }, { file: 'n2.wav', note: 'B4' }];
        expect([0, 1, 2].map((t) => sampleZone({ samples: beside } as never, 69, 0, t).index)).toEqual([0, 0, 0]);
    });

    it('takes out how sharp a recording is said to be', () => {
        // Half a semitone sharp, and said so: it plays in tune. Unsaid, it is heard sharp.
        const tuned = play([{ file: 'sharp.wav', note: 'A4', tune: 50 }], '1 - - - - - - - . . . . . . . .').channels[0]!;
        const raw = play([{ file: 'sharp.wav', note: 'A4' }], '1 - - - - - - - . . . . . . . .').channels[0]!;
        expect(pitchOf(tuned, 44100, 0.05, 0.45)).toBeCloseTo(440, -0.5);
        expect(pitchOf(raw, 44100, 0.05, 0.45)).toBeGreaterThan(449);
    });
});
