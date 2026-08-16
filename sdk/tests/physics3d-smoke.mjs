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
m._physics3d_addBox(FLOOR, 50, 0.5, 50, 0, -0.5, 0, ...IDENTITY, STATIC, 0.5, 0, 0);
const ballId = m._physics3d_addSphere(BALL, 0.5, 0, 4, 0, ...IDENTITY, DYNAMIC, 0.5, 0, 0);
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
                                       KINEMATIC, 0.5, 0, 0);
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
const capId = m._physics3d_addCapsule(CAP, 0.3, 0.5, 3, 5, 0, ...IDENTITY, DYNAMIC, 0.5, 0, 0);
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

// ── 5) A removed body is gone from both the sweep and the getter ────────────
m._physics3d_removeBody(capId);
step(1);
check('a removed body leaves the readback', bodyPos(CAP) === null);
check('and its state can no longer be read', bodyState(capId) === null);

m._physics3d_shutdown();
check('the world reports itself gone', m._physics3d_isReady() === 0);

console.log(pass ? '\nphysics3d smoke: all behaviours hold'
                 : '\nphysics3d smoke: FAILURES');
process.exit(pass ? 0 : 1);
