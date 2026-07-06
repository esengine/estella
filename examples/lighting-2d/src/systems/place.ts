import {
    defineSystem, Res, Input, Commands, UICameraInfo,
    Transform, Sprite, Light2D, Light2DType, ShadowCaster2D,
} from 'esengine';
import type { UICameraData } from 'esengine';
import { Fading } from '../components';
import {
    LIGHT_COLORS, PLACED_LIGHT_INTENSITY, PLACED_LIGHT_RADIUS, PLACED_LIGHT_SOFTNESS,
    OBSTACLE_SIZE, MAX_LIGHTS, MAX_OBSTACLES, FADE_DURATION,
} from '../config';

// FIFO records of what the player has placed. When a list exceeds its cap the
// oldest entity is tagged Fading (the fade system dims and despawns it), so the
// scene stays within the GPU's light/occluder budget.
const lights: number[] = [];
const obstacles: number[] = [];
let nextColor = 0;

// Left-click → colored Point light, right-click → box obstacle, C → clear.
// Placed markers stay unlit (no `lit` flag) so a light always reads as a
// bright dot and an obstacle as a solid block, regardless of the lighting.
export const placeSystem = defineSystem(
    [Res(Input), Res(UICameraInfo), Commands()],
    (input, camera: UICameraData, cmds) => {
        if (camera.valid) {
            const x = camera.worldMouseX;
            const y = camera.worldMouseY;

            if (input.isMouseButtonPressed(0)) {
                const color = LIGHT_COLORS[nextColor % LIGHT_COLORS.length];
                nextColor++;
                const entity = cmds.spawn()
                    .insert(Transform, { position: { x, y, z: 0 } })
                    .insert(Light2D, {
                        type: Light2DType.Point,
                        color,
                        intensity: PLACED_LIGHT_INTENSITY,
                        radius: PLACED_LIGHT_RADIUS,
                        shadowSoftness: PLACED_LIGHT_SOFTNESS,
                        enabled: true,
                    })
                    .insert(Sprite, { size: { x: 18, y: 18 }, color, layer: 5 })
                    .id();
                lights.push(entity);
                if (lights.length > MAX_LIGHTS) {
                    cmds.entity(lights.shift()!).insert(Fading, { remaining: FADE_DURATION });
                }
            }

            if (input.isMouseButtonPressed(2)) {
                const entity = cmds.spawn()
                    .insert(Transform, { position: { x, y, z: 0 } })
                    .insert(Sprite, {
                        size: OBSTACLE_SIZE,
                        color: { r: 0.22, g: 0.24, b: 0.30, a: 1 },
                        layer: 4,
                    })
                    .insert(ShadowCaster2D, { size: OBSTACLE_SIZE, enabled: true })
                    .id();
                obstacles.push(entity);
                if (obstacles.length > MAX_OBSTACLES) {
                    cmds.entity(obstacles.shift()!).insert(Fading, { remaining: FADE_DURATION });
                }
            }
        }

        if (input.isKeyPressed('KeyC')) {
            for (const entity of lights) cmds.entity(entity).insert(Fading, { remaining: FADE_DURATION });
            for (const entity of obstacles) cmds.entity(entity).insert(Fading, { remaining: FADE_DURATION });
            lights.length = 0;
            obstacles.length = 0;
        }
    },
    { name: 'PlaceSystem' },
);
