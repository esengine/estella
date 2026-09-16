// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    components.ts
 * @brief   What a project AUTHORS about a decal: how squarely it prints.
 *
 * @details One declaration and no policy, on the shape BakedLighting has. The
 *          engine never reads it — the geometry is cut at creation time and drawn
 *          as an ordinary mesh — so it is a TypeScript component.
 *
 *          WHERE it prints is not here: that is the entity's own Transform, whose
 *          unit cube is the box. A decal is placed, turned and sized with the
 *          gizmo every other object uses.
 */

import { defineComponent, type ComponentDef } from '../ecs/component';
import { DEFAULT_FACING_COSINE } from './clip';

/** The fields of the `DecalProjector` component. @experimental */
export interface DecalProjectorData {
    /** How far from facing the projector a surface may be and still take the
     *  decal, as a cosine. 1 accepts only what squarely faces it; 0 accepts
     *  anything not turned away. */
    facing: number;
    /** What the last cut was OF. Empty until one has run; different from what
     *  the scene reads as now means the decal is out of date. The baker writes it. */
    bakedFrom: string;
}

/**
 * Declares that the entity carrying it prints its material onto what it covers.
 *
 * The result is an ordinary mesh on this same entity's MeshRenderer — so
 * instancing, LOD, culling and picking need to know nothing about decals, and
 * the material's own depth bias is what wins it against the surface.
 *
 * @experimental
 */
export const DecalProjector: ComponentDef<DecalProjectorData> = defineComponent<DecalProjectorData>(
    'DecalProjector',
    { facing: DEFAULT_FACING_COSINE, bakedFrom: '' },
    {
        fields: {
            facing: { min: -1, max: 1, step: 0.05,
                      tooltip: 'How squarely a surface must face the projector to take the decal.' },
            bakedFrom: { advanced: true, tooltip: 'What the last cut read.' },
        },
    },
);
