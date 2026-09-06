import {
    defineSystem, Res, ResMut, Query, Mut,
    Text, UIVisual, Health, Playthrough, type PlaythroughData,
} from 'esengine';
import { Runner, HealthMeter, ObjectiveText, PromptText, OverlayText } from '../components';
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
        Query(Health, Runner),
        Query(Mut(UIVisual), HealthMeter),
        Query(Mut(Text), ObjectiveText),
        Query(Mut(Text), PromptText),
        Query(Mut(Text), OverlayText),
    ],
    (run: RunData, runners, meters, objectives, prompts, overlays) => {
        let health = 0;
        for (const [, hp] of runners) health = hp.current;
        for (const [, fill] of meters) {
            fill.fillAmount = Math.max(0, Math.min(1, health / MAX_HEALTH));
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

/**
 * The same run, stated for automation rather than for the player. A HUD is read
 * by eye and proves nothing to a gate; these are the facts a playthrough is
 * judged on, published by the game that owns them.
 */
export const factsSystem = defineSystem(
    [Res(Run), Query(Health, Runner), ResMut(Playthrough)],
    (run: RunData, runners, factsMut) => {
        let health = 0;
        for (const [, hp] of runners) health = hp.current;
        const out = factsMut.get() as PlaythroughData;
        out.facts = {
            phase: run.phase,
            health,
            dead: run.phase === 'dead',
            paused: run.phase === 'paused',
            victory: run.phase === 'won',
            cores: run.cores,
            coresNeeded: CORES_NEEDED,
            gateOpen: run.cores >= CORES_NEEDED,
            checkpointZ: run.respawn.z,
            elapsed: Math.round(run.elapsed),
        };
    },
    { name: 'PlaythroughFactsSystem' },
);
