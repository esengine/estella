import {
    defineSystem, Query, Mut, Res, Time, Input, UIEvents, Audio,
} from 'esengine';
import type { UIEventQueue, AudioAPI } from 'esengine';
import { Pad } from '../components';
import { PADS } from '../config';

// Trigger a pad from its key (1-4) or a click, with slight per-hit pitch and pan
// variation so repeats feel alive. cooldown debounces held keys.
export const sfxSystem = defineSystem(
    [Query(Mut(Pad)), Res(Time), Res(Input), Res(UIEvents), Res(Audio)],
    (pads, time, input, events: UIEventQueue, audio: AudioAPI) => {
        const clicks = events.query('click');
        for (const [entity, pad] of pads) {
            pad.cooldown = Math.max(0, pad.cooldown - time.delta);
            const key = `Digit${pad.index + 1}`;
            const hit = input.isKeyPressed(key) || clicks.some((c) => c.target === entity);
            if (hit && pad.cooldown <= 0) {
                const sample = PADS[pad.index];
                if (sample) {
                    audio.playSFX(sample.url, {
                        pitch: 0.9 + Math.random() * 0.2,
                        pan: (Math.random() - 0.5) * 0.6,
                    });
                }
                pad.cooldown = 0.08;
            }
        }
    },
    { name: 'SFXSystem' },
);
