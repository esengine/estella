import { defineSystem, Query, Mut, Res, UINode, Audio } from 'esengine';
import type { AudioAPI } from 'esengine';
import { VisualizerBar } from '../components';
import { SPECTRUM_BINS, BAR_STRIDE } from '../config';

const spectrum = new Uint8Array(SPECTRUM_BINS);
const BASE_H = 6;
const MAX_H = 130;

// Drive each bar's height from a real analyser bin of the master output. Falls
// back to flat bars on backends without analysis (getSpectrum returns false).
export const visualizerSystem = defineSystem(
    [Query(Mut(UINode), VisualizerBar), Res(Audio)],
    (bars, audio: AudioAPI) => {
        const live = audio.getSpectrum(spectrum);
        for (const [, node, bar] of bars) {
            const mag = live ? (spectrum[bar.index * BAR_STRIDE] ?? 0) / 255 : 0;
            node.height = { value: BASE_H + mag * MAX_H, unit: node.height.unit };
        }
    },
    { name: 'VisualizerSystem' },
);
