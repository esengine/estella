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
        // An instrument that is only ever struck as a drum has no note to be out of.
        expect(renderMusic(validateMusicSource({ tempo: 120, key: 'A', humanize: 0, instruments: { keys: { samples: [{ file: 'a.wav', note: 'C2' }] } }, patterns: { a: { bars: 1, tracks: { keys: 'x . . . x . . . . . . . . . . .' } } }, song: ['a'] }), files).notes).toEqual([]);
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
        expect(bad({ samples: [{ file: 'a.wav', note: 'C4', root: 'C4' }] })).toThrow(/unknown "root"; a sample has file, note, low, high, loop, dynamic, tune, gain, cutoff/);
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

describe('an introduction heard once before the round', () => {
    const FULL = '1 - - - 1 - - - 1 - - - 1 - - -';
    const instruments = { tone, click, low: tone, pad: tone, bass: tone };
    const tracks = { tone: FULL, pad: FULL.replace(/1/g, '3'), bass: FULL.replace(/1/g, '5,'), click: steps('x', '.', 'x') };
    const thin = { pattern: 'a', only: ['tone'] };

    it('says where the round begins, and meets itself there and not at the top of the file', () => {
        const m = renderMusic(piece(tracks, { loop: true, instruments, song: [thin, 'a', 'a', 'a'], intro: 1 }));
        // One bar of two seconds is the introduction.
        expect(m.loopStart).toBe(2);
        expect(m.seconds).toBe(8);
        // The round is full at both ends, and nothing is said of the thin bar before it.
        expect(m.join).toMatchObject({ begins: ['tone', 'click', 'pad', 'bass'], ends: ['tone', 'click', 'pad', 'bass'] });
        expect(m.notes.join()).not.toMatch(/meets itself/);
        // Without the introduction marked, the same song drops at the join and is told so.
        expect(renderMusic(piece(tracks, { loop: true, instruments, song: [thin, 'a', 'a', 'a'] })).notes.join()).toMatch(/meets itself/);
    });

    it('brings what rings past the end in where the round begins, and leaves the introduction as it was', () => {
        const long = { layers: [{ source: 'sine', freq: 440, length: 0.8, decay: 0.3 }] };
        const last = `${REST.slice(0, -1)}1`;
        // Three bars: silence, silence, and one long note on the last step of the last.
        const source = (intro?: number) => piece({ tone: REST }, {
            loop: true, instruments: { tone: long, click, low: tone },
            patterns: { a: { bars: 1, tracks: { click: REST } }, b: { bars: 1, tracks: { tone: last } } }, song: ['a', 'a', 'b'], ...(intro ? { intro } : {}),
        });
        const whole = renderMusic(source()).channels[0]!;
        const after = renderMusic(source(1)).channels[0]!;
        // With no introduction the tail is at the top of the file; with one it is at two seconds, and the top is silent.
        expect(level(whole, 44100, 0.05, 0.4)).toBeGreaterThan(0.05);
        expect(level(after, 44100, 0.05, 0.4)).toBeLessThan(1e-4);
        expect(level(after, 44100, 2.05, 2.4)).toBeGreaterThan(0.05);
        expect(after.length).toBe(whole.length);
    });

    it('refuses an introduction that leaves nothing to go round, or a piece that ends', () => {
        expect(() => piece(tracks, { loop: true, instruments, song: ['a', 'a'], intro: 2 })).toThrow(/intro must be how many of the song's first parts are heard once.*\(the song has 2\)/);
        expect(() => piece(tracks, { instruments, song: ['a', 'a'], intro: 1 })).toThrow(/intro is the part of a loop that is heard once/);
    });
});

describe('a line that is played and not only sounded', () => {
    const EIGHT = '1 - - - 1 - - - 1 - - - 1 - - -';

    it('moves evenly from the loudness one bar begins on to the next', () => {
        const source = validateMusicSource({
            tempo: 120, key: 'A', humanize: 0, instruments: { tone, other: tone },
            patterns: { a: { bars: 2, dynamics: { tone: [0.5, 1, 0.6] }, tracks: { tone: `${EIGHT} | ${EIGHT}`, other: `${EIGHT} | ${EIGHT}` } } }, song: ['a'],
        });
        const e = compileMusic(source).events;
        const of = (name: string): number[] => e.filter((x) => x.instrument === name).map((x) => Math.round(x.loud * 1000) / 1000);
        // Up through the first bar and down through the second, a quarter of the way at each beat.
        expect(of('tone')).toEqual([0.5, 0.625, 0.75, 0.875, 1, 0.9, 0.8, 0.7]);
        // An instrument with no line of its own is as written.
        expect(of('other')).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
        // And "all" is for every instrument that has none of its own.
        const all = compileMusic(validateMusicSource({ ...source, patterns: { a: { ...source.patterns.a!, dynamics: { all: [0.5], tone: [1] } } } })).events;
        expect([...new Set(all.filter((x) => x.instrument === 'other').map((x) => x.loud))]).toEqual([0.5]);
        expect([...new Set(all.filter((x) => x.instrument === 'tone').map((x) => x.loud))]).toEqual([1]);
    });

    it('is heard to rise and fall', () => {
        const m = renderMusic(validateMusicSource({
            tempo: 120, key: 'A', humanize: 0, loop: false, gain: 0.5, instruments: { tone },
            patterns: { a: { bars: 2, dynamics: { tone: [0.4, 1, 0.4] }, tracks: { tone: `${EIGHT} | ${EIGHT}` } } }, song: ['a'],
        })).channels[0]!;
        expect(level(m, 44100, 0.05, 0.4)).toBeLessThan(level(m, 44100, 2.05, 2.4) * 0.5);
        expect(level(m, 44100, 3.55, 3.9)).toBeLessThan(level(m, 44100, 2.05, 2.4) * 0.65);
    });

    it('takes a soft or a loud recording where the dynamics make a step soft or loud', () => {
        const recorded = (hz: number): SampleData => ({ rate: 44100, channels: [Float32Array.from({ length: 22050 }, (_, n) => 0.5 * Math.sin((2 * Math.PI * hz * n) / 44100))] });
        const m = renderMusic(validateMusicSource({
            tempo: 120, key: 'A', humanize: 0, loop: false,
            instruments: { keys: { samples: [{ file: 'n.wav', note: 'A4' }, { file: 's.wav', note: 'A4', dynamic: 'soft' }] } },
            patterns: { a: { bars: 2, dynamics: { keys: [0.5, 1] }, tracks: { keys: `1 - - . . . . . . . . . . . . . | 1 - - . . . . . . . . . . . . .` } } }, song: ['a'],
        }), { 'n.wav': recorded(440), 's.wav': recorded(330) }).channels[0]!;
        expect(pitchOf(m, 44100, 0.05, 0.3)).toBeCloseTo(330, -1);
        expect(pitchOf(m, 44100, 2.05, 2.3)).toBeCloseTo(440, -1);
    });

    it('slurs a note that runs straight on from the last, and strikes one that does not', () => {
        const source = (line: string, legato: unknown = true) => validateMusicSource({
            tempo: 120, key: 'A', humanize: 0, instruments: { tone: { ...tone, legato } }, patterns: { a: { bars: 1, tracks: { tone: line } } }, song: ['a'],
        });
        const slurs = (line: string): string => compileMusic(source(line)).events.map((e) => (e.slur ? 's' : '-') + (e.tied ? 't' : '-')).join(' ');
        // Four notes end to end: the first is struck, the rest come in under the one before.
        expect(slurs('1 - - - 2 - - - 3 - - - 4 - - -')).toBe('-t st st s-');
        // A silence between is a breath taken; an accent is a note struck; a chord is struck.
        expect(slurs('1 - - . 2 - - - 3! - - - [1 3] - - -')).toBe('-- -- -- -- --');
        // And an instrument without it strikes every note.
        expect(compileMusic(source('1 - - - 2 - - - 3 - - - 4 - - -', false)).events.some((e) => e.slur || e.tied)).toBe(false);
        expect(() => source(EIGHT, 2)).toThrow(/legato must be true, or the seconds one note takes to come in under the last/);
    });

    it('does not let the sound drop between slurred notes, where struck ones leave a gap', () => {
        // A slow attack, so a note struck afresh begins from nothing.
        const bowed = { layers: [{ source: 'sine', freq: 440, attack: 0.08 }], release: 0.02 };
        const play = (legato: boolean) => renderMusic(validateMusicSource({
            tempo: 120, key: 'A', humanize: 0, loop: false, gain: 0.5, instruments: { tone: { ...bowed, ...(legato ? { legato: 0.06 } : {}) } },
            patterns: { a: { bars: 1, tracks: { tone: '1 - - - 1 - - - 1 - - - 1 - - -' } } }, song: ['a'],
        })).channels[0]!;
        // The quietest fiftieth of a second round each join, against the level in the middle of a note.
        const dip = (c: Float32Array): number => {
            let low = Infinity;
            for (let t = 0.46; t < 0.56; t += 0.01) low = Math.min(low, level(c, 44100, t, t + 0.02));
            return low / level(c, 44100, 0.2, 0.4);
        };
        expect(dip(play(false))).toBeLessThan(0.45);
        expect(dip(play(true))).toBeGreaterThan(0.7);
    });

    it('takes a slurred recording from past its attack', () => {
        // A recording that begins with a second of 880 Hz... of a tenth, and is 440 after: the attack is the high part.
        const data: SampleData = { rate: 44100, channels: [Float32Array.from({ length: 44100 }, (_, n) => 0.5 * Math.sin((2 * Math.PI * (n < 3528 ? 880 : 440) * n) / 44100))] };
        const m = renderMusic(validateMusicSource({
            tempo: 120, key: 'A', humanize: 0, loop: false, instruments: { keys: { samples: [{ file: 'a.wav', note: 'A4' }], legato: 0.05 } },
            patterns: { a: { bars: 1, tracks: { keys: '1 - - - 1 - - - . . . . . . . .' } } }, song: ['a'],
        }), { 'a.wav': data }).channels[0]!;
        // The first note has the attack in it; the second, slurred, has none of it.
        expect(pitchOf(m, 44100, 0.005, 0.07)).toBeGreaterThan(800);
        expect(pitchOf(m, 44100, 0.6, 0.9)).toBeCloseTo(440, -1);
        expect(pitchOf(m, 44100, 0.56, 0.6)).toBeLessThan(500);
    });

    it('holds every note to the end of its bar under the pedal', () => {
        const pluck = { layers: [{ source: 'sine', freq: 440, decay: 3 }], release: 0.05 };
        const source = (pedal: boolean) => validateMusicSource({
            tempo: 120, key: 'A', humanize: 0, loop: false, gain: 0.5, instruments: { keys: { ...pluck, ...(pedal ? { pedal: true } : {}) } },
            patterns: { a: { bars: 2, tracks: { keys: `1 . . . 3 . . . . . . . . . . . | ${REST}` } } }, song: ['a'],
        });
        const e = compileMusic(source(true)).events;
        // Written a sixteenth each; the first rings two seconds to the bar line, the second a second and a half.
        expect(e.map((x) => [x.seconds, x.sounds])).toEqual([[0.125, 2], [0.125, 1.5]]);
        expect(compileMusic(source(false)).events.every((x) => x.sounds === undefined)).toBe(true);
        const [dry, wet] = [renderMusic(source(false)).channels[0]!, renderMusic(source(true)).channels[0]!];
        // Half a second after it is let go, the dry note is gone and the pedalled one is still there.
        expect(level(dry, 44100, 1, 1.4)).toBeLessThan(1e-4);
        expect(level(wet, 44100, 1, 1.4)).toBeGreaterThan(0.05);
        // And the pedal is lifted at the bar line: nothing is left in the second bar.
        expect(level(wet, 44100, 2.3, 3.9)).toBeLessThan(1e-3);
    });

    it('refuses dynamics that are not a loudness for each bar', () => {
        const bad = (dynamics: unknown) => () => validateMusicSource({ tempo: 120, key: 'A', instruments: { tone }, patterns: { a: { bars: 2, dynamics, tracks: { tone: `${EIGHT} | ${EIGHT}` } } }, song: ['a'] });
        expect(bad({ drums: [1] })).toThrow(/dynamics for "drums", which is not an instrument; the instruments are tone, or "all"/);
        expect(bad({ tone: [1, 1, 1, 1] })).toThrow(/one for each of its 2 bars and at most one more/);
        expect(bad({ tone: [1, 5] })).toThrow(/0\.1\.\.2 with 1 as written/);
        expect(bad({ all: [] })).toThrow(/how loud each bar begins/);
    });
});

describe('the whole, mixed and breathing', () => {
    const EIGHT = '1 - - - 1 - - - 1 - - - 1 - - -';
    /** How much of it lies at these pitches, from a quarter of a second in: the overtones of the note played, named one by one. */
    const energy = (c: Float32Array, rate: number, ...pitches: number[]): number => {
        let sum = 0;
        const [from, size] = [Math.round(rate * 0.25), 16384];
        for (const hz of pitches) {
            let [re, im] = [0, 0];
            for (let n = 0; n < size; n++) {
                const v = c[from + n]! * (0.5 - 0.5 * Math.cos((2 * Math.PI * n) / size));
                re += v * Math.cos((2 * Math.PI * hz * n) / rate); im += v * Math.sin((2 * Math.PI * hz * n) / rate);
            }
            sum += re * re + im * im;
        }
        return sum;
    };

    it('holds the loud moments down, so a quiet line comes up beside a loud one', () => {
        // One loud note, then quiet ones: what a compressor is for.
        const source = (compress?: number) => validateMusicSource({
            tempo: 120, key: 'A', humanize: 0, loop: false, stems: true, instruments: { tone, other: tone },
            patterns: { a: { bars: 2, dynamics: { tone: [1.6, 0.2, 0.2] }, tracks: { tone: `${EIGHT} | ${EIGHT}`, other: `1' - - - . . . . . . . . . . . . | ${REST}` } } },
            song: ['a'], ...(compress ? { master: { compress } } : {}),
        });
        const [plain, held] = [renderMusic(source()), renderMusic(source(0.8))];
        const quiet = (m: ReturnType<typeof renderMusic>): number => level(m.channels[0]!, m.rate, 3.1, 3.4) / m.peak;
        // By a third and more: 0.108 of full without it, 0.157 with.
        expect(quiet(held)).toBeGreaterThan(quiet(plain) * 1.3);
        // And the instruments written apart still add up to it.
        let worst = 0;
        for (let n = 0; n < held.channels[0]!.length; n += 5) worst = Math.max(worst, Math.abs(Object.values(held.stems!).reduce((s, stem) => s + stem[0]![n]!, 0) - held.channels[0]![n]!));
        expect(worst).toBeLessThan(1e-4);
    });

    it('takes the bottom off an instrument that has no need of it, and the top off one that sits behind', () => {
        const rich = { layers: [{ source: 'saw', freq: 110 }] };
        const play = (more: Record<string, unknown>) => renderMusic(validateMusicSource({
            tempo: 120, key: 'A', humanize: 0, loop: false, gain: 0.5, instruments: { tone: { ...rich, ...more } }, patterns: { a: { bars: 1, tracks: { tone: EIGHT } } }, song: ['a'],
        })).channels[0]!;
        const [plain, thin, dull] = [play({}), play({ lowcut: 800 }), play({ highcut: 800 })];
        // After the peak of each is brought to the same place, where the energy lies is what differs.
        // The note is the A of 110 Hz: its first three overtones against four of those round 3 kHz.
        const bottom = (c: Float32Array): number => energy(c, 44100, 110, 220, 330) / energy(c, 44100, 2200, 2750, 3300, 3850);
        expect(bottom(thin)).toBeLessThan(bottom(plain) * 0.02);
        expect(bottom(dull)).toBeGreaterThan(bottom(plain) * 20);
    });

    it('tilts the whole with the two shelves', () => {
        const rich = { layers: [{ source: 'saw', freq: 55 }] };
        const play = (master?: unknown) => renderMusic(validateMusicSource({
            tempo: 120, key: 'A', humanize: 0, loop: false, instruments: { tone: rich }, patterns: { a: { bars: 1, tracks: { tone: EIGHT } } }, song: ['a'], ...(master ? { master } : {}),
        })).channels[0]!;
        // The note is the A of 55 Hz: its fundamental against four of its overtones round 10 kHz. Nine decibels is eight times the energy.
        const tilt = (c: Float32Array): number => energy(c, 44100, 9900, 10450, 11000, 11550) / energy(c, 44100, 55);
        const plain = tilt(play());
        expect(tilt(play({ high: 9 })) / plain).toBeGreaterThan(5);
        expect(tilt(play({ high: 9 })) / plain).toBeLessThan(10);
        expect(plain / tilt(play({ low: 9 }))).toBeGreaterThan(4);
        // Both down together leave the top where it was beside the bottom, near enough.
        expect(tilt(play({ low: -9, high: -9 })) / plain).toBeGreaterThan(0.5);
        expect(tilt(play({ low: -9, high: -9 })) / plain).toBeLessThan(2.5);
        // And the middle is not touched by either.
        const middle = (c: Float32Array): number => energy(c, 44100, 880, 990) / energy(c, 44100, 1100, 1210);
        expect(middle(play({ low: 9, high: 9 })) / middle(play())).toBeCloseTo(1, 1);
    });

    it('gives and takes back time across a pattern, every instrument together, and ends where it was', () => {
        const source = (rubato: number) => validateMusicSource({
            tempo: 120, key: 'A', humanize: 0, rubato, instruments: { tone, other: tone },
            patterns: { a: { bars: 4, tracks: { tone: Array(4).fill(EIGHT).join(' | '), other: Array(4).fill(EIGHT).join(' | ') } } }, song: ['a', 'a'],
        });
        const [strict, free] = [compileMusic(source(0)), compileMusic(source(1))];
        const of = (m: ReturnType<typeof compileMusic>, name: string): number[] => m.events.filter((e) => e.instrument === name).map((e) => e.at);
        const [a, b] = [of(strict, 'tone'), of(free, 'tone')];
        // Held back as the phrase begins, made up by its middle, held back again toward its end.
        expect(b[1]! - a[1]!).toBeGreaterThan(0.02);
        expect(Math.abs(b[8]! - a[8]!)).toBeLessThan(1e-9);
        expect(b[13]! - a[13]!).toBeLessThan(-0.02);
        // Never so far that the notes change order, and by no more than a twelfth of the tempo.
        for (let n = 1; n < b.length; n++) expect(b[n]! - b[n - 1]!).toBeGreaterThan(0.5 * 0.9);
        // The second time through begins on the bar line, where it would have without it.
        expect(b[16]).toBeCloseTo(8, 9);
        expect(free.seconds).toBe(strict.seconds);
        // The two instruments are together at every note.
        expect(of(free, 'other')).toEqual(b);
        // And the notes still fill the time between them.
        const first = free.events.filter((e) => e.instrument === 'tone')[0]!;
        expect(first.seconds).toBeCloseTo(b[1]! - b[0]!, 9);
    });

    it('plays a sample as loud and as dull as it says', () => {
        const bright: SampleData = { rate: 44100, channels: [Float32Array.from({ length: 22050 }, (_, n) => { const t = (2 * Math.PI * 440 * n) / 44100; return 0.3 * Math.sin(t) + 0.3 * Math.sin(8 * t); })] };
        const play = (more: Record<string, unknown>) => renderMusic(validateMusicSource({
            tempo: 120, key: 'A', humanize: 0, loop: false, gain: 0.5, instruments: { keys: { samples: [{ file: 'a.wav', note: 'A4', ...more }] }, tone },
            patterns: { a: { bars: 1, tracks: { keys: '1 - - - . . . . . . . . . . . .', tone: '. . . . . . . . 1 - - - . . . .' } } }, song: ['a'],
        }), { 'a.wav': bright }).channels[0]!;
        // Beside a tone that is the same in both, half the gain is half as loud.
        const beside = (c: Float32Array): number => level(c, 44100, 0.1, 0.4) / level(c, 44100, 1.1, 1.4);
        expect(beside(play({ gain: 0.5 })) / beside(play({}))).toBeCloseTo(0.5, 1);
        const top = (c: Float32Array): number => energy(c, 44100, 3000, 4000) / energy(c, 44100, 400, 480);
        expect(top(play({ cutoff: 900 }))).toBeLessThan(top(play({})) * 0.05);
    });

    it('refuses a mix that is not one', () => {
        const bad = (more: Record<string, unknown>, instrument: Record<string, unknown> = {}) => () => validateMusicSource({ tempo: 120, key: 'A', instruments: { tone: { ...tone, ...instrument } }, patterns: { a: { bars: 1, tracks: { tone: EIGHT } } }, song: ['a'], ...more });
        expect(bad({ master: { compress: 2 } })).toThrow(/master\.compress must be 0\.\.1/);
        expect(bad({ master: { low: 20 } })).toThrow(/master\.low must be decibels, -12\.\.12/);
        expect(bad({ master: { limit: true } })).toThrow(/master has unknown "limit"; it takes compress, low, high/);
        expect(bad({ rubato: 3 })).toThrow(/rubato must be 0\.\.1/);
        expect(bad({}, { lowcut: 5 })).toThrow(/lowcut must be Hz, 20\.\.2000/);
        expect(bad({}, { highcut: 100 })).toThrow(/highcut must be Hz, 500\.\.20000/);
    });
});

describe('scales of five notes', () => {
    const five = (scale: string, line: string, more: Record<string, unknown> = {}, pattern: Record<string, unknown> = {}) => compileMusic(validateMusicSource({
        tempo: 120, key: 'A', scale, humanize: 0, instruments: { tone, low: { ...tone, follow: true } }, patterns: { a: { bars: 1, tracks: { tone: line }, ...pattern } }, song: ['a'], ...more,
    })).events.map((e) => noteName(e.midi!));
    const run = "1 2 3 4 5 1' 2' 5, . . . . . . . .";

    it('count their degrees to five, and begin the next octave again at 1', () => {
        // La do re mi sol: the five notes of the minor that a wuxia tune is made of.
        expect(five('yu', run)).toEqual(['A4', 'C5', 'D5', 'E5', 'G5', 'A5', 'C6', 'G4']);
        expect(five('pentatonicMinor', run)).toEqual(five('yu', run));
        // Do re mi sol la.
        expect(five('gong', run, { key: 'C' })).toEqual(['C4', 'D4', 'E4', 'G4', 'A4', 'C5', 'D5', 'A3']);
        expect(five('pentatonic', run, { key: 'C' })).toEqual(five('gong', run, { key: 'C' }));
        // The other three modes are the same five notes begun from re, mi and sol.
        expect(five('shang', '1 2 3 4 5 . . . . . . . . . . .', { key: 'D' })).toEqual(['D4', 'E4', 'G4', 'A4', 'C5']);
        expect(five('jue', '1 2 3 4 5 . . . . . . . . . . .', { key: 'E' })).toEqual(['E4', 'G4', 'A4', 'C5', 'D5']);
        expect(five('zhi', '1 2 3 4 5 . . . . . . . . . . .', { key: 'G' })).toEqual(['G4', 'A4', 'C5', 'D5', 'E5']);
    });

    it('cannot be written out of: a sixth degree is refused, and says why', () => {
        expect(() => five('yu', '1 2 6 . . . . . . . . . . . . .')).toThrow(/pattern "a", track "tone", bar 1: degree 6 is not in this scale, which has 5 notes: its degrees are 1\.\.5, and the next octave begins again at 1'/);
        expect(() => five('yu', '[1 3 7] . . . . . . . . . . . . . . .')).toThrow(/degree 7 is not in this scale/);
        // The same line is fine in a scale of seven.
        expect(five('minor', '1 2 6 . . . . . . . . . . . . .')).toEqual(['A4', 'B4', 'F5']);
        expect(() => five('yu', run, {}, { chords: [6] })).toThrow(/chords must be the degree of each bar's root, 1\.\.5/);
    });

    it('lets one instrument write in five notes over a piece that has seven', () => {
        const source = (tune: string) => validateMusicSource({
            tempo: 120, key: 'A', scale: 'minor', humanize: 0, instruments: { flute: { ...tone, scale: 'yu' }, low: { ...tone, follow: true } },
            patterns: { a: { bars: 1, chords: [6], tracks: { flute: tune, low: '[1 3 5] . . . . . . . . . . . . . . .' } } }, song: ['a'],
        });
        const e = compileMusic(source("1 2 3 4 5 1' . . . . . . . . . ."));
        // The flute counts five; the chord under it is F, which the flute could not play.
        expect(e.events.filter((x) => x.instrument === 'flute').map((x) => noteName(x.midi!))).toEqual(['A4', 'C5', 'D5', 'E5', 'G5', 'A5']);
        expect(e.events.filter((x) => x.instrument === 'low').map((x) => noteName(x.midi!))).toEqual(['F4', 'A4', 'C5']);
        expect(() => source('6 . . . . . . . . . . . . . . .')).toThrow(/track "flute", bar 1: degree 6 is not in this scale, which has 5 notes/);
        expect(() => validateMusicSource({ tempo: 120, key: 'A', instruments: { low: { ...tone, follow: true, scale: 'yu' } }, patterns: { a: { bars: 1, tracks: { low: REST } } }, song: ['a'] })).toThrow(/a scale of its own is for a line that does not follow/);
    });

    it('builds what follows a chord from the five notes, with roots on 4 and 5 below the tonic', () => {
        const follow = (chord: number): string[] => compileMusic(validateMusicSource({
            tempo: 120, key: 'A', scale: 'yu', humanize: 0, instruments: { low: { ...tone, follow: true } },
            patterns: { a: { bars: 1, chords: [chord], tracks: { low: '[1 3 5] . . . . . . . . . . . . . . .' } } }, song: ['a'],
        })).events.map((e) => noteName(e.midi!));
        // Every other note of the five from the root: fourths and fifths, the open sound of the style.
        expect(follow(1)).toEqual(['A4', 'D5', 'G5']);
        expect(follow(3)).toEqual(['D5', 'G5', 'C6']);
        expect(follow(4)).toEqual(['E4', 'A4', 'D5']);
        expect(follow(5)).toEqual(['G4', 'C5', 'E5']);
    });
});
