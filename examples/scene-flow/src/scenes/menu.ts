import {
    createButton, spawnUIEntity, themeColors, px, percent, UIPositionType,
} from 'esengine';
import type { SceneConfig, SceneManagerState, UIEventQueue, World } from 'esengine';

import { SCENES, FADE_TO_LEVEL_1, goTo } from '../flow';
import { sceneUiRoot, buttonStates } from './build';

export function menuScene(
    world: World, events: UIEventQueue, scenes: SceneManagerState,
): SceneConfig {
    return {
        name: SCENES.menu,
        setup(ctx) {
            const c = themeColors();
            const root = sceneUiRoot(ctx, world);

            spawnUIEntity({
                world, parent: root,
                node: {
                    position: UIPositionType.Absolute,
                    insetLeft: px(0), insetRight: px(0),
                    insetTop: percent(26), height: px(44),
                },
                text: { content: 'SCENE FLOW', fontSize: 36, bold: true, color: c.text },
            });
            spawnUIEntity({
                world, parent: root,
                node: {
                    position: UIPositionType.Absolute,
                    insetLeft: px(0), insetRight: px(0),
                    insetTop: percent(26), marginTop: px(52), height: px(20),
                },
                text: {
                    content: 'SceneManager + fade transitions',
                    fontSize: 13,
                    color: { ...c.text, a: 0.6 },
                },
            });

            createButton({
                world, events, parent: root,
                node: {
                    position: UIPositionType.Absolute,
                    width: px(180), height: px(46),
                    insetLeft: percent(50), marginLeft: px(-90),
                    insetTop: percent(55),
                },
                states: buttonStates(c),
                text: { content: 'Start', fontSize: 16, color: c.onPrimary },
                onClick: () => goTo(scenes, SCENES.level1, FADE_TO_LEVEL_1),
            });
        },
    };
}
