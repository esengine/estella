import { defineSystem, Res, Audio } from 'esengine';
import type { AudioAPI } from 'esengine';
import { ALL_URLS } from '../config';

// Warm the buffer cache at startup so the first hit plays without latency.
export const preloadSystem = defineSystem(
    [Res(Audio)],
    (audio: AudioAPI) => {
        void audio.preloadAll(ALL_URLS);
    },
    { name: 'PreloadSystem' },
);
