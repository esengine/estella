import { defineSystem, Query, Mut, PostProcessVolume, Text } from 'esengine';
import { SceneVolume, TitleLabel, HintLabel } from '../components';
import { SHOWCASES, cloneEffects } from '../config';
import { state } from '../state';

// Apply the first showcase to the scene-wide volume and set the labels.
export const setupSystem = defineSystem(
    [Query(Mut(PostProcessVolume), SceneVolume), Query(Mut(Text), TitleLabel), Query(Mut(Text), HintLabel)],
    (volumes, titles, hints) => {
        const sc = SHOWCASES[state.current];
        for (const [, vol] of volumes) vol.effects = cloneEffects(sc.global);
        for (const [, text] of titles) text.content = sc.name;
        for (const [, text] of hints) text.content = sc.hint;
    },
    { name: 'SetupSystem' },
);
