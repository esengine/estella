import { defineSystem, Query, Mut, ParticleEmitter } from 'esengine';
import { Follow } from '../components';
import { PRESETS, applyPreset } from '../config';

// Give the scene's follow emitter its starting look (the first preset) once at
// startup, so config.ts is the single source of truth for how a preset looks.
export const setupSystem = defineSystem(
    [Query(Mut(ParticleEmitter), Follow)],
    (follows) => {
        for (const [, emitter] of follows) {
            applyPreset(emitter, PRESETS[0]);
        }
    },
    { name: 'SetupSystem' },
);
