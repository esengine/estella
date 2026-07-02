import { defineSystem, Query, Mut, Commands, Sprite, Text } from 'esengine';
import { TexHolder, TitleLabel } from '../components';
import { SHOWCASES, spawnShowcase } from '../config';
import { state } from '../state';

// At startup: read the particle texture handle off the invisible TexHolder
// sprite, spawn the first showcase's emitters, and set the title.
export const setupSystem = defineSystem(
    [Query(Sprite, TexHolder), Query(Mut(Text), TitleLabel), Commands()],
    (holders, titles, cmds) => {
        let texture = 0;
        for (const [, sprite] of holders) texture = sprite.texture;
        spawnShowcase(cmds, state.current, texture);
        for (const [, text] of titles) text.content = SHOWCASES[state.current].name;
    },
    { name: 'SetupSystem' },
);
