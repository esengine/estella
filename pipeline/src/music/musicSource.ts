// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  musicSource.ts — a piece of music as what it is made of: instruments, the patterns they play, and the order
 *        the patterns come in.
 *
 *        An instrument is the layers of a sound (soundSource.ts), written as it sounds at A above middle C; a note
 *        strikes it at another pitch for as long as the note lasts. A pattern is a few bars, each track a line of
 *        steps. A step is a degree of the key and not a pitch in Hz, so a line written without accidentals cannot
 *        leave the key, and a track that follows the bar's chord cannot leave the chord's scale either. What is saved
 *        is this description; the `.wav` a game plays is made from it.
 *
 *        Layers make sounds that are plainly made. An instrument that has to pass for a real one is recordings of it:
 *        a few notes of a piano or a section of strings, each played back faster or slower for the notes round it.
 */
import { validateSoundSource, type SoundLayer } from '../sound/soundSource';

export const MUSIC_SOURCE_EXT = '.esmusic';
export const MUSIC_SOURCE_VERSION = 1;
export const MAX_MUSIC_SECONDS = 240;

/** Semitones above the tonic of each of a scale's seven degrees. */
export const SCALES = {
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
    dorian: [0, 2, 3, 5, 7, 9, 10],
    phrygian: [0, 1, 3, 5, 7, 8, 10],
    lydian: [0, 2, 4, 6, 7, 9, 11],
    mixolydian: [0, 2, 4, 5, 7, 9, 10],
    harmonic: [0, 2, 3, 5, 7, 8, 11],
} as const;
export type ScaleName = keyof typeof SCALES;

const TONICS: Record<string, number> = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };

/** One recording of an instrument playing one note. */
export interface MusicSample {
    /** A project path to the recording. */
    file: string;
    /** The note it is a recording of: "C4" is middle C, "F#3", "Bb2"; or its number, 60 being middle C. */
    note: string | number;
    /** The notes it plays, lowest to highest. Left out, each note is played by the recording nearest it. */
    low?: string | number;
    high?: string | number;
    /** For a note held longer than the recording: true goes round its steady middle, [from, to] round those seconds of it. A piano dies of itself and has none. */
    loop?: boolean | readonly [number, number];
}

export interface MusicInstrument {
    /** The layers of its sound at A above middle C (440 Hz): a sine at 440 is its fundamental, one at 880 the octave over it. A layer with no `length` lasts as long as the note; one with a `length` (the knock at the front of a pluck, a drum) keeps its own. */
    layers?: readonly SoundLayer[];
    /** In place of layers: recordings of the instrument, each played faster or slower for the notes round it. The further a note is from its recording the less it is the instrument, so a recording every three or four semitones. */
    samples?: readonly MusicSample[];
    /** Samples: seconds a note takes to come in. Default 0.003. */
    attack?: number;
    /** Loudness against the other instruments. Default 1. */
    gain?: number;
    /** -1 is left, 1 is right. Default 0. */
    pan?: number;
    /** Octaves up or down from where its notes are written: a bass is -2. Default 0. */
    octave?: number;
    /** Its degrees count from the root of the bar's chord: 1 is the root, 3 the third, 5 the fifth, whatever the chord. A bass or a pad that follows is written once and moves with the chords. */
    follow?: boolean;
    /** Seconds a held note takes to die after it is let go. Default 0.08. */
    release?: number;
    /** How much of it goes to the room, 0..1. Default 0.3; a bass or a kick wants 0. */
    reverb?: number;
}

export interface MusicPattern {
    bars: number;
    /** Steps to a beat. Default 4, which is sixteenths; 3 is triplets; 2 is eighths. */
    div?: number;
    /** The chord of each bar, as the degree its root is on: [1, 6, 3, 7]. Fewer than the bars come round again. Only instruments that `follow` hear them. */
    chords?: readonly number[];
    /**
     * A line of steps for each instrument that plays, separated by spaces, bars by `|`. A step is: `.` silence; `-` the
     * note before, still held; a degree 1..7 with `'` for each octave up and `,` for each down, `#` or `b` before it to
     * leave the key by a semitone; `[1 3 5]` several at once; `x` the instrument at its own pitch, for a drum. `!` after
     * a step makes it louder and `?` softer.
     */
    tracks: Readonly<Record<string, string>>;
}

