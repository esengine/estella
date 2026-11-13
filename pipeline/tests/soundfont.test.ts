// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * A SoundFont read for the instruments in it, held to a file built here byte by byte: what comes out has to be the
 * recordings that went in, on the notes, ranges, tuning and loops its tables say, and has to play at those pitches.
 */
import { describe, expect, it } from 'vitest';
import { liftSoundFontPreset, readSoundFont } from '../src/music/soundFont';
import { validateMusicSource } from '../src/music/musicSource';
import { renderMusic } from '../src/music/musicRender';

const GEN = { attack: 34, release: 38, instrument: 41, keyRange: 43, velRange: 44, fineTune: 52, sampleId: 53, sampleModes: 54, rootKey: 58 };

function bytesOf(...parts: (Uint8Array | number[])[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
}
const u16 = (v: number): number[] => [v & 255, (v >> 8) & 255];
const u32 = (v: number): number[] => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];
const name20 = (text: string): number[] => Array.from({ length: 20 }, (_, i) => text.charCodeAt(i) || 0);
const chunk = (id: string, data: Uint8Array | number[]): Uint8Array => bytesOf([...id].map((c) => c.charCodeAt(0)), u32(data.length), data, data.length & 1 ? [0] : []);
const list = (type: string, ...chunks: Uint8Array[]): Uint8Array => chunk('LIST', bytesOf([...type].map((c) => c.charCodeAt(0)), ...chunks));
const range = (low: number, high: number): number => low | (high << 8);

interface Recording { name: string; hz: number; rate: number; frames: number; pitch: number; correction?: number; type?: number; link?: number; loop?: [number, number] }
type Zone = [number, number][];

/** A SoundFont of @p recordings, one instrument of @p zones (the first is what the others start from), and @p presets each a zone on that instrument. */
function soundFont(recordings: Recording[], zones: Zone[], presets: { name: string; bank: number; program: number; zone: Zone }[]): Uint8Array {
    const samples: number[] = [];
    const headers: number[] = [];
    for (const r of recordings) {
        const start = samples.length / 2;
        for (let n = 0; n < r.frames; n++) samples.push(...u16(Math.round(16000 * Math.sin((2 * Math.PI * r.hz * n) / r.rate)) & 0xffff));
        // The format asks for nothing after each recording.
        for (let n = 0; n < 46; n++) samples.push(0, 0);
        headers.push(...name20(r.name), ...u32(start), ...u32(start + r.frames), ...u32(start + (r.loop?.[0] ?? 0)), ...u32(start + (r.loop?.[1] ?? 0)), ...u32(r.rate), r.pitch, (r.correction ?? 0) & 255, ...u16(r.link ?? 0), ...u16(r.type ?? 1));
    }
    headers.push(...name20('EOS'), ...Array(26).fill(0));
    const bags = (all: Zone[]): [number[], number[]] => {
        const [bag, gen]: [number[], number[]] = [[], []];
        let at = 0;
        for (const zone of all) { bag.push(...u16(at), ...u16(0)); for (const [op, amount] of zone) { gen.push(...u16(op), ...u16(amount & 0xffff)); at++; } }
        bag.push(...u16(at), ...u16(0));
        gen.push(0, 0, 0, 0);
        return [bag, gen];
    };
    const [ibag, igen] = bags(zones);
    const [pbag, pgen] = bags(presets.map((p) => p.zone));
    const phdr = [...presets.flatMap((p, i) => [...name20(p.name), ...u16(p.program), ...u16(p.bank), ...u16(i), ...Array(12).fill(0)]), ...name20('EOP'), ...u16(0), ...u16(0), ...u16(presets.length), ...Array(12).fill(0)];
    const inst = [...name20('Keys'), ...u16(0), ...name20('EOI'), ...u16(zones.length)];
    return chunk('RIFF', bytesOf([...'sfbk'].map((c) => c.charCodeAt(0)),
        list('INFO', chunk('INAM', [...'Test Bank'].map((c) => c.charCodeAt(0)))),
        list('sdta', chunk('smpl', samples)),
        list('pdta', chunk('phdr', phdr), chunk('pbag', pbag), chunk('pmod', Array(10).fill(0)), chunk('pgen', pgen), chunk('inst', inst), chunk('ibag', ibag), chunk('imod', Array(10).fill(0)), chunk('igen', igen), chunk('shdr', headers))));
}

