import { defineSystem, Query, Mut, Res, Transform, Camera, UICameraInfo } from 'esengine';
import { Player } from '../components';

// The world the tilemap covers, in world units: 32×24 cells of 16, with the
// layer's origin at its top-left corner (see the World entity's Transform).
const MAP = { left: -256, right: 256, bottom: -192, top: 192 };

/** Keep `v` inside [min, max]; centred when the span is smaller than the view. */
function clamp(v: number, min: number, max: number): number {
    return min > max ? (min + max) / 2 : Math.min(Math.max(v, min), max);
}

/**
 * The camera sits ON the hero, stopped at the edges of the map and snapped to
 * whole pixels. A pixel-art camera that eases (as a smooth-scrolling one should)
 * lands between pixels, and every sprite in the frame shimmers as it crosses the
 * sampling grid.
 */
export const followSystem = defineSystem(
    [Query(Mut(Transform), Camera), Query(Transform, Player), Res(UICameraInfo)],
    (cameras, players, view) => {
        const target = [...players][0];
        if (!target) return;
        const [, to] = target;
        // The visible half-extent, from the camera the frame was drawn with —
        // so the clamp is right at any window size rather than at one.
        const halfW = view.valid ? (view.worldRight - view.worldLeft) / 2 : 0;
        const halfH = view.valid ? (view.worldTop - view.worldBottom) / 2 : 0;

        for (const [, camera] of cameras) {
            camera.position.x = Math.round(clamp(to.position.x, MAP.left + halfW, MAP.right - halfW));
            camera.position.y = Math.round(clamp(to.position.y, MAP.bottom + halfH, MAP.top - halfH));
        }
    },
    { name: 'FollowSystem' },
);
