import {
    defineSystem, Query, Mut, Res, Commands,
    Input, UIEvents, PostProcessVolume, Text,
} from 'esengine';
import type { UIEventQueue } from 'esengine';
import { SceneVolume, ShowcaseOwned, TitleLabel, HintLabel, PrevButton, NextButton } from '../components';
import { SHOWCASES, SHOWCASE_COUNT, cloneEffects, spawnLocalVolume } from '../config';
import { state } from '../state';

// Page through the effects with the Prev/Next buttons or the arrow keys / Space.
// On a change, despawn the previous page's entities, rewrite the scene-wide
// volume's effect list, spawn anything the new page needs, then retitle.
export const switchSystem = defineSystem(
    [
        Res(Input), Res(UIEvents),
        Query(PrevButton), Query(NextButton),
        Query(Mut(PostProcessVolume), SceneVolume), Query(ShowcaseOwned),
        Query(Mut(Text), TitleLabel), Query(Mut(Text), HintLabel),
        Commands(),
    ],
    (input, events: UIEventQueue, prevs, nexts, volumes, owned, titles, hints, cmds) => {
        let dir = 0;
        if (input.isKeyPressed('ArrowRight') || input.isKeyPressed('Space')) dir = 1;
        else if (input.isKeyPressed('ArrowLeft')) dir = -1;

        const clicks = events.query('click');
        for (const [entity] of nexts) if (clicks.some((c) => c.target === entity)) dir = 1;
        for (const [entity] of prevs) if (clicks.some((c) => c.target === entity)) dir = -1;
        if (dir === 0) return;

        state.current = (state.current + dir + SHOWCASE_COUNT) % SHOWCASE_COUNT;
        const sc = SHOWCASES[state.current];

        for (const [entity] of owned) cmds.despawn(entity);
        for (const [, vol] of volumes) vol.effects = cloneEffects(sc.global);
        if (sc.local) spawnLocalVolume(cmds);

        for (const [, text] of titles) text.content = sc.name;
        for (const [, text] of hints) text.content = sc.hint;
    },
    { name: 'SwitchSystem' },
);
