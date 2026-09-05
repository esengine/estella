import {
    defineSystem, Res, Query, Mut,
    Text, UIVisual,
} from 'esengine';
import { HealthMeter, ObjectiveText, PromptText, OverlayText } from '../components';
import { Run, MAX_HEALTH, CORES_NEEDED, type RunData } from '../resources';

const clock = (seconds: number): string => {
    const s = Math.max(0, Math.floor(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * Everything the player is told, in one pass. Four lines and a bar: what is
 * left of them, what they are here for, what this key would do, and — only when
 * the run has stopped — why and how to go on.
 */
export const hudSystem = defineSystem(
    [
        Res(Run),
        Query(Mut(UIVisual), HealthMeter),
        Query(Mut(Text), ObjectiveText),
        Query(Mut(Text), PromptText),
        Query(Mut(Text), OverlayText),
    ],
    (run: RunData, meters, objectives, prompts, overlays) => {
        for (const [, fill] of meters) {
            fill.fillAmount = Math.max(0, Math.min(1, run.health / MAX_HEALTH));
        }
        for (const [, text] of objectives) {
            text.content = run.cores >= CORES_NEEDED
                ? `cores ${run.cores}/${CORES_NEEDED} — the gate will open now   ${clock(run.elapsed)}`
                : `cores ${run.cores}/${CORES_NEEDED}   ${clock(run.elapsed)}`;
        }
        for (const [, text] of prompts) {
            text.content = run.phase === 'playing' ? run.prompt : '';
        }
        for (const [, text] of overlays) {
            text.content =
                run.phase === 'paused' ? 'PAUSED\n\nEsc — continue      R — start over'
                : run.phase === 'dead' ? 'YOU FELL\n\nE — from the last marker      R — start over'
                : run.phase === 'won' ? `THE ARCHIVE OPENS\n\n${clock(run.elapsed)}\n\nR — again`
                : '';
        }
    },
    { name: 'HudSystem' },
);

/** The opening line, replaced by the first real objective the moment one exists. */
export const openingSystem = defineSystem(
    [Res(Run), Query(Mut(Text), ObjectiveText)],
    (run: RunData, objectives) => {
        if (run.elapsed > 6 || run.phase !== 'playing') return;
        for (const [, text] of objectives) {
            text.content = 'WASD to walk · mouse to look · Shift to run · Space to jump';
        }
    },
    { name: 'OpeningSystem' },
);