const RECORDINGS: Recording[] = [
    { name: 'Low A', hz: 220, rate: 22050, frames: 5512, pitch: 57 },
    { name: 'High A!', hz: 440, rate: 44100, frames: 13230, pitch: 60, loop: [4410, 8820] },
    { name: 'High A R', hz: 440, rate: 44100, frames: 100, pitch: 69, type: 2 },
];
const ZONES: Zone[] = [
    // What the others start from: let go over half a second.
    [[GEN.release, -1200]],
    [[GEN.keyRange, range(0, 63)], [GEN.sampleId, 0]],
    // Its header says C4; the zone says A4, a quarter of a semitone flat, and that it goes round.
    [[GEN.keyRange, range(64, 127)], [GEN.rootKey, 69], [GEN.fineTune, 25], [GEN.sampleModes, 1], [GEN.sampleId, 1]],
    [[GEN.keyRange, range(64, 127)], [GEN.sampleId, 2]],
];
const FONT = soundFont(RECORDINGS, ZONES, [
    { name: 'Test Keys', bank: 0, program: 4, zone: [[GEN.instrument, 0]] },
    { name: 'Top Only', bank: 0, program: 5, zone: [[GEN.keyRange, range(72, 96)], [GEN.instrument, 0]] },
]);

describe('a SoundFont read for its instruments', () => {
    it('lists the instruments in it, with their numbers and the notes they cover', () => {
        const font = readSoundFont(FONT);
        expect(font.name).toBe('Test Bank');
        expect(font.presets).toEqual([
            { index: 0, name: 'Test Keys', bank: 0, program: 4, recordings: 2, low: 0, high: 127 },
            { index: 1, name: 'Top Only', bank: 0, program: 5, recordings: 1, low: 72, high: 96 },
        ]);
    });

    it('lifts one out as samples: each recording with its note, range, tuning and loop', () => {
        const lifted = liftSoundFontPreset(readSoundFont(FONT), 0, 'assets/samples/keys/');
        expect(lifted.instrument).toEqual({
            release: 0.5,
            samples: [
                { file: 'assets/samples/keys/Low_A.wav', note: 'A3', low: 'C-1', high: 'D#4' },
                // A quarter of a semitone is added as it plays, which is a recording that much flat of A4.
                { file: 'assets/samples/keys/High_A.wav', note: 'A4', low: 'E4', high: 'G9', tune: -25, loop: [0.1, 0.2] },
            ],
        });
        // The recordings themselves, as long and at the rate they were, and the right-hand half left out.
        expect(Object.keys(lifted.files)).toEqual(['assets/samples/keys/Low_A.wav', 'assets/samples/keys/High_A.wav']);
        const low = lifted.files['assets/samples/keys/Low_A.wav']!;
        expect([low.rate, low.channels.length, low.channels[0]!.length]).toEqual([22050, 1, 5512]);
        expect(low.channels[0]![25]).toBeCloseTo((16000 / 32768) * Math.sin((2 * Math.PI * 220 * 25) / 22050), 3);
        expect(lifted.files['assets/samples/keys/High_A.wav']!.channels[0]!.length).toBe(13230);
        // And a music source takes it as it comes.
        expect(() => validateMusicSource({ tempo: 120, key: 'A', instruments: { keys: lifted.instrument }, patterns: { a: { bars: 1, tracks: { keys: '1 . . . . . . . . . . . . . . .' } } }, song: ['a'] })).not.toThrow();
    });

    it('plays at the pitches the SoundFont would', () => {
        const lifted = liftSoundFontPreset(readSoundFont(FONT), 0, 'k');
        const music = renderMusic(validateMusicSource({
            tempo: 120, key: 'A', humanize: 0, loop: false, instruments: { keys: lifted.instrument },
            patterns: { a: { bars: 2, tracks: { keys: "1, - - . . . . . 1 - - - - - - - | 1 - - - - - - - - - - - - - - -" } } }, song: ['a'],
        }), lifted.files);
        const pitch = (from: number, to: number): number => {
            const c = music.channels[0]!;
            let crossings = 0;
            for (let n = Math.floor(from * 44100) + 1; n < to * 44100; n++) if (c[n - 1]! <= 0 && c[n]! > 0) crossings++;
            return crossings / (to - from);
        };
        // The A below, from the low recording at half the rate.
        expect(pitch(0.05, 0.2)).toBeCloseTo(220, -1);
        // The A above, a quarter of a semitone up as the zone says: 446.4 Hz.
        expect(pitch(1.1, 1.9)).toBeGreaterThan(443);
        expect(pitch(1.1, 1.9)).toBeLessThan(450);
        // Held two seconds from a recording of three tenths, it goes round and is still sounding at the end.
        expect(pitch(3.2, 3.9)).toBeGreaterThan(443);
        // No recording is said to be a note it is not.
        expect(music.notes.join()).not.toMatch(/sounds as/);
    });

    it('keeps to the notes a preset gives an instrument', () => {
        const lifted = liftSoundFontPreset(readSoundFont(FONT), 1, 'k');
        expect(lifted.instrument.samples).toEqual([{ file: 'k/High_A.wav', note: 'A4', tune: -25, loop: [0.1, 0.2] }]);
    });

    it('says what is not a SoundFont, and what is not in one', () => {
        expect(() => readSoundFont(new Uint8Array(64))).toThrow(/not a SoundFont: it does not begin RIFF\.\.\.\.sfbk/);
        expect(() => readSoundFont(chunk('RIFF', bytesOf([...'sfbk'].map((c) => c.charCodeAt(0)))))).toThrow(/a SoundFont with no "smpl" table/);
        expect(() => liftSoundFontPreset(readSoundFont(FONT), 7, 'k')).toThrow(/there is no instrument 7 in this SoundFont; it has 2, numbered from 0/);
    });
});

