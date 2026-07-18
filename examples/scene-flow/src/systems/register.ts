import { defineSystem, Res, GetWorld, SceneManager, UIEvents } from 'esengine';
import type { SceneManagerState, UIEventQueue, World } from 'esengine';

import { SCENES } from '../flow';
import { menuScene } from '../scenes/menu';
import { level1Scene } from '../scenes/level1';
import { level2Scene } from '../scenes/level2';

// Registers every scene the game can switch to, then loads the menu. The
// authored .esscene stays loaded underneath as a persistent shell (camera,
// backdrop, Canvas) — plain load() makes 'menu' the active scene without
// unloading it; from then on every hop is a switchTo with a fade.
export const registerScenesSystem = defineSystem(
    [Res(SceneManager), Res(UIEvents), GetWorld()],
    (scenes: SceneManagerState, events: UIEventQueue, world: World) => {
        if (scenes.isLoaded(SCENES.menu)) return;

        scenes.register(menuScene(world, events, scenes));
        scenes.register(level1Scene(world, events, scenes));
        scenes.register(level2Scene(world, events, scenes));

        void scenes.load(SCENES.menu);
    },
    { name: 'RegisterScenesSystem' },
);
