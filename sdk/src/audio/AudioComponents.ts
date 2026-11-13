// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { defineComponent } from '../ecs/component';
import { AttenuationModel } from './SpatialAudio';

export interface AudioSourceData {
    clip: string;
    bus: string;
    volume: number;
    pitch: number;
    loop: boolean;
    /** With `loop`: seconds into the clip that it comes back to at its end, so an introduction is heard once. 0 is the start. */
    loopStart: number;
    /** Seconds it takes to come up to its volume when `playing` is raised. 0 is at once. */
    fadeIn: number;
    /** Seconds it takes to go down to nothing when `playing` is lowered, after which it stops. 0 is at once. */
    fadeOut: number;
    /**
     * Raise it and the clip sounds; lower it and the voice stops. The engine
     * lowers it again when a non-looping clip ends, so it reads as "is this
     * sounding" — the flag contract TimelinePlayer and SpriteAnimator keep.
     */
    playing: boolean;
    /**
     * Latched true when a non-looping clip reaches its end; cleared when
     * `playing` is raised again. Runtime-observable — don't author it.
     */
    finished: boolean;
    playOnAwake: boolean;
    spatial: boolean;
    minDistance: number;
    maxDistance: number;
    attenuationModel: number;
    rolloff: number;
    priority: number;
    enabled: boolean;
}

export const AudioSource = defineComponent<AudioSourceData>('AudioSource', {
    clip: '',
    bus: 'sfx',
    volume: 1.0,
    pitch: 1.0,
    loop: false,
    loopStart: 0,
    fadeIn: 0,
    fadeOut: 0,
    playing: false,
    finished: false,
    playOnAwake: false,
    spatial: false,
    minDistance: 100,
    maxDistance: 1000,
    attenuationModel: AttenuationModel.Inverse,
    rolloff: 1.0,
    priority: 0,
    enabled: true,
}, {
    assetFields: [{ field: 'clip', type: 'audio' }],
    fields: {
        loopStart: { min: 0, step: 0.1, tooltip: 'With Loop: seconds into the clip that it comes back to at its end, so an introduction plays once. 0 is the start.' },
        fadeIn: { min: 0, step: 0.1, tooltip: 'Seconds to come up to Volume when Playing is raised. 0 is at once.' },
        fadeOut: { min: 0, step: 0.1, tooltip: 'Seconds to go down to nothing when Playing is lowered; it stops after. 0 is at once.' },
        playing: { tooltip: 'Raise to play, lower to stop. The engine lowers it when a non-looping clip ends.' },
        finished: { advanced: true, tooltip: 'Clip completed (runtime, read-only). Raise Playing to play it again.' },
    },
});

export interface AudioListenerData {
    enabled: boolean;
}

/** An entity-owned event definition; all voices share the Audio voice budget. @beta */
export interface SoundEventSourceData {
    event: string;
    seed: number;
    playOnAwake: boolean;
    enabled: boolean;
}

/** Trigger with triggerSoundEventSource or the soundEvent.trigger graph action. @beta */
export const SoundEventSource = defineComponent<SoundEventSourceData>('SoundEventSource', {
    event: '', seed: 0, playOnAwake: false, enabled: true,
}, {
    assetFields: [{ field: 'event', type: 'sound-event' }],
    fields: { seed: { tooltip: 'Fixed 32-bit seed for this source selection stream.' } },
});

export const AudioListener = defineComponent<AudioListenerData>('AudioListener', {
    enabled: true,
});
