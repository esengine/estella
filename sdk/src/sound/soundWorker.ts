// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    soundWorker.ts
 * @brief   A sound or a piece of music made from its source, and the thread that does it away from the game's.
 *
 * @details A piece of music is seconds of work for a minute of sound: made on the game's thread it is a frame that long. The same
 *          function runs here, on a job-pool worker, and in place where a host has no workers.
 */
import { validateMusicSource, musicSampleFiles, type MusicSource } from './musicSource';
import { renderMusic } from './musicRender';
import { decodeWav, encodeWav, renderSound, type SoundRecording } from './soundRender';
import { soundSampleFiles, validateSoundSource, type SoundSource } from './soundSource';

export interface SoundJob {
    /** The text of the `.essound` or `.esmusic`. */
    source: string;
    /** Its project path, which says which of the two it is. */
    path: string;
    /** The recordings it plays, by project path, as the bytes of their files. */
    files: Record<string, ArrayBuffer>;
}

const isMusic = (path: string): boolean => /\.esmusic(\?|$)/i.test(path);

function parsed(job: Pick<SoundJob, 'source' | 'path'>): { music: MusicSource } | { sound: SoundSource } {
    let raw: unknown;
    try { raw = JSON.parse(job.source); } catch { throw new Error(`${job.path} is not JSON`); }
    return isMusic(job.path) ? { music: validateMusicSource(raw) } : { sound: validateSoundSource(raw) };
}

/** The recordings a source plays, by project path: a sampled instrument's notes, a sample layer's file. */
export function soundNeeds(source: string, path: string): string[] {
    const made = parsed({ source, path });
    if ('sound' in made) return soundSampleFiles(made.sound);
    const files = new Set(musicSampleFiles(made.music));
    for (const instrument of Object.values(made.music.instruments)) for (const file of soundSampleFiles({ layers: instrument.layers ?? [] })) files.add(file);
    return [...files];
}

/** The clip of a source, as the bytes of a 16-bit `.wav`. A sound with variants is its first: the others are the sound event's. */
export function makeSound(job: SoundJob): ArrayBuffer {
    const given: Record<string, SoundRecording> = {};
    for (const [file, bytes] of Object.entries(job.files)) {
        if (!/\.wav$/i.test(file)) throw new Error(`${job.path} plays ${file}, and a recipe plays .wav recordings only`);
        const read = decodeWav(new Uint8Array(bytes));
        given[file] = { rate: read.rate, channels: read.channels };
    }
    const made = parsed(job);
    const out = 'sound' in made ? renderSound(made.sound, 0, { given }) : renderMusic(made.music, given);
    const wav = encodeWav({ rate: out.rate, channels: out.channels });
    return (wav.byteOffset === 0 && wav.byteLength === wav.buffer.byteLength ? wav.buffer : wav.slice().buffer) as ArrayBuffer;
}

interface WorkerScope {
    document?: unknown;
    onmessage: ((e: { data: SoundJob & { id: number } }) => void) | null;
    postMessage(m: unknown, transfer?: ArrayBuffer[]): void;
}
declare const self: WorkerScope | undefined;

if (typeof self !== 'undefined' && typeof self.document === 'undefined') {
    const scope = self;
    scope.onmessage = (e) => {
        const job = e.data;
        try {
            const wav = makeSound(job);
            scope.postMessage({ id: job.id, result: wav }, [wav]);
        } catch (err) {
            scope.postMessage({ id: job.id, error: err instanceof Error ? err.message : String(err) });
        }
    };
}
