// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  soundSource.ts — `.essound`: a sound as the layers that make it, what a model writes and edits, and what is wrong with one.
 *
 *        A picture is layers of shapes and a model is steps; a sound effect is layers too. A gunshot is a crack of
 *        noise, a thump under it and a tail; a footstep is a thud and a scrape; a glass is a handful of ringing tones.
 *        Each layer is one source (a tone, a noise, or a struck body's ringing), shaped in time by an envelope and in
 *        colour by filters, and the layers are summed. What is saved is this description, and the `.wav` a game plays is
 *        made from it, so a sound is changed by changing a number and never by recording again.
 *
 *        Nothing here is random that is not seeded: the same source is the same samples on every machine.
 */

export const SOUND_SOURCE_EXT = '.essound';
export const SOUND_SOURCE_VERSION = 1;
export const MAX_SOUND_SECONDS = 30;
export const SOUND_RATES = [22050, 44100, 48000] as const;

/** One value for the whole of a layer, or [[seconds, value], ...] from the layer's start: a pitch that falls, a filter that opens. */
export type SoundCurve = number | readonly (readonly [number, number])[];

export const SOUND_SOURCES = ['sine', 'triangle', 'saw', 'square', 'noise', 'modes', 'impulse', 'sample', 'group'] as const;
export const MAX_SOUND_VARIANTS = 8;
export type SoundSourceKind = (typeof SOUND_SOURCES)[number];
export const SOUND_FILTERS = ['lowpass', 'highpass', 'bandpass', 'notch', 'peak'] as const;
export const REVERB_KINDS = ['room', 'open'] as const;
export const NOISE_COLORS = ['white', 'pink', 'brown'] as const;

export interface SoundFilter {
    type: (typeof SOUND_FILTERS)[number];
    /** Hz, 20..20000. */
    freq: SoundCurve;
    /** How narrow: 0.7 is plain, 5 rings, 20 whistles. Default 0.7. */
    q?: number;
    /** peak: dB it lifts (or with a minus, cuts) round `freq`, -24..24: the note a barrel, a box or a room adds. */
    gain?: number;
}

export interface SoundLayer {
    id?: string;
    source: SoundSourceKind;
    /**
     * group: the layers that make one event, struck together. A footstep is a thud, a scrape and two clicks, and four
     * footsteps are that one group with `repeat`, each striking with its own grit, in place of the layers written out
     * four times. The group's `start`, `gain`, `pan`, `repeat` and `scatter` are the event's; each layer in it keeps its
     * own start, counted from the event's.
     */
    layers?: readonly SoundLayer[];
    /** A tone's pitch in Hz; a curve glides between its points as the ear hears pitch. */
    freq?: SoundCurve;
    /** square: the share of each cycle it is high, 0.05..0.95. Default 0.5. impulse: seconds its one spike lasts, 0.00002..0.02; a shot's is 0.0002. */
    width?: number;
    /**
     * noise: only what lies between these two Hz, brought back to the level of the whole. A real bang is several bands
     * of noise that die at different rates, the high ones first, and this is one of them.
     */
    band?: readonly [number, number];
    /** noise: how unlike its two sides are, 0..1. It makes the file stereo, and a wide crack fills the head where a narrow one sits in the middle. */
    wide?: number;
    /** noise: white is hiss, pink is rain, brown is a rumble. Default white. */
    color?: (typeof NOISE_COLORS)[number];
    /**
     * sample: a recording in the project, by its path, played as a layer among the made ones: the real crack of a
     * branch under made leaves, a voice, the one sound that will not come out of waves and noise. Everything a layer
     * has shapes it as it shapes the rest: an envelope, filters, a drive, repeats, a scatter.
     */
    file?: string;
    /** sample: how fast it is played, 0.25..4; 2 is an octave up and half as long. Default 1. */
    speed?: number;
    /** sample: seconds into the recording that it starts from. Default 0. */
    from?: number;
    /** modes: each [Hz, loudness, seconds to die away], the tones a struck thing rings with. */
    modes?: readonly (readonly [number, number, number])[];
    seed?: number;
    /** Seconds into the sound that it begins. Default 0. */
    start?: number;
    /** Seconds it lasts. Default: to the end of the sound. */
    length?: number;
    /** Loudness, 1 being full; a curve shapes it over the layer. Default 1. */
    gain?: SoundCurve;
    /** Seconds to rise from nothing, and to fall to nothing at its end. Defaults 0.002 and 0.01, which only stop a click. */
    attack?: number;
    release?: number;
    /** Dies away of itself: seconds to fall to about a third. A hit, a pluck, a drop. */
    decay?: number;
    /** With `decay`: a share `mix` of it dies more slowly, in `decay` seconds of its own. The body of a bang goes at once and its ring lingers. */
    tail?: { decay: number; mix: number };
    /** Wavers in pitch: `rate` times a second, `depth` semitones each way. */
    vibrato?: { rate: number; depth: number };
    /** Wavers in loudness: `rate` times a second, by `depth` 0..1. */
    tremolo?: { rate: number; depth: number };
    /** A second tone bending this one: at `ratio` times its pitch, by `index` (0 is none, 2 is brassy, 8 is a clang). Metal, bells, lasers. */
    fm?: { ratio: number; index: SoundCurve };
    /** In order, each working on what the one before left. */
    filters?: readonly SoundFilter[];
    /** Pushed into distortion, 0..1: grit, fuzz, a speaker torn. */
    drive?: number;
    /** -1 is left, 1 is right. Default 0. */
    pan?: number;
    /** The layer struck again: `count` times in all, `every` seconds apart, each `gain` times as loud and `pitch` times as high as the last, off the beat by up to `jitter` seconds. */
    repeat?: { count: number; every: number; gain?: number; pitch?: number; jitter?: number; faster?: number };
    /**
     * The layer struck many times at random: `count` strikes within `over` seconds, crowded toward the start by
     * `early` (1 is even, 2.3 is a crash), each at a pitch between the two of `pitch` times its own, as loud as between
     * the two of `gain`, thrown to either side by up to `pan`, the later ones quieter by `fade`. Breaking glass is four
     * hundred short rings scattered like this; so are gravel, rain, sparks and applause.
     */
    scatter?: { count: number; over: number; early?: number; pitch?: readonly [number, number]; gain?: readonly [number, number]; pan?: number; fade?: number };
    /** Left out of the sound, kept in the source. */
    mute?: boolean;
}

export interface SoundSource {
    version?: number;
    /** Seconds. */
    duration: number;
    /** Samples a second. Default 44100. */
    rate?: number;
    /** Its end runs into its start with no click, for an engine, a wind, a hum. */
    loop?: boolean;
    /**
     * How many of it to make, 1..8, each a little unlike the others: other noise, and pitch, loudness, decay and timing
     * off by up to `vary`. A game that plays the same file for every shot or step is heard as a machine however good the
     * file; with variants a sound event is written beside them that plays one after another without repeating.
     */
    variants?: number;
    /** How far a variant strays, 0..0.3. Default 0.06. */
    vary?: number;
    /** A recording to make it like, by project path. It is shown above the sound in every reply, drawn the same way to the same scale, and measured the same way. Nothing is taken from it. */
    reference?: string;
    layers: readonly SoundLayer[];
    /** Over the whole sound, after the layers are summed: */
    highpass?: number;
    lowpass?: number;
    /** A repeat of the whole: `time` seconds later, `feedback` 0..0.95 of each into the next, `mix` 0..1 of it in the sound. */
    echo?: { time: number; feedback?: number; mix?: number };
    /**
     * A place round it: `size` 0..1 from a closet to a hall, `mix` 0..1 of it in the sound. `kind` "room" is walls
     * close by, with first echoes and a wash whose top dies before its bottom; "open" is a street or a yard: a few
     * distinct slaps off far walls and a long thin tail.
     */
    reverb?: { size?: number; mix?: number; kind?: (typeof REVERB_KINDS)[number] };
    /** Loudness of the whole. With `normalize` it is how loud the loudest moment is, 1 being full. Default 0.9. */
    gain?: number;
    /** false leaves the levels as the layers sum to. Default true: the loudest moment is brought to `gain`. */
    normalize?: boolean;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const between = (v: unknown, lo: number, hi: number): boolean => isNum(v) && v >= lo && v <= hi;

function curveProblem(v: unknown, lo: number, hi: number, what: string): string | null {
    if (isNum(v)) return v >= lo && v <= hi ? null : `${what} must be ${lo}..${hi}`;
    if (!Array.isArray(v) || v.length < 2) return `${what} must be a number, or two or more [seconds, value]`;
    let last = -Infinity;
    for (const p of v) {
        if (!Array.isArray(p) || p.length !== 2 || !isNum(p[0]) || !isNum(p[1])) return `${what} must be [seconds, value] pairs`;
        if (p[0] < 0) return `${what}: a time is seconds from the layer's start, none below 0`;
        if (p[0] <= last) return `${what}: its times must rise`;
        if (p[1] < lo || p[1] > hi) return `${what}: each value must be ${lo}..${hi}`;
        last = p[0];
    }
    return null;
}

const LAYER_FIELDS = ['id', 'source', 'freq', 'width', 'band', 'wide', 'color', 'modes', 'file', 'speed', 'from', 'seed', 'start', 'length', 'gain', 'attack', 'release', 'decay', 'tail', 'vibrato', 'tremolo', 'fm', 'filters', 'drive', 'pan', 'repeat', 'scatter', 'mute'];

const GROUP_FIELDS = ['id', 'source', 'layers', 'start', 'gain', 'pan', 'repeat', 'scatter', 'mute'];

function checkLayer(l: Record<string, unknown>, where: string, ids: Set<string>, duration: number, depth = 0): void {
    const fail = (what: string): never => { throw new Error(`${where}: ${what}`); };
    if (typeof l !== 'object' || l === null || Array.isArray(l)) fail('must be an object');
    if (l.source === 'group') {
        for (const key of Object.keys(l)) if (!GROUP_FIELDS.includes(key)) fail(`a group takes ${GROUP_FIELDS.join(', ')}; "${key}" belongs on the layers in it`);
        if (depth >= 3) fail('groups go three deep and no further');
        if (!Array.isArray(l.layers) || l.layers.length === 0) fail('a group needs `layers`: one or more');
        if (l.gain !== undefined && !between(l.gain, 0, 4)) fail('a group\'s gain is one number, 0..4');
    } else if (l.layers !== undefined) fail('`layers` goes with source "group"');
    if (l.source !== 'group') for (const key of Object.keys(l)) if (!LAYER_FIELDS.includes(key)) fail(`unknown field "${key}"; a layer takes ${LAYER_FIELDS.join(', ')}`);
    if (l.id !== undefined) {
        if (typeof l.id !== 'string' || !l.id) fail('id must be a name');
        if (ids.has(l.id as string)) fail(`the id "${String(l.id)}" is already used`);
        ids.add(l.id as string);
    }
    if (!SOUND_SOURCES.includes(l.source as SoundSourceKind)) fail(`source ${JSON.stringify(l.source)} must be one of ${SOUND_SOURCES.join(', ')}`);
    const tone = l.source !== 'noise' && l.source !== 'modes' && l.source !== 'impulse' && l.source !== 'group' && l.source !== 'sample';
    if (l.source === 'sample') {
        if (typeof l.file !== 'string' || !/\.(wav|ogg|mp3|flac|m4a|aac|webm)$/i.test(l.file)) fail('a sample needs file: a project path to a recording (.wav, .ogg, .mp3, .flac, .m4a)');
        if (l.speed !== undefined && !between(l.speed, 0.25, 4)) fail('speed must be 0.25..4');
        if (l.from !== undefined && !between(l.from, 0, 600)) fail('from must be seconds into the recording, 0 or more');
    } else for (const key of ['file', 'speed', 'from']) if (l[key] !== undefined) fail(`${key} goes with source "sample"`);
    if (tone) {
        if (l.freq === undefined) fail(`a ${String(l.source)} needs freq, its pitch in Hz`);
        const bad = curveProblem(l.freq, 10, 20000, 'freq');
        if (bad) fail(bad);
    } else if (l.freq !== undefined) fail(`freq is a tone's pitch; a ${String(l.source)} has none (give noise its colour with filters, and modes their own Hz)`);
    if (l.width !== undefined) {
        if (l.source === 'square') { if (!between(l.width, 0.05, 0.95)) fail('a square\'s width is the share of a cycle it is high, 0.05..0.95'); }
        else if (l.source === 'impulse') { if (!between(l.width, 0.00002, 0.02)) fail('an impulse\'s width is seconds, 0.00002..0.02'); }
        else fail('width is a square\'s or an impulse\'s');
    }
    if (l.band !== undefined) {
        const b = l.band as unknown[];
        if (l.source !== 'noise') fail('band is a noise\'s: [low Hz, high Hz]');
        if (!Array.isArray(b) || b.length !== 2 || !between(b[0], 20, 20000) || !between(b[1], 20, 20000) || (b[0] as number) >= (b[1] as number)) fail('band must be [low Hz, high Hz], 20..20000, the first below the second');
    }
    if (l.wide !== undefined && !(l.source === 'noise' && between(l.wide, 0, 1))) fail('wide is a noise\'s, 0..1');
    if (l.tail !== undefined) {
        const t = l.tail as Record<string, unknown> | null;
        if (l.decay === undefined) fail('tail is the slow part of a decay: give decay too');
        if (typeof t !== 'object' || t === null || !(isNum(t.decay) && t.decay > 0) || !between(t.mix, 0, 1) || Object.keys(t).length !== 2) fail('tail must be { decay: seconds above 0, mix: 0..1 }');
    }
    if (l.color !== undefined && !(l.source === 'noise' && NOISE_COLORS.includes(l.color as never))) fail(`color is a noise's: ${NOISE_COLORS.join(', ')}`);
    if (l.source === 'modes') {
        const modes = l.modes;
        if (!Array.isArray(modes) || modes.length === 0 || modes.length > 64) fail('modes needs `modes`: 1 to 64 of [Hz, loudness, seconds to die away]');
        for (const m of modes as unknown[]) {
            if (!Array.isArray(m) || m.length !== 3 || !between(m[0], 10, 20000) || !between(m[1], 0, 4) || !between(m[2], 0.001, MAX_SOUND_SECONDS)) fail('each mode must be [Hz 10..20000, loudness 0..4, seconds above 0]');
        }
    } else if (l.modes !== undefined) fail('`modes` goes with source "modes"');
    if (l.seed !== undefined && !Number.isInteger(l.seed)) fail('seed must be a whole number');
    if (l.start !== undefined && !between(l.start, 0, duration)) fail(`start must be 0..${duration}, inside the sound`);
    if (l.length !== undefined && !(isNum(l.length) && l.length > 0)) fail('length must be above 0');
    if (l.gain !== undefined && l.source !== 'group') { const bad = curveProblem(l.gain, 0, 4, 'gain'); if (bad) fail(bad); }
    for (const key of ['attack', 'release']) if (l[key] !== undefined && !between(l[key], 0, MAX_SOUND_SECONDS)) fail(`${key} must be seconds, 0 or more`);
    if (l.decay !== undefined && !(isNum(l.decay) && l.decay > 0)) fail('decay must be seconds above 0');
    const wobble = (key: string, deepest: number): void => {
        const w = l[key] as Record<string, unknown> | undefined;
        if (w === undefined) return;
        if (typeof w !== 'object' || w === null || !between(w.rate, 0.01, 2000) || !between(w.depth, 0, deepest) || Object.keys(w).length !== 2) fail(`${key} must be { rate: times a second, depth: 0..${deepest} }`);
    };
    wobble('vibrato', 24);
    wobble('tremolo', 1);
    if (l.fm !== undefined) {
        const fm = l.fm as Record<string, unknown> | null;
        if (!tone) fail('fm bends a tone; noise and modes have no pitch to bend');
        if (typeof fm !== 'object' || fm === null || !between(fm.ratio, 0.01, 64) || Object.keys(fm).some((k) => k !== 'ratio' && k !== 'index')) fail('fm must be { ratio: 0.01..64, index }');
        const bad = curveProblem(fm!.index, 0, 64, 'fm.index');
        if (bad) fail(bad);
    }
    if (l.filters !== undefined) {
        if (!Array.isArray(l.filters) || l.filters.length > 8) fail('filters must be a list of up to 8');
        (l.filters as Record<string, unknown>[]).forEach((f, i) => {
            if (typeof f !== 'object' || f === null) fail(`filter ${i} must be { type, freq, q? }`);
            for (const key of Object.keys(f)) if (!['type', 'freq', 'q', 'gain'].includes(key)) fail(`filter ${i} has unknown "${key}"; it takes type, freq, q, gain`);
            if (f.type === 'peak' ? !between(f.gain, -24, 24) : f.gain !== undefined) fail(`filter ${i}: gain is a peak's, in dB, -24..24`);
            if (!SOUND_FILTERS.includes(f.type as never)) fail(`filter ${i}: type must be one of ${SOUND_FILTERS.join(', ')}`);
            const bad = curveProblem(f.freq, 20, 20000, `filter ${i}: freq`);
            if (bad) fail(bad);
            if (f.q !== undefined && !between(f.q, 0.1, 40)) fail(`filter ${i}: q must be 0.1..40`);
        });
    }
    if (l.drive !== undefined && !between(l.drive, 0, 1)) fail('drive must be 0..1');
    if (l.pan !== undefined && !between(l.pan, -1, 1)) fail('pan must be -1..1');
    if (l.repeat !== undefined) {
        const r = l.repeat as Record<string, unknown> | null;
        if (typeof r !== 'object' || r === null) fail('repeat must be { count, every, gain?, pitch?, jitter? }');
        for (const key of Object.keys(r!)) if (!['count', 'every', 'gain', 'pitch', 'jitter', 'faster'].includes(key)) fail(`repeat has unknown "${key}"; it takes count, every, gain, pitch, jitter, faster`);
        if (r!.faster !== undefined && !between(r!.faster, 0.2, 1)) fail('repeat.faster is how much shorter each gap is than the last, 0.2..1: a thing bouncing to rest');
        if (l.scatter !== undefined) fail('a layer is struck by repeat or by scatter, not both');
        if (!Number.isInteger(r!.count) || (r!.count as number) < 2 || (r!.count as number) > 200) fail('repeat.count must be a whole number, 2..200');
        if (!(isNum(r!.every) && (r!.every as number) > 0)) fail('repeat.every must be seconds above 0');
        if (r!.gain !== undefined && !between(r!.gain, 0, 2)) fail('repeat.gain must be 0..2');
        if (r!.pitch !== undefined && !between(r!.pitch, 0.25, 4)) fail('repeat.pitch must be 0.25..4');
        if (r!.jitter !== undefined && !between(r!.jitter, 0, 1)) fail('repeat.jitter must be 0..1 seconds');
    }
    if (l.scatter !== undefined) {
        const c = l.scatter as Record<string, unknown> | null;
        if (typeof c !== 'object' || c === null) fail('scatter must be { count, over, early?, pitch?, gain?, pan?, fade? }');
        for (const key of Object.keys(c!)) if (!['count', 'over', 'early', 'pitch', 'gain', 'pan', 'fade'].includes(key)) fail(`scatter has unknown "${key}"; it takes count, over, early, pitch, gain, pan, fade`);
        if (!Number.isInteger(c!.count) || (c!.count as number) < 2 || (c!.count as number) > 2000) fail('scatter.count must be a whole number, 2..2000');
        if (!(isNum(c!.over) && (c!.over as number) > 0)) fail('scatter.over must be seconds above 0');
        if (c!.early !== undefined && !between(c!.early, 0.3, 6)) fail('scatter.early must be 0.3..6');
        const range = (key: string, lo: number, hi: number): void => {
            const v = c![key] as unknown[] | undefined;
            if (v === undefined) return;
            if (!Array.isArray(v) || v.length !== 2 || !between(v[0], lo, hi) || !between(v[1], lo, hi) || (v[0] as number) > (v[1] as number)) fail(`scatter.${key} must be [low, high], ${lo}..${hi}`);
        };
        range('pitch', 0.1, 10);
        range('gain', 0, 2);
        for (const key of ['pan', 'fade']) if (c![key] !== undefined && !between(c![key], 0, 1)) fail(`scatter.${key} must be 0..1`);
    }
    if (l.mute !== undefined && typeof l.mute !== 'boolean') fail('mute must be true or false');
    if (l.source === 'group') (l.layers as Record<string, unknown>[]).forEach((c, i) => checkLayer(c, `${where} > layer ${i}${c?.id ? ` "${String(c.id)}"` : ''}`, ids, duration, depth + 1));
}

const SOURCE_FIELDS = ['version', 'duration', 'rate', 'loop', 'variants', 'vary', 'reference', 'layers', 'highpass', 'lowpass', 'echo', 'reverb', 'gain', 'normalize'];

/** The recordings a sound's layers play, each once. */
export function soundSampleFiles(source: Pick<SoundSource, 'layers'>): string[] {
    const files = new Set<string>();
    const walk = (layers: readonly SoundLayer[]): void => { for (const l of layers) { if (l.source === 'sample' && l.file) files.add(l.file); if (l.layers) walk(l.layers); } };
    walk(source.layers);
    return [...files];
}

/** The source if it is well formed; otherwise throws, naming the layer and the field. */
export function validateSoundSource(raw: unknown): SoundSource {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('a sound source must be { duration, layers }');
    const s = raw as Record<string, unknown>;
    for (const key of Object.keys(s)) if (!SOURCE_FIELDS.includes(key)) throw new Error(`unknown field "${key}"; a sound has ${SOURCE_FIELDS.join(', ')}`);
    if (s.version !== undefined && s.version !== SOUND_SOURCE_VERSION) throw new Error(`version ${String(s.version)} is not one this editor reads (${SOUND_SOURCE_VERSION})`);
    if (!(isNum(s.duration) && s.duration > 0 && s.duration <= MAX_SOUND_SECONDS)) throw new Error(`duration must be seconds, above 0 and up to ${MAX_SOUND_SECONDS}`);
    if (s.rate !== undefined && !SOUND_RATES.includes(s.rate as never)) throw new Error(`rate must be one of ${SOUND_RATES.join(', ')}`);
    if (s.loop !== undefined && typeof s.loop !== 'boolean') throw new Error('loop must be true or false');
    if (s.variants !== undefined && !(Number.isInteger(s.variants) && (s.variants as number) >= 1 && (s.variants as number) <= MAX_SOUND_VARIANTS)) throw new Error(`variants must be a whole number, 1..${MAX_SOUND_VARIANTS}`);
    if (s.vary !== undefined && !between(s.vary, 0, 0.3)) throw new Error('vary must be 0..0.3');
    if (s.reference !== undefined && !(typeof s.reference === 'string' && /\.(wav|ogg|mp3|flac|m4a|aac|webm)$/i.test(s.reference))) throw new Error('reference must be a project path to a recording (.wav, .ogg, .mp3, .flac, .m4a)');
    if (s.normalize !== undefined && typeof s.normalize !== 'boolean') throw new Error('normalize must be true or false');
    if (s.gain !== undefined && !between(s.gain, 0, 1)) throw new Error('gain must be 0..1');
    for (const key of ['highpass', 'lowpass']) if (s[key] !== undefined && !between(s[key], 20, 20000)) throw new Error(`${key} must be Hz, 20..20000`);
    if (s.echo !== undefined) {
        const e = s.echo as Record<string, unknown> | null;
        if (typeof e !== 'object' || e === null || !between(e.time, 0.01, 2)) throw new Error('echo must be { time: 0.01..2 seconds, feedback?, mix? }');
        for (const key of Object.keys(e)) if (!['time', 'feedback', 'mix'].includes(key)) throw new Error(`echo has unknown "${key}"; it takes time, feedback, mix`);
        if (e.feedback !== undefined && !between(e.feedback, 0, 0.95)) throw new Error('echo.feedback must be 0..0.95');
        if (e.mix !== undefined && !between(e.mix, 0, 1)) throw new Error('echo.mix must be 0..1');
    }
    if (s.reverb !== undefined) {
        const r = s.reverb as Record<string, unknown> | null;
        if (typeof r !== 'object' || r === null) throw new Error('reverb must be { size?, mix?, kind? }');
        for (const key of Object.keys(r)) if (!['size', 'mix', 'kind'].includes(key)) throw new Error(`reverb has unknown "${key}"; it takes size, mix, kind`);
        if (r.kind !== undefined && !REVERB_KINDS.includes(r.kind as never)) throw new Error(`reverb.kind must be one of ${REVERB_KINDS.join(', ')}`);
        for (const key of ['size', 'mix']) if (r[key] !== undefined && !between(r[key], 0, 1)) throw new Error(`reverb.${key} must be 0..1`);
    }
    if (!Array.isArray(s.layers) || s.layers.length === 0) throw new Error('layers must be a list of one or more');
    if (s.layers.length > 64) throw new Error('a sound has up to 64 layers');
    const ids = new Set<string>();
    (s.layers as Record<string, unknown>[]).forEach((l, i) => checkLayer(l, `layer ${i}${l?.id ? ` "${String(l.id)}"` : ''}`, ids, s.duration as number));
    return { version: SOUND_SOURCE_VERSION, ...(s as unknown as SoundSource) };
}

export type SoundEdit =
    | { op: 'set'; layer: string | number; fields: Record<string, unknown> }
    | { op: 'insert'; layer: SoundLayer; before?: string | number; after?: string | number; into?: string }
    | { op: 'remove'; layer: string | number }
    | { op: 'settings'; fields: Partial<Omit<SoundSource, 'layers' | 'version'>> };

/** The source with @p edits applied, in order. A `null` field removes it. Refuses without changing anything. */
export function applySoundEdits(source: SoundSource, edits: readonly SoundEdit[]): SoundSource {
    const next = JSON.parse(JSON.stringify(source)) as SoundSource & { layers: (SoundLayer & Record<string, unknown>)[] };
    type Row = SoundLayer & Record<string, unknown>;
    const allIds = (list: readonly Row[]): string[] => list.flatMap((l) => [...(l.id ? [l.id] : []), ...allIds((l.layers ?? []) as Row[])]);
    /** The list a layer is in and its place there: by index among the top layers, or by id anywhere, in a group too. */
    const locate = (ref: string | number): { list: Row[]; index: number } => {
        const within = (list: Row[]): { list: Row[]; index: number } | null => {
            for (let i = 0; i < list.length; i++) {
                if (list[i]!.id === ref) return { list, index: i };
                const hit = list[i]!.layers ? within(list[i]!.layers as Row[]) : null;
                if (hit) return hit;
            }
            return null;
        };
        const top = next.layers as Row[];
        const hit = typeof ref === 'number' ? (Number.isInteger(ref) && ref >= 0 && ref < top.length ? { list: top, index: ref } : null) : within(top);
        if (!hit) throw new Error(`no layer ${JSON.stringify(ref)}; ${top.length} layers, ids: ${allIds(top).join(', ') || '(none)'}`);
        return hit;
    };
    for (const edit of edits) {
        switch (edit?.op) {
            case 'set': {
                const at = locate(edit.layer);
                const layer = at.list[at.index]!;
                for (const [key, value] of Object.entries(edit.fields ?? {})) {
                    if (value === null) delete layer[key];
                    else layer[key] = value;
                }
                break;
            }
            case 'insert': {
                // Beside the layer named, in whichever list that is; or, with `into`, at the end of a group.
                if (edit.into !== undefined) {
                    const group = locate(edit.into);
                    const row = group.list[group.index]!;
                    if (row.source !== 'group') throw new Error(`${JSON.stringify(edit.into)} is not a group`);
                    (row.layers as Row[]).push(edit.layer as Row);
                } else if (edit.before !== undefined || edit.after !== undefined) {
                    const at = locate((edit.before ?? edit.after)!);
                    at.list.splice(at.index + (edit.before !== undefined ? 0 : 1), 0, edit.layer as Row);
                } else (next.layers as Row[]).push(edit.layer as Row);
                break;
            }
            case 'remove': {
                const at = locate(edit.layer);
                at.list.splice(at.index, 1);
                break;
            }
            case 'settings':
                for (const [key, value] of Object.entries(edit.fields ?? {})) {
                    if (key === 'layers' || key === 'version') throw new Error(`settings does not take ${key}; use set, insert and remove for layers`);
                    if (value === null) delete (next as unknown as Record<string, unknown>)[key];
                    else (next as unknown as Record<string, unknown>)[key] = value;
                }
                break;
            default:
                throw new Error(`an edit has op ${JSON.stringify((edit as { op?: unknown })?.op)}; there are set, insert, remove, settings`);
        }
    }
    return validateSoundSource(next);
}
