// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  soundFont.ts — a SoundFont (`.sf2`) read for what a piece of music needs of it: which instruments it holds,
 *        and one of them taken out as recordings with the note, range, tuning and loop of each.
 *
 *        A SoundFont is a bank of instruments in one file: every recording end to end in one block, and tables that
 *        say which stretch of it is which note of which instrument. Nothing here plays one. An instrument is lifted
 *        out as the `samples` a music source takes (musicSource.ts) and the recordings as samples to be written as
 *        `.wav` files, after which the SoundFont is not needed: the project holds what it uses and no more.
 *
 *        What a SoundFont can say and this does not carry over: its filters and envelopes beyond attack and release,
 *        its modulators, and the second side of a recording made in stereo.
 */
import type { MusicSample } from './musicSource';
import type { SampleData } from './musicRender';

export interface SoundFontPreset {
    /** Its place in the file, which is how it is asked for. */
    index: number;
    name: string;
    /** The General MIDI numbers it answers to: bank 0 program 0 is a grand piano, bank 128 is drums. */
    bank: number;
    program: number;
    /** How many recordings it plays, and the notes they cover between them. */
    recordings: number;
    low: number;
    high: number;
}

interface Zone { sample: number; keyLow: number; keyHigh: number; velLow: number; velHigh: number; root: number; cents: number; loop: boolean; offsets: [number, number, number, number]; attack: number | null; release: number | null }
interface SampleHeader { name: string; start: number; end: number; loopStart: number; loopEnd: number; rate: number; pitch: number; correction: number; type: number }

export interface SoundFont {
    name: string;
    presets: SoundFontPreset[];
    /** @internal */ zones: Zone[][];
    /** @internal */ headers: SampleHeader[];
    /** @internal */ data: Int16Array;
}

// The generators read here, by their numbers in the format.
const GEN = { startOffset: 0, endOffset: 1, loopStartOffset: 2, loopEndOffset: 3, startCoarse: 4, endCoarse: 12, attack: 34, release: 38, instrument: 41, keyRange: 43, velRange: 44, loopStartCoarse: 45, loopEndCoarse: 50, coarseTune: 51, fineTune: 52, sampleId: 53, sampleModes: 54, rootKey: 58 } as const;

type Generators = Map<number, number>;
const signed = (v: number): number => (v > 32767 ? v - 65536 : v);

