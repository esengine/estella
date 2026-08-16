// Headless validation of the 3D physics module: loads the built wasm and asserts
// each behaviour against a value arithmetic predicts. A world that steps without
// throwing proves nothing about where anything ended up.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const wasmDir = path.resolve(dir, '../../desktop/public/wasm');
const factory = (await import('file://' + path.join(wasmDir, 'physics3d.js').replace(/\\/g, '/'))).default;
const wasmBinary = readFileSync(path.join(wasmDir, 'physics3d.wasm'));
const m = await factory({ wasmBinary });

let pass = true;
const check = (name, cond, detail) => {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}  ${detail ?? ''}`);
    if (!cond) pass = false;
};
const near = (a, b, tol = 1e-3) => Math.abs(a - b) <= tol;

const STATIC = 0, KINEMATIC = 1, DYNAMIC = 2;
const IDENTITY = [0, 0, 0, 1];
// motion, gravityScale, linearDamping, angularDamping, fixedRotation — what a body
// is beyond its shape.
const FREE = (motion) => [motion, 1, 0, 0, 0];

/** The position of `entity` in the step's transform readback, or null. */
function bodyPos(entity) {
    const bytes = m._physics3d_transformsBytes();
    const base = m._physics3d_transforms() >> 2;
    for (let i = 0; i < bytes / 4; i += 8) {
        if (m.HEAPF32[base + i] === entity) {
            return { x: m.HEAPF32[base + i + 1], y: m.HEAPF32[base + i + 2],
                     z: m.HEAPF32[base + i + 3] };
        }
    }
    return null;
}

/** One body's state, read through the single-body getter rather than the sweep. */
function bodyState(id) {
    if (!m._physics3d_getBodyState(id)) return null;
    const base = m._physics3d_queryResult() >> 2;
    const f = (i) => m.HEAPF32[base + i];
    return { x: f(0), y: f(1), z: f(2), vx: f(7), vy: f(8), vz: f(9) };
}

function raycast(ox, oy, oz, dx, dy, dz) {
    if (!m._physics3d_raycast(ox, oy, oz, dx, dy, dz)) return null;
    const base = m._physics3d_queryResult() >> 2;
    const f = (i) => m.HEAPF32[base + i];
    return { entity: f(0), fraction: f(1), x: f(2), y: f(3), z: f(4),
             nx: f(5), ny: f(6), nz: f(7) };
}

const step = (n) => { for (let i = 0; i < n; i++) m._physics3d_step(1 / 60, 1); };

m._physics3d_init(0, -9.81, 0, 1024);
check('the world reports itself ready', m._physics3d_isReady() === 1);

// ── 1) A sphere falls onto a floor and stops on top of it ───────────────────
// Floor spans y in [-1, 0]; a sphere of radius 0.5 dropped from y=4 comes to rest
// with its CENTRE at 0.5 — the one number that says contact resolution ran.
const FLOOR = 1, BALL = 2;
m._physics3d_addBox(FLOOR, 50, 0.5, 50, 0, -0.5, 0, ...IDENTITY, ...FREE(STATIC), 0.5, 0, 0);
const ballId = m._physics3d_addSphere(BALL, 0.5, 0, 4, 0, ...IDENTITY, ...FREE(DYNAMIC), 0.5, 0, 0);
m._physics3d_optimize();

check('a body id is handed back', ballId !== 0, `id=${ballId}`);
step(1);
const early = bodyPos(BALL);
check('a falling body is in the readback', early !== null, JSON.stringify(early));

step(180);
const rest = bodyState(ballId);
check('the sphere rests on the floor', rest && near(rest.y, 0.5, 0.05),
      `y=${rest?.y.toFixed(4)} want 0.5`);
check('and it has stopped falling', rest && near(rest.vy, 0, 0.05),
      `vy=${rest?.vy.toFixed(4)}`);
check('gravity acts on y alone', rest && near(rest.x, 0, 0.05) && near(rest.z, 0, 0.05),
      `x=${rest?.x.toFixed(4)} z=${rest?.z.toFixed(4)}`);

// ── 2) A ray finds it, and names the entity that owns it ────────────────────
// Straight down from y=10 over 20 units: the sphere's top is at 1.0, so the hit
// fraction is (10-1)/20 = 0.45 and the surface normal points back up.
const hit = raycast(0, 10, 0, 0, -20, 0);
check('the ray hits something', hit !== null);
check('it hits the sphere, not the floor', hit && hit.entity === BALL, `entity=${hit?.entity}`);
check('at the fraction the geometry predicts', hit && near(hit.fraction, 0.45, 0.01),
      `fraction=${hit?.fraction.toFixed(4)} want 0.45`);
check('with the normal pointing up', hit && near(hit.ny, 1, 0.05), `ny=${hit?.ny.toFixed(4)}`);

// A ray aimed away from everything finds nothing — a query that always answers is
// not a query.
check('a ray into empty space misses', raycast(0, 10, 0, 0, 20, 0) === null);

// ── 3) Static bodies stay put, kinematic ones are moved by hand ─────────────
const PLATFORM = 3;
const platformId = m._physics3d_addBox(PLATFORM, 1, 0.25, 1, 5, 2, 0, ...IDENTITY,
                                       ...FREE(KINEMATIC), 0.5, 0, 0);
step(60);
const platform = bodyState(platformId);
check('a kinematic body ignores gravity', platform && near(platform.y, 2, 1e-3),
      `y=${platform?.y.toFixed(4)}`);
m._physics3d_setTransform(platformId, 5, 3, 0, ...IDENTITY);
check('and goes where it is put', near(bodyState(platformId).y, 3, 1e-3));

// ── 4) A capsule keeps its own dimensions ──────────────────────────────────
// Radius 0.3 + half-height 0.5 puts the bottom cap 0.8 below the centre, so a
// resting capsule sits at 0.8.
const CAP = 4;
const capId = m._physics3d_addCapsule(CAP, 0.3, 0.5, 3, 5, 0, ...IDENTITY, ...FREE(DYNAMIC), 0.5, 0, 0);
step(240);
const cap = bodyState(capId);
check('a capsule rests on its own half-height', cap && near(cap.y, 0.8, 0.05),
      `y=${cap?.y.toFixed(4)} want 0.8`);
// Resting height cannot tell radius from half-height: their SUM holds the capsule
// up, so swapping the two keeps it. Width is what differs — and the capsule is
// PLACED, since a body that drifted while landing moves the answer on its own.
m._physics3d_setTransform(capId, 3, 0.8, 0, ...IDENTITY);
const side = raycast(10, 0.8, 0, -20, 0, 0);
check('and on its own radius', side && side.entity === CAP && near(side.fraction, 0.335, 0.01),
      `entity=${side?.entity} fraction=${side?.fraction.toFixed(4)} want 0.335`);

// ── 5) What a body is beyond its shape ─────────────────────────────────────
// gravityScale 0 is weightlessness, not slow falling: a body that never reads it
// drops 4.9m in the same second.
const FLOAT = 5;
const floatId = m._physics3d_addSphere(FLOAT, 0.5, -3, 5, 0, ...IDENTITY,
                                       DYNAMIC, 0, 0, 0, 0, 0.5, 0, 0);
step(60);
check('gravityScale 0 leaves a body where it was', near(bodyState(floatId).y, 5, 0.01),
      `y=${bodyState(floatId).y.toFixed(4)} want 5`);

// fixedRotation freezes the orientation a body was given — it does not right it.
// This capsule starts tilted and lands on the floor; free to turn it would topple
// flat, so the tilt it KEEPS is what says the solver may not turn it.
const UPRIGHT = 6;
const uprightId = m._physics3d_addCapsule(UPRIGHT, 0.3, 0.5, -6, 3, 0,
                                          0.3, 0, 0, 0.954, DYNAMIC, 1, 0, 0, 1, 0.5, 0, 0);
step(180);
const uprightBase = m._physics3d_getBodyState(uprightId) ? m._physics3d_queryResult() >> 2 : 0;
const qx = m.HEAPF32[uprightBase + 3];
check('fixedRotation keeps a body from turning', near(qx, 0.3, 0.01),
      `qx=${qx?.toFixed(4)} want the 0.3 it was given`);

// ── 6) A character stands, walks, climbs a step and is stopped by a wall ────
// The three things that make a character a character rather than a falling
// capsule. Ground state: 0 = OnGround, 3 = InAir.
const ON_GROUND = 0, IN_AIR = 3;
function moveCharacter(id, vx, vy, vz, steps = 1, stepUp = 0.4, stepDown = 0.5) {
    for (let i = 0; i < steps; i++) m._physics3d_moveCharacter(id, vx, vy, vz, 1 / 60, stepUp, stepDown);
    const base = m._physics3d_queryResult() >> 2;
    const f = (i) => m.HEAPF32[base + i];
    return { x: f(0), y: f(1), z: f(2), ground: f(3), ny: f(5), vy: f(8) };
}

// Dropped from 3m onto the floor: a capsule of radius 0.3 + half-height 0.5
// stands with its centre 0.8 up, and reports the ground it is on.
const hero = m._physics3d_addCharacter(9, 0.3, 0.5, -20, 3, 0, 0.87, 70);
check('a character is handed back', hero !== 0, `id=${hero}`);
const airborne = moveCharacter(hero, 0, 0, 0, 1);
check('and starts in the air', airborne.ground === IN_AIR, `state=${airborne.ground}`);

const landed = moveCharacter(hero, 0, 0, 0, 180);
check('a character lands on the floor', near(landed.y, 0.8, 0.05),
      `y=${landed.y.toFixed(4)} want 0.8`);
check('and reports the ground it is on', landed.ground === ON_GROUND, `state=${landed.ground}`);
check('with the floor normal pointing up', near(landed.ny, 1, 0.05), `ny=${landed.ny.toFixed(4)}`);

// Walking: 2 m/s for half a second covers about a metre, and stays on the floor.
const walked = moveCharacter(hero, 2, 0, 0, 30);
check('a character walks where it is sent', walked.x > landed.x + 0.8,
      `x=${walked.x.toFixed(4)} from ${landed.x.toFixed(4)}`);
check('and stays on the ground while walking', walked.ground === ON_GROUND);

// A 0.2m step is climbed rather than stopped at: without WalkStairs the character
// stops dead against it, so the y AFTER is what tells the two apart.
m._physics3d_addBox(10, 0.5, 0.1, 5, walked.x + 1.3, 0.1, 0, ...IDENTITY,
                    ...FREE(STATIC), 0.5, 0, 0);
m._physics3d_optimize();
const climbed = moveCharacter(hero, 2, 0, 0, 60);
check('a character climbs a step', near(climbed.y, 1.0, 0.08),
      `y=${climbed.y.toFixed(4)} want 1.0 (0.8 + a 0.2 step)`);

// A wall taller than any step stops it. The character keeps its own height, so a
// wall that was CLIMBED would show up as a rise rather than as a stop.
const wallX = climbed.x + 1.0;
m._physics3d_addBox(11, 0.2, 2, 5, wallX, 2, 0, ...IDENTITY, ...FREE(STATIC), 0.5, 0, 0);
m._physics3d_optimize();
const blocked = moveCharacter(hero, 3, 0, 0, 120);
check('a wall stops a character', blocked.x < wallX - 0.2,
      `x=${blocked.x.toFixed(4)} wall at ${wallX.toFixed(4)}`);
check('and it did not climb the wall', blocked.y < climbed.y + 0.3,
      `y=${blocked.y.toFixed(4)}`);

m._physics3d_removeCharacter(hero);
check('a removed character can no longer be moved',
      (m._physics3d_moveCharacter(hero, 1, 0, 0, 1 / 60, 0.4, 0.5),
       m._physics3d_queryResultBytes() === 0));

// ── 7) A removed body is gone from both the sweep and the getter ────────────
m._physics3d_removeBody(capId);
step(1);
check('a removed body leaves the readback', bodyPos(CAP) === null);
check('and its state can no longer be read', bodyState(capId) === null);

m._physics3d_shutdown();
check('the world reports itself gone', m._physics3d_isReady() === 0);

console.log(pass ? '\nphysics3d smoke: all behaviours hold'
                 : '\nphysics3d smoke: FAILURES');
process.exit(pass ? 0 : 1);
