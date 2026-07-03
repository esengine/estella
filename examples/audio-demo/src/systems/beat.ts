import {
    defineSystem, Query, Mut, Res, UIEvents, Audio, Text,
} from 'esengine';
import type { UIEventQueue, AudioAPI } from 'esengine';
import { BeatToggle, BeatLabel } from '../components';
import { BEAT_URL } from '../config';

let beatOn = false;

// Toggle the looping beat on the music bus, fading in/out, and reflect the state
// in the label.
export const beatSystem = defineSystem(
    [Res(UIEvents), Res(Audio), Query(BeatToggle), Query(Mut(Text), BeatLabel)],
    (events: UIEventQueue, audio: AudioAPI, toggles, labels) => {
        const clicks = events.query('click');
        let toggled = false;
        for (const [entity] of toggles) if (clicks.some((c) => c.target === entity)) toggled = true;
        if (!toggled) return;

        beatOn = !beatOn;
        if (beatOn) audio.playBGM(BEAT_URL, { volume: 0.9, fadeIn: 0.3 });
        else audio.stopBGM(0.3);
        for (const [, text] of labels) text.content = beatOn ? 'Beat: On' : 'Beat: Off';
    },
    { name: 'BeatSystem' },
);
