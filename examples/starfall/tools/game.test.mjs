import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const compiled = await build({ entryPoints: [fileURLToPath(new URL('../src/game.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false });
const { Trial, LIMITS, FLOOR } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const idle = { move: 0, attack: false, dash: false, nova: false, jump: false };
const ticks = (g, count, controls = idle) => { for (let i = 0; i < count; i++) g.update(controls); };
function playing() { const g = new Trial(); g.enter(); ticks(g, 82); assert.equal(g.phase, 'playing'); return g; }
test('entry is debounced and pause freezes gameplay, projectiles and effects', () => {
    const g = new Trial(); g.enter(); ticks(g, 35); const progress = g.phaseTime; g.enter(); assert.equal(g.phaseTime, progress);
    ticks(g, 50); g.update({ ...idle, nova: true }); g.pause(); const before = JSON.stringify(g); ticks(g, 300); assert.equal(JSON.stringify(g), before);
    g.resume(); g.update(idle); assert.equal(g.phase, 'playing'); assert.ok(g.remaining < 60);
});
test('melee direction, nova cooldown, jumping and reset are gameplay rules', () => {
    const g = playing(), e = g.enemies[0];
    Object.assign(e, { active: true, x: g.x - 100, y: FLOOR + 40, hp: 2, maxHp: 2, fire: 10 });
    g.update({ ...idle, attack: true }); assert.equal(e.hp, 2);
    ticks(g, 25); g.update({ ...idle, move: -1, attack: true }); assert.equal(g.kills, 0, 'the anticipation frame does not damage');
    ticks(g, 10); assert.equal(g.kills, 1);
    g.update({ ...idle, nova: true, jump: true }); ticks(g, 5); assert.ok(g.y > FLOOR); const serial = g.novaSerial;
    ticks(g, 100, { ...idle, nova: true }); assert.equal(g.novaSerial, serial); assert.equal(g.y, FLOOR);
    g.health = 0; g.update(idle); assert.equal(g.phase, 'lost'); g.enter(); ticks(g, 82);
    assert.equal(g.health, 100); assert.equal(g.kills, 0); assert.equal(g.novaCooldown, 0);
});
test('a real round can be won with movement, held attack and timed skills', () => {
    const g = playing();
    for (let i = 0; i < 3600 && g.phase === 'playing'; i++) g.update({ move: Math.floor(i / 120) % 2 ? -1 : 1, attack: true, dash: i % 120 === 0, nova: i % 365 === 0, jump: false });
    assert.equal(g.phase, 'won'); assert.equal(g.kills, LIMITS.kills); assert.ok(g.score > 0);
});

test('combo contact is timed, hits once per swing, and chains three different attacks', () => {
    const g = playing(), e = g.enemies[0];
    Object.assign(e, { active: true, x: g.x + 120, y: FLOOR + 40, hp: 20, maxHp: 20, fire: 100 });
    g.update({ ...idle, attack: true }); ticks(g, 4); assert.equal(e.hp, 20);
    ticks(g, 3); assert.equal(e.hp, 18); assert.ok(g.hitStop > 0); assert.ok(e.vx > 0);
    ticks(g, 12); assert.equal(e.hp, 18, 'one damage event per swing');
    const chain = new Trial(); chain.enter(); ticks(chain, 82); const stages = []; let serial = 0;
    for (let i = 0; i < 180; i++) {
        chain.update({ ...idle, attack: true });
        if (chain.attackSerial !== serial) { stages.push(chain.attackStage); serial = chain.attackSerial; }
    }
    assert.deepEqual(stages.slice(0, 6), [0, 1, 2, 0, 1, 2]);
});

test('nova press survives hit stop, charges before damage and releases once', () => {
    const g = playing(), e = g.enemies[0];
    Object.assign(e, { active: true, x: g.x + 250, y: FLOOR + 40, hp: 6, maxHp: 6, fire: 100 });
    g.hitStop = .05; g.update({ ...idle, nova: true }); assert.equal(g.novaSerial, 0);
    ticks(g, 5); assert.equal(g.novaSerial, 1); assert.ok(g.charge > 0); assert.equal(e.hp, 6);
    const x = g.x; ticks(g, 10, { ...idle, move: 1 }); assert.equal(g.x, x); assert.equal(g.novaReleaseSerial, 0);
    ticks(g, 25); assert.equal(g.novaReleaseSerial, 1); assert.equal(e.active, false);
    ticks(g, 60, { ...idle, nova: true }); assert.equal(g.novaReleaseSerial, 1);
});

test('an active slash deflects nearby front bolts while a rear bolt can damage', () => {
    const g = playing(); g.update({ ...idle, attack: true }); ticks(g, 6);
    Object.assign(g.bolts[0], { active: true, x: g.x + 100, y: FLOOR + 45, vx: -200, vy: 0, life: 4 });
    g.update(idle); assert.equal(g.bolts[0].active, false); assert.equal(g.health, 100);
    Object.assign(g.bolts[1], { active: true, x: g.x - 29, y: FLOOR + 45, vx: 0, vy: 0, life: 4 });
    g.update(idle); assert.equal(g.health, 90);
});
test('repeated rounds keep all pools bounded and reuse their objects', () => {
    const g = new Trial(), enemy = g.enemies[0], bolt = g.bolts[0], spark = g.sparks[0];
    for (let round = 0; round < 40; round++) {
        g.lobby(); g.enter(); ticks(g, 82);
        for (let i = 0; i < 3600 && g.phase === 'playing'; i++) {
            g.update({ move: Math.sin(i / 80), attack: true, nova: i % 365 === 0, dash: i % 90 === 0, jump: i % 150 === 0 });
            assert.ok(g.enemies.filter(e => e.active).length <= LIMITS.enemies);
            assert.ok(g.bolts.filter(b => b.active).length <= LIMITS.bolts);
            assert.ok(g.sparks.filter(p => p.life > 0).length <= LIMITS.particles);
        }
    }
    assert.equal(g.enemies[0], enemy); assert.equal(g.bolts[0], bolt); assert.equal(g.sparks[0], spark);
    g.particleLimit = 80; for (const p of g.sparks) p.life = 0; g.burst(0, 0, 10000);
    assert.equal(g.sparks.filter(p => p.life > 0).length, 80);
});
