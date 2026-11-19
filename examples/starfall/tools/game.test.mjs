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
    ticks(g, 25); g.update({ ...idle, move: -1, attack: true }); assert.equal(g.kills, 1);
    g.update({ ...idle, nova: true, jump: true }); assert.ok(g.y > FLOOR); const serial = g.novaSerial;
    ticks(g, 100, { ...idle, nova: true }); assert.equal(g.novaSerial, serial); assert.equal(g.y, FLOOR);
    g.health = 0; g.update(idle); assert.equal(g.phase, 'lost'); g.enter(); ticks(g, 82);
    assert.equal(g.health, 100); assert.equal(g.kills, 0); assert.equal(g.novaCooldown, 0);
});
test('a real round can be won with movement, held attack and timed skills', () => {
    const g = playing();
    for (let i = 0; i < 3600 && g.phase === 'playing'; i++) g.update({ move: Math.floor(i / 120) % 2 ? -1 : 1, attack: true, dash: i % 120 === 0, nova: i % 365 === 0, jump: false });
    assert.equal(g.phase, 'won'); assert.equal(g.kills, LIMITS.kills); assert.ok(g.score > 0);
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
