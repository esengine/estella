// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    index.ts
 * @brief   `esengine/sound`: sounds and music made from their sources, in the editor that bakes them and on the device that plays them.
 *
 * @details Importing this module installs the maker of audio recipes (see asset/audioRecipe.ts): a clip named by its `.essound` or
 *          `.esmusic` is then made where it is loaded, and the package carries the source in place of the samples.
 */
import { makeSound, soundNeeds, type SoundJob } from './soundWorker';
import { SOUND_WORKER_SOURCE } from './soundWorkerBundle.generated';
import { setAudioRecipeMaker, type AudioRecipeMaker } from '../asset/audioRecipe';
import { createJobPool, type JobPool } from '../runtime/jobs';

export * from './soundSource';
export * from './soundRender';
export * from './musicSource';
export * from './musicRender';
export { fft } from './fft';
export { makeSound, soundNeeds, type SoundJob } from './soundWorker';

/**
 * How the synthesis sounds, as a name. Bump it whenever the same source would come out as other samples: a clip made by an earlier
 * run is kept under it, and an old one would otherwise be played for the new.
 */
export const SOUND_RENDER_REVISION = '4';

let pool: JobPool | null | undefined;
/** A piece of music is seconds of work and a sound a fraction of one: each has a worker, so a step is never made behind a theme. */
const MUSIC_WORKER = 0, SOUND_WORKER = 1;
const SAMPLE_DECODE_RATE = 44100;

const isWav = (bytes: ArrayBuffer): boolean => {
    const head = new Uint8Array(bytes, 0, Math.min(12, bytes.byteLength));
    return head.length === 12 && String.fromCharCode(...head.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...head.subarray(8, 12)) === 'WAVE';
};

/**
 * A sample a recipe plays, as the `.wav` the synthesis reads. A package may carry it compressed (the cook encodes a clip whose import
 * settings allow it); the host decodes that here, where there is an audio context to do it, and what cannot be decoded goes on as it is
 * for the synthesis to refuse by name.
 */
async function asWav(bytes: ArrayBuffer): Promise<ArrayBuffer> {
    if (isWav(bytes) || typeof OfflineAudioContext === 'undefined') return bytes;
    let decoded: AudioBuffer;
    try {
        decoded = await new OfflineAudioContext(1, 1, SAMPLE_DECODE_RATE).decodeAudioData(bytes.slice(0));
    } catch {
        return bytes;
    }
    const channels = decoded.numberOfChannels, frames = decoded.length;
    const out = new DataView(new ArrayBuffer(44 + frames * channels * 2));
    const text = (at: number, value: string): void => { for (let i = 0; i < value.length; i++) out.setUint8(at + i, value.charCodeAt(i)); };
    text(0, 'RIFF'); out.setUint32(4, 36 + frames * channels * 2, true); text(8, 'WAVE'); text(12, 'fmt ');
    out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, channels, true);
    out.setUint32(24, decoded.sampleRate, true); out.setUint32(28, decoded.sampleRate * channels * 2, true);
    out.setUint16(32, channels * 2, true); out.setUint16(34, 16, true); text(36, 'data'); out.setUint32(40, frames * channels * 2, true);
    const data = Array.from({ length: channels }, (_, channel) => decoded.getChannelData(channel));
    for (let frame = 0, at = 44; frame < frames; frame++) {
        for (let channel = 0; channel < channels; channel++, at += 2) out.setInt16(at, Math.round(Math.max(-1, Math.min(1, data[channel]![frame]!)) * 32767), true);
    }
    return out.buffer;
}

// Made on a worker where the host has workers, so a game goes on drawing frames while its music is played out; in place where it has
// none or once they have failed (a recipe is still a clip then, a slower one to load).
const MAKER: AudioRecipeMaker = {
    revision: SOUND_RENDER_REVISION,
    needs: soundNeeds,
    async make(source, files, path): Promise<ArrayBuffer> {
        const job: SoundJob = { source, path, files: {} };
        for (const [file, bytes] of files) job.files[file] = await asWav(bytes);
        if (pool === undefined) pool = createJobPool(SOUND_WORKER_SOURCE, 2);
        if (pool) {
            try {
                return await pool.run<ArrayBuffer>(/\.esmusic(\?|$)/i.test(path) ? MUSIC_WORKER : SOUND_WORKER, { ...job });
            } catch (err) {
                const why = err instanceof Error ? err.message : String(err);
                // What the source itself is refused for is the answer; only a worker that cannot do the job sends it back here.
                if (/^(a job worker failed|the job workers have stopped|the job pool was disposed)/.test(why)) pool = null;
                else throw err;
            }
        }
        return makeSound(job);
    },
};

/** Installs the maker of audio recipes: what importing this module does, and a way back for whoever took it out. */
export function installAudioRecipes(): void {
    setAudioRecipeMaker(MAKER);
}

installAudioRecipes();
