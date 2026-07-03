import {
    defineSystem, Query, Mut, Res, UIEvents, Audio, Text,
} from 'esengine';
import type { UIEventQueue, AudioAPI } from 'esengine';
import { VolumeKnob, VolumeLabel } from '../components';
import { VOLUME_STEPS } from '../config';

function applyBusVolume(audio: AudioAPI, bus: string, v: number): void {
    if (bus === 'master') audio.setMasterVolume(v);
    else if (bus === 'music') audio.setMusicVolume(v);
    else if (bus === 'sfx') audio.setSFXVolume(v);
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

// Clicking a knob steps its bus volume through VOLUME_STEPS; labels mirror each
// bus's current level.
export const volumeSystem = defineSystem(
    [Res(UIEvents), Res(Audio), Query(Mut(VolumeKnob)), Query(Mut(Text), VolumeLabel)],
    (events: UIEventQueue, audio: AudioAPI, knobs, labels) => {
        const clicks = events.query('click');
        const vol: Record<string, number> = {};
        let changed = false;
        for (const [entity, knob] of knobs) {
            if (clicks.some((c) => c.target === entity)) {
                const next = (VOLUME_STEPS.indexOf(knob.volume) + 1) % VOLUME_STEPS.length;
                knob.volume = VOLUME_STEPS[next] ?? 1;
                applyBusVolume(audio, knob.bus, knob.volume);
                changed = true;
            }
            vol[knob.bus] = knob.volume;
        }
        if (changed) {
            for (const [, text, label] of labels) {
                text.content = `${cap(label.bus)}  ${Math.round((vol[label.bus] ?? 1) * 100)}%`;
            }
        }
    },
    { name: 'VolumeSystem' },
);
