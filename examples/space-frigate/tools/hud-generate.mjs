import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'ui');

export const ICE = '#e6f2f7';
export const HAZE = '#8ea9b6';
export const DRIVE = '#7cd3ff';
export const AMBER = '#ffa348';
export const ALERT = '#ff5a3d';
export const PLATE = '#06121a';

export const GAUGE = { size: 640, sweep: 270, fullScale: 440, redline: 400, speed: [270, 296], comb: [248, 264], drive: [198, 206], command: [211, 214] };

const alpha = (color, a) => `${color}${Math.round(a * 255).toString(16).padStart(2, '0')}`;
const round = (v) => Math.round(v * 100) / 100;

export function on(c, r, t) {
    const phi = ((90 + GAUGE.sweep * t) * Math.PI) / 180;
    return [round(c + r * Math.cos(phi)), round(c + r * Math.sin(phi))];
}

export function sector(c, inner, outer, from, to) {
    const steps = Math.max(2, Math.ceil(Math.abs(to - from) * GAUGE.sweep / 1.5));
    const points = [];
    for (let i = 0; i <= steps; i++) points.push(on(c, outer, from + ((to - from) * i) / steps));
    for (let i = steps; i >= 0; i--) points.push(on(c, inner, from + ((to - from) * i) / steps));
    return points;
}

function tick(c, inner, outer, t, width) {
    const half = width / (2 * ((inner + outer) / 2)) / ((GAUGE.sweep * Math.PI) / 180);
    return [on(c, outer, t - half), on(c, outer, t + half), on(c, inner, t + half), on(c, inner, t - half)];
}

function gaugeDial() {
    const c = GAUGE.size / 2;
    const layers = [];
    layers.push({ shape: 'circle', at: [c, c], radius: c - 2, fill: { type: 'radial', at: [c, c], radius: c - 2, stops: [[0, alpha(PLATE, 0.78)], [0.6, alpha(PLATE, 0.6)], [0.86, alpha(PLATE, 0.3)], [1, alpha(PLATE, 0)]] } });
    const [s0, s1] = GAUGE.speed;
    layers.push({ id: 'speedTrack', shape: 'polygon', points: sector(c, s0, s1, 0, 1), fill: alpha(ICE, 0.07) });
    layers.push({ shape: 'polygon', points: sector(c, s1 - 1.5, s1, 0, 1), fill: alpha(ICE, 0.34) });
    layers.push({ shape: 'polygon', points: sector(c, s0, s0 + 1.5, 0, 1), fill: alpha(ICE, 0.2) });
    const red = GAUGE.redline / GAUGE.fullScale;
    layers.push({ id: 'redline', shape: 'polygon', points: sector(c, s1 + 5, s1 + 10, red, 1), fill: alpha(AMBER, 0.9), effects: [{ type: 'glow', color: AMBER, blur: 4, opacity: 0.45 }] });
    layers.push({ shape: 'polygon', points: tick(c, s0 - 4, s1 + 12, 0, 3), fill: alpha(ICE, 0.75) });
    layers.push({ shape: 'polygon', points: tick(c, s0 - 4, s1 + 12, 1, 3), fill: alpha(AMBER, 0.9) });
    const [k0, k1] = GAUGE.comb;
    for (let v = 0; v <= GAUGE.fullScale; v += 20) {
        const major = v % 100 === 0;
        const hot = v >= GAUGE.redline;
        layers.push({ shape: 'polygon', points: tick(c, major ? k0 : k0 + 8, k1, v / GAUGE.fullScale, major ? 3 : 2), fill: alpha(hot ? AMBER : ICE, major ? 0.9 : 0.5) });
    }
    const [d0, d1] = GAUGE.drive;
    layers.push({ id: 'driveTrack', shape: 'polygon', points: sector(c, d0, d1, 0, 1), fill: alpha(ICE, 0.1) });
    for (let q = 0; q <= 4; q++) layers.push({ shape: 'polygon', points: tick(c, d0 - 9, d0 - 3, q / 4, 2), fill: alpha(ICE, q % 2 === 0 ? 0.6 : 0.32) });
    return { version: 1, size: GAUGE.size, layers };
}

