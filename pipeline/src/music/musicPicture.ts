// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  musicPicture.ts — a piece of music drawn for whoever cannot hear it: every note as a bar, when it sounds
 *        across and how high it is up, in its instrument's colour.
 *
 *        What a spectrum shows of music is a smear; what is wrong with a piece is nearly always in its notes, and those
 *        can be drawn exactly. Two lines in one octave lie on top of each other, a bar with nothing in it is a gap, a
 *        bass that never moves is a flat line, and a part that is too full is a block of colour.
 */
import type { RenderedMusic } from './musicRender';

export interface MusicPicture {
    width: number;
    height: number;
    rgba: Uint8Array;
    /** Which colour each instrument is drawn in. */
    colours: Record<string, string>;
    /** The lowest and highest note of the part of the picture where pitch is up, 60 being middle C. */
    low: number;
    high: number;
}

const PALETTE: [string, number, number, number][] = [
    ['blue', 90, 170, 255], ['orange', 255, 160, 70], ['green', 110, 220, 130], ['pink', 255, 120, 190],
    ['yellow', 240, 220, 90], ['cyan', 90, 225, 225], ['red', 255, 95, 95], ['violet', 180, 140, 255],
];

/** The loudness over time on top, the notes by pitch under it, and a row for each instrument that has no pitch. */
export function musicPicture(music: RenderedMusic): MusicPicture {
    const names = Object.keys(music.instruments);
    const bars = Math.max(1, Math.round(music.seconds / music.barSeconds));
    const width = Math.max(768, Math.min(1536, bars * 64));
    const pitched = music.events.filter((e) => e.midi !== null);
    const [low, high] = pitched.length ? [Math.min(...pitched.map((e) => e.midi!)) - 2, Math.max(...pitched.map((e) => e.midi!)) + 2] : [58, 62];
    const row = Math.max(3, Math.min(8, Math.floor(300 / (high - low + 1))));
    const [waveH, rollH] = [48, (high - low + 1) * row];
    const drums = names.filter((n) => music.events.some((e) => e.instrument === n && e.midi === null));
    const [drumRow, gap] = [12, 6];
    const height = waveH + rollH + (drums.length ? gap + drums.length * drumRow : 0);
    const rgba = new Uint8Array(width * height * 4);
    const put = (x: number, y: number, r: number, g: number, b: number, a = 1): void => {
        if (x < 0 || x >= width || y < 0 || y >= height) return;
        const o = (y * width + x) * 4;
        rgba[o] = Math.round(rgba[o]! * (1 - a) + r * a);
        rgba[o + 1] = Math.round(rgba[o + 1]! * (1 - a) + g * a);
        rgba[o + 2] = Math.round(rgba[o + 2]! * (1 - a) + b * a);
        rgba[o + 3] = 255;
    };
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) put(x, y, y < waveH ? 22 : 10, y < waveH ? 24 : 10, y < waveH ? 30 : 16);

    // Loudness: each column from the quietest to the loudest sample it covers.
    const frames = music.channels[0]!.length;
    for (let x = 0; x < width; x++) {
        const [from, to] = [Math.floor((x / width) * frames), Math.floor(((x + 1) / width) * frames)];
        let top = 0;
        for (let n = from; n < to; n++) top = Math.max(top, Math.abs(music.channels[0]![n]!), Math.abs(music.channels[1]![n]!));
        for (let y = Math.round((waveH - 2) * (1 - top)); y < waveH - 1; y++) put(x, y, 120, 214, 255);
    }

    // The rows of the white keys' C, and the black keys darker, as on a keyboard laid on its side.
    for (let midi = low; midi <= high; midi++) {
        const y = waveH + (high - midi) * row;
        const black = [1, 3, 6, 8, 10].includes(((midi % 12) + 12) % 12);
        if (black) for (let dy = 0; dy < row; dy++) for (let x = 0; x < width; x++) put(x, y + dy, 0, 0, 0, 0.35);
        if (midi % 12 === 0) for (let x = 0; x < width; x++) put(x, y + row - 1, 255, 255, 255, 0.22);
    }
    // Every bar, and brighter where a part of the song begins.
    const starts = new Set(music.parts.map((p) => Math.round(p.at / music.barSeconds)));
    for (let b = 0; b <= bars; b++) {
        const x = Math.min(width - 1, Math.round((b * music.barSeconds / music.seconds) * width));
        for (let y = 0; y < height; y++) put(x, y, 255, 255, 255, starts.has(b) ? 0.5 : 0.14);
    }

    const colours: Record<string, string> = {};
    names.forEach((name, i) => { colours[name] = PALETTE[i % PALETTE.length]![0]; });
    for (const e of music.events) {
        const [, r, g, b] = PALETTE[names.indexOf(e.instrument) % PALETTE.length]!;
        const x0 = Math.round((e.at / music.seconds) * width);
        const x1 = Math.max(x0 + 2, Math.round(((e.at + e.seconds) / music.seconds) * width) - 1);
        const strength = Math.max(0.45, Math.min(1, 0.75 * e.loud));
        const [top, tall] = e.midi !== null
            ? [waveH + (high - e.midi) * row, row - (row > 3 ? 1 : 0)]
            : [waveH + rollH + gap + drums.indexOf(e.instrument) * drumRow + 2, drumRow - 4];
        // A drum is drawn as short as it is, not as long as its step.
        const end = e.midi !== null ? x1 : x0 + 3;
        for (let y = top; y < top + tall; y++) for (let x = x0; x < end && x < width; x++) put(x, y, r, g, b, strength);
        // The front of a note is bright, so two of one pitch in a row are seen as two.
        for (let y = top; y < top + tall; y++) put(x0, y, 255, 255, 255, 0.55);
        // A note outside the key has a white line over it.
        if (e.outside) for (let x = x0; x < end && x < width; x++) put(x, top, 255, 255, 255, 0.9);
    }
    for (let x = 0; x < width; x++) put(x, waveH, 90, 96, 110);
    return { width, height, rgba, colours, low, high };
}
