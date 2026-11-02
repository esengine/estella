// Texture Canvas: make a blank canvas, paste textures into it at pixel positions, show the result on a Sprite.
import {
    addSystemToSchedule, defineSystem, Commands, Transform, Sprite, Schedule,
    RenderTexture, Renderer, Draw, BlendMode, TextureCanvas,
    type RenderTextureHandle,
} from 'esengine';

type Color = { r: number; g: number; b: number; a: number };

// The parts. In a game these would be loaded images (what `Sprite.texture` holds); here each is a
// flat-coloured texture painted on the spot so the example needs no asset files.
function solid(width: number, height: number, color: Color): RenderTextureHandle {
    const rt = RenderTexture.create({ width, height, depth: false, filter: 'nearest' });
    const vp = new Float32Array(16);
    vp[0] = 2 / width; vp[5] = 2 / height; vp[10] = -1; vp[12] = -1; vp[13] = -1; vp[15] = 1;
    RenderTexture.begin(rt, vp);
    Draw.begin(vp);
    Renderer.setViewport(0, 0, width, height);
    Draw.setBlendMode(BlendMode.None);
    Draw.rect({ x: width / 2, y: height / 2 }, { x: width, y: height }, color);
    Draw.end();
    RenderTexture.end();
    RenderTexture.contentDrawn(rt);
    return rt;
}

let composed = false;

const composeSystem = defineSystem([Commands()], (cmds) => {
    if (composed) return;

    // 1. A blank 256 x 256 canvas.
    const canvas = TextureCanvas.create(256, 256, { filter: 'nearest' });
    if (!canvas) return;   // the renderer is not up yet: try again next frame

    const body = solid(64, 96, { r: 0.35, g: 0.6, b: 0.95, a: 1 });
    const head = solid(48, 48, { r: 0.98, g: 0.8, b: 0.6, a: 1 });
    const arm = solid(20, 72, { r: 0.3, g: 0.5, b: 0.85, a: 1 });
    const leg = solid(26, 60, { r: 0.25, g: 0.3, b: 0.5, a: 1 });

    // 2. Paste textures in. (x, y) is the picture's top-left corner, counted in pixels from the canvas's top-left.
    canvas.draw(leg.texture, 88, 190);
    canvas.draw(leg.texture, 142, 190);
    canvas.draw(body.texture, 96, 100);
    canvas.draw(arm.texture, 68, 104);
    canvas.draw(arm.texture, 168, 104);
    canvas.draw(head.texture, 104, 46);
    canvas.draw(head.texture, 190, 20, 24, 24);   // optional width and height scale a picture as it is pasted

    // 3. The canvas is an ordinary texture: give it to a Sprite.
    cmds.spawn()
        .insert(Transform, { position: { x: 0, y: 0, z: 0 } })
        .insert(Sprite, { texture: canvas.texture, size: { x: 512, y: 512 }, color: { r: 1, g: 1, b: 1, a: 1 } });

    composed = true;
}, { name: 'ComposeSystem' });

addSystemToSchedule(Schedule.Update, composeSystem);
