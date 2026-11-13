// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  musicRender.ts — a music source worked out into the notes it plays, and the notes into samples.
 *
 *        Two steps, and the first is worth having on its own: `compileMusic` turns patterns of steps into notes with a
 *        time, a length and a pitch, which is what a picture of the piece is drawn from and what can be checked without
 *        hearing anything. `renderMusic` then strikes each instrument's layers once for every note (soundRender.ts) and
 *        sums them, each instrument on its own bus so the buses can be written out apart.
 *
 *        A piece that loops is not faded into itself: what rings past its end is added to its start, which is what
 *        would be heard had it been playing round already.
 */
import { fft } from '../sound/soundPicture';
import { placeResponse, renderSound } from '../sound/soundRender';
import type { SoundLayer } from '../sound/soundSource';
import { midiOf, musicSeconds, parseTrack, SCALES, tonicOf, type MusicInstrument, type MusicSource } from './musicSource';

/** A recording as samples: what an instrument made of recordings plays from. */
export interface SampleData { rate: number; channels: readonly Float32Array[] }

export interface MusicEvent {
    instrument: string;
    /** Seconds from the start of the piece, and how long it is held. */
    at: number;
    seconds: number;
    /** The note, 60 being middle C; null for an instrument struck at its own pitch. */
    midi: number | null;
    loud: number;
    /** Which part of the song it is in. */
    part: number;
    /** Written with # or b: outside the key. */
    outside: boolean;
    /** Softer (-1) or louder (1) than the rest by its mark and by where it lies in the dynamics; 0 for neither. */
    mark: -1 | 0 | 1;
    /** How loud it is written, by its mark and the dynamics, before the hand's unevenness. */
    hard: number;
    /** How long it sounds, where that is longer than it is written: held on by the pedal to the end of its bar. */
    sounds?: number;
    /** It comes in under the note before it and is not struck afresh. */
    slur?: boolean;
    /** The note after it comes in under it, and it stays a moment longer for that. */
    tied?: boolean;
}

export interface CompiledMusic {
    seconds: number;
    barSeconds: number;
    events: MusicEvent[];
    parts: { pattern: string; at: number; bars: number }[];
    notes: string[];
}

