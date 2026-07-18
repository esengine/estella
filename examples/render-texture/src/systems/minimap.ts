import {
    defineSystem, Query, Mut, Res, Input, Transform, Sprite,
    RenderTexture, Renderer, Draw,
    type RenderTextureHandle,
} from 'esengine';
import { Blip, Minimap } from '../components';
import {
    WORLD_HALF_W, WORLD_HALF_H, VIEW_HALF_W, VIEW_HALF_H,
    MINIMAP_RESOLUTIONS, MINIMAP_START_RESOLUTION, MINIMAP_PAD, BLIP_SCALE,
} from '../config';

// The render-to-texture flow this engine supports:
//
//   RenderTexture is a LOW-LEVEL surface — a camera cannot target it, and it
//   does not re-render the scene for you. What it does is redirect whatever
//   you draw with the immediate `Draw` API between `begin`/`end` into an
//   offscreen target, under a view-projection matrix you supply. The handle's
//   `textureId` is then an ordinary texture usable anywhere (here: the corner
//   quad's `Sprite.texture`).
//
// So the minimap is painted, not re-rendered: each frame this system opens the
// target, lays down a background (the pass does NOT clear — the first opaque
// rect is the clear), draws the world border, the camera's view rectangle,
// and one dot per shape, then closes the target. Because the ortho matrix
// spans the WORLD's extents, everything is drawn in plain world coordinates —
// the matrix does the world→minimap mapping.
//
// This runs in Schedule.Update, before the engine's render system
// (Schedule.Last) draws the scene — a begin/end pair is a self-contained
// render pass, so it must not run inside the scene pass (e.g. inside a
// registerDrawCallback callback).

/** Column-major ortho projection (the view-projection RenderTexture.begin
 *  wants). Not exported by the SDK — five lines to build yourself. */
function ortho(l: number, r: number, b: number, t: number): Float32Array {
    const m = new Float32Array(16);
    m[0] = 2 / (r - l);
    m[5] = 2 / (t - b);
    m[10] = -1;
    m[12] = -(r + l) / (r - l);
    m[13] = -(t + b) / (t - b);
    m[15] = 1;
    return m;
}

const MAP_VP = ortho(
    -WORLD_HALF_W - MINIMAP_PAD, WORLD_HALF_W + MINIMAP_PAD,
    -WORLD_HALF_H - MINIMAP_PAD, WORLD_HALF_H + MINIMAP_PAD,
);

let rt: RenderTextureHandle | null = null;
let resolutionIndex = MINIMAP_START_RESOLUTION;

export const minimapSystem = defineSystem(
    [Res(Input), Query(Transform, Sprite, Blip), Query(Mut(Sprite), Minimap)],
    (input, blips, minimapQuads) => {
        if (!rt) {
            const res = MINIMAP_RESOLUTIONS[resolutionIndex];
            // depth off: pure 2D compositing needs no depth buffer. nearest
            // filter: makes the low resolutions honestly blocky on screen.
            const created = RenderTexture.create({ width: res.w, height: res.h, depth: false, filter: 'nearest' });
            if (created.textureId === 0) {
                // Renderer not booted yet — try again next frame.
                RenderTexture.release(created);
                return;
            }
            rt = created;
        }

        // R cycles the target's resolution. resize() releases the old target
        // and returns a NEW handle — the textureId changes, so every consumer
        // must be re-pointed at it (done below, where the quad's Sprite is
        // synced to rt.textureId every frame).
        if (input.isKeyPressed('KeyR')) {
            resolutionIndex = (resolutionIndex + 1) % MINIMAP_RESOLUTIONS.length;
            const res = MINIMAP_RESOLUTIONS[resolutionIndex];
            rt = RenderTexture.resize(rt, res.w, res.h);
        }

        for (const [, sprite] of minimapQuads) {
            if (sprite.texture !== rt.textureId) sprite.texture = rt.textureId;
        }

        // --- The offscreen pass -------------------------------------------
        RenderTexture.begin(rt, MAP_VP);
        Draw.begin(MAP_VP);
        // Draw.begin resets the GL viewport to the SCREEN size; point it at
        // the target instead. Must come after Draw.begin, before Draw.end
        // (which is when the batched primitives are actually submitted). No
        // restore needed: every on-screen camera pass sets its own viewport.
        Renderer.setViewport(0, 0, rt.width, rt.height);

        // Opaque background first — the pass does not clear the target.
        Draw.rect(
            { x: 0, y: 0 },
            { x: (WORLD_HALF_W + MINIMAP_PAD) * 2, y: (WORLD_HALF_H + MINIMAP_PAD) * 2 },
            { r: 0.07, g: 0.09, b: 0.13, a: 1 },
        );

        // World border. Thicknesses are world units — the ortho maps ~8.6
        // world units to one texel at 384×240, so borders are drawn fat.
        Draw.rectOutline(
            { x: 0, y: 0 },
            { x: WORLD_HALF_W * 2, y: WORLD_HALF_H * 2 },
            { r: 0.45, g: 0.5, b: 0.6, a: 1 },
            24,
        );

        // The rectangle the static scene camera actually shows.
        Draw.rectOutline(
            { x: 0, y: 0 },
            { x: VIEW_HALF_W * 2, y: VIEW_HALF_H * 2 },
            { r: 0.9, g: 0.92, b: 1, a: 0.55 },
            18,
        );

        // One dot per shape, in its own color, exaggerated for legibility.
        for (const [, transform, sprite] of blips) {
            Draw.rect(
                { x: transform.position.x, y: transform.position.y },
                { x: sprite.size.x * BLIP_SCALE, y: sprite.size.y * BLIP_SCALE },
                sprite.color,
            );
        }

        Draw.end();
        RenderTexture.end();
    },
    { name: 'MinimapSystem' },
);