describe('what a SoundFont does that an instrument of samples does not', () => {
    const TWO: Recording[] = [{ name: 'Pipe', hz: 220, rate: 44100, frames: 8820, pitch: 57 }, { name: 'Pipe Low', hz: 110, rate: 44100, frames: 8820, pitch: 45 }];

    it('keeps one of the recordings it plays together for a note, the one nearest its own pitch', () => {
        // Two ranks over the same keys: the second an octave down. And a third zone above them both, on its own.
        const font = soundFont(TWO, [
            [[GEN.keyRange, range(0, 80)], [51, -12], [GEN.sampleId, 0]],
            [[GEN.keyRange, range(0, 80)], [GEN.sampleId, 1]],
            [[GEN.keyRange, range(81, 127)], [GEN.sampleId, 0]],
        ], [{ name: 'Two Ranks', bank: 0, program: 19, zone: [[GEN.instrument, 0]] }]);
        const lifted = liftSoundFontPreset(readSoundFont(font), 0, 'o');
        expect(lifted.instrument.samples).toEqual([
            { file: 'o/Pipe_Low.wav', note: 'A2', low: 'C-1', high: 'G#5' },
            { file: 'o/Pipe.wav', note: 'A3', low: 'A5', high: 'G9' },
        ]);
        expect(lifted.notes.join()).toMatch(/plays 1 of its 3 zones on top of others, several recordings to one note; one is kept/);
        expect(Object.keys(lifted.files)).toEqual(['o/Pipe_Low.wav', 'o/Pipe.wav']);
    });

    it('takes an instrument set an octave down out at the pitch its recordings are, and says so', () => {
        const font = soundFont(TWO, [[[51, -12], [GEN.sampleId, 0]]], [{ name: 'Sub', bank: 0, program: 19, zone: [[GEN.instrument, 0]] }]);
        const lifted = liftSoundFontPreset(readSoundFont(font), 0, 'o');
        // The recording is of the A below middle C, and that is the note it is given: not the A above, as an octave of tuning would have it.
        expect(lifted.instrument.samples).toEqual([{ file: 'o/Pipe.wav', note: 'A3' }]);
        expect(lifted.notes).toEqual(['it is set 1 octave down in the SoundFont; the recordings are taken out at the pitch they are, so give the instrument octave: -1 to have it where the SoundFont had it']);
        // Tuning that is not whole octaves is the recording being another note, and moves it.
        const fifth = soundFont(TWO, [[[51, 7], [GEN.sampleId, 0]]], [{ name: 'Up', bank: 0, program: 19, zone: [[GEN.instrument, 0]] }]);
        expect(liftSoundFontPreset(readSoundFont(fifth), 0, 'o').instrument.samples).toEqual([{ file: 'o/Pipe.wav', note: 'D3' }]);
    });
});