export type SongPart = string | { pattern: string; without?: readonly string[]; only?: readonly string[] };

export interface MusicSource {
    version?: number;
    /** Beats a minute. */
    tempo: number;
    /** Beats to a bar. Default 4. */
    beats?: number;
    /** The tonic: C, F#, Bb. */
    key: string;
    /** Default minor. */
    scale?: ScaleName;
    /** Every second step comes late by this share of a step, 0..0.6. 0.33 is a shuffle. */
    swing?: number;
    /** How unlike a machine: timing and loudness off by a little at random, 0..1. Default 0.15. */
    humanize?: number;
    seed?: number;
    instruments: Readonly<Record<string, MusicInstrument>>;
    patterns: Readonly<Record<string, MusicPattern>>;
    /** The patterns in the order they come, each whole, or with some instruments left out or only some kept. */
    song: readonly SongPart[];
    /**
     * What rings past the end comes in at the start, so the piece runs into itself. Default true. False is a piece
     * with an end: its last notes and the room ring out after the last bar, and the file is that much longer.
     */
    loop?: boolean;
    /** Seconds over which it comes up from nothing at its start. A loop comes round to its start again and again, so only a piece that ends has one; a game fades a loop in as it starts it. */
    fadeIn?: number;
    /** Seconds before the end of the last bar over which it goes down to nothing, for a piece that ends and has no ending written. */
    fadeOut?: number;
    /** Also a file for each instrument, which add up to the whole: a game brings them in and out. */
    stems?: boolean;
    /** The room it is all in: `size` 0..1, `mix` 0..1. */
    reverb?: { size?: number; mix?: number };
    /** How loud the loudest moment is, 1 being full. Default 0.9. */
    gain?: number;
    rate?: number;
}

/** One sounding in a step: a degree, or the instrument's own pitch. */
export interface StepNote { degree: number; alter: number; octave: number }
export type Step =
    | { kind: 'rest' }
    | { kind: 'hold' }
    | { kind: 'hit'; loud: number }
    | { kind: 'notes'; loud: number; notes: StepNote[] };

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const between = (v: unknown, lo: number, hi: number): boolean => isNum(v) && v >= lo && v <= hi;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const NAME = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;

export const tonicOf = (key: string): number => TONICS[key]!;

