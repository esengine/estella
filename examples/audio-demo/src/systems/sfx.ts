import {
    defineSystem, Query, Mut, Res, Time, Input, Audio,
    UIEvents,
} from 'esengine';
import type { UIEventQueue } from 'esengine';
import { SFXTrigger } from '../components';

const SFX_URLS = [
    'assets/audio/kick.wav',
    'assets/audio/snare.wav',
    'assets/audio/hihat.wav',
    'assets/audio/clap.wav',
];

let triggerIndex = 0;

export const sfxTriggerSystem = defineSystem(
    [Query(Mut(SFXTrigger)), Res(Time), Res(Input), Res(UIEvents)],
    (query, time, input, events: UIEventQueue) => {
        triggerIndex = 0;
        for (const [entity, trigger] of query) {
            trigger.cooldown = Math.max(0, trigger.cooldown - time.delta);

            const key = `Digit${triggerIndex + 1}`;
            const clicked = events.hasEvent(entity, 'click');
            if ((input.isKeyPressed(key) || clicked) && trigger.cooldown <= 0) {
                const url = SFX_URLS[triggerIndex];
                if (url) {
                    Audio.playSFX(url);
                }
                trigger.cooldown = 0.1;
            }
            triggerIndex++;
        }
    },
    { name: 'SFXTriggerSystem' }
);
