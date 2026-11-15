// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { renderMusic, validateMusicSource, type MusicSource } from '../src/sound';

const tracks = (chord: string, root: string): Record<string, string> => ({ pad: `${chord} - - - | ${chord} - - -`, bass: `${root} - - - | ${root} - - -` });

const piece = (song: readonly string[], over: Partial<MusicSource> = {}): MusicSource => validateMusicSource({
    tempo: 120, key: 'A', scale: 'minor', humanize: 0, seed: 3, loop: true,
    instruments: {
        pad: { release: 0.5, reverb: 0.4, layers: [{ source: 'sine', freq: 440, gain: 0.6 }, { source: 'sine', freq: 1760, gain: 0.2 }] },
        bass: { octave: -2, release: 0.5, reverb: 0, layers: [{ source: 'sine', freq: 440 }] },
    },
    patterns: { a: { bars: 2, div: 1, tracks: tracks('[1 3 5]', '1') }, b: { bars: 2, div: 1, tracks: tracks("[4 6 1']", '4') } },
    song,
    reverb: { size: 0.4, mix: 0.2 },
    ...over,
});

const mono = (channels: readonly Float32Array[]): Float32Array => channels[0]!.map((v, i) => (v + (channels[1] ?? channels[0]!)[i]!) / 2);

function apartAtTheSeam(over: Partial<MusicSource>): { apart: number; level: number } {
    const cutAtA = renderMusic(piece(['a', 'b'], over)), cutAtB = renderMusic(piece(['b', 'a'], over));
    const [one, other] = [mono(cutAtA.channels), mono(cutAtB.channels)];
    expect(one.length).toBe(other.length);
    const half = one.length / 2, span = Math.round(0.25 * cutAtA.rate);
    let apart = 0, level = 0;
    for (let n = 0; n < span; n++) {
        apart = Math.max(apart, Math.abs(one[n]! - other[half + n]!));
        level = Math.max(level, Math.abs(one[n]!));
    }
    return { apart, level };
}

describe('a piece of music that goes round', () => {
    it('is the same sound wherever the round is cut', () => {
        const { apart, level } = apartAtTheSeam({});
        expect(level).toBeGreaterThan(0.05);
        expect(apart).toBeLessThan(level * 0.01);
    });

    it.each([
        ['a lift of its top', { high: 4 }],
        ['a cut of its top', { high: -4 }],
        ['a lift of its bottom', { low: 6 }],
        ['a cut of its bottom', { low: -6 }],
    ] as const)('is still the same wherever it is cut with %s', (_what, master) => {
        const { apart, level } = apartAtTheSeam({ master });
        expect(level).toBeGreaterThan(0.05);
        expect(apart).toBeLessThan(level * 0.01);
    });

    it('is the same wherever it is cut when its instruments are cut low and high and it is held together', () => {
        const base = piece(['a', 'b']);
        const instruments = { pad: { ...base.instruments.pad!, lowcut: 300, highcut: 1200 }, bass: { ...base.instruments.bass!, highcut: 500 } };
        const { apart, level } = apartAtTheSeam({ instruments, master: { compress: 0.4, low: 3, high: -3 } });
        expect(level).toBeGreaterThan(0.05);
        expect(apart).toBeLessThan(level * 0.02);
    });

    it('a piece that ends is made as it was: its tilt starts from silence', () => {
        const ending = renderMusic(piece(['a', 'b'], { loop: false, master: { high: -4 } }));
        const plain = renderMusic(piece(['a', 'b'], { loop: false }));
        expect(ending.seconds).toBeCloseTo(plain.seconds, 3);
        expect(Math.abs(ending.channels[0]![0]!)).toBeLessThan(1e-3);
    });
});
