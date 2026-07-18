import { createButton, themeColors, px, Schedule, UIPositionType } from 'esengine';
import type { SceneConfig, SceneManagerState, UIEventQueue, World } from 'esengine';

import { SCENES, FADE_TO_LEVEL_2, goTo } from '../flow';
import { bobSystem } from '../systems/bob';
import { sceneUiRoot, heading, platform, buttonStates } from './build';

export function level1Scene(
    world: World, events: UIEventQueue, scenes: SceneManagerState,
): SceneConfig {
    return {
        name: SCENES.level1,
        // Scene-scoped: installed on load, gated to this scene, removed on unload.
        systems: [{ schedule: Schedule.Update, system: bobSystem }],
        setup(ctx) {
            platform(ctx, world, -220, -120, 200, { r: 0.28, g: 0.72, b: 0.42, a: 1 }, 0.0);
            platform(ctx, world, 0, -40, 160, { r: 0.24, g: 0.58, b: 0.86, a: 1 }, 1.1);
            platform(ctx, world, 210, 40, 180, { r: 0.28, g: 0.72, b: 0.42, a: 1 }, 2.2);
            platform(ctx, world, -60, 130, 140, { r: 0.24, g: 0.58, b: 0.86, a: 1 }, 3.3);

            const c = themeColors();
            const root = sceneUiRoot(ctx, world);
            heading(world, root, 'Level 1');
            createButton({
                world, events, parent: root,
                node: {
                    position: UIPositionType.Absolute,
                    width: px(160), height: px(42),
                    insetRight: px(24), insetBottom: px(40),
                },
                states: buttonStates(c),
                text: { content: 'Next level', fontSize: 15, color: c.onPrimary },
                onClick: () => goTo(scenes, SCENES.level2, FADE_TO_LEVEL_2),
            });
        },
    };
}
