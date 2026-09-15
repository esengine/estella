// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    components.ts
 * @brief   What a project AUTHORS about its baked light: how finely, and of what.
 *
 * @details One declaration and no policy, on the shape StreamedWorld has. The
 *          engine never reads it — a bake is a creation-time act — so it is a
 *          TypeScript component: what it carries are the knobs a baker takes and
 *          the fingerprint of the last bake, which is how anything downstream
 *          knows the scene has moved on since.
 */

import { defineComponent, type ComponentDef } from '../ecs/component';
import { BAKE_DEFAULTS } from './bake';

/** The fields of the `BakedLighting` component. @experimental */
export interface BakedLightingData {
    /** Side of the square atlas, in texels. */
    atlasSize: number;
    /** How finely a surface is lit, in texels per world unit. A world unit here
     *  is a design pixel, so a room is hundreds of them across. */
    texelsPerUnit: number;
    /** How many times light is allowed to reflect. Zero is direct light only. */
    bounces: number;
    /** Rays each lumel gathers per bounce. */
    samples: number;
    /** Directions each probe gathers — over the whole sphere, so this buys less
     *  per ray than a lumel's hemisphere does. */
    probeSamples: number;
    /** What the last bake was OF. Empty until one has run; different from what
     *  the scene fingerprints to now means the light is out of date. The baker
     *  writes it — not `readonly`, which means "the engine computes this and the
     *  editor must not project it into the World", and this is neither. */
    bakedFrom: string;
}

/**
 * Declares how the scene carrying it is lit, and what its light was baked from.
 *
 * Presence is not the switch — a scene with nothing to light bakes to nothing
 * either way. It exists so the knobs have one home rather than one per door, and
 * so "out of date" can be asked without re-running the bake to find out.
 *
 * @experimental
 */
export const BakedLighting: ComponentDef<BakedLightingData> = defineComponent<BakedLightingData>(
    'BakedLighting',
    {
        atlasSize: BAKE_DEFAULTS.atlasSize,
        texelsPerUnit: BAKE_DEFAULTS.texelsPerUnit,
        bounces: BAKE_DEFAULTS.bounces,
        samples: BAKE_DEFAULTS.samples,
        probeSamples: BAKE_DEFAULTS.probeSamples,
        bakedFrom: '',
    },
    {
        fields: {
            atlasSize: { min: 64, step: 64, tooltip: 'Side of the square atlas, in texels.' },
            texelsPerUnit: { min: 0.01, step: 0.05, unit: 'tx/wu',
                             tooltip: 'How finely a surface is lit. A world unit is a design pixel.' },
            bounces: { min: 0, max: 8, tooltip: 'How many times light may reflect. 0 = direct only.' },
            samples: { min: 1, tooltip: 'Rays each lumel gathers per bounce.' },
            probeSamples: { min: 1, tooltip: 'Directions each probe gathers, over the whole sphere.' },
            bakedFrom: { advanced: true, tooltip: 'Fingerprint of the inputs the last bake read.' },
        },
    },
);