/** The file read. Throws on what is not a SoundFont, saying what was found. */
export function readSoundFont(bytes: Uint8Array): SoundFont {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const tag = (at: number): string => String.fromCharCode(bytes[at]!, bytes[at + 1]!, bytes[at + 2]!, bytes[at + 3]!);
    const text = (at: number, length: number): string => { let s = ''; for (let i = 0; i < length && bytes[at + i]; i++) s += String.fromCharCode(bytes[at + i]!); return s.trim(); };
    if (bytes.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'sfbk') throw new Error('not a SoundFont: it does not begin RIFF....sfbk');

    const chunks = new Map<string, { at: number; size: number }>();
    let name = '';
    const walk = (from: number, to: number): void => {
        for (let at = from; at + 8 <= to;) {
            const size = view.getUint32(at + 4, true);
            if (tag(at) === 'LIST') walk(at + 12, Math.min(to, at + 8 + size));
            else {
                chunks.set(tag(at), { at: at + 8, size: Math.min(size, bytes.length - at - 8) });
                if (tag(at) === 'INAM') name = text(at + 8, size);
            }
            at += 8 + size + (size & 1);
        }
    };
    walk(12, bytes.length);
    for (const need of ['smpl', 'phdr', 'pbag', 'pgen', 'inst', 'ibag', 'igen', 'shdr']) if (!chunks.has(need)) throw new Error(`a SoundFont with no "${need}" table in it`);
    const of = (id: string): { at: number; size: number } => chunks.get(id)!;

    const smpl = of('smpl');
    // The recordings: every one of them end to end, 16 bits a sample.
    const data = new Int16Array(Math.floor(smpl.size / 2));
    for (let i = 0; i < data.length; i++) data[i] = view.getInt16(smpl.at + i * 2, true);

    const headers: SampleHeader[] = [];
    for (let at = of('shdr').at; at + 46 <= of('shdr').at + of('shdr').size - 46; at += 46) {
        headers.push({
            name: text(at, 20), start: view.getUint32(at + 20, true), end: view.getUint32(at + 24, true), loopStart: view.getUint32(at + 28, true), loopEnd: view.getUint32(at + 32, true),
            rate: view.getUint32(at + 36, true), pitch: bytes[at + 40]!, correction: view.getInt8(at + 41), type: view.getUint16(at + 44, true),
        });
    }

    /** The generators of each zone of the thing whose bags run from @p first to @p last. */
    const zonesOf = (bag: string, gen: string, first: number, last: number): Generators[] => {
        const out: Generators[] = [];
        for (let b = first; b < last; b++) {
            const [from, to] = [view.getUint16(of(bag).at + b * 4, true), view.getUint16(of(bag).at + (b + 1) * 4, true)];
            const zone: Generators = new Map();
            for (let g = from; g < to; g++) zone.set(view.getUint16(of(gen).at + g * 4, true), view.getUint16(of(gen).at + g * 4 + 2, true));
            out.push(zone);
        }
        return out;
    };
    const instruments = Math.floor(of('inst').size / 22) - 1;
    const instrumentZones = (index: number): Generators[] => (index < 0 || index >= instruments ? []
        : zonesOf('ibag', 'igen', view.getUint16(of('inst').at + index * 22 + 20, true), view.getUint16(of('inst').at + (index + 1) * 22 + 20, true)));
    const range = (zone: Generators, id: number): [number, number] => { const v = zone.get(id); return v === undefined ? [0, 127] : [v & 255, v >> 8]; };
    const seconds = (timecents: number | undefined): number | null => (timecents === undefined ? null : Math.pow(2, signed(timecents) / 1200));

    const presets: SoundFontPreset[] = [];
    const zones: Zone[][] = [];
    const count = Math.floor(of('phdr').size / 38) - 1;
    for (let p = 0; p < count; p++) {
        const at = of('phdr').at + p * 38;
        const mine: Zone[] = [];
        let presetGlobal: Generators = new Map();
        for (const pz of zonesOf('pbag', 'pgen', view.getUint16(at + 24, true), view.getUint16(at + 38 + 24, true))) {
            // A zone that names no instrument is what the others start from.
            if (!pz.has(GEN.instrument)) { presetGlobal = pz; continue; }
            const [pk, pv] = [range(pz, GEN.keyRange), range(pz, GEN.velRange)];
            const add = (id: number): number => signed(pz.get(id) ?? presetGlobal.get(id) ?? 0);
            let global: Generators = new Map();
            for (const iz of instrumentZones(pz.get(GEN.instrument)!)) {
                if (!iz.has(GEN.sampleId)) { global = iz; continue; }
                const get = (id: number): number | undefined => iz.get(id) ?? global.get(id);
                const header = headers[iz.get(GEN.sampleId)!];
                // The right-hand half of a stereo pair, and what lives in a sound card's ROM: left out.
                if (!header || header.type === 2 || header.type & 0x8000) continue;
                const [ik, iv] = [range(iz.has(GEN.keyRange) ? iz : global, GEN.keyRange), range(iz.has(GEN.velRange) ? iz : global, GEN.velRange)];
                const [keyLow, keyHigh, velLow, velHigh] = [Math.max(ik[0], pk[0]), Math.min(ik[1], pk[1]), Math.max(iv[0], pv[0]), Math.min(iv[1], pv[1])];
                if (keyLow > keyHigh || velLow > velHigh) continue;
                const rootKey = get(GEN.rootKey);
                mine.push({
                    sample: iz.get(GEN.sampleId)!, keyLow, keyHigh, velLow, velHigh,
                    root: rootKey !== undefined && signed(rootKey) >= 0 ? rootKey : header.pitch <= 127 ? header.pitch : 60,
                    cents: (signed(get(GEN.coarseTune) ?? 0) + add(GEN.coarseTune)) * 100 + signed(get(GEN.fineTune) ?? 0) + add(GEN.fineTune) + header.correction,
                    loop: ((get(GEN.sampleModes) ?? 0) & 1) === 1,
                    offsets: [
                        signed(get(GEN.startOffset) ?? 0) + signed(get(GEN.startCoarse) ?? 0) * 32768, signed(get(GEN.endOffset) ?? 0) + signed(get(GEN.endCoarse) ?? 0) * 32768,
                        signed(get(GEN.loopStartOffset) ?? 0) + signed(get(GEN.loopStartCoarse) ?? 0) * 32768, signed(get(GEN.loopEndOffset) ?? 0) + signed(get(GEN.loopEndCoarse) ?? 0) * 32768,
                    ],
                    attack: seconds(get(GEN.attack)), release: seconds(get(GEN.release)),
                });
            }
        }
        zones.push(mine);
        presets.push({
            index: p, name: text(at, 20), program: view.getUint16(at + 20, true), bank: view.getUint16(at + 22, true), recordings: new Set(mine.map((z) => z.sample)).size,
            low: mine.length ? Math.min(...mine.map((z) => z.keyLow)) : 0, high: mine.length ? Math.max(...mine.map((z) => z.keyHigh)) : 0,
        });
    }
    return { name, presets, zones, headers, data };
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = (midi: number): string => `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;

export interface LiftedInstrument {
    /** What a music source's instrument takes: `samples`, and how its notes come in and are let go where the SoundFont says. */
    instrument: { samples: MusicSample[]; attack?: number; release?: number };
    /** The recordings, by the path each sample names: to be written as `.wav` files there. */
    files: Record<string, SampleData>;
    notes: string[];
}

/**
 * One instrument of a SoundFont as the `samples` of a music source, its recordings named under @p dir. Each keeps the
 * note it is a recording of, the notes it is for, how far out of tune it is, where it goes round, and whether it was
 * made soft or loud.
 */
export function liftSoundFontPreset(font: SoundFont, index: number, dir: string): LiftedInstrument {
    const preset = font.presets[index];
    if (!preset) throw new Error(`there is no instrument ${index} in this SoundFont; it has ${font.presets.length}, numbered from 0`);
    const zones = font.zones[index]!;
    if (zones.length === 0) throw new Error(`"${preset.name}" has no recordings that can be read`);
    if (zones.length > 256) throw new Error(`"${preset.name}" is ${zones.length} recordings, and an instrument takes 256`);
    const notes: string[] = [];
    const files: Record<string, SampleData> = {};
    const named = new Map<string, string>();
    const taken = new Set<string>();
    const folder = dir.replace(/\\/g, '/').replace(/\/+$/, '');
    // Hard and soft only mean something where the instrument has more than one of them for a note.
    const layered = zones.some((z) => z.velLow > 0 || z.velHigh < 127);
    const ranged = zones.length > 1;

    const samples = zones.map((zone): MusicSample => {
        const header = font.headers[zone.sample]!;
        const [from, to] = [Math.max(0, header.start + zone.offsets[0]), Math.min(font.data.length, header.end + zone.offsets[1])];
        const key = `${zone.sample}|${from}|${to}`;
        let file = named.get(key);
        if (!file) {
            const base = (header.name.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || `sample${zone.sample}`).slice(0, 40);
            let leaf = base;
            for (let n = 2; taken.has(leaf.toLowerCase()); n++) leaf = `${base}_${n}`;
            taken.add(leaf.toLowerCase());
            file = `${folder}/${leaf}.wav`;
            named.set(key, file);
            const channel = new Float32Array(Math.max(1, to - from));
            for (let n = 0; n < channel.length; n++) channel[n] = font.data[from + n]! / 32768;
            files[file] = { rate: header.rate || 44100, channels: [channel] };
        }
        // Played `cents` higher than its root says: the same as a recording of a note that much lower.
        const exact = zone.root - zone.cents / 100;
        const note = Math.max(0, Math.min(127, Math.round(exact)));
        const tune = Math.round((exact - note) * 100);
        const [loopFrom, loopTo] = [(header.loopStart + zone.offsets[2] - from) / (header.rate || 44100), (header.loopEnd + zone.offsets[3] - from) / (header.rate || 44100)];
        const mid = (zone.velLow + zone.velHigh) / 2;
        return {
            file, note: noteName(note),
            ...(ranged ? { low: noteName(zone.keyLow), high: noteName(zone.keyHigh) } : {}),
            ...(tune !== 0 ? { tune: Math.max(-100, Math.min(100, tune)) } : {}),
            // Often a single turn of the wave, a few thousandths of a second: that is how a SoundFont holds a tone.
            ...(zone.loop && loopFrom >= 0 && loopTo > loopFrom + 0.0005 ? { loop: [Math.round(loopFrom * 1e5) / 1e5, Math.round(loopTo * 1e5) / 1e5] as const } : {}),
            ...(layered && mid < 56 ? { dynamic: 'soft' as const } : layered && mid > 104 ? { dynamic: 'loud' as const } : {}),
        };
    });

    const [attacks, releases] = [zones.map((z) => z.attack).filter((v): v is number => v !== null), zones.map((z) => z.release).filter((v): v is number => v !== null)];
    const middle = (list: number[]): number => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)]!;
    const attack = attacks.length ? Math.min(2, middle(attacks)) : 0;
    const release = releases.length ? Math.max(0.05, Math.min(4, middle(releases))) : 0;
    if (preset.bank === 128) notes.push(`"${preset.name}" is a drum kit: each key is another drum, so a step plays the drum on that note and not a pitch`);
    return {
        instrument: { samples, ...(attack > 0.01 ? { attack: Math.round(attack * 1000) / 1000 } : {}), ...(release > 0 ? { release: Math.round(release * 1000) / 1000 } : {}) },
        files, notes,
    };
}
