import { defineSystem, Commands, Transform, Sprite } from 'esengine';
import { Orbit, Blip, Minimap } from '../components';
import {
    WORLD_HALF_W, WORLD_HALF_H, VIEW_HALF_W, VIEW_HALF_H, GRID_STEP, GRID_DOT,
    MINIMAP_DISPLAY, MINIMAP_MARGIN, MINIMAP_LAYER, SHAPES,
} from '../config';

// Builds the world from code: a dim ground-dot grid, a border frame at the
// world's edge, the drifting shapes the minimap tracks, and the minimap quad
// itself. The quad's Sprite.texture starts at 0 — the minimap system points it
// at the RenderTexture's textureId on its first run (same first frame, before
// anything renders).
export const setupSystem = defineSystem(
    [Commands()],
    (cmds) => {
        for (let x = -WORLD_HALF_W; x <= WORLD_HALF_W; x += GRID_STEP) {
            for (let y = -WORLD_HALF_H; y <= WORLD_HALF_H; y += GRID_STEP) {
                cmds.spawn()
                    .insert(Transform, { position: { x, y, z: 0 } })
                    .insert(Sprite, {
                        size: { x: GRID_DOT, y: GRID_DOT },
                        color: { r: 0.22, g: 0.24, b: 0.28, a: 1 },
                        layer: 0,
                    });
            }
        }

        // Border frame marking the edge of the world the shapes roam.
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

        for (const s of SHAPES) {
            cmds.spawn()
                .insert(Transform, {
                    position: { x: Math.cos(s.phase) * s.rx, y: Math.sin(s.phase) * s.ry, z: 0 },
                })
                .insert(Sprite, {
                    size: { x: s.size, y: s.size },
                    color: s.color,
                    layer: 2,
                })
                .insert(Orbit, { rx: s.rx, ry: s.ry, speed: s.speed, phase: s.phase })
                .insert(Blip);
        }

        // The minimap quad, pinned to the view's top-right corner (the scene
        // camera is static at the origin, so world units == design pixels). The
        // RenderTexture reads as an ordinary texture: uploaded images are flipped
        // to the engine's y-up sampling convention on upload, and a render target
        // is already y-up, so drawing world-up into it displays upright — no flip.
        cmds.spawn('Minimap')
            .insert(Transform, {
                position: {
                    x: VIEW_HALF_W - MINIMAP_MARGIN - MINIMAP_DISPLAY.w / 2,
                    y: VIEW_HALF_H - MINIMAP_MARGIN - MINIMAP_DISPLAY.h / 2,
                    z: 0,
                },
            })
            .insert(Sprite, {
                size: { x: MINIMAP_DISPLAY.w, y: MINIMAP_DISPLAY.h },
                color: { r: 1, g: 1, b: 1, a: 1 },
                layer: MINIMAP_LAYER,
            })
            .insert(Minimap);
    },
    { name: 'SetupSystem' },
);
