// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    components.ts
 * @brief   What a project AUTHORS about residency: that a world is streamed, what
 *          stays out of the streaming, and who asks for content to be present.
 *
 * @details Three declarations and no policy. The grid is read by the cook, which
 *          is what turns one authored world into a persistent scene plus cells;
 *          the source is read by the streamer, which is the only thing that
 *          decides what exists. Neither is a place to put "load this now" — a
 *          game that could say that has an answer the engine can never make
 *          asynchronous.
 */

import { defineComponent, defineTag, type ComponentDef } from '../ecs/component';

/** The fields of the `StreamedWorld` component. @experimental */
export interface StreamedWorldData {
    /**
     * Edge of one square cell in world units, on the XZ plane. Y does not
     * partition: a cell is a vertical column, so a tower's floors are one place.
     */
    cellSize: number;
    enabled: boolean;
}

/**
 * Declares the scene carrying it a streamed world, and how the cook cuts it.
 *
 * Its entity is persistent by construction — it is what says the world streams.
 * Without this component a scene loads whole, which is what a small one should.
 *
 * @experimental
 */
export const StreamedWorld: ComponentDef<StreamedWorldData> = defineComponent<StreamedWorldData>(
    'StreamedWorld',
    { cellSize: 1000, enabled: true },
    {
        fields: {
            cellSize: { min: 1, unit: 'wu', tooltip: 'Edge of one cell on the XZ plane.' },
        },
    },
);

/**
 * Keeps the entity's whole subtree out of the partition — the player, the camera,
 * the sun, the services that outlive any place.
 *
 * NOT scene persistence (`setPersistent`, which is about surviving a scene
 * SWITCH): this decides which cooked scene an entity is written into.
 *
 * @experimental
 */
export const WorldPersistent: ComponentDef<{}> = defineTag('WorldPersistent');

/** The fields of the `WorldStreamingSource` component. @experimental */
export interface WorldStreamingSourceData {
    /** Cells whose nearest edge is within this distance are asked for. */
    loadRadius: number;
    /**
     * A resident cell is only given up once its nearest edge passes this. Must
     * exceed `loadRadius`: the gap between the two is the band that stops a
     * source standing on a boundary from loading and unloading every frame.
     */
    unloadRadius: number;
    enabled: boolean;
}

/**
 * "Keep the world near me present." Add it beside a `Transform`.
 *
 * A source states a need, never a decision: several may exist and their asks are
 * UNIONED, which is what makes split screen, a spectator, a cinematic camera and
 * an editor preview the same kind of thing.
 *
 * @experimental
 */
export const WorldStreamingSource: ComponentDef<WorldStreamingSourceData> =
    defineComponent<WorldStreamingSourceData>(
        'WorldStreamingSource',
        { loadRadius: 2000, unloadRadius: 3000, enabled: true },
        {
            fields: {
                loadRadius: { min: 0, unit: 'wu', tooltip: 'Cells this close are brought in.' },
                unloadRadius: { min: 0, unit: 'wu', tooltip: 'Resident cells are kept until past this.' },
            },
        },
    );
