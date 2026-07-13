// Headless validation of one-way platforms, motor joints, and mouse (drag) joints.
// Loads the built physics wasm directly and asserts each behaviour end-to-end, the
// same pattern as mover-smoke.mjs / sensor-smoke.mjs.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const wasmDir = path.resolve(dir, '../../desktop/public/wasm');
const factory = (await import('file://' + path.join(wasmDir, 'physics.js').replace(/\\/g, '/'))).default;
const wasmBinary = readFileSync(path.join(wasmDir, 'physics.wasm'));
const m = await factory({ wasmBinary });

let pass = true;
const check = (name, cond, detail) => {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}  ${detail ?? ''}`);
    if (!cond) pass = false;
};

// Read a dynamic body's (x, y) from the batched transform buffer.
function bodyPos(entity) {
    const count = m._physics_getDynamicBodyCount();
    const base = m._physics_getDynamicBodyTransforms() >> 2;
    for (let i = 0; i < count; i++) {
        const o = base + i * 4;
        if (m.HEAPU32[o] === entity) return { x: m.HEAPF32[o + 1], y: m.HEAPF32[o + 2] };
    }
    return null;
}
const STATIC = 0, DYNAMIC = 2;
const body = (e, type, x, y) => m._physics_createBody(e, type, x, y, 0, 1, 0, 0, 0, 0);
const box = (e, hw, hh) => m._physics_addBoxShape(e, hw, hh, 0, 0, 0, 1, 0.3, 0, 0, 1, 0xffff);
const step = (n) => { for (let i = 0; i < n; i++) m._physics_step(1 / 60); };

// ── 1) One-way platform ─────────────────────────────────────────────────────
// Platforms have a solid top (+Y): a body resting from above lands, a body launched
// up from below passes through, then falls back and lands on top.
m._physics_init(0, -9.81, 1 / 60, 4, 30, 10, 3);

const PLAT_A = 1, ABOVE = 2;
body(PLAT_A, STATIC, -5, 0); box(PLAT_A, 2, 0.2);
m._physics_setOneWayPlatform(PLAT_A, 0, 1, 1);
body(ABOVE, DYNAMIC, -5, 3); box(ABOVE, 0.2, 0.2);

const PLAT_B = 3, BELOW = 4;
body(PLAT_B, STATIC, 5, 0); box(PLAT_B, 2, 0.2);
m._physics_setOneWayPlatform(PLAT_B, 0, 1, 1);
body(BELOW, DYNAMIC, 5, -3); box(BELOW, 0.2, 0.2);
m._physics_setLinearVelocity(BELOW, 0, 12); // launch up through the platform

let belowMaxY = -Infinity;
for (let i = 0; i < 240; i++) {
    m._physics_step(1 / 60);
    const p = bodyPos(BELOW);
    if (p) belowMaxY = Math.max(belowMaxY, p.y);
}
const aPos = bodyPos(ABOVE), bPos = bodyPos(BELOW);
// Platform top at 0.2, body half-height 0.2 → resting centre ≈ 0.4.
check('above body lands on top', aPos && Math.abs(aPos.y - 0.4) < 0.15, `y=${aPos?.y.toFixed(3)} (want ≈0.4)`);
check('above body does not sink through', aPos && aPos.y > 0.2, `y=${aPos?.y.toFixed(3)}`);
check('below body passes up through', belowMaxY > 1.5, `maxY=${belowMaxY.toFixed(3)} (want >1.5)`);
check('below body lands on top after passing', bPos && Math.abs(bPos.y - 0.4) < 0.2, `y=${bPos?.y.toFixed(3)} (want ≈0.4)`);

// ── 2) Motor joint (conveyor / driven motion) ───────────────────────────────
m._physics_shutdown();
m._physics_init(0, 0, 1 / 60, 4, 30, 10, 3); // no gravity isolates the motor
const ANCHOR = 1, DRIVEN = 2;
body(ANCHOR, STATIC, 0, 0);
body(DRIVEN, DYNAMIC, 0, 0); box(DRIVEN, 0.3, 0.3);
// Drive DRIVEN toward +x at 4 m/s with ample force (velocity-only motor).
m._physics_createMotorJoint(ANCHOR, DRIVEN, 4, 0, 1000, 0, 0, 0, 0, 0, 0, 0, 0, 0);
step(60);
const driven1 = bodyPos(DRIVEN);
check('motor drives body +x', driven1 && driven1.x > 2.0, `x=${driven1?.x.toFixed(3)} (want >2.0 after 1s @ 4 m/s)`);
m._physics_setMotorJointLinearVelocity(DRIVEN, -4, 0); // reverse at runtime
step(120);
const driven2 = bodyPos(DRIVEN);
check('motor reverses body -x', driven2 && driven2.x < driven1.x, `x=${driven2?.x.toFixed(3)} < ${driven1?.x.toFixed(3)}`);

// ── 3) Mouse (drag) joint ───────────────────────────────────────────────────
m._physics_shutdown();
m._physics_init(0, 0, 1 / 60, 4, 30, 10, 3);
const DRAG = 1;
body(DRAG, DYNAMIC, 0, 0); box(DRAG, 0.3, 0.3);
// Grab the body at its centre (0,0), then drag the target around.
const created = m._physics_createMouseJoint(DRAG, 0, 0, 7.5, 1.0, 0 /*auto force*/);
check('mouse joint created', created === 1, `ret=${created}`);
check('has mouse joint', m._physics_hasMouseJoint() === 1, '');
for (let i = 0; i < 90; i++) { m._physics_setMouseTarget(5, 0); m._physics_step(1 / 60); }
const drag1 = bodyPos(DRAG);
check('drag pulls body toward x=5', drag1 && drag1.x > 3.0, `x=${drag1?.x.toFixed(3)} (want >3.0)`);
for (let i = 0; i < 120; i++) { m._physics_setMouseTarget(5, 5); m._physics_step(1 / 60); }
const drag2 = bodyPos(DRAG);
check('drag follows target to y=5', drag2 && drag2.y > 3.0, `y=${drag2?.y.toFixed(3)} (want >3.0)`);
m._physics_destroyMouseJoint();
check('mouse joint destroyed', m._physics_hasMouseJoint() === 0, '');

console.log(pass ? '\nPHYSICS_FEATURES_SMOKE PASS' : '\nPHYSICS_FEATURES_SMOKE FAIL');
process.exit(pass ? 0 : 1);
