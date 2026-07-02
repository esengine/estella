import {
    defineSystem, Query, Mut, Res, Commands,
    Input, UIEvents, Sprite, Text,
} from 'esengine';
import type { UIEventQueue } from 'esengine';
import { TexHolder, TitleLabel, PrevButton, NextButton, ShowcaseEmitter } from '../components';
import { SHOWCASES, SHOWCASE_COUNT, spawnShowcase } from '../config';
import { state } from '../state';

// Page through the showcases with the Prev/Next buttons or the arrow keys /
// Space. A click on a button surfaces as a UI 'click' event targeting it. On a
// change, despawn the whole current showcase and spawn the next one, then
// retitle.
export const switchSystem = defineSystem(
    [
        Res(Input), Res(UIEvents),
        Query(PrevButton), Query(NextButton),
        Query(Sprite, TexHolder), Query(ShowcaseEmitter), Query(Mut(Text), TitleLabel),
        Commands(),
    ],
    (input, events: UIEventQueue, prevs, nexts, holders, emitters, titles, cmds) => {
        let dir = 0;
        if (input.isKeyPressed('ArrowRight') || input.isKeyPressed('Space')) dir = 1;
        else if (input.isKeyPressed('ArrowLeft')) dir = -1;

        const clicks = events.query('click');
        for (const [entity] of nexts) if (clicks.some((c) => c.target === entity)) dir = 1;
        for (const [entity] of prevs) if (clicks.some((c) => c.target === entity)) dir = -1;
        if (dir === 0) return;

        state.current = (state.current + dir + SHOWCASE_COUNT) % SHOWCASE_COUNT;
        for (const [entity] of emitters) cmds.despawn(entity);

        let texture = 0;
        for (const [, sprite] of holders) texture = sprite.texture;
        spawnShowcase(cmds, state.current, texture);
        for (const [, text] of titles) text.content = SHOWCASES[state.current].name;
    },
    { name: 'SwitchSystem' },
);
