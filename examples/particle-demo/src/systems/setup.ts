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
        let hasHolder = false;
        for (const [, sprite] of holders) { texture = sprite.texture; hasHolder = true; }
        // The code-driven gallery depends on the main scene's TexHolder (particle
        // texture) + UI. A scene without them — e.g. the static-emitters showcase,
        // which authors its own ParticleEmitter entities — skips the gallery so the
        // two paths don't overlap.
        if (!hasHolder) return;
        spawnShowcase(cmds, state.current, texture);
        for (const [, text] of titles) text.content = SHOWCASES[state.current].name;
    },
    { name: 'SetupSystem' },
);
