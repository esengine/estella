// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    waterCaustics.ts
 * @brief   The net of light a rippled surface throws on what is under it, as one pattern the Water shader and the Underwater effect both draw.
 *
 * @details A wave focuses the sun where its surface curves like a lens, and the light on the bottom is a web of bright threads on a darker ground that
 *          swims as the waves move. This is not a simulation of that: it is the picture of it, made from two fields of value noise drifting past each
 *          other at three scales. Where the two fields are equal is a bright thread, and the threads of the three scales laid over one another make
 *          the web. It needs only a position on the surface and the time, so the same pattern is found wherever it is asked, from above the water through
 *          the surface (the Water shader, lighting what it refracts) and from below it (the Underwater effect, lighting what the camera sees and the
 *          light it walks through).
 *
 *          The pattern is written once per shading language and placed in each shader's source; the scale, the speed and the strength are the
 *          Water material's, and the Underwater effect is given the same ones, so the two halves agree about what the light is doing.
 */

import { MOST_WATER_CAUSTIC_LAYERS } from './qualitySettings/water';

export const CAUSTICS_GLSL = `float causticHash(vec2 p) {
    p = fract(p * vec2(0.1031, 0.1030));
    p += dot(p, p.yx + 33.33);
    return fract((p.x + p.y) * p.x);
}
float causticNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(causticHash(i), causticHash(i + vec2(1.0, 0.0)), f.x),
               mix(causticHash(i + vec2(0.0, 1.0)), causticHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float causticPattern(vec2 p, float t, float layers) {
    float sum = 0.0;
    float weight = 1.0;
    float norm = 0.0;
    for (int i = 0; i < ${MOST_WATER_CAUSTIC_LAYERS}; ++i) {
        if (float(i) >= layers) break;
        float s = exp2(float(i));
        float a = causticNoise(p * s + vec2(0.31, 0.12) * t * (1.0 + 0.3 * float(i)) + 7.0 * float(i));
        float b = causticNoise(p * s * 1.37 - vec2(0.17, 0.4) * t * (1.0 + 0.2 * float(i)) + 31.0 * float(i));
        float thread = max(1.0 - abs(a - b) * 3.2, 0.0);
        sum += weight * thread * thread * thread * thread;
        norm += weight;
        weight *= 0.55;
    }
    return clamp(sum / norm * 2.2, 0.0, 1.0);
}
`;
