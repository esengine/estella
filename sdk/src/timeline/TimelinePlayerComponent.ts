// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    TimelinePlayerComponent.ts
 * @brief   What plays a timeline on an entity: the component, and the one rule
 *          for reading its wrap mode.
 *
 * @details Separate from the plugin that advances it because it is DATA — the
 *          plugin, the animator's timeline motion, and the AI conditions all
 *          read this shape, and a component living inside the system that ticks
 *          it makes every other reader depend on that system.
 */

import { defineComponent } from '../ecs/component';
import { wrapModeFromName, isWrapModeName, type WrapMode } from './TimelineTypes';

export interface TimelinePlayerData {
    timeline: string;
    playing: boolean;
    speed: number;
    /** Overrides the wrap mode the CLIP declares; empty means the clip's own. */
    wrapMode: string;
    /**
     * Latched true when a Once clip completes; cleared when `playing` is raised
     * again (which replays from the top). Runtime-observable — don't author it.
     */
    finished: boolean;
    /**
     * The names of this player's bindings, and in `bindings` (same order) the entity each is bound to: what a track
     * whose path starts `@Name` animates (Unity's PlayableDirector bindings, UE's possessables). One timeline played by
     * two players can drive two different characters.
     */
    bindingNames: string[];
    bindings: number[];
    /**
     * The stretch of the timeline this player plays (UE's playback range): from `rangeStart` seconds to `rangeEnd`;
     * 0 is the timeline's end. A once timeline finishes at the range's end, a looping one loops within it.
     */
    rangeStart: number;
    rangeEnd: number;
    /** Run on real time rather than the game's: a cutscene or menu animation that plays on while the game is paused
     *  (Time.scale 0), as Unity's Unscaled Game Time. */
    unscaledTime: boolean;
}

/**
 * Which wrap mode a playing clip runs under: the CLIP's, unless the player names
 * one to override it with. A string that is not a wrap mode name is a typo, not
 * a choice, and leaves the clip's own mode standing.
 */
export function resolveWrapMode(playerWrapMode: string, assetWrapMode: WrapMode): WrapMode {
    return isWrapModeName(playerWrapMode) ? wrapModeFromName(playerWrapMode) : assetWrapMode;
}

export const TimelinePlayer = /* @__PURE__ */ defineComponent<TimelinePlayerData>('TimelinePlayer', {
    timeline: '',
    playing: false,
    speed: 1.0,
    wrapMode: '',
    finished: false,
    bindingNames: [],
    bindings: [],
    rangeStart: 0,
    rangeEnd: 0,
    unscaledTime: false,
}, {
    assetFields: [{ field: 'timeline', type: 'timeline' }],
    // Remapped with the scene like any entity reference, so a binding names the entity the scene loads as.
    entityFields: ['bindings'],
    fields: {
        bindings: { rowLabelsFrom: 'bindingNames', tooltip: 'What each of the timeline’s bound tracks (a path starting @Name) animates on this player.' },
        wrapMode: { tooltip: "Override the clip's own wrap mode: once, loop or pingPong. Empty uses what the clip declares." },
        finished: { advanced: true, tooltip: 'Clip completed (runtime, read-only). Raise Playing to replay.' },
        rangeStart: { min: 0, step: 0.05, unit: 's', tooltip: 'Where this player starts in the timeline.' },
        rangeEnd: { min: 0, step: 0.05, unit: 's', tooltip: 'Where it ends, or loops back from; 0 is the timeline’s end.' },
        unscaledTime: { tooltip: 'Run on real time, on while the game is paused (Time.scale 0).' },
    },
});
