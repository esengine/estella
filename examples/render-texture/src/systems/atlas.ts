import {
    defineSystem, Commands, Transform, Sprite,
    RenderTexture, Renderer, Draw, BlendMode, TextureAtlas, onDeviceRestored,
    type RenderTextureHandle, type TextureAtlasHandle,
} from 'esengine';
import { VIEW_HALF_W, VIEW_HALF_H, MINIMAP_LAYER } from '../config';

// The four sources are lopsided on purpose, so a flipped or misplaced cell shows; in a game they
// would be loaded images. Every sprite shares the one canvas, so they batch.

const SOURCES = [
    { w: 96, h: 64, color: { r: 0.95, g: 0.45, b: 0.35, a: 1 } },
    { w: 48, h: 96, color: { r: 0.4, g: 0.75, b: 1, a: 1 } },
    { w: 64, h: 64, color: { r: 0.55, g: 0.9, b: 0.45, a: 1 } },
    { w: 80, h: 40, color: { r: 0.95, g: 0.8, b: 0.35, a: 1 } },
];

function ortho(w: number, h: number): Float32Array {
    const m = new Float32Array(16);
    m[0] = 2 / w; m[5] = 2 / h; m[10] = -1; m[12] = -1; m[13] = -1; m[15] = 1;
    return m;
}

/** A coloured card with a white square in its top-left corner and a dark bar along its bottom edge. */
function paint(rt: RenderTextureHandle, color: { r: number; g: number; b: number; a: number }): void {
    const { width: w, height: h } = rt;
    const vp = ortho(w, h);
    RenderTexture.begin(rt, vp);
    Draw.begin(vp);
    Renderer.setViewport(0, 0, w, h);
    Draw.setBlendMode(BlendMode.None);
    Draw.rect({ x: w / 2, y: h / 2 }, { x: w, y: h }, color);
    Draw.rect({ x: 12, y: h - 12 }, { x: 16, y: 16 }, { r: 1, g: 1, b: 1, a: 1 });
    Draw.rect({ x: w / 2, y: 5 }, { x: w - 12, y: 6 }, { r: 0.1, g: 0.1, b: 0.14, a: 1 });
    Draw.end();
    RenderTexture.end();
    RenderTexture.contentDrawn(rt);
}

let sources: RenderTextureHandle[] | null = null;
let atlas: TextureAtlasHandle | null = null;

export const atlasSystem = defineSystem(
    [Commands()],
    (cmds) => {
        if (atlas) return;
        sources = SOURCES.map((s) => RenderTexture.create({ width: s.w, height: s.h, depth: false, filter: 'nearest' }));
        if (sources.some((rt) => rt.texture === 0)) {
            sources.forEach((rt) => RenderTexture.release(rt));
            sources = null;
            return;
        }
        sources.forEach((rt, i) => paint(rt, SOURCES[i].color));

        const packed = TextureAtlas.pack(sources.map((rt) => rt.texture), { filter: 'nearest' });
        if (!packed) return;
        atlas = packed;
        onDeviceRestored(() => {
            sources!.forEach((rt, i) => paint(rt, SOURCES[i].color));
            atlas!.repaint();
        });

        // The four cells, along the bottom-left, each its source's own size.
        let x = -VIEW_HALF_W + 24;
        sources.forEach((rt, i) => {
            const { w, h } = SOURCES[i];
            cmds.spawn()
                .insert(Transform, { position: { x: x + w / 2, y: -VIEW_HALF_H + 24 + h / 2, z: 0 } })
                .insert(Sprite, { ...atlas!.sprite(rt.texture), size: { x: w, y: h }, color: { r: 1, g: 1, b: 1, a: 1 }, layer: MINIMAP_LAYER });
            x += w + 16;
        });

        // The whole canvas, next to them.
        cmds.spawn()
            .insert(Transform, { position: { x: x + 80, y: -VIEW_HALF_H + 24 + 80, z: 0 } })
            .insert(Sprite, {
                texture: atlas.texture, size: { x: 160, y: 160 * atlas.height / atlas.width },
                color: { r: 1, g: 1, b: 1, a: 1 }, layer: MINIMAP_LAYER,
            });
    },
    { name: 'AtlasSystem' },
);