describe('what comes over with a recording', () => {
    it('takes both sides of a recording made in stereo as one file of two', () => {
        // The left side links to the right, which is as long; the right is a zone of its own in the SoundFont and is not taken twice.
        const pair: Recording[] = [{ name: 'Wide L', hz: 220, rate: 44100, frames: 4410, pitch: 57, type: 4, link: 1 }, { name: 'Wide R', hz: 330, rate: 44100, frames: 4410, pitch: 57, type: 2, link: 0 }];
        const font = soundFont(pair, [[[GEN.sampleId, 0]], [[GEN.sampleId, 1]]], [{ name: 'Wide', bank: 0, program: 0, zone: [[GEN.instrument, 0]] }]);
        const lifted = liftSoundFontPreset(readSoundFont(font), 0, 'w');
        expect(lifted.instrument.samples).toEqual([{ file: 'w/Wide_L.wav', note: 'A3' }]);
        const data = lifted.files['w/Wide_L.wav']!;
        expect(data.channels).toHaveLength(2);
        // Each side is its own recording: 220 on the left, 330 on the right.
        expect(data.channels[0]![50]).toBeCloseTo((16000 / 32768) * Math.sin((2 * Math.PI * 220 * 50) / 44100), 3);
        expect(data.channels[1]![50]).toBeCloseTo((16000 / 32768) * Math.sin((2 * Math.PI * 330 * 50) / 44100), 3);
        // A left side whose other side is not as long is taken alone.
        const odd = soundFont([pair[0]!, { ...pair[1]!, frames: 100 }], [[[GEN.sampleId, 0]]], [{ name: 'Odd', bank: 0, program: 0, zone: [[GEN.instrument, 0]] }]);
        expect(liftSoundFontPreset(readSoundFont(odd), 0, 'w').files['w/Wide_L.wav']!.channels).toHaveLength(1);
    });

    it('carries how far a zone turns its recording down and how dull it leaves it, without a file for each', () => {
        const one: Recording[] = [{ name: 'Key', hz: 220, rate: 44100, frames: 4410, pitch: 57 }];
        // 8 is the filter, in hundredths of a semitone above 8.176 Hz: 9600 is 2093 Hz. 48 is tenths of a decibel down. 11 opens the filter as the note sounds.
        const font = soundFont(one, [
            [[GEN.keyRange, range(0, 59)], [GEN.velRange, range(0, 63)], [8, 9600], [48, 100], [GEN.sampleId, 0]],
            [[GEN.keyRange, range(0, 59)], [GEN.velRange, range(64, 127)], [GEN.sampleId, 0]],
            [[GEN.keyRange, range(60, 127)], [8, 9600], [11, 2400], [GEN.sampleId, 0]],
        ], [{ name: 'Keys', bank: 0, program: 0, zone: [[GEN.instrument, 0]] }]);
        const lifted = liftSoundFontPreset(readSoundFont(font), 0, 'k');
        expect(lifted.instrument.samples).toEqual([
            // Ten decibels down, of which four are taken: 0.63. And dull, at 2090 Hz.
            { file: 'k/Key.wav', note: 'A3', low: 'C-1', high: 'B3', dynamic: 'soft', gain: 0.63, cutoff: 2090 },
            { file: 'k/Key.wav', note: 'A3', low: 'C-1', high: 'B3' },
            // A filter that opens two octaves is taken an octave open.
            { file: 'k/Key.wav', note: 'A3', low: 'C4', high: 'G9', cutoff: 4190 },
        ]);
        expect(Object.keys(lifted.files)).toEqual(['k/Key.wav']);
        expect(() => validateMusicSource({ tempo: 120, key: 'A', instruments: { keys: lifted.instrument }, patterns: { a: { bars: 1, tracks: { keys: '1 . . . . . . . . . . . . . . .' } } }, song: ['a'] })).not.toThrow();
    });
});
