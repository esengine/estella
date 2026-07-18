import { defineSystem, Res, Input, Graphics, registerDrawCallback } from 'esengine';
import { STAR, hsv } from '../config';

// The Graphics tier: a retained path recorder. The star is BUILT once (path
// tessellation, curve subdivision) and the per-frame cost is only flush(),
// which replays the recorded commands through Draw. Press G to clear() and
// re-record with new parameters — the only time the path is rebuilt.

const g = new Graphics();

function buildStar(points: number, outerRadius: number, innerRadius: number, hue: number): void {
    g.clear();
    const { x: cx, y: cy } = STAR.center;

    // Filled hub (beginFill/endFill fill rects and circles; paths stay strokes).
    g.lineStyle(2, hsv(hue, 0.5, 1, 0.9));
    g.beginFill(hsv(hue, 0.75, 0.35, 0.9));
    g.drawCircle(cx, cy, innerRadius * 0.55, 40);
    g.endFill();

    // Star outline: alternate outer/inner vertices around the circle.
    g.lineStyle(3, hsv(hue, 0.55, 1));
    const step = Math.PI / points;
    const start = Math.PI / 2;
    g.moveTo(cx, cy + outerRadius);
    for (let i = 1; i <= points * 2; i++) {
        const r = i % 2 === 0 ? outerRadius : innerRadius;
        const a = start + i * step;
        g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }

    // Orbit ring and four arc brackets just outside it.
    g.lineStyle(1, hsv(hue, 0.35, 0.9, 0.5));
    g.drawCircle(cx, cy, outerRadius + 16, 64);
    g.lineStyle(3, hsv(hue, 0.35, 1, 0.8));
    for (let i = 0; i < 4; i++) {
        const a0 = i * (Math.PI / 2) + Math.PI / 8;
        g.moveTo(cx + Math.cos(a0) * (outerRadius + 26), cy + Math.sin(a0) * (outerRadius + 26));
        g.arc(cx, cy, outerRadius + 26, a0, a0 + Math.PI / 4);
    }

    // A quadratic-bézier swoosh under the star (curveTo subdivides on record).
    g.lineStyle(2, hsv(hue + 0.08, 0.5, 1, 0.8));
    g.moveTo(cx - outerRadius, cy - outerRadius - 42);
    g.curveTo(cx, cy - outerRadius + 8, cx + outerRadius, cy - outerRadius - 42);
}

buildStar(STAR.points, STAR.outerRadius, STAR.innerRadius, STAR.hue);

// flush() is the retained payoff: replaying recorded commands, no re-tessellation.
registerDrawCallback('star-shape', () => g.flush());

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
