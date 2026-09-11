import {
    defineSystem, Commands, Res, Prefabs,
    Transform, Sprite, SpriteMask, SpriteMaskInteraction,
} from 'esengine';
import {
    GameState, HALF_WIDTH, HALF_HEIGHT,
    PREFAB_STAR, positionOverride, propOverride, HULL_BAR_WIDTH,
} from '../resources';
import { HullBarMask } from '../components';

const INITIAL_STAR_COUNT = 40;

/** The hull bar, in world units. Its WIDTH is shared with the HUD that cuts it. */
const BAR_X = -110;
const BAR_Y = -500;
const BAR_H = 14;
/** Above every gameplay sprite, so the bar is never flown over. */
const BAR_LAYER = 10;

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

        // The fill is CUT, not resized: scaling stretches the art, a mask takes a bite
        // out of it. The mask's width is the reading (hudSystem). Left-pivoted, and
        // ordered back < mask < fill — the order a mask has to be written in.
        cmds.spawn('HullBarBack')
            .insert(Transform, { position: { x: BAR_X, y: BAR_Y, z: 0 } })
            .insert(Sprite, {
                size: { x: HULL_BAR_WIDTH, y: BAR_H },
                pivot: { x: 0, y: 0.5 },
                color: { r: 0.10, g: 0.12, b: 0.18, a: 0.85 },
                layer: BAR_LAYER,
                order: 0,
            });

        cmds.spawn('HullBarMask')
            .insert(Transform, { position: { x: BAR_X, y: BAR_Y, z: 0 } })
            .insert(Sprite, {
                size: { x: HULL_BAR_WIDTH, y: BAR_H },
                pivot: { x: 0, y: 0.5 },
                layer: BAR_LAYER,
                order: 1,
            })
            .insert(SpriteMask, {})
            .insert(HullBarMask, {});

        cmds.spawn('HullBarFill')
            .insert(Transform, { position: { x: BAR_X, y: BAR_Y, z: 0 } })
            .insert(Sprite, {
                size: { x: HULL_BAR_WIDTH, y: BAR_H },
                pivot: { x: 0, y: 0.5 },
                color: { r: 0.35, g: 0.95, b: 0.6, a: 1 },
                layer: BAR_LAYER,
                order: 2,
                maskInteraction: SpriteMaskInteraction.VisibleInside,
            });

        // The same mask's other side: what the hull has LOST. One mask cuts both, so
        // the halves cannot disagree about the boundary — and at full hull this one has
        // nowhere to show, which is what makes a broken outside-test visible.
        cmds.spawn('HullBarLost')
            .insert(Transform, { position: { x: BAR_X, y: BAR_Y, z: 0 } })
            .insert(Sprite, {
                size: { x: HULL_BAR_WIDTH, y: BAR_H },
                pivot: { x: 0, y: 0.5 },
                color: { r: 0.85, g: 0.22, b: 0.28, a: 1 },
                layer: BAR_LAYER,
                order: 3,
                maskInteraction: SpriteMaskInteraction.VisibleOutside,
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
