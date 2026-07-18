import { createButton, themeColors, px, Schedule, UIPositionType } from 'esengine';
import type { SceneConfig, SceneManagerState, UIEventQueue, World } from 'esengine';

import { SCENES, FADE_TO_MENU, goTo } from '../flow';
import { bobSystem } from '../systems/bob';
import { sceneUiRoot, heading, platform, buttonStates } from './build';

export function level2Scene(
    world: World, events: UIEventQueue, scenes: SceneManagerState,
): SceneConfig {
    return {
        name: SCENES.level2,
        systems: [{ schedule: Schedule.Update, system: bobSystem }],
        setup(ctx) {
            platform(ctx, world, -240, 60, 150, { r: 0.85, g: 0.45, b: 0.25, a: 1 }, 0.0);
            platform(ctx, world, -80, -90, 190, { r: 0.68, g: 0.36, b: 0.85, a: 1 }, 0.9);
            platform(ctx, world, 120, 20, 130, { r: 0.85, g: 0.45, b: 0.25, a: 1 }, 1.8);
            platform(ctx, world, 250, -140, 170, { r: 0.68, g: 0.36, b: 0.85, a: 1 }, 2.7);
            platform(ctx, world, 40, 160, 150, { r: 0.86, g: 0.68, b: 0.28, a: 1 }, 3.6);

            const c = themeColors();
            const root = sceneUiRoot(ctx, world);
            heading(world, root, 'Level 2');
            createButton({
                world, events, parent: root,
                node: {
                    position: UIPositionType.Absolute,
                    width: px(180), height: px(42),
                    insetRight: px(24), insetBottom: px(40),
                },
                states: buttonStates(c),
                text: { content: 'Back to menu', fontSize: 15, color: c.onPrimary },
                onClick: () => goTo(scenes, SCENES.menu, FADE_TO_MENU),
            });
        },
    };
}
