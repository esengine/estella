// Bounded, deterministic simulation; rendering and platform input live elsewhere.
export const STEP = 1 / 60;
export const FLOOR = -126;
export const LIMITS = { enemies: 6, bolts: 24, particles: 160, kills: 18 } as const;
export type Phase = 'lobby' | 'entering' | 'playing' | 'paused' | 'won' | 'lost';
export interface Controls { move: number; attack: boolean; dash: boolean; nova: boolean; jump: boolean }
export interface Enemy { active: boolean; x: number; y: number; hp: number; maxHp: number; fire: number; hit: number; seed: number }
export interface Bolt { active: boolean; x: number; y: number; vx: number; vy: number; life: number }
export interface Spark { life: number; max: number; x: number; y: number; vx: number; vy: number; gold: boolean }
export class Trial {
    phase: Phase = 'lobby';
    time = 0; phaseTime = 0; remaining = 60; frame = 0;
    x = -220; y = FLOOR; vy = 0; facing = 1; moving = false;
    health = 100; kills = 0; score = 0; combo = 0; comboTime = 0;
    slash = 0; slashCooldown = 0; dash = 0; dashCooldown = 0; nova = 0; novaCooldown = 0;
    immune = 0; shake = 0; spawned = 0; spawnClock = 0; attackSerial = 0; dashSerial = 0; novaSerial = 0; hitSerial = 0;
    particleLimit = LIMITS.particles as number;
    readonly enemies: Enemy[] = Array.from({ length: LIMITS.enemies }, (_, seed) => ({ active: false, x: 0, y: 0, hp: 0, maxHp: 0, fire: 0, hit: 0, seed }));
    readonly bolts: Bolt[] = Array.from({ length: LIMITS.bolts }, () => ({ active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0 }));
    readonly sparks: Spark[] = Array.from({ length: LIMITS.particles }, () => ({ life: 0, max: 0, x: 0, y: 0, vx: 0, vy: 0, gold: false }));
    private seed = 75491;
    private random(): number { this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0; return this.seed / 4294967296; }
    enter(): void {
        if (this.phase !== 'lobby' && this.phase !== 'won' && this.phase !== 'lost') return;
        this.phase = 'entering'; this.phaseTime = 0; this.remaining = 60;
        this.x = -220; this.y = FLOOR; this.vy = 0; this.facing = 1; this.health = 100;
        this.kills = this.score = this.combo = this.comboTime = this.spawned = 0;
        this.slash = this.slashCooldown = this.dash = this.dashCooldown = this.nova = this.novaCooldown = this.immune = this.shake = 0;
        this.spawnClock = 0; this.seed = 75491;
        for (const e of this.enemies) e.active = false;
        for (const b of this.bolts) b.active = false;
        for (const p of this.sparks) p.life = 0;
    }
    lobby(): void { this.phase = 'lobby'; this.phaseTime = 0; for (const e of this.enemies) e.active = false; for (const b of this.bolts) b.active = false; }
    pause(): void { if (this.phase === 'playing') this.phase = 'paused'; }
    resume(): void { if (this.phase === 'paused') this.phase = 'playing'; }
    burst(x: number, y: number, count: number, gold = false): void {
        for (let i = 0; i < this.particleLimit && count > 0; i++) {
            const p = this.sparks[i]; if (p.life > 0) continue;
            const a = this.random() * Math.PI * 2, speed = 45 + this.random() * 280;
            p.x = x; p.y = y; p.vx = Math.cos(a) * speed; p.vy = Math.sin(a) * speed;
            p.life = p.max = 0.22 + this.random() * 0.55; p.gold = gold; count--;
        }
    }
    private hit(e: Enemy, damage: number): void {
        if (!e.active) return;
        e.hp -= damage; e.hit = .14; this.shake = Math.max(this.shake, .12); this.hitSerial++;
        this.burst(e.x, e.y, e.hp <= 0 ? 22 : 8, true);
        if (e.hp <= 0) { e.active = false; this.kills++; this.combo++; this.comboTime = 3; this.score += 100 + Math.min(this.combo, 20) * 25; }
    }
    update(c: Controls): void {
        if (this.phase === 'paused') return;
        this.frame++; this.time += STEP; this.phaseTime += STEP;
        for (const p of this.sparks) if (p.life > 0) { p.life -= STEP; p.x += p.vx * STEP; p.y += p.vy * STEP; p.vy -= 150 * STEP; }
        if (this.phase === 'entering') {
            if (this.phaseTime >= 1.35) { this.phase = 'playing'; this.phaseTime = 0; this.burst(this.x, this.y + 45, 42); }
            return;
        }
        if (this.phase !== 'playing') return;
        this.remaining = Math.max(0, this.remaining - STEP);
        this.slash = Math.max(0, this.slash - STEP); this.slashCooldown = Math.max(0, this.slashCooldown - STEP);
        this.dash = Math.max(0, this.dash - STEP); this.dashCooldown = Math.max(0, this.dashCooldown - STEP);
        this.nova = Math.max(0, this.nova - STEP); this.novaCooldown = Math.max(0, this.novaCooldown - STEP);
        this.immune = Math.max(0, this.immune - STEP); this.shake = Math.max(0, this.shake - STEP);
        this.comboTime -= STEP; if (this.comboTime <= 0) this.combo = 0;
        this.moving = Math.abs(c.move) > .15;
        if (this.moving && !this.dash) this.facing = c.move < 0 ? -1 : 1;
        if (c.jump && this.y <= FLOOR) this.vy = 500;
        this.vy -= 1250 * STEP; this.y = Math.max(FLOOR, this.y + this.vy * STEP); if (this.y === FLOOR) this.vy = 0;
        if (c.dash && this.dashCooldown <= 0) { this.dash = .18; this.dashCooldown = 1.1; this.immune = .3; this.dashSerial++; this.burst(this.x, this.y + 30, 14); }
        this.x = Math.max(-545, Math.min(545, this.x + (this.dash > 0 ? this.facing * 1060 : c.move * 300) * STEP));
        if (c.attack && this.slashCooldown <= 0) {
            this.slash = .23; this.slashCooldown = .32; this.attackSerial++;
            for (const e of this.enemies) if (e.active && Math.abs(e.y - this.y - 42) < 110 && Math.abs(e.x - this.x) < 192 && (e.x - this.x) * this.facing > -35) this.hit(e, 2);
        }
        if (c.nova && this.novaCooldown <= 0) {
            this.nova = .85; this.novaCooldown = 6; this.immune = .8; this.novaSerial++; this.shake = .25;
            this.burst(this.x, this.y + 45, 72);
            for (const b of this.bolts) b.active = false;
            for (const e of this.enemies) if (e.active && Math.abs(e.x - this.x) < 520) this.hit(e, 6);
        }
        this.spawnClock -= STEP;
        if (this.spawned < LIMITS.kills && this.spawnClock <= 0) {
            const e = this.enemies.find(e => !e.active);
            if (e) {
                e.active = true; e.x = this.spawned % 2 ? -560 : 560; e.y = FLOOR + 48;
                e.hp = e.maxHp = this.spawned >= 15 ? 6 : 2 + Math.floor(this.spawned / 6);
                e.fire = 2 + this.random(); e.hit = 0; this.spawned++; this.spawnClock = .8;
            }
        }
        for (const e of this.enemies) if (e.active) {
            e.hit = Math.max(0, e.hit - STEP);
            const delta = this.x - e.x;
            e.x += Math.sign(delta) * Math.max(0, Math.min(Math.abs(delta) - 96, 78 + this.spawned * 2)) * STEP;
            e.y = FLOOR + 45 + Math.sin(this.time * 2.8 + e.seed * 1.7) * 11;
            e.fire -= STEP;
            if (e.fire <= 0) {
                const b = this.bolts.find(b => !b.active);
                if (b) { b.active = true; b.x = e.x; b.y = e.y; const dx = this.x - e.x, dy = this.y + 45 - e.y, d = Math.hypot(dx, dy) || 1; b.vx = dx / d * 210; b.vy = dy / d * 210; b.life = 4; }
                e.fire = 2.7;
            }
        }
        for (const b of this.bolts) if (b.active) {
            b.x += b.vx * STEP; b.y += b.vy * STEP; b.life -= STEP;
            if (b.life <= 0 || Math.abs(b.x) > 630) b.active = false;
            if (this.immune <= 0 && Math.hypot(b.x - this.x, b.y - this.y - 42) < 30) {
                b.active = false; this.health = Math.max(0, this.health - 10); this.immune = .65; this.shake = .17; this.burst(this.x, this.y + 40, 10, true);
            }
        }
        if (this.kills >= LIMITS.kills) { this.phase = 'won'; this.phaseTime = 0; this.score += Math.ceil(this.remaining) * 25; }
        else if (this.health <= 0 || this.remaining <= 0) { this.phase = 'lost'; this.phaseTime = 0; }
    }
}
