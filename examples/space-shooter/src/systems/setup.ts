import {
    defineSystem, Commands, Res, Prefabs,
} from 'esengine';
import {
    GameState, HALF_WIDTH, HALF_HEIGHT,
    PREFAB_STAR, positionOverride, propOverride,
} from '../resources';

const INITIAL_STAR_COUNT = 40;

export const setupSystem = defineSystem(
    [Commands(), Res(Prefabs)],
    (cmds, prefabServer) => {
        cmds.insertResource(GameState, {
            score: 0,
            gameOver: false,
            spawnTimer: 0,
            difficulty: 1,
            shootCooldown: 0,
        });

        for (let i = 0; i < INITIAL_STAR_COUNT; i++) {
            const layer = i % 3;
            const speed = 20 + layer * 30;
            prefabServer.instantiate(PREFAB_STAR, {
                overrides: [
                    positionOverride(
                        (Math.random() - 0.5) * HALF_WIDTH * 2,
                        (Math.random() - 0.5) * HALF_HEIGHT * 2,
                    ),
                    propOverride('Star', 'speed', speed),
                    propOverride('Sprite', 'color', { r: 1, g: 1, b: 1, a: 0.3 + layer * 0.3 }),
                ],
            });
        }
    },
    { name: 'SetupSystem' }
);
