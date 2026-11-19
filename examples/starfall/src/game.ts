// Bounded, deterministic simulation; rendering and platform input live elsewhere.
export const STEP = 1 / 60;
export const FLOOR = -126;
export const LIMITS = { enemies: 6, bolts: 24, particles: 160, kills: 18 } as const;
export type Phase = 'lobby' | 'entering' | 'playing' | 'paused' | 'won' | 'lost';
export interface Controls { move: number; attack: boolean; dash: boolean; nova: boolean; jump: boolean }
export const ATTACKS = [
    { duration: .36, contact: .10, reach: 190, damage: 2 },
    { duration: .40, contact: .14, reach: 210, damage: 2 },
    { duration: .50, contact: .20, reach: 240, damage: 4 },
] as const;
export const CHARGE_TIME = .45;
export interface Enemy { active: boolean; x: number; y: number; hp: number; maxHp: number; fire: number; hit: number; seed: number; vx: number; death: number }
export interface Bolt { active: boolean; x: number; y: number; vx: number; vy: number; life: number }
export interface Spark { life: number; max: number; x: number; y: number; vx: number; vy: number; gold: boolean }
export class Trial {
    phase: Phase = 'lobby';
    time = 0; phaseTime = 0; remaining = 60; frame = 0;
    x = -220; y = FLOOR; vy = 0; facing = 1; moving = false;
    health = 100; kills = 0; score = 0; combo = 0; comboTime = 0;
    slash = 0; slashCooldown = 0; dash = 0; dashCooldown = 0; nova = 0; novaCooldown = 0;
    attackStage = 0; attackAge = 0; chainTime = 0; charge = 0; hitStop = 0; landing = 0; hurt = 0;
    motionTime = 0; runTime = 0; novaX = 0; novaY = 0; light = 0;
    novaReleaseSerial = 0; landingSerial = 0;
    immune = 0; shake = 0; spawned = 0; spawnClock = 0; attackSerial = 0; dashSerial = 0; novaSerial = 0; hitSerial = 0;
    particleLimit = LIMITS.particles as number;
    readonly enemies: Enemy[] = Array.from({ length: LIMITS.enemies }, (_, seed) => ({ active: false, x: 0, y: 0, hp: 0, maxHp: 0, fire: 0, hit: 0, seed, vx: 0, death: 0 }));
    readonly bolts: Bolt[] = Array.from({ length: LIMITS.bolts }, () => ({ active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0 }));
    readonly sparks: Spark[] = Array.from({ length: LIMITS.particles }, () => ({ life: 0, max: 0, x: 0, y: 0, vx: 0, vy: 0, gold: false }));
    private seed = 75491;
    private attackConnected = false;
    private bufferedAttack = 0;
    private pendingDash = false; private pendingNova = false; private pendingJump = false;
    private random(): number { this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0; return this.seed / 4294967296; }
    enter(): void {
        if (this.phase !== 'lobby' && this.phase !== 'won' && this.phase !== 'lost') return;
        this.phase = 'entering'; this.phaseTime = 0; this.remaining = 60;
        this.x = -220; this.y = FLOOR; this.vy = 0; this.facing = 1; this.health = 100;
        this.kills = this.score = this.combo = this.comboTime = this.spawned = 0;
        this.slash = this.slashCooldown = this.dash = this.dashCooldown = this.nova = this.novaCooldown = this.immune = this.shake = 0;
        this.charge = this.hitStop = this.landing = this.hurt = this.chainTime = this.light = this.runTime = this.bufferedAttack = 0;
        this.attackStage = this.attackAge = 0; this.attackConnected = false; this.moving = false;
        this.pendingDash = this.pendingNova = this.pendingJump = false;
        this.spawnClock = 0; this.seed = 75491;
        for (const e of this.enemies) { e.active = false; e.death = 0; }
        for (const b of this.bolts) b.active = false;
        for (const p of this.sparks) p.life = 0;
    }
    lobby(): void {
        this.phase = 'lobby'; this.phaseTime = 0; this.light = this.charge = this.nova = this.hitStop = 0;
        for (const e of this.enemies) { e.active = false; e.death = 0; }
        for (const b of this.bolts) b.active = false;
    }
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
        e.hp -= damage; e.hit = .18; e.vx = Math.sign(e.x - this.x) * (damage >= 4 ? 340 : 180);
        this.shake = Math.max(this.shake, damage >= 4 ? .22 : .13); this.hitSerial++;
        this.hitStop = Math.max(this.hitStop, damage >= 4 ? .065 : .035); this.light = Math.max(this.light, damage >= 4 ? 1.4 : .8);
        this.burst(e.x, e.y, e.hp <= 0 ? 22 : 8, true);
        if (e.hp <= 0) { e.active = false; e.death = .32; this.kills++; this.combo++; this.comboTime = 3; this.score += 100 + Math.min(this.combo, 20) * 25; }
    }
    update(c: Controls): void {
        if (this.phase === 'paused') return;
        this.frame++; this.time += STEP; this.phaseTime += STEP;
        this.light = Math.max(0, this.light - STEP * 4);
        for (const p of this.sparks) if (p.life > 0) { p.life -= STEP; p.x += p.vx * STEP; p.y += p.vy * STEP; p.vy -= 150 * STEP; }
        if (this.phase === 'entering') {
            if (this.phaseTime >= 1.35) { this.phase = 'playing'; this.phaseTime = 0; this.burst(this.x, this.y + 45, 42); }
            return;
        }
        if (this.phase !== 'playing') return;
        this.remaining = Math.max(0, this.remaining - STEP);
        this.pendingDash ||= c.dash; this.pendingNova ||= c.nova; this.pendingJump ||= c.jump;
        if (c.attack) this.bufferedAttack = .12;
        this.dashCooldown = Math.max(0, this.dashCooldown - STEP); this.novaCooldown = Math.max(0, this.novaCooldown - STEP);
        this.immune = Math.max(0, this.immune - STEP); this.shake = Math.max(0, this.shake - STEP);
        // Impact holds animation, actors and projectiles for 2–4 ticks. Presses
        // stay buffered so a quick dash/nova during the stop is not swallowed.
        if (this.hitStop > 0) { this.hitStop = Math.max(0, this.hitStop - STEP); this.finish(); return; }
        this.motionTime += STEP;
        this.slash = Math.max(0, this.slash - STEP); this.slashCooldown = Math.max(0, this.slashCooldown - STEP);
        this.dash = Math.max(0, this.dash - STEP); this.nova = Math.max(0, this.nova - STEP);
        this.landing = Math.max(0, this.landing - STEP); this.hurt = Math.max(0, this.hurt - STEP);
        this.chainTime = Math.max(0, this.chainTime - STEP); this.bufferedAttack = Math.max(0, this.bufferedAttack - STEP);
        this.comboTime -= STEP; if (this.comboTime <= 0) this.combo = 0;
        this.moving = Math.abs(c.move) > .15;
        if (this.moving && !this.dash && !this.slash && !this.charge) this.facing = c.move < 0 ? -1 : 1;
        if (this.pendingJump && this.y <= FLOOR && !this.charge) this.vy = 500;
        const wasAirborne = this.y > FLOOR;
        this.vy -= 1250 * STEP; this.y = Math.max(FLOOR, this.y + this.vy * STEP); if (this.y === FLOOR) this.vy = 0;
        if (wasAirborne && this.y === FLOOR) { this.landing = .14; this.landingSerial++; this.burst(this.x, FLOOR + 4, 12); }
        if (this.pendingDash && this.dashCooldown <= 0 && !this.charge) {
            this.dash = .18; this.dashCooldown = 1.1; this.immune = .3; this.dashSerial++; this.slash = this.slashCooldown = 0;
            this.burst(this.x, this.y + 30, 14);
        }
        if (this.pendingNova && this.novaCooldown <= 0) {
            this.charge = CHARGE_TIME; this.novaCooldown = 6; this.immune = 1.1; this.novaSerial++;
            this.slash = this.slashCooldown = this.dash = 0; this.bufferedAttack = 0;
        }
        this.pendingDash = this.pendingNova = this.pendingJump = false;
        const casting = this.charge > 0 || this.nova > .72;
        const speed = this.dash > 0 ? this.facing * 1060 : casting ? 0 : c.move * (this.slash > 0 ? 235 : 300);
        this.x = Math.max(-545, Math.min(545, this.x + speed * STEP));
        const previousRun = this.runTime;
        if (Math.abs(speed) > 1) this.runTime += Math.abs(speed) * STEP / 300;
        if (this.y === FLOOR && !this.dash && Math.floor(previousRun * 7) !== Math.floor(this.runTime * 7)) this.burst(this.x - this.facing * 15, FLOOR + 4, 3);
        if (this.charge > 0) {
            this.charge = Math.max(0, this.charge - STEP);
            if (this.charge === 0) {
                this.nova = 1; this.novaX = this.x; this.novaY = this.y + 48; this.novaReleaseSerial++; this.shake = .35; this.light = 3.2;
                this.burst(this.novaX, this.novaY, 72);
                for (const b of this.bolts) b.active = false;
                for (const e of this.enemies) if (e.active && Math.abs(e.x - this.x) < 520) this.hit(e, 6);
            }
        }
        if (this.bufferedAttack > 0 && this.slashCooldown <= 0 && !casting && !this.dash) {
            this.attackStage = this.chainTime > 0 ? (this.attackStage + 1) % 3 : 0;
            this.slash = this.slashCooldown = ATTACKS[this.attackStage].duration; this.attackAge = 0;
            this.attackConnected = false; this.attackSerial++; this.bufferedAttack = 0;
            this.chainTime = this.slash + .55;
        }
        if (this.slash > 0) {
            const attack = ATTACKS[this.attackStage]; this.attackAge = attack.duration - this.slash;
            if (!this.attackConnected && this.attackAge + 1e-8 >= attack.contact) {
                this.attackConnected = true; this.light = Math.max(this.light, this.attackStage === 2 ? 1.25 : .65);
                for (const e of this.enemies) if (e.active && Math.abs(e.y - this.y - 42) < 110 && Math.abs(e.x - this.x) < attack.reach && (e.x - this.x) * this.facing > -35) this.hit(e, attack.damage);
            }
        }
        this.spawnClock -= STEP;
        if (this.spawned < LIMITS.kills && this.spawnClock <= 0) {
            const e = this.enemies.find(e => !e.active && e.death <= 0);
            if (e) {
                e.active = true; e.x = this.spawned % 2 ? -560 : 560; e.y = FLOOR + 48;
                e.hp = e.maxHp = this.spawned >= 15 ? 6 : 2 + Math.floor(this.spawned / 6);
                e.fire = 2 + this.random(); e.hit = e.death = e.vx = 0; this.spawned++; this.spawnClock = .8;
            }
        }
        for (const e of this.enemies) {
            e.death = Math.max(0, e.death - STEP);
            e.x = Math.max(-590, Math.min(590, e.x + e.vx * STEP)); e.vx *= .82;
            if (!e.active) continue;
            e.hit = Math.max(0, e.hit - STEP);
            const delta = this.x - e.x;
            if (!e.hit) e.x += Math.sign(delta) * Math.max(0, Math.min(Math.abs(delta) - 96, 78 + this.spawned * 2)) * STEP;
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
            if (this.slash > 0 && this.attackAge >= ATTACKS[this.attackStage].contact && this.attackAge < ATTACKS[this.attackStage].contact + .15
                && (b.x - this.x) * this.facing > -25 && Math.abs(b.x - this.x) < 190 && Math.abs(b.y - this.y - 48) < 95) {
                b.active = false; this.burst(b.x, b.y, 4, true); continue;
            }
            if (this.immune <= 0 && Math.hypot(b.x - this.x, b.y - this.y - 42) < 30) {
                b.active = false; this.health = Math.max(0, this.health - 10); this.immune = .65; this.hurt = .12; this.shake = .17; this.burst(this.x, this.y + 40, 10, true);
            }
        }
        this.finish();
    }
    private finish(): void {
        if (this.kills >= LIMITS.kills) { this.phase = 'won'; this.phaseTime = 0; this.score += Math.ceil(this.remaining) * 25; }
        else if (this.health <= 0 || this.remaining <= 0) { this.phase = 'lost'; this.phaseTime = 0; }
    }
}
