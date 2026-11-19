import { Draw, BlendMode, type Color } from 'esengine';
import { FLOOR, type Trial } from './game';

// The draw bridge consumes these immediately. Reuse scratch records instead of
// allocating a point/color for every star, line or particle on mobile.
const p = { x: 0, y: 0 }, q = { x: 0, y: 0 }, size = { x: 0, y: 0 };
const c: Color = { r: 1, g: 1, b: 1, a: 1 };
function tint(r: number, g: number, b: number, a: number) { c.r = r; c.g = g; c.b = b; c.a = a; return c; }
function line(x: number, y: number, x2: number, y2: number, w: number) { p.x = x; p.y = y; q.x = x2; q.y = y2; Draw.line(p, q, c, w); }
function rect(x: number, y: number, w: number, h: number) { p.x = x; p.y = y; size.x = w; size.y = h; Draw.rect(p, size, c); }
function ring(x: number, y: number, rx: number, ry: number, start: number, length: number, width: number, n = 40) {
    let ax = x + Math.cos(start) * rx, ay = y + Math.sin(start) * ry;
    for (let i = 1; i <= n; i++) { const a = start + length * i / n, bx = x + Math.cos(a) * rx, by = y + Math.sin(a) * ry; line(ax, ay, bx, by, width); ax = bx; ay = by; }
}
export function drawEffects(g: Trial, reduced: boolean, stickX = 0): void {
    Draw.setDepthTest(false); Draw.setLayer(20); Draw.setBlendMode(BlendMode.Normal);
    const t = g.time, lobby = g.phase === 'lobby', entering = g.phase === 'entering';
    if (lobby || entering) {
        const fade = lobby ? 1 : Math.max(0, 1 - g.phaseTime * 1.8);
        for (let i = 0; i < 60; i++) {
            tint(.012, .025, .046, (1 - i / 60) * .72 * fade); rect(-636 + i * 8, 0, 8, 720);
            tint(.012, .025, .046, (1 - i / 60) * .43 * fade); rect(638 - i * 4, 0, 4, 720);
        }
    }
    // Selective small geometry carries the light; no bloom, blur or full-screen noise.
    Draw.setBlendMode(BlendMode.Additive);
    const starCount = reduced ? 18 : 36;
    for (let i = 0; i < starCount; i++) {
        const x = ((i * 193.17 + t * (3 + i % 4)) % 1240) - 620;
        const y = ((i * 101.31 + t * (5 + i % 3)) % 490) - 145;
        const a = .18 + .32 * Math.pow(.5 + .5 * Math.sin(t * 1.5 + i), 2);
        tint(.35, .91, 1, a); rect(x, y, i % 4 ? 1.6 : 3, i % 4 ? 1.6 : 3);
        if (i % 7 === 0) { tint(.7, 1, 1, a * .55); line(x - 6, y, x + 6, y, 1); line(x, y - 6, x, y + 6, 1); }
    }
    const gatePower = entering ? Math.sin(Math.min(1, g.phaseTime / 1.35) * Math.PI) : .16;
    tint(.2, .85, .88, .22 + gatePower * .48);
    ring(89, 116, 195, 195, t * .09, Math.PI * 1.38, 1.5, 44);
    tint(1, .74, .36, .35 + gatePower * .5);
    ring(89, 116, 211, 211, -t * .12 + 2, Math.PI * .7, 1.2, 24);
    for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4 + t * .12, x = 89 + Math.cos(a) * 205, y = 116 + Math.sin(a) * 205;
        tint(.55, 1, .94, .35 + gatePower * .45); rect(x, y, 3, 3);
    }
    if (entering) {
        const u = Math.min(1, g.phaseTime / 1.35), radius = 30 + u * u * 850;
        tint(.45, 1, .92, (1 - u) * .7); ring(89, 116, radius, radius, 0, Math.PI * 2, 5, 64);
        for (let i = 0; i < 24; i++) {
            const a = i * Math.PI / 12 + .2, r = 120 + (u * 700 + i * 29) % 800;
            tint(.4, .95, 1, .3 * Math.sin(u * Math.PI)); line(89 + Math.cos(a) * r, 116 + Math.sin(a) * r, 89 + Math.cos(a) * (r + 75), 116 + Math.sin(a) * (r + 75), 2);
        }
    }
    if (g.phase !== 'lobby' && g.phase !== 'entering') {
        for (const e of g.enemies) if (e.active) {
            const x = e.x, y = e.y, r = e.maxHp >= 6 ? 30 : 23;
            Draw.setBlendMode(BlendMode.Additive);
            tint(1, .45, .22, .33); ring(x, y, r + 9, r + 9, t * 1.3 + e.seed, 4.4, 1, 18);
            tint(.9, .65, .38, .8); rect(x - 20 + 20 * e.hp / e.maxHp, y + r + 15, 40 * e.hp / e.maxHp, 2);
        }
        for (const b of g.bolts) if (b.active) {
            tint(1, .36, .16, .22); line(b.x - b.vx * .09, b.y - b.vy * .09, b.x, b.y, 10);
            tint(1, .78, .43, .95); line(b.x - b.vx * .055, b.y - b.vy * .055, b.x, b.y, 3);
        }
        if (g.dash > 0) {
            for (let i = 0; i < 4; i++) { tint(.25, .92, 1, .3 * (1 - i / 4)); line(g.x - g.facing * (40 + i * 35), g.y + 12 + i * 14, g.x + g.facing * 20, g.y + 12 + i * 14, 3); }
        }
        if (g.slash > 0) {
            const u = 1 - g.slash / .23, direction = g.facing, a = direction > 0 ? -.95 : Math.PI - .95;
            const r = 70 + u * 105, alpha = Math.sin((.1 + u * .9) * Math.PI);
            tint(.17, .9, .86, .16 * alpha); ring(g.x, g.y + 48, r, r * .62, a, 2.1, 22, 20);
            tint(.34, 1, .94, .8 * alpha); ring(g.x, g.y + 48, r + 4, r * .62, a, 2.1, 7, 20);
            tint(.91, 1, .97, alpha); ring(g.x, g.y + 48, r + 5, r * .62, a + .2, 1.7, 2, 16);
        }
        if (g.nova > 0) {
            const u = 1 - g.nova / .85, r = 35 + Math.pow(u, .7) * 550;
            tint(.15, .9, .92, .16 * (1 - u)); ring(g.x, g.y + 48, r, r * .68, 0, Math.PI * 2, 24, 56);
            tint(.6, 1, .9, .8 * (1 - u)); ring(g.x, g.y + 48, r + 4, r * .68, 0, Math.PI * 2, 3, 56);
            tint(1, .81, .45, .55 * (1 - u)); ring(g.x, g.y + 48, r * .72, r * .48, -t, Math.PI * 1.7, 2, 42);
            tint(.35, .9, 1, (1 - u) * .4); line(g.x, FLOOR, g.x, 340, 12 * (1 - u));
        }
    }
    for (let i = 0; i < g.particleLimit; i++) {
        const s = g.sparks[i]; if (s.life <= 0) continue;
        const a = s.life / s.max; tint(s.gold ? 1 : .3, s.gold ? .69 : .96, s.gold ? .28 : 1, a * .85);
        line(s.x, s.y, s.x - s.vx * .025, s.y - s.vy * .025, a * 2 + .5);
    }
    if (!lobby && !entering) {
        // UI hit regions remain native widgets; only their circular decoration is drawn here.
        const control = (x: number, y: number, r: number, gold = false, active = false) => {
            Draw.setBlendMode(BlendMode.Normal); p.x = x; p.y = y; tint(.025, .07, .1, .73); Draw.circle(p, r, c, true, 32);
            Draw.setBlendMode(BlendMode.Additive); tint(gold ? 1 : .4, gold ? .78 : .88, gold ? .42 : .9, active ? .95 : .48);
            ring(x, y, r, r, 0, Math.PI * 2, active ? 3 : 1, 36);
            tint(gold ? 1 : .45, gold ? .78 : .91, gold ? .42 : .95, .16); ring(x, y, r - 6, r - 6, 0, Math.PI * 2, 1, 32);
        };
        control(-495, -261, 58);
        tint(.45, .95, .9, .3); p.x = -495 + stickX * 35; p.y = -261; Draw.circle(p, 23, c, true, 24);
        tint(.65, 1, .94, .7); ring(p.x, p.y, 23, 23, 0, Math.PI * 2, 1, 24);
        control(512, -256, 55, false, g.slash > 0);
        control(363, -199, 45, true, g.nova > 0);
        if (g.novaCooldown > 0) { tint(1, .8, .43, .8); ring(363, -199, 49, 49, Math.PI / 2, -Math.PI * 2 * (1 - g.novaCooldown / 6), 2, 30); }
        control(362, -297, 34, false, g.dash > 0); control(244, -297, 34);
    }
    Draw.setBlendMode(BlendMode.Normal); Draw.setLayer(0);
}
