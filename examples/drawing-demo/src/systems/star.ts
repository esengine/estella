import { defineSystem, Res, Input, Graphics, registerDrawCallback } from 'esengine';
import { STAR, hsv } from '../config';

// The Graphics tier: a retained vector drawing. The star is BUILT once (paths
// filled and stroked, curves subdivided, all of it tessellated into triangles)
// and the per-frame cost is only flush(), one batched draw of those triangles.
// Press G to clear() and re-record with new parameters — the only time it is
// rebuilt.

const g = new Graphics();

function buildStar(points: number, outerRadius: number, innerRadius: number, hue: number): void {
    g.clear();
    const { x: cx, y: cy } = STAR.center;

    // The star itself: a concave path, filled and outlined. Everything drawn
    // between beginFill and endFill is filled — paths as much as shapes.
    g.lineStyle(3, hsv(hue, 0.55, 1), { join: 'miter' });
    g.beginFill(hsv(hue, 0.6, 0.45, 0.85));
    const step = Math.PI / points;
    const start = Math.PI / 2;
    g.moveTo(cx, cy + outerRadius);
    for (let i = 1; i < points * 2; i++) {
        const r = i % 2 === 0 ? outerRadius : innerRadius;
        const a = start + i * step;
        g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    g.closePath();
    g.endFill();

    // Filled hub over it.
    g.lineStyle(2, hsv(hue, 0.5, 1, 0.9));
    g.beginFill(hsv(hue, 0.75, 0.3, 0.95));
    g.drawCircle(cx, cy, innerRadius * 0.55, 40);
    g.endFill();

    // Orbit ring and four arc brackets just outside it, with round caps.
    g.lineStyle(1, hsv(hue, 0.35, 0.9, 0.5));
    g.drawCircle(cx, cy, outerRadius + 16, 64);
    g.lineStyle(3, hsv(hue, 0.35, 1, 0.8), { cap: 'round' });
    for (let i = 0; i < 4; i++) {
        const a0 = i * (Math.PI / 2) + Math.PI / 8;
        g.moveTo(cx + Math.cos(a0) * (outerRadius + 26), cy + Math.sin(a0) * (outerRadius + 26));
        g.arc(cx, cy, outerRadius + 26, a0, a0 + Math.PI / 4);
    }

    // A quadratic-bézier swoosh under the star (curveTo subdivides on record).
    g.lineStyle(2, hsv(hue + 0.08, 0.5, 1, 0.8), { cap: 'round' });
    g.moveTo(cx - outerRadius, cy - outerRadius - 42);
    g.curveTo(cx, cy - outerRadius + 8, cx + outerRadius, cy - outerRadius - 42);
}

buildStar(STAR.points, STAR.outerRadius, STAR.innerRadius, STAR.hue);

// One hexagon, built once, about its own origin. A hit flash is this shape
// drawn where the hit is, a little larger and fainter each frame: flush()
// moves, scales and fades it, so a hundred flashes on screen build nothing
// and make no texture.
const hexagon = new Graphics();
hexagon.lineStyle(2, { r: 1, g: 1, b: 1, a: 1 });
hexagon.beginFill({ r: 1, g: 0.85, b: 0.4, a: 0.6 });
hexagon.drawPolygon(Array.from({ length: 6 }, (_, i) => ({
    x: Math.cos((i / 6) * Math.PI * 2) * STAR.flashRadius,
    y: Math.sin((i / 6) * Math.PI * 2) * STAR.flashRadius,
})));
hexagon.endFill();

function drawFlashes(elapsed: number): void {
    const { x: cx, y: cy } = STAR.center;
    const around = STAR.outerRadius + 70;
    for (let i = 0; i < 6; i++) {
        // Each flash pops on its own beat and fades over a little more than a second.
        const age = (elapsed * 0.8 + i / 6) % 1;
        const a = (i / 6) * Math.PI * 2;
        hexagon.flush({
            x: cx + Math.cos(a) * around,
            y: cy + Math.sin(a) * around,
            rotation: age * 0.6,
            scale: 0.7 + age * 0.6,
            alpha: 1 - age,
        });
    }
}

// flush() is the retained payoff: one batched draw, no re-tessellation.
registerDrawCallback('star-shape', (elapsed) => {
    g.flush();
    drawFlashes(elapsed);
});

export const starRebuildSystem = defineSystem(
    [Res(Input)],
    (input) => {
        if (!input.isKeyPressed('KeyG')) return;
        buildStar(
            5 + Math.floor(Math.random() * 6),
            108 + Math.random() * 32,
            42 + Math.random() * 34,
            Math.random(),
        );
    },
    { name: 'StarRebuildSystem' },
);
