// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * Music from instruments and patterns, held to what can be counted: which notes a line of steps is, when each sounds,
 * what pitch comes out, that a loop runs into itself and that the instruments written apart add up to the whole.
 */
import { describe, expect, it } from 'vitest';
import { applyMusicEdits, validateMusicSource, type MusicSource } from '../src/music/musicSource';
import { compileMusic, noteName, renderMusic } from '../src/music/musicRender';
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
        expect(round.channels[0]!.length).toBe(open.channels[0]!.length);
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