function gaugeRing([inner, outer], color, glow) {
    const c = GAUGE.size / 2;
    return {
        version: 1, size: GAUGE.size,
        layers: [{ shape: 'ring', at: [c, c], radius: outer, inner, fill: color, effects: [{ type: 'glow', color: glow.color, blur: glow.blur, opacity: glow.opacity }] }],
    };
}

function gaugeSpeed(hot) {
    const c = GAUGE.size / 2;
    const [s0, s1] = GAUGE.speed;
    const inner = s0 + 4, outer = s1 - 4;
    const gaps = [];
    for (let v = 20; v < GAUGE.fullScale; v += 20) gaps.push({ shape: 'polygon', points: tick(c, inner - 2, outer + 2, v / GAUGE.fullScale, v % 100 === 0 ? 4 : 2.5), fill: '#000000', erase: true });
    const stops = hot
        ? [[0, AMBER], [inner / outer, alpha(AMBER, 0.85)], [(inner + 7) / outer, alpha('#ffc98a', 0.95)], [1, '#fff1dc']]
        : [[0, DRIVE], [inner / outer, alpha(DRIVE, 0.8)], [(inner + 7) / outer, alpha('#c4ecff', 0.94)], [1, '#f4fbff']];
    return {
        version: 1, size: GAUGE.size,
        layers: [{
            shape: 'group', effects: [{ type: 'glow', color: hot ? '#ff8a2a' : '#3fb8ff', blur: 9, opacity: 0.5 }],
            layers: [{ shape: 'ring', at: [c, c], radius: outer, inner, fill: { type: 'radial', at: [c, c], radius: outer, stops } }, ...gaps],
        }],
    };
}

function plate() {
    const size = 128, cut = 22;
    const outline = [[1, 1], [size - cut, 1], [size - 1, cut], [size - 1, size - 1], [1, size - 1]];
    return {
        version: 1, size,
        layers: [
            { id: 'body', shape: 'polygon', points: outline, fill: { type: 'linear', from: [0, 0], to: [0, size], stops: [[0, alpha('#0b1d28', 0.74)], [0.5, alpha(PLATE, 0.66)], [1, alpha('#040c12', 0.78)]] }, effects: [{ type: 'bevel', size: 2, angle: 115, depth: 0.5, shade: '#00000066' }] },
            { shape: 'polygon', points: outline, stroke: { color: alpha(ICE, 0.22), width: 1.5, align: 'inside', join: 'miter' } },
            { shape: 'line', points: [[1, 1.5], [size - cut, 1.5]], stroke: { color: alpha(ICE, 0.5), width: 1.5, cap: 'butt' } },
            { shape: 'line', points: [[size - cut, 1.5], [size - 1.5, cut]], stroke: { color: alpha(AMBER, 0.95), width: 2.5, cap: 'butt' }, effects: [{ type: 'glow', color: AMBER, blur: 6, opacity: 0.5 }] },
            { shape: 'rect', at: [2, 2.5], size: [3, 16], fill: alpha(ICE, 0.85) },
        ],
    };
}

function bar(lit) {
    const cells = 24, cell = 12, height = 14, gap = 3;
    const width = cells * cell;
    const layers = [];
    for (let i = 0; i < cells; i++) {
        layers.push({ shape: 'rect', at: [i * cell, 0], size: [cell - gap, height], fill: lit ? { type: 'linear', from: [0, 0], to: [0, height], stops: [[0, '#ffffff'], [1, alpha('#ffffff', 0.78)]] } : alpha('#ffffff', 0.13) });
    }
    return { version: 1, size: [width, height], layers };
}

function bracket() {
    const size = 96, arm = 18, w = 3, inset = 14;
    const corner = (x, y, dx, dy) => ({ shape: 'line', points: [[x + dx * arm, y], [x, y], [x, y + dy * arm]], stroke: { color: ICE, width: w, join: 'miter', cap: 'butt' } });
    const far = size - inset;
    return {
        version: 1, size,
        layers: [{
            shape: 'group', effects: [{ type: 'glow', color: DRIVE, blur: 4, opacity: 0.5 }],
            layers: [corner(inset, inset, 1, 1), corner(far, inset, -1, 1), corner(far, far, -1, -1), corner(inset, far, 1, -1)],
        }],
    };
}

