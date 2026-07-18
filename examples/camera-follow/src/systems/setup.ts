import {
    defineSystem, Query, Commands, Transform, Sprite, Camera, ProjectionType,
    FollowTarget,
} from 'esengine';
import { Player, OverviewCam } from '../components';
import {
    WORLD_HALF_W, WORLD_HALF_H, GRID_STEP, PLAYER_SIZE, FOLLOW, OVERVIEW_ORTHO,
    LANDMARKS,
} from '../config';

// Builds the whole world from code (a large scatter of primitives is simpler to
// spawn than to author): ground-dot grid, landmark blocks, border frame, the
// player, and the fixed overview camera. Then wires the scene's gameplay camera
// to the player by inserting a FollowTarget on it — from that point on the
// built-in follow system damps the camera toward the player every frame.
export const setupSystem = defineSystem(
    [Query(Camera), Commands()],
    (cameras, cmds) => {
        // Dim ground dots every GRID_STEP so camera motion is visible everywhere.
        for (let x = -WORLD_HALF_W; x <= WORLD_HALF_W; x += GRID_STEP) {
            for (let y = -WORLD_HALF_H; y <= WORLD_HALF_H; y += GRID_STEP) {
                cmds.spawn()
                    .insert(Transform, { position: { x, y, z: 0 } })
                    .insert(Sprite, {
                        size: { x: 14, y: 14 },
                        color: { r: 0.22, g: 0.24, b: 0.28, a: 1 },
                        layer: 0,
                    });
            }
        }

        for (const mark of LANDMARKS) {
            cmds.spawn()
                .insert(Transform, { position: { x: mark.x, y: mark.y, z: 0 } })
                .insert(Sprite, {
                    size: { x: mark.w, y: mark.h },
                    color: mark.color,
                    layer: 1,
                });
        }

        // Border frame marking the edge of the roamable world.
        const frames = [
            { x: 0, y: WORLD_HALF_H, w: WORLD_HALF_W * 2, h: 8 },
            { x: 0, y: -WORLD_HALF_H, w: WORLD_HALF_W * 2, h: 8 },
            { x: -WORLD_HALF_W, y: 0, w: 8, h: WORLD_HALF_H * 2 },
            { x: WORLD_HALF_W, y: 0, w: 8, h: WORLD_HALF_H * 2 },
        ];
        for (const f of frames) {
            cmds.spawn()
                .insert(Transform, { position: { x: f.x, y: f.y, z: 0 } })
                .insert(Sprite, {
                    size: { x: f.w, y: f.h },
                    color: { r: 0.45, g: 0.5, b: 0.6, a: 1 },
                    layer: 1,
                });
        }

        const player = cmds.spawn('Player')
            .insert(Transform, { position: { x: 0, y: 0, z: 0 } })
            .insert(Sprite, {
                size: { x: PLAYER_SIZE, y: PLAYER_SIZE },
                color: { r: 1, g: 1, b: 1, a: 1 },
                layer: 2,
            })
            .insert(Player)
            .id();

        // A fixed wide-angle camera framing the whole world. It is NOT active —
        // it only renders when setViewTarget hands the view to it (key 2).
        cmds.spawn('OverviewCamera')
            .insert(Transform, { position: { x: 0, y: 0, z: 10 } })
            .insert(Camera, {
                projectionType: ProjectionType.Orthographic,
                orthoSize: OVERVIEW_ORTHO,
                isActive: false,
                priority: 0,
            })
            .insert(OverviewCam);

        // The scene's active camera becomes the follow camera. The query snapshot
        // predates the overview spawn, but filter on isActive anyway so the
        // FollowTarget can never land on the overview camera.
        for (const [entity, cam] of cameras) {
            if (!cam.isActive) continue;
            cmds.entity(entity).insert(FollowTarget, {
                target: player,
                deadzone: FOLLOW.deadzone,
                damping: FOLLOW.damping,
            });
        }
    },
    { name: 'SetupSystem' },
);
