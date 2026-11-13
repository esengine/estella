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
export const SOUND_RENDER_REVISION = '2';

let pool: JobPool | null | undefined;
/** A piece of music is seconds of work and a sound a fraction of one: each has a worker, so a step is never made behind a theme. */
const MUSIC_WORKER = 0, SOUND_WORKER = 1;

// Made on a worker where the host has workers, so a game goes on drawing frames while its music is played out; in place where it has
// none or once they have failed (a recipe is still a clip then, a slower one to load).
const MAKER: AudioRecipeMaker = {
    revision: SOUND_RENDER_REVISION,
    needs: soundNeeds,
    async make(source, files, path): Promise<ArrayBuffer> {
        const job: SoundJob = { source, path, files: {} };
        for (const [file, bytes] of files) job.files[file] = bytes;
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