function diamond() {
    const size = 64, c = size / 2, r = 13;
    return {
        version: 1, size,
        layers: [
            { shape: 'polygon', points: [[c, c - r], [c + r, c], [c, c + r], [c - r, c]], stroke: { color: AMBER, width: 3, join: 'miter' }, effects: [{ type: 'glow', color: AMBER, blur: 5, opacity: 0.6 }] },
            { shape: 'circle', at: [c, c], radius: 2.5, fill: AMBER },
        ],
    };
}

function chevron() {
    const size = 96, c = size / 2;
    const arm = (x) => ({ shape: 'line', points: [[x - 12, c - 17], [x + 5, c], [x - 12, c + 17]], stroke: { color: AMBER, width: 5, join: 'miter', cap: 'butt' } });
    return {
        version: 1, size,
        layers: [{ shape: 'group', effects: [{ type: 'glow', color: AMBER, blur: 8, opacity: 0.55 }], layers: [arm(c + 14), { ...arm(c - 4), opacity: 0.55 }] }],
    };
}

function body() {
    const size = 64, c = size / 2;
    return {
        version: 1, size,
        layers: [
            { shape: 'ring', at: [c, c], radius: 15, inner: 12.5, fill: ICE, effects: [{ type: 'glow', color: DRIVE, blur: 4, opacity: 0.5 }] },
            { shape: 'circle', at: [c, c], radius: 3, fill: ICE },
        ],
    };
}

function dot() {
    const size = 48, c = size / 2;
    return {
        version: 1, size,
        layers: [{ shape: 'circle', at: [c, c], radius: 7, fill: '#ffffff', effects: [{ type: 'glow', color: '#ffffff', blur: 5, opacity: 0.7 }] }],
    };
}

function pip() {
    return { version: 1, size: [40, 12], layers: [{ shape: 'polygon', points: [[5, 0], [40, 0], [35, 12], [0, 12]], fill: '#ffffff' }] };
}

function keycap() {
    const size = 48;
    return {
        version: 1, size,
        layers: [
            { shape: 'rect', at: [2, 2], size: [size - 4, size - 4], radius: 8, fill: alpha(PLATE, 0.6), stroke: { color: alpha(ICE, 0.55), width: 2, align: 'inside' } },
            { shape: 'line', points: [[11, size - 7], [size - 11, size - 7]], stroke: { color: alpha(ICE, 0.3), width: 2, cap: 'round' } },
        ],
    };
}

function scrim(up) {
    const h = 256;
    const stops = [[0, alpha('#02070b', 0.78)], [0.4, alpha('#02070b', 0.4)], [1, alpha('#02070b', 0)]];
    return { version: 1, size: [8, h], layers: [{ shape: 'rect', at: [0, 0], size: [8, h], fill: { type: 'linear', from: up ? [0, h] : [0, 0], to: up ? [0, 0] : [0, h], stops } }] };
}

function shade() {
    const size = 128, c = size / 2;
    return { version: 1, size, layers: [{ shape: 'circle', at: [c, c], radius: c, fill: { type: 'radial', at: [c, c], radius: c, stops: [[0, alpha('#02070b', 0.72)], [0.55, alpha('#02070b', 0.42)], [1, alpha('#02070b', 0)]] } }] };
}

const FILES = {
    'gauge-dial': gaugeDial(),
    'gauge-speed': gaugeSpeed(false),
    'gauge-speed-hot': gaugeSpeed(true),
    'gauge-drive': gaugeRing(GAUGE.drive, ICE, { color: DRIVE, blur: 5, opacity: 0.4 }),
    'gauge-command': gaugeRing(GAUGE.command, alpha(AMBER, 0.8), { color: AMBER, blur: 4, opacity: 0.3 }),
    plate: plate(),
    'bar-track': bar(false),
    'bar-fill': bar(true),
    bracket: bracket(),
    diamond: diamond(),
    chevron: chevron(),
    body: body(),
    dot: dot(),
    pip: pip(),
    keycap: keycap(),
    'scrim-bottom': scrim(true),
    'scrim-top': scrim(false),
    shade: shade(),
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    mkdirSync(OUT, { recursive: true });
    for (const [name, source] of Object.entries(FILES)) {
        writeFileSync(path.join(OUT, `${name}.esimage`), `${JSON.stringify(source)}\n`);
        console.log(`assets/ui/${name}.esimage`);
    }
}
