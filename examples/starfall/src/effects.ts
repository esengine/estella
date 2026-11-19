import { Draw, BlendMode, type Color } from 'esengine';
import { ATTACKS, CHARGE_TIME, FLOOR, type Trial } from './game';

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
function glow(x: number, y: number, radius: number, alpha: number, gold = false) {
    p.x = x; p.y = y;
    for (let i = 4; i > 0; i--) {
        tint(gold ? 1 : .22, gold ? .74 : .94, gold ? .35 : 1, alpha * (i === 1 ? .65 : .08));
        Draw.circle(p, radius * i / 4, c, true, 24);
    }
}
function sigil(x: number, y: number, radius: number, squash: number, spin: number, alpha: number, detailed: boolean) {
    tint(.25, 1, .91, alpha * .65); ring(x, y, radius, radius * squash, 0, Math.PI * 2, 2, 48);
    tint(1, .78, .42, alpha * .75); ring(x, y, radius * .87, radius * squash * .87, -spin, Math.PI * 1.8, 1.3, 40);
    for (let i = 0; i < 6; i++) {
        const a = i * Math.PI / 3 + spin, b = a + Math.PI * 2 / 3;
        tint(.6, 1, .92, alpha * .35);
        line(x + Math.cos(a) * radius * .72, y + Math.sin(a) * radius * squash * .72, x + Math.cos(b) * radius * .72, y + Math.sin(b) * radius * squash * .72, 1.3);
    }
    if (detailed) for (let i = 0; i < 18; i++) {
        const a = i * Math.PI / 9 - spin * .5, r = radius * 1.06;
        tint(.8, 1, .9, alpha * .65);
        line(x + Math.cos(a) * r, y + Math.sin(a) * r * squash, x + Math.cos(a) * (r + 6), y + Math.sin(a) * (r + 6) * squash, 2);
    }
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
    // Moving wisps and meteors sit on top of the painted environment. The
    // temple's own material supplies the soft lighting on the stone below.
    const meteor = (t * .22) % 1;
    if (!reduced && meteor < .22) {
        const mx = 480 - meteor * 2100, my = 320 - meteor * 650;
        tint(.5, .95, 1, Math.sin(meteor / .22 * Math.PI) * .5); line(mx, my, mx + 75, my + 23, 1.5);
        glow(mx, my, 7, .5);
    }
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
        if (g.landing > 0) {
            const u = 1 - g.landing / .14;
            tint(.42, .93, 1, (1 - u) * .6); ring(g.x, FLOOR + 2, 20 + u * 65, 5 + u * 12, 0, Math.PI * 2, 2, 28);
        }
        for (const e of g.enemies) if (e.active) {
            const x = e.x, y = e.y, r = e.maxHp >= 6 ? 30 : 23;
            Draw.setBlendMode(BlendMode.Additive);
            tint(1, .45, .22, .33); ring(x, y, r + 9, r + 9, t * 1.3 + e.seed, 4.4, 1, 18);
            tint(.9, .65, .38, .8); rect(x - 20 + 20 * e.hp / e.maxHp, y + r + 15, 40 * e.hp / e.maxHp, 2);
            if (e.fire < .5) { glow(x, y, 19, 1 - e.fire * 2, true); tint(1, .6, .25, .65); ring(x, y, 12 + e.fire * 50, 12 + e.fire * 50, 0, Math.PI * 2, 1.4, 24); }
            if (e.hit > 0) {
                const a = e.hit / .18;
                glow(x, y, 30 * a + 10, a, true);
                tint(1, .94, .72, a); line(x - 21, y - 26, x + 21, y + 26, 2.5); line(x - 30, y + 12, x + 30, y - 12, 1.5);
            }
        }
        for (const b of g.bolts) if (b.active) {
            tint(1, .36, .16, .22); line(b.x - b.vx * .09, b.y - b.vy * .09, b.x, b.y, 10);
            tint(1, .78, .43, .95); line(b.x - b.vx * .055, b.y - b.vy * .055, b.x, b.y, 3);
        }
        if (g.dash > 0) {
            for (let i = 0; i < 4; i++) { tint(.25, .92, 1, .3 * (1 - i / 4)); line(g.x - g.facing * (40 + i * 35), g.y + 12 + i * 14, g.x + g.facing * 20, g.y + 12 + i * 14, 3); }
        }
        if (g.slash > 0) {
            const u = (g.attackAge - ATTACKS[g.attackStage].contact) / .22;
            if (u >= -.05 && u <= 1) {
                const k = Math.max(0, u), finishing = g.attackStage === 2;
                const rx = (finishing ? 177 : 140) + k * 25, ry = g.attackStage === 0 ? 53 : finishing ? 126 : 108;
                const start = g.attackStage === 1 ? -1.4 + k * .8 : .9 - k * .7;
                const arc = g.attackStage === 1 ? 2.5 : -2.4, alpha = (1 - k) * .95;
                // Tapered ribbons: soft cyan body, saturated edge, white blade.
                for (let layer = reduced ? 1 : 0; layer < 3; layer++) for (let i = 0; i < 28; i++) {
                    const s = i / 28, a = start + arc * s, b = start + arc * (i + 1) / 28;
                    const taper = Math.sin(s * Math.PI) * (layer === 0 ? 25 : layer === 1 ? 11 : 2.2) + .5;
                    tint(layer === 2 ? .92 : finishing ? .7 : .18, 1, finishing ? .65 : .94, alpha * (layer === 0 ? .16 : layer === 1 ? .6 : 1));
                    line(g.x + Math.cos(a) * rx * g.facing, g.y + 68 + Math.sin(a) * ry, g.x + Math.cos(b) * rx * g.facing, g.y + 68 + Math.sin(b) * ry, taper);
                }
                if (finishing) {
                    tint(1, .78, .4, alpha * .6); ring(g.x + g.facing * 85, FLOOR + 3, 65 + k * 110, 16 + k * 18, 0, Math.PI * 2, 2, 32);
                }
            }
        }
        if (g.charge > 0) {
            const charge = 1 - g.charge / CHARGE_TIME;
            sigil(g.x, FLOOR + 3, 65 + charge * 60, .28, t * 1.4, .5 + charge * .5, !reduced);
            glow(g.x + g.facing * 14, g.y + 115, 15 + charge * 35, .6 + charge * .4, true);
            for (let i = 0; i < (reduced ? 5 : 10); i++) {
                const a = i * Math.PI * .618 + t * 2, r = 40 + ((i * .193 - charge + 2) % 1) * 170;
                tint(.4, 1, .95, charge * .65);
                line(g.x + Math.cos(a) * r, g.y + 80 + Math.sin(a) * r * .7, g.x + Math.cos(a) * (r + 20), g.y + 80 + Math.sin(a) * (r + 20) * .7, 1.6);
            }
        }
        if (g.nova > 0) {
            const u = 1 - g.nova, r = 35 + Math.pow(u, .58) * 620, x = g.novaX, y = g.novaY;
            sigil(x, FLOOR + 3, 132 + u * 65, .28, t * .6, (1 - u) * .8, !reduced);
            tint(.15, .9, .92, .15 * (1 - u)); ring(x, y, r, r * .68, 0, Math.PI * 2, 30, 64);
            tint(.65, 1, .9, .8 * (1 - u)); ring(x, y, r + 4, r * .68, 0, Math.PI * 2, 3, 64);
            tint(1, .81, .45, .55 * (1 - u)); ring(x, y, r * .72, r * .48, -t, Math.PI * 1.7, 2, 48);
            const pillar = Math.max(0, 1 - u * 2.8);
            if (pillar > 0) {
                const strips = reduced ? 8 : 16;
                for (let i = strips; i > 0; i--) { tint(i === 1 ? .85 : .22, 1, .91, pillar * (i === 1 ? .7 : .018)); line(x, FLOOR, x, 350, (i === 1 ? 3 : i / strips * 88) * pillar); }
                glow(x, y + 55, 85 + u * 100, pillar, true);
            }
            for (let i = 0; i < (reduced ? 8 : 16); i++) {
                const a = i * Math.PI / (reduced ? 4 : 8) + .15, tail = Math.max(0, r - 70 * (1 - u));
                tint(.7, 1, .92, (1 - u) * .45);
                line(x + Math.cos(a) * tail, y + Math.sin(a) * tail * .68, x + Math.cos(a) * r, y + Math.sin(a) * r * .68, 2);
            }
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
        control(363, -199, 45, true, g.nova > 0 || g.charge > 0);
        if (g.novaCooldown > 0) { tint(1, .8, .43, .8); ring(363, -199, 49, 49, Math.PI / 2, -Math.PI * 2 * (1 - g.novaCooldown / 6), 2, 30); }
        control(362, -297, 34, false, g.dash > 0); control(244, -297, 34);
    }
    Draw.setBlendMode(BlendMode.Normal); Draw.setLayer(0);
}