/** "C4" as its number, 60; a number as itself. Null for what is neither. */
export function midiOf(note: unknown): number | null {
    if (typeof note === 'number') return Number.isInteger(note) && note >= 0 && note <= 127 ? note : null;
    const m = typeof note === 'string' ? /^([A-G](?:#|b)?)(-?\d)$/.exec(note) : null;
    if (!m || TONICS[m[1]!] === undefined) return null;
    const midi = TONICS[m[1]!]! + 12 * (Number(m[2]) + 1);
    return midi >= 0 && midi <= 127 ? midi : null;
}

/** The recordings a source plays, each once. */
export function musicSampleFiles(source: MusicSource): string[] {
    return [...new Set(Object.values(source.instruments).flatMap((i) => (i.samples ?? []).map((s) => s.file)))];
}

const loudOf = (mark: string): number => (mark === '!' ? 1.3 : mark === '?' ? 0.6 : 1);

function noteOf(text: string): StepNote | null {
    const m = /^([#b]?)([1-7])([',]*)$/.exec(text);
    if (!m) return null;
    let octave = 0;
    for (const c of m[3]!) octave += c === "'" ? 1 : -1;
    return { degree: Number(m[2]), alter: m[1] === '#' ? 1 : m[1] === 'b' ? -1 : 0, octave };
}

/** A track's line as steps, bar by bar. Throws saying which bar is wrong and why. */
export function parseTrack(text: string, bars: number, stepsToBar: number, where: string): Step[] {
    const out: Step[] = [];
    const written = text.split('|').map((b) => b.trim());
    if (written.at(-1) === '') written.pop();
    if (written.length !== bars) throw new Error(`${where} has ${written.length} bar${written.length === 1 ? '' : 's'} between its | marks; the pattern is ${bars}`);
    written.forEach((bar, b) => {
        // A chord's notes are kept together through the split on spaces.
        const tokens = bar.replace(/\[([^\]]*)\]/g, (_, inner: string) => `[${inner.trim().split(/\s+/).join('+')}]`).split(/\s+/).filter((t) => t !== '');
        if (tokens.length !== stepsToBar) throw new Error(`${where}, bar ${b + 1} has ${tokens.length} steps; a bar here is ${stepsToBar}. Write "." for a silent step and "-" for one that holds the note before`);
        for (const token of tokens) {
            const mark = token.endsWith('!') || token.endsWith('?') ? token.slice(-1) : '';
            const body = mark ? token.slice(0, -1) : token;
            if (body === '.') out.push({ kind: 'rest' });
            else if (body === '-') out.push({ kind: 'hold' });
            else if (body === 'x') out.push({ kind: 'hit', loud: loudOf(mark) });
            else {
                const parts = body.startsWith('[') && body.endsWith(']') ? body.slice(1, -1).split('+') : [body];
                const notes = parts.map(noteOf);
                if (notes.length === 0 || notes.length > 6 || notes.some((n) => n === null)) {
                    throw new Error(`${where}, bar ${b + 1}: "${token.replace(/\+/g, ' ')}" is not a step. A step is . (silence), - (hold), x (a drum), a degree 1..7 with ' or , for octaves and # or b before it, or [1 3 5] for up to six at once`);
                }
                out.push({ kind: 'notes', loud: loudOf(mark), notes: notes as StepNote[] });
            }
        }
    });
    return out;
}

const SOURCE_FIELDS = ['version', 'tempo', 'beats', 'key', 'scale', 'swing', 'humanize', 'seed', 'instruments', 'patterns', 'song', 'loop', 'fadeIn', 'fadeOut', 'stems', 'reverb', 'gain', 'rate'];
const INSTRUMENT_FIELDS = ['layers', 'samples', 'attack', 'gain', 'pan', 'octave', 'follow', 'release', 'reverb'];
const RECORDING = /\.(wav|ogg|mp3|flac|m4a|aac|webm)$/i;

function checkSamples(samples: unknown, where: string): void {
    if (!Array.isArray(samples) || samples.length === 0 || samples.length > 64) throw new Error(`${where}: samples must be 1..64 of { file, note }`);
    samples.forEach((sample: unknown, i) => {
        const at = `${where}, sample ${i + 1}`;
        if (!isObj(sample)) throw new Error(`${at} must be { file, note }`);
        for (const key of Object.keys(sample)) if (!['file', 'note', 'low', 'high', 'loop'].includes(key)) throw new Error(`${at} has unknown "${key}"; a sample has file, note, low, high, loop`);
        if (typeof sample.file !== 'string' || !RECORDING.test(sample.file)) throw new Error(`${at}: file must be a project path to a recording (.wav, .ogg, .mp3, .flac, .m4a)`);
        if (midiOf(sample.note) === null) throw new Error(`${at}: note must be the note recorded, as "C4", "F#3" or "Bb2" (C4 is middle C), or its number 0..127`);
        for (const key of ['low', 'high']) if (sample[key] !== undefined && midiOf(sample[key]) === null) throw new Error(`${at}: ${key} must be a note, as "C4"`);
        if (sample.low !== undefined && sample.high !== undefined && midiOf(sample.low)! > midiOf(sample.high)!) throw new Error(`${at}: low is above high`);
        const loop = sample.loop;
        if (loop !== undefined && typeof loop !== 'boolean' && !(Array.isArray(loop) && loop.length === 2 && isNum(loop[0]) && isNum(loop[1]) && loop[0] >= 0 && loop[1] > loop[0] + 0.02)) {
            throw new Error(`${at}: loop must be true, or [from, to] in seconds with to past from`);
        }
    });
}
const PATTERN_FIELDS = ['bars', 'div', 'chords', 'tracks'];

/** Seconds the song lasts, before anything that rings past its end. */
export function musicSeconds(source: MusicSource): number {
    const bar = ((source.beats ?? 4) * 60) / source.tempo;
    return source.song.reduce((sum, part) => sum + source.patterns[typeof part === 'string' ? part : part.pattern]!.bars * bar, 0);
}

/** The source if it is well formed; otherwise throws, naming the instrument, the pattern, the track and the bar. */
export function validateMusicSource(raw: unknown): MusicSource {
    if (!isObj(raw)) throw new Error('a music source must be { tempo, key, instruments, patterns, song }');
    const s = raw;
    for (const key of Object.keys(s)) if (!SOURCE_FIELDS.includes(key)) throw new Error(`unknown field "${key}"; music has ${SOURCE_FIELDS.join(', ')}`);
    if (s.version !== undefined && s.version !== MUSIC_SOURCE_VERSION) throw new Error(`version ${String(s.version)} is not one this editor reads (${MUSIC_SOURCE_VERSION})`);
    if (!between(s.tempo, 30, 300)) throw new Error('tempo must be beats a minute, 30..300');
    if (s.beats !== undefined && !(Number.isInteger(s.beats) && between(s.beats, 2, 12))) throw new Error('beats must be a whole number to the bar, 2..12');
    if (typeof s.key !== 'string' || TONICS[s.key] === undefined) throw new Error(`key must be a tonic: ${Object.keys(TONICS).join(', ')}`);
    if (s.scale !== undefined && !(typeof s.scale === 'string' && s.scale in SCALES)) throw new Error(`scale must be one of ${Object.keys(SCALES).join(', ')}`);
    if (s.swing !== undefined && !between(s.swing, 0, 0.6)) throw new Error('swing must be 0..0.6');
    if (s.humanize !== undefined && !between(s.humanize, 0, 1)) throw new Error('humanize must be 0..1');
    if (s.seed !== undefined && !Number.isInteger(s.seed)) throw new Error('seed must be a whole number');
    if (s.gain !== undefined && !between(s.gain, 0, 1)) throw new Error('gain must be 0..1');
    if (s.rate !== undefined && ![22050, 44100, 48000].includes(s.rate as number)) throw new Error('rate must be one of 22050, 44100, 48000');
    for (const key of ['loop', 'stems']) if (s[key] !== undefined && typeof s[key] !== 'boolean') throw new Error(`${key} must be true or false`);
    if (s.reverb !== undefined) {
        if (!isObj(s.reverb)) throw new Error('reverb must be { size?, mix? }');
        for (const key of Object.keys(s.reverb)) if (!['size', 'mix'].includes(key)) throw new Error(`reverb has unknown "${key}"; it takes size, mix`);
        if (s.reverb.size !== undefined && !between(s.reverb.size, 0, 1)) throw new Error('reverb.size must be 0..1');
        if (s.reverb.mix !== undefined && !between(s.reverb.mix, 0, 1)) throw new Error('reverb.mix must be 0..1');
    }

    if (!isObj(s.instruments) || Object.keys(s.instruments).length === 0) throw new Error('instruments must be { name: { layers: [...] } }, at least one');
    if (Object.keys(s.instruments).length > 16) throw new Error('at most 16 instruments');
    for (const [name, value] of Object.entries(s.instruments)) {
        const where = `instrument "${name}"`;
        if (!NAME.test(name)) throw new Error(`${where}: a name is a letter, then letters, digits, _ or -`);
        if (!isObj(value)) throw new Error(`${where} must be { layers: [...] }`);
        for (const key of Object.keys(value)) if (!INSTRUMENT_FIELDS.includes(key)) throw new Error(`${where} has unknown "${key}"; an instrument has ${INSTRUMENT_FIELDS.join(', ')}`);
        if ((value.layers === undefined) === (value.samples === undefined)) throw new Error(`${where} needs layers (a made sound) or samples (recordings), one of the two`);
        if (value.samples !== undefined) checkSamples(value.samples, where);
        else {
            try {
                // Its layers are a sound's layers, and are wrong in the same ways.
                validateSoundSource({ duration: 8, layers: value.layers });
            } catch (e) {
                throw new Error(`${where}: ${(e as Error).message}`);
            }
        }
        if (value.attack !== undefined && !(value.samples !== undefined && between(value.attack, 0, 2))) throw new Error(`${where}: attack is for samples, seconds 0..2; layers have their own`);
        if (value.gain !== undefined && !between(value.gain, 0, 4)) throw new Error(`${where}: gain must be 0..4`);
        if (value.pan !== undefined && !between(value.pan, -1, 1)) throw new Error(`${where}: pan must be -1..1`);
        if (value.octave !== undefined && !(Number.isInteger(value.octave) && between(value.octave, -4, 4))) throw new Error(`${where}: octave must be a whole number, -4..4`);
        if (value.follow !== undefined && typeof value.follow !== 'boolean') throw new Error(`${where}: follow must be true or false`);
        if (value.release !== undefined && !between(value.release, 0, 4)) throw new Error(`${where}: release must be seconds, 0..4`);
        if (value.reverb !== undefined && !between(value.reverb, 0, 1)) throw new Error(`${where}: reverb must be 0..1`);
    }

    const beats = (s.beats as number | undefined) ?? 4;
    if (!isObj(s.patterns) || Object.keys(s.patterns).length === 0) throw new Error('patterns must be { name: { bars, tracks: { instrument: "steps" } } }, at least one');
    for (const [name, value] of Object.entries(s.patterns)) {
        const where = `pattern "${name}"`;
        if (!NAME.test(name)) throw new Error(`${where}: a name is a letter, then letters, digits, _ or -`);
        if (!isObj(value)) throw new Error(`${where} must be { bars, tracks }`);
        for (const key of Object.keys(value)) if (!PATTERN_FIELDS.includes(key)) throw new Error(`${where} has unknown "${key}"; a pattern has ${PATTERN_FIELDS.join(', ')}`);
        if (!(Number.isInteger(value.bars) && between(value.bars, 1, 32))) throw new Error(`${where}: bars must be a whole number, 1..32`);
        if (value.div !== undefined && !(Number.isInteger(value.div) && between(value.div, 1, 8))) throw new Error(`${where}: div must be whole steps to a beat, 1..8`);
        if (value.chords !== undefined) {
            if (!Array.isArray(value.chords) || value.chords.length === 0 || value.chords.length > (value.bars as number) || value.chords.some((c) => !(Number.isInteger(c) && c >= 1 && c <= 7))) {
                throw new Error(`${where}: chords must be the degree of each bar's root, 1..7, no more of them than bars`);
            }
        }
        if (!isObj(value.tracks) || Object.keys(value.tracks).length === 0) throw new Error(`${where}: tracks must be { instrument: "steps" }, at least one`);
        for (const [track, line] of Object.entries(value.tracks)) {
            if (!(track in s.instruments)) throw new Error(`${where} has a track for "${track}", which is not an instrument; the instruments are ${Object.keys(s.instruments).join(', ')}`);
            if (typeof line !== 'string') throw new Error(`${where}, track "${track}" must be a line of steps`);
            parseTrack(line, value.bars as number, beats * ((value.div as number | undefined) ?? 4), `${where}, track "${track}"`);
        }
    }

    if (!Array.isArray(s.song) || s.song.length === 0 || s.song.length > 64) throw new Error('song must be the patterns in order, 1..64 of them');
    s.song.forEach((part, i) => {
        const name = typeof part === 'string' ? part : isObj(part) ? part.pattern : undefined;
        if (typeof name !== 'string' || !(name in (s.patterns as object))) throw new Error(`song part ${i + 1}: "${String(name)}" is not a pattern; the patterns are ${Object.keys(s.patterns as object).join(', ')}`);
        if (isObj(part)) {
            for (const key of Object.keys(part)) if (!['pattern', 'without', 'only'].includes(key)) throw new Error(`song part ${i + 1} has unknown "${key}"; it takes pattern, without, only`);
            if (part.without !== undefined && part.only !== undefined) throw new Error(`song part ${i + 1}: give without or only, not both`);
            for (const key of ['without', 'only']) {
                const list = part[key];
                if (list === undefined) continue;
                if (!Array.isArray(list) || list.some((n) => typeof n !== 'string' || !(n in (s.instruments as object)))) throw new Error(`song part ${i + 1}: ${key} must be a list of instruments (${Object.keys(s.instruments as object).join(', ')})`);
            }
        }
    });
    const source = s as unknown as MusicSource;
    const seconds = musicSeconds(source);
    for (const key of ['fadeIn', 'fadeOut'] as const) {
        if (s[key] === undefined) continue;
        if (s.loop !== false) throw new Error(`${key} is for a piece that ends (loop: false). A loop comes round to its start with no gap, and a fade written into it would be heard every time round: the game fades it, playBGM(url, { fadeIn }) to start it and stopBGM(seconds) to end it`);
        if (!(isNum(s[key]) && (s[key] as number) > 0 && (s[key] as number) <= seconds)) throw new Error(`${key} must be seconds, above 0 and no longer than the piece (${Math.round(seconds * 10) / 10} s)`);
    }
    if (seconds > MAX_MUSIC_SECONDS) throw new Error(`the song lasts ${Math.round(seconds)} s; at most ${MAX_MUSIC_SECONDS}`);
    return source;
}

export type MusicEdit =
    | { op: 'instrument'; name: string; value: MusicInstrument | null }
    | { op: 'pattern'; name: string; value: MusicPattern | null }
    | { op: 'track'; pattern: string; track: string; steps: string | null }
    | { op: 'settings'; fields: Record<string, unknown> };

/** The source with @p edits made in order, checked as a whole. A bad edit changes nothing. */
export function applyMusicEdits(source: MusicSource, edits: readonly MusicEdit[]): MusicSource {
    const next = JSON.parse(JSON.stringify(source)) as Record<string, unknown> & { instruments: Record<string, unknown>; patterns: Record<string, { tracks: Record<string, string> }> };
    edits.forEach((edit, i) => {
        const where = `edit ${i + 1}`;
        if (!isObj(edit)) throw new Error(`${where} must be { op, ... }`);
        if (edit.op === 'instrument' || edit.op === 'pattern') {
            const into = edit.op === 'instrument' ? next.instruments : next.patterns;
            if (typeof edit.name !== 'string') throw new Error(`${where}: name the ${edit.op}`);
            if (edit.value === null) {
                if (!(edit.name in into)) throw new Error(`${where}: there is no ${edit.op} "${edit.name}"; there are ${Object.keys(into).join(', ')}`);
                delete into[edit.name];
            } else (into as Record<string, unknown>)[edit.name] = edit.value;
        } else if (edit.op === 'track') {
            const pattern = next.patterns[edit.pattern];
            if (!pattern) throw new Error(`${where}: there is no pattern "${edit.pattern}"; there are ${Object.keys(next.patterns).join(', ')}`);
            if (edit.steps === null) delete pattern.tracks[edit.track];
            else pattern.tracks[edit.track] = edit.steps;
        } else if (edit.op === 'settings') {
            if (!isObj(edit.fields)) throw new Error(`${where}: settings needs fields`);
            for (const [key, value] of Object.entries(edit.fields)) {
                if (['instruments', 'patterns'].includes(key)) throw new Error(`${where}: change ${key} with the ${key.slice(0, -1)} op`);
                if (value === null) delete next[key];
                else next[key] = value;
            }
        } else throw new Error(`${where}: op must be instrument, pattern, track or settings`);
    });
    return validateMusicSource(next);
}
