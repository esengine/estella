import {
    defineSystem, Query, Mut, Res, UIEvents, Audio, Text, AudioSource,
} from 'esengine';
import type { UIEventQueue, AudioAPI, AudioSourceData } from 'esengine';
import { BeatToggle, BeatLabel } from '../components';

let beatOn = false;

// Toggle the looping beat on the music bus, fading in/out, and reflect the state
// in the label. Which sound it is comes from the button's AudioSource, not from
// code: the scene names the clip, so the asset system brings it in with it.
export const beatSystem = defineSystem(
    [Res(UIEvents), Res(Audio), Query(AudioSource, BeatToggle), Query(Mut(Text), BeatLabel)],
    (events: UIEventQueue, audio: AudioAPI, toggles, labels) => {
        const clicks = events.query('click');
        let clip: string | null = null;
        for (const [entity, source] of toggles) {
            if (clicks.some((c) => c.target === entity)) clip = (source as AudioSourceData).clip;
        }
        if (clip === null) return;

        beatOn = !beatOn;
        if (beatOn) audio.playBGM(clip, { volume: 0.9, fadeIn: 0.3 });
        else audio.stopBGM(0.3);
        for (const [, text] of labels) text.content = beatOn ? 'Beat: On' : 'Beat: Off';
    },
    { name: 'BeatSystem' },
);
