import type { Color } from 'esengine';

export const RADAR = {
    center: { x: -420, y: -40 },
    radius: 150,
    rings: 3,
    sweepSpeed: 1.4,
    trailSteps: 10,
    trailSpread: 0.55,
    color: { r: 0.3, g: 0.95, b: 0.55, a: 1 } as Color,
};

export const DRONES = {
    count: 3,
    size: 22,
    boxMargin: 9,
    boxColor: { r: 1, g: 0.85, b: 0.3, a: 0.9 } as Color,
    colors: [
        { r: 0.95, g: 0.4, b: 0.4, a: 1 },
        { r: 0.4, g: 0.7, b: 0.95, a: 1 },
        { r: 0.9, g: 0.65, b: 0.95, a: 1 },
    ] as Color[],
};

export const STAR = {
    center: { x: 0, y: -40 },
    points: 7,
    outerRadius: 130,
    innerRadius: 58,
    hue: 0.58,
};

export const RIBBON = {
    halfLength: 170,
    halfWidth: 26,
    segments: 48,
    waveAmplitude: 58,
    waveFrequency: 2.2,
    scrollSpeed: 2.4,
};

/** HSV → Color (h/s/v in 0..1); the demo's one-stop palette knob. */
export function hsv(h: number, s: number, v: number, a = 1): Color {
    const i = Math.floor(((h % 1) + 1) % 1 * 6);
    const f = ((h % 1) + 1) % 1 * 6 - i;
    const p = v * (1 - s);
    const q = v * (1 - f * s);
    const t = v * (1 - (1 - f) * s);
    switch (i % 6) {
        case 0: return { r: v, g: t, b: p, a };
        case 1: return { r: q, g: v, b: p, a };
        case 2: return { r: p, g: v, b: t, a };
        case 3: return { r: p, g: q, b: v, a };
        case 4: return { r: t, g: p, b: v, a };
        default: return { r: v, g: p, b: q, a };
    }
}