export interface RenderedMusic extends CompiledMusic {
    rate: number;
    /** Left, right. */
    channels: Float32Array[];
    peak: number;
    rms: number;
    /** For a loop with an introduction: seconds into the file that it comes back to. 0 where the whole of it goes round. */
    loopStart: number;
    /** For a piece that ends: seconds it rings on after its last bar, which the file is longer by. */
    tailSeconds: number;
    /** For a loop: what sounds in its last bar and in its first, and how loud each is, in decibels beside the whole. Null for a piece that ends. */
    join: { ends: string[]; begins: string[]; endDb: number; startDb: number } | null;
    /** Each instrument alone, when the source asks for stems: they add up to `channels`. */
    stems: Record<string, Float32Array[]> | null;
    /** What each instrument played, and how loud it is beside the whole, in decibels. */
    instruments: Record<string, { notes: number; low?: string; high?: string; levelDb: number }>;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const noteName = (midi: number): string => `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;

function randomOf(seed: number): () => number {
    let s = (seed * 2654435761 + 0x9e3779b9) >>> 0;
    return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 2147483648 - 1;
    };
}

/** The notes a validated source plays, in the order they begin. */
export function compileMusic(source: MusicSource): CompiledMusic {
    const beats = source.beats ?? 4;
    const barSeconds = (beats * 60) / source.tempo;
    const scale = SCALES[source.scale ?? 'minor'];
    const tonic = tonicOf(source.key);
    const human = source.humanize ?? 0.15;
    const random = randomOf(source.seed ?? 1);
    const events: MusicEvent[] = [];
    const parts: CompiledMusic['parts'] = [];
    const notes: string[] = [];
    const said = new Set<string>();
    const say = (text: string): void => { if (!said.has(text)) { said.add(text); notes.push(text); } };
    const played = new Set<string>();
    const used = new Set<string>();
    let at = 0;

    source.song.forEach((part, p) => {
        const name = typeof part === 'string' ? part : part.pattern;
        const pattern = source.patterns[name]!;
        used.add(name);
        parts.push({ pattern: name, at, bars: pattern.bars });
        const div = pattern.div ?? 4;
        const stepsToBar = beats * div;
        const step = barSeconds / stepsToBar;
        const before = events.length;
        for (const [track, line] of Object.entries(pattern.tracks)) {
            if (typeof part !== 'string' && (part.without?.includes(track) || (part.only && !part.only.includes(track)))) continue;
            const instrument = source.instruments[track]!;
            if (instrument.follow && !pattern.chords) say(`"${track}" follows the chords, and pattern "${name}" has none: it plays every bar on chord 1`);
            const steps = parseTrack(line, pattern.bars, stepsToBar, `pattern "${name}", track "${track}"`);
            // How loud the line is at each step: between the number its bar begins on and the next bar's.
            const levels = pattern.dynamics?.[track] ?? pattern.dynamics?.all;
            const levelAt = (i: number): number => {
                if (!levels) return 1;
                const bar = i / stepsToBar;
                const [a, b] = [levels[Math.min(Math.floor(bar), levels.length - 1)]!, levels[Math.min(Math.floor(bar) + 1, levels.length - 1)]!];
                return a + (b - a) * (bar - Math.floor(bar));
            };
            // The last single note of this line, and the step it ends on: what a note that follows straight on is slurred from.
            let before: { end: number; event: MusicEvent } | null = null;
            for (let i = 0; i < steps.length; i++) {
                const s = steps[i]!;
                if (s.kind === 'hold' && (i === 0 || steps[i - 1]!.kind === 'rest')) say(`pattern "${name}", track "${track}": a "-" at step ${(i % stepsToBar) + 1} of bar ${Math.floor(i / stepsToBar) + 1} has no note before it to hold, and is silent`);
                if (s.kind !== 'hit' && s.kind !== 'notes') continue;
                let held = 1;
                while (i + held < steps.length && steps[i + held]!.kind === 'hold') held++;
                // Every second step late, which is what makes a line swing.
                const late = div % 2 === 0 && i % 2 === 1 ? (source.swing ?? 0) * step : 0;
                const when = Math.max(0, at + i * step + late + human * 0.012 * random());
                const hard = s.loud * levelAt(i);
                const loud = hard * (1 + human * 0.25 * random());
                const mark = hard > 1.15 ? 1 : hard < 0.8 ? -1 : 0;
                // The pedal is down to the end of the bar: the note rings on to there.
                const toBarEnd = (Math.floor(i / stepsToBar) + 1) * stepsToBar * step - i * step;
                const sounds = instrument.pedal && toBarEnd > held * step ? { sounds: toBarEnd } : {};
                played.add(track);
                if (s.kind === 'hit') {
                    events.push({ instrument: track, at: when, seconds: held * step, midi: null, loud, part: p, outside: false, mark, hard, ...sounds });
                    before = null;
                    continue;
                }
                // One note running straight on from one note, and not struck harder: in the same breath.
                const slurred = !!instrument.legato && s.notes.length === 1 && before !== null && before.end === i && s.loud <= 1;
                if (slurred) before!.event.tied = true;
                const chord = instrument.follow && pattern.chords ? pattern.chords[Math.floor(i / stepsToBar) % pattern.chords.length]! : 1;
                // A root on 5, 6 or 7 is taken below the tonic, so the chords lie round it and a bass does not climb away.
                const drop = chord >= 5 ? -7 : 0;
                for (const n of s.notes) {
                    const index = n.degree - 1 + chord - 1 + drop + 7;
                    const midi = 60 + tonic + scale[index % 7]! + 12 * (Math.floor(index / 7) - 1 + n.octave + (instrument.octave ?? 0)) + n.alter;
                    events.push({ instrument: track, at: when, seconds: held * step, midi, loud, part: p, outside: n.alter !== 0, mark, hard, ...sounds, ...(slurred ? { slur: true } : {}) });
                }
                before = s.notes.length === 1 ? { end: i + held, event: events.at(-1)! } : null;
            }
        }
        if (events.length === before) notes.push(`part ${p + 1} of the song ("${name}") plays nothing`);
        at += pattern.bars * barSeconds;
    });

    for (const name of Object.keys(source.instruments)) if (!played.has(name)) notes.push(`instrument "${name}" is never played`);
    for (const name of Object.keys(source.patterns)) if (!used.has(name)) notes.push(`pattern "${name}" is not in the song`);

    // What can be said of the notes without hearing them.
    const pitched = new Map<string, MusicEvent[]>();
    for (const e of events) if (e.midi !== null) pitched.set(e.instrument, [...(pitched.get(e.instrument) ?? []), e]);
    const middle = new Map<string, number>();
    for (const [name, list] of pitched) {
        const sorted = list.map((e) => e.midi!).sort((a, b) => a - b);
        middle.set(name, sorted[Math.floor(sorted.length / 2)]!);
        if (sorted[0]! < 24) notes.push(`"${name}" goes down to ${noteName(sorted[0]!)}, below where a pitch can be told: raise its octave`);
        if (sorted.at(-1)! > 100) notes.push(`"${name}" goes up to ${noteName(sorted.at(-1)!)}, which is a whistle: lower its octave`);
        const outside = list.filter((e) => e.outside).length;
        if (outside > 0) notes.push(`"${name}" plays ${outside} note${outside === 1 ? '' : 's'} outside the key`);
    }
    const names = [...pitched.keys()];
    for (let a = 0; a < names.length; a++) for (let b = a + 1; b < names.length; b++) {
        const [x, y] = [pitched.get(names[a]!)!, pitched.get(names[b]!)!];
        if (Math.abs(middle.get(names[a]!)! - middle.get(names[b]!)!) > 4) continue;
        // How much of the time the less busy of the two sounds, the other is sounding too.
        const length = (list: MusicEvent[]): number => list.reduce((sum, e) => sum + e.seconds, 0);
        let both = 0;
        for (const e of x) for (const f of y) both += Math.max(0, Math.min(e.at + e.seconds, f.at + f.seconds) - Math.max(e.at, f.at));
        if (both > 0.5 * Math.min(length(x), length(y))) notes.push(`"${names[a]}" and "${names[b]}" sound together in the same octave, round ${noteName(middle.get(names[a]!)!)}, and will blur into one: move one of them an octave`);
    }

    events.sort((a, b) => a.at - b.at);
    return { seconds: musicSeconds(source), barSeconds, events, parts, notes };
}

/** How far past its own start a layer can still be sounding, when a held note lasts @p held seconds. */
function reach(layer: SoundLayer, held: number): number {
    const again = layer.scatter ? layer.scatter.over : layer.repeat ? (layer.repeat.count - 1) * layer.repeat.every : 0;
    const own = layer.source === 'group' ? Math.max(0, ...layer.layers!.map((l) => reach(l, held))) : layer.length ?? held;
    return (layer.start ?? 0) + again + own;
}

/** A layer with no length of its own lasts as long as the note, and dies over the instrument's release. */
function forNote(layer: SoundLayer, held: number, release: number, slur = 0): SoundLayer {
    if (layer.source === 'group') return { ...layer, layers: layer.layers!.map((l) => forNote(l, held, release, slur)) };
    // A layer with a length of its own is the knock at the front of a note, which a slurred note has none of.
    if (layer.length !== undefined) return slur > 0 ? { ...layer, mute: true } : layer;
    return { ...layer, length: Math.max(0.01, held + release - (layer.start ?? 0)), release: layer.release ?? release, ...(slur > 0 ? { attack: Math.max(layer.attack ?? 0, slur) } : {}) };
}

/**
 * One note of an instrument made of recordings: the recording nearest the note, played faster to be higher or slower
 * to be lower, let go over the release. A recording an octave from its note is another instrument, which is why there
 * are several; within three semitones the ear takes it for the same one.
 */
const HARDNESS = { soft: -1, normal: 0, loud: 1 } as const;

/**
 * Which of an instrument's recordings plays a note. First by how hard: the recordings made as hard as the note is
 * marked, or failing those the nearest in hardness. Then by pitch: the ones whose range holds the note, or failing
 * those the nearest. And where several are left that are the same note, they take turns, so the same key struck
 * four times is not one recording four times.
 */
export function sampleZone(instrument: MusicInstrument, midi: number | null, mark: number, turn: number): { index: number; matched: boolean } {
    const zones = instrument.samples!;
    const hard = (i: number): number => HARDNESS[zones[i]!.dynamic ?? 'normal'];
    let left = zones.map((_, i) => i);
    const nearest = Math.min(...left.map((i) => Math.abs(hard(i) - mark)));
    left = left.filter((i) => Math.abs(hard(i) - mark) === nearest);
    const matched = nearest === 0 && mark !== 0;
    if (midi !== null) {
        const ranged = left.filter((i) => (zones[i]!.low !== undefined || zones[i]!.high !== undefined) && midi >= (midiOf(zones[i]!.low) ?? 0) && midi <= (midiOf(zones[i]!.high) ?? 127));
        if (ranged.length) left = ranged;
        const far = Math.min(...left.map((i) => Math.abs(midiOf(zones[i]!.note)! - midi)));
        left = left.filter((i) => Math.abs(midiOf(zones[i]!.note)! - midi) === far);
        // Of two as near, one above and one below, the turn must not swap them: only recordings of one note take turns.
        left = left.filter((i) => midiOf(zones[i]!.note) === midiOf(zones[left[0]!]!.note));
    } else left = [left[0]!];
    return { index: left[turn % left.length]!, matched };
}

function sampleNote(name: string, instrument: MusicInstrument, index: number, midi: number | null, held: number, rate: number, given: Readonly<Record<string, SampleData>>, slur = 0): Float32Array[] {
    const zone = instrument.samples![index]!;
    const data = given[zone.file];
    if (!data) throw new Error(`instrument "${name}": the recording ${zone.file} was not found`);
    const frames = data.channels[0]!.length;
    const step = (midi === null ? 1 : Math.pow(2, (midi - midiOf(zone.note)! - (zone.tune ?? 0) / 100) / 12)) * (data.rate / rate);
    // Slurred, it is not the start of the recording that is wanted, which is the bow biting or the breath beginning,
    // but what comes after; and it comes in over the time the note before takes to go.
    const skip = slur > 0 ? Math.min(0.12 * data.rate, frames * 0.25) : 0;
    const [attack, release] = [slur > 0 ? slur : instrument.attack ?? 0.003, instrument.release ?? 0.08];
    // Round its steady middle, or the seconds given, with the end of each turn faded into the start of the next.
    let [from, to] = [0, 0];
    if (zone.loop) {
        [from, to] = zone.loop === true ? [frames * 0.4, frames * 0.85] : [zone.loop[0] * data.rate, Math.min(frames - 2, zone.loop[1] * data.rate)];
    }
    const round = to - from;
    const fade = round > 0 ? Math.min(0.12 * data.rate, round / 3, from) : 0;
    const count = Math.max(1, Math.round(Math.min(held + release, round > 0 ? 30 : (frames - 2 - skip) / step / rate) * rate));
    const at = (channel: Float32Array, p: number): number => {
        // Through four points, so a note played slower is not a staircase.
        const i = Math.floor(p), t = p - i;
        const [a, b, c, d] = [channel[i - 1] ?? channel[i]!, channel[i]!, channel[i + 1] ?? 0, channel[i + 2] ?? 0];
        return b + 0.5 * t * (c - a + t * (2 * a - 5 * b + 4 * c - d + t * (3 * (b - c) + d - a)));
    };
    const out = data.channels.slice(0, 2).map(() => new Float32Array(count));
    const letGo = Math.round(held * rate);
    const ending = Math.min(count, Math.round(0.005 * rate));
    for (let n = 0; n < count; n++) {
        let p = skip + n * step;
        let blend = 0;
        if (round > 0 && p >= to - fade) {
            p = from + ((p - from) % round);
            if (fade > 0 && p >= to - fade) blend = (p - (to - fade)) / fade;
        }
        let level = n < attack * rate ? n / (attack * rate) : 1;
        if (n > letGo) level *= Math.max(0, 1 - (n - letGo) / Math.max(1, release * rate));
        if (count - n < ending) level *= (count - n) / ending;
        for (let c = 0; c < out.length; c++) {
            const channel = data.channels[c]!;
            out[c]![n] = (blend > 0 ? at(channel, p) * (1 - blend) + at(channel, p - round) * blend : at(channel, p)) * level;
        }
    }
    return out;
}

/**
 * The pitch heard in a recording, in Hz, looked for within two octaves of @p near; null where it has none that can be
 * told (a drum, a noise). It is found by how far the wave has to be slid to lie on itself again. A wave lies on itself
 * at twice its period too, so the shortest slide that fits nearly as well as the best is taken: that is what tells a
 * recording named an octave from what it is, which libraries that count octaves from another C are throughout.
 */
export function samplePitch(data: SampleData, near: number): number | null {
    const samples = data.channels[0]!;
    const longest = Math.ceil(data.rate / (near / 2.1));
    const start = Math.floor(samples.length * 0.25);
    const size = Math.min(16384, samples.length - start - longest);
    if (size < longest * 2) return null;
    const scores: [number, number][] = [];
    for (let lag = Math.max(8, Math.floor(data.rate / (near * 4.2))); lag <= longest; lag++) {
        let sum = 0, a = 0, b = 0;
        for (let n = 0; n < size; n += 2) { const x = samples[start + n]!, y = samples[start + n + lag]!; sum += x * y; a += x * x; b += y * y; }
        scores.push([lag, sum / Math.sqrt(a * b + 1e-12)]);
    }
    const top = Math.max(...scores.map((score) => score[1]));
    if (!(top > 0.6)) return null;
    let at = scores.findIndex((score) => score[1] >= top * 0.92);
    while (at + 1 < scores.length && scores[at + 1]![1] > scores[at]![1]) at++;
    // A high note in a recording made at a low rate has a period of a dozen samples and a half: no whole slide fits
    // it, and twice the period, which is whole, fits better. So a half and a third of the slide found are tried too,
    // between the samples, and the shortest that fits nearly as well is the pitch.
    const fits = (lag: number): number => {
        let sum = 0, a = 0, b = 0;
        const whole = Math.floor(lag), part = lag - whole;
        for (let n = 0; n < size; n += 2) {
            const x = samples[start + n]!, y = samples[start + n + whole]! * (1 - part) + samples[start + n + whole + 1]! * part;
            sum += x * y; a += x * x; b += y * y;
        }
        return sum / Math.sqrt(a * b + 1e-12);
    };
    let lag = scores[at]![0];
    // Just off the whole number, a little either side, where the fit is best.
    const best = (centre: number): [number, number] => { let found: [number, number] = [centre, -1]; for (let d = -0.5; d <= 0.5; d += 0.05) { const f = fits(centre + d); if (f > found[1]) found = [centre + d, f]; } return found;
    };
    let [fine, fit] = best(lag);
    for (const part of [3, 2]) {
        if (lag / part < 4 || data.rate / (lag / part) > near * 4.2) continue;
        const [shorter, shorterFit] = best(lag / part);
        if (shorterFit >= fit * 0.9) { [fine, fit] = [shorter, shorterFit]; break; }
    }
    lag = fine;
    return data.rate / lag;
}

const TAIL_SECONDS = 4;

/**
 * A long sound in a place: the same sum a single transform of the whole would give, taken a stretch at a time, each
 * stretch answered by the place and laid where it belongs. A piece of music is a hundred times as long as the room's
 * answer, and one transform of all of it costs several times what these do.
 */
function inPlace(response: Float32Array): (signal: Float32Array) => Float32Array {
    let size = 1;
    while (size < response.length * 2) size <<= 1;
    const block = size - response.length;
    const [hr, hi] = [new Float64Array(size), new Float64Array(size)];
    hr.set(response);
    fft(hr, hi);
    const [xr, xi] = [new Float64Array(size), new Float64Array(size)];
    return (signal) => {
        const out = new Float32Array(signal.length);
        for (let from = 0; from < signal.length; from += block) {
            xr.fill(0); xi.fill(0);
            let any = false;
            for (let n = 0; n < block && from + n < signal.length; n++) { const v = signal[from + n]!; xr[n] = v; if (v !== 0) any = true; }
            if (!any) continue;
            fft(xr, xi);
            for (let k = 0; k < size; k++) {
                const re = xr[k]! * hr[k]! - xi[k]! * hi[k]!, im = xr[k]! * hi[k]! + xi[k]! * hr[k]!;
                // Back the same way: the transform of the conjugate, shared out.
                xr[k] = re; xi[k] = -im;
            }
            fft(xr, xi);
            for (let n = 0; n < size && from + n < signal.length; n++) out[from + n]! += xr[n]! / size;
        }
        return out;
    };
}

/** The samples a validated source makes. @p given holds the recordings its instruments play, by the path each is named by. */
export function renderMusic(source: MusicSource, given: Readonly<Record<string, SampleData>> = {}): RenderedMusic {
    const compiled = compileMusic(source);
    const rate = source.rate ?? 44100;
    const count = Math.max(1, Math.round(compiled.seconds * rate));
    const work = count + Math.round(TAIL_SECONDS * rate);
    const names = Object.keys(source.instruments);
    const buses = new Map(names.map((name) => [name, [new Float32Array(work), new Float32Array(work)]] as const));

    const cache = new Map<string, Float32Array[]>();
    const noteOf = (name: string, instrument: MusicInstrument, e: MusicEvent, turn: number, zone: number): Float32Array[] => {
        // The same note is made a few times over and no more: enough that a hat is not one sample struck again.
        const legato = instrument.legato === true ? 0.07 : instrument.legato || 0;
        const slur = e.slur ? legato : 0;
        // As long as it sounds: as written, or on to the bar line under the pedal, and a moment more where the next
        // note comes in under it.
        const held = (e.sounds ?? e.seconds) + (e.tied ? legato : 0);
        const key = `${name}|${e.midi}|${Math.round(held * 1000)}|${slur}|${instrument.samples ? `z${zone}` : turn % 3}`;
        let made = cache.get(key);
        if (!made && instrument.samples) {
            made = sampleNote(name, instrument, zone, e.midi, held, rate, given, slur);
            cache.set(key, made);
        }
        if (!made) {
            const release = instrument.release ?? 0.08;
            const layers = instrument.layers!.map((l) => forNote(l, held, release, slur));
            const duration = Math.min(8, Math.max(0.02, ...layers.map((l) => reach(l, held + release))));
            made = renderSound({ duration, rate, layers, normalize: false }, 0, { pitch: e.midi === null ? 1 : Math.pow(2, (e.midi - 69) / 12), seed: (turn % 3) * 7919, raw: true }).channels;
            cache.set(key, made);
        }
        return made;
    };

    const turns = new Map<string, number>();
    for (const e of compiled.events) {
        const instrument = source.instruments[e.instrument]!;
        const turn = turns.get(e.instrument) ?? 0;
        turns.set(e.instrument, turn + 1);
        // Which recording, for an instrument of them: recordings of one note take turns, counted for each note apart.
        let zone = { index: 0, matched: false };
        if (instrument.samples) {
            const of = `${e.instrument}|${e.midi}|${e.mark}`;
            const again = turns.get(of) ?? 0;
            turns.set(of, again + 1);
            zone = sampleZone(instrument, e.midi, e.mark, again);
        }
        const note = noteOf(e.instrument, instrument, e, turn, zone.index);
        const [l, r] = [note[0]!, note[1] ?? note[0]!];
        const pan = instrument.pan ?? 0;
        // Equal power, and full in the middle. A recording made as hard as the note is marked is already that loud:
        // the mark is not counted twice.
        const loud = (zone.matched ? e.loud / e.hard : e.loud) * (instrument.gain ?? 1) * Math.SQRT2;
        const [gl, gr] = [Math.cos(((pan + 1) * Math.PI) / 4) * loud, Math.sin(((pan + 1) * Math.PI) / 4) * loud];
        const [left, right] = buses.get(e.instrument)!;
        const from = Math.round(e.at * rate);
        for (let n = 0; n < l.length && from + n < work; n++) {
            left[from + n]! += l[n]! * gl;
            right[from + n]! += r[n]! * gr;
        }
    }

    // The room. One for everything; or, when the instruments are to be written apart, one each, so they still add up.
    const room = [new Float32Array(work), new Float32Array(work)];
    if (source.reverb) {
        const [size, mix] = [source.reverb.size ?? 0.4, (source.reverb.mix ?? 0.2) * 3];
        const answers = [0, 1].map((side) => inPlace(placeResponse(rate, size, 'room', side)));
        const sendOf = (name: string): number => source.instruments[name]!.reverb ?? 0.3;
        if (source.stems) {
            for (const name of names) {
                if (sendOf(name) === 0) continue;
                buses.get(name)!.forEach((channel, c) => {
                    const wet = answers[c]!(channel);
                    for (let n = 0; n < work; n++) channel[n]! += wet[n]! * mix * sendOf(name);
                });
            }
        } else {
            for (const c of [0, 1]) {
                const send = new Float32Array(work);
                for (const name of names) { const [bus, share] = [buses.get(name)![c]!, sendOf(name)]; if (share > 0) for (let n = 0; n < work; n++) send[n]! += bus[n]! * share; }
                const wet = answers[c]!(send);
                for (let n = 0; n < work; n++) room[c]![n] = wet[n]! * mix;
            }
        }
    }

    const loop = source.loop !== false;
    // Where the round begins: the start, or the end of an introduction that is heard once.
    const loopStart = loop && source.intro ? compiled.parts[source.intro]!.at : 0;
    const roundFrom = Math.round(loopStart * rate);
    // A piece that ends rings out: the file runs on past its last bar until what is left cannot be heard. One that fades
    // out is at nothing by the end of the bar, and has nothing to ring.
    let total = count;
    if (!loop && !source.fadeOut) {
        let last = count;
        for (const channel of [...room, ...names.flatMap((name) => buses.get(name)!)]) for (let n = work - 1; n > last; n--) if (Math.abs(channel[n]!) > 2e-4) { last = n; break; }
        total = Math.min(work, last + (last > count ? Math.round(0.05 * rate) : 0));
    }
    const finish = (channel: Float32Array): Float32Array => {
        const out = channel.slice(0, total);
        // What rings past the end is heard as the round begins again, which is where it is put.
        if (loop) for (let n = count; n < work; n++) out[roundFrom + ((n - count) % (count - roundFrom))]! += channel[n]!;
        else {
            if (source.fadeIn) { const rise = Math.round(source.fadeIn * rate); for (let n = 0; n < rise && n < total; n++) out[n]! *= (n / rise) ** 2; }
            // Let down over the seconds asked, or over the last fiftieth of one so that it does not stop on a step.
            const fall = Math.min(total, Math.round((source.fadeOut ?? 0.02) * rate));
            for (let n = 0; n < fall; n++) out[total - 1 - n]! *= source.fadeOut ? (n / fall) ** 2 : n / fall;
        }
        return out;
    };
    const stems: Record<string, Float32Array[]> = {};
    for (const name of names) stems[name] = buses.get(name)!.map(finish);
    const channels = [0, 1].map((c) => {
        const sum = finish(room[c]!);
        for (const name of names) { const stem = stems[name]![c]!; for (let n = 0; n < total; n++) sum[n]! += stem[n]!; }
        return sum;
    });

    let peak = 0;
    for (const channel of channels) for (const v of channel) if (Math.abs(v) > peak) peak = Math.abs(v);
    const notes = [...compiled.notes];
    // A recording called a note it is not puts every note played from it out of tune, and nothing in the notes shows it.
    for (const name of names) {
        const wrong: { file: string; said: number; is: number }[] = [];
        const zones = source.instruments[name]!.samples ?? [];
        const heard = new Set<string>();
        for (const zone of zones) {
            const data = given[zone.file];
            // A recording used for several ranges is listened to once.
            if (!data || heard.has(`${zone.file}|${zone.note}`)) continue;
            heard.add(`${zone.file}|${zone.note}`);
            const said = midiOf(zone.note)!;
            // Where it is said to be sharp or flat of its note, that is where it is listened for.
            const hz = 440 * Math.pow(2, (said + (zone.tune ?? 0) / 100 - 69) / 12);
            const found = samplePitch(data, hz);
            const off = found === null ? 0 : 12 * Math.log2(found / hz);
            if (Math.abs(off) >= 0.7) wrong.push({ file: zone.file, said, is: Math.round(said + off) });
        }
        if (wrong.length === 0) continue;
        const by = (w: { said: number; is: number }): number => w.is - w.said;
        const semitones = (n: number): string => `${Math.abs(n)} semitone${Math.abs(n) === 1 ? '' : 's'} ${n > 0 ? 'higher' : 'lower'}`;
        // A whole library out by the same amount is one thing to say, and nearly always an octave: it counts its octaves from another C.
        if (wrong.length === heard.size && wrong.length > 1 && wrong.every((w) => by(w) === by(wrong[0]!))) {
            notes.push(`"${name}": every one of its ${heard.size} recordings sounds ${semitones(by(wrong[0]!))} than the note it is said to be (${wrong[0]!.file} is said to be ${noteName(wrong[0]!.said)} and sounds as ${noteName(wrong[0]!.is)})${Math.abs(by(wrong[0]!)) === 12 ? ', as a library does that counts its octaves from another C' : ''}: the instrument plays that much out. Move each \`note\` by that much`);
        } else {
            for (const w of wrong) notes.push(`"${name}": ${w.file} is said to be ${noteName(w.said)} and sounds as ${noteName(w.is)}: every note played from it is ${semitones(by(w))} than written. Set its note to "${noteName(w.is)}"`);
        }
    }
    const target = source.gain ?? 0.9;
    const scale = peak > 1e-6 ? target / peak : 1;
    if (peak <= 1e-6) notes.push('the piece is silent: nothing in it reaches a level that can be heard');
    for (const list of [channels, ...Object.values(stems)]) for (const channel of list) for (let n = 0; n < total; n++) channel[n]! *= scale;
    const rmsOf = (list: Float32Array[], from = 0, to = count): number => { let s = 0; for (const channel of list) for (let n = from; n < to; n++) s += channel[n]! * channel[n]!; return Math.sqrt(s / (Math.max(1, to - from) * list.length)); };
    const rms = rmsOf(channels);

    // Where a loop meets itself. The samples join without a step whatever is written; what the ear hears as a join is
    // the music changing at once, a full last bar running into a first bar with two instruments in it.
    let join: RenderedMusic['join'] = null;
    if (loop) {
        const bar = Math.min(count, Math.round(compiled.barSeconds * rate));
        const sounding = (from: number, to: number): string[] => {
            // In the bar for more than a twentieth of it: a note let go on the bar line, a few thousandths late, is not in the next bar.
            const least = compiled.barSeconds * 0.05;
            return names.filter((name) => compiled.events.some((e) => e.instrument === name && Math.min(to, e.at + e.seconds) - Math.max(from, e.at) > least));
        };
        const db = (level: number): number => (level > 0 && rms > 0 ? Math.round(20 * Math.log10(level / rms) * 10) / 10 : -120);
        join = {
            // The first bar of the round, which with an introduction is not the first bar of the file.
            ends: sounding(compiled.seconds - compiled.barSeconds, compiled.seconds), begins: sounding(loopStart, loopStart + compiled.barSeconds),
            endDb: db(rmsOf(channels, count - bar, count)), startDb: db(rmsOf(channels, roundFrom, Math.min(count, roundFrom + bar))),
        };
        const [gone, come] = [join.ends.filter((n) => !join!.begins.includes(n)), join.begins.filter((n) => !join!.ends.includes(n))];
        if (count - roundFrom > bar * 2 && (Math.abs(join.endDb - join.startDb) > 6 || gone.length + come.length > Math.max(1, names.length / 3))) {
            notes.push(`where the loop meets itself the music changes at once: its last bar has ${join.ends.join(', ') || 'nothing'} at ${join.endDb} dB and its first has ${join.begins.join(', ') || 'nothing'} at ${join.startDb} dB${gone.length ? `, so ${gone.join(', ')} stop${gone.length === 1 ? 's' : ''} dead` : ''}. A loop is heard as one piece when its end is as full as its start: end on a part like the one it comes back to (thin the last part with \`without\`, or begin as full as it ends), and put a build that happens once in an introduction with \`intro\``);
        }
    }

    const instruments: RenderedMusic['instruments'] = {};
    for (const name of names) {
        const mine = compiled.events.filter((e) => e.instrument === name);
        const pitches = mine.filter((e) => e.midi !== null).map((e) => e.midi!);
        const level = rmsOf(stems[name]!);
        instruments[name] = {
            notes: mine.length,
            ...(pitches.length ? { low: noteName(Math.min(...pitches)), high: noteName(Math.max(...pitches)) } : {}),
            levelDb: level > 0 && rms > 0 ? Math.round(20 * Math.log10(level / rms) * 10) / 10 : -120,
        };
    }
    return { ...compiled, notes, rate, channels, peak: peak > 1e-6 ? target : 0, rms, loopStart, tailSeconds: (total - count) / rate, join, stems: source.stems ? stems : null, instruments };
}
