import { defineSystem, GetWorld } from 'esengine';
import type { World } from 'esengine';

import { NAMED, DIFFICULTIES } from '../config';
import { ids, state } from '../state';
import { setText, sliderValue, toggleOn } from '../ui';

// Resolve every control by the name it carries in the scene, once. Nothing here
// builds UI: the panel, the modal and all nine controls are authored, dropped
// from the editor's Create → UI menu, and a system's whole job is what they DO.
export const wireSystem = defineSystem(
    [GetWorld()],
    (world: World) => {
        if (state.wired) return;
        for (const name of NAMED) ids[name] = world.findEntityByName(name);
        // The scene loads asynchronously; without its entities there is nothing
        // to wire and the next frame tries again.
        if (ids.ClickButton == null) return;
        state.wired = true;

        const picked = DIFFICULTIES.find((d) => toggleOn(world, ids[`${d}Toggle`] ?? null));
        setText(world, ids.DifficultyLabel, `Difficulty: ${picked ?? 'none'}`);
        setText(world, ids.VolumeLabel, `Volume  ${Math.round(sliderValue(world, ids.VolumeSlider))}%`);
    },
    { name: 'WireSystem' },
);
