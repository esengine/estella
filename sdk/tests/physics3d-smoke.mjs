// Headless validation of the 3D physics module: loads the built wasm and asserts
// each behaviour against a value arithmetic predicts. A world that steps without
// throwing proves nothing about where anything ended up.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { requireWasm } from '../../tools/lib/wasmDir.mjs';

const wasmDir = requireWasm('physics3d.wasm');
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
// motion, gravityScale, linearDamping, angularDamping, fixedRotation, layer —
// what a body is beyond its shape.
const FREE = (motion, layer = 0) => [motion, 1, 0, 0, 0, layer, 0];
/** The same, with continuous collision on — the path, not the endpoint. */
const SWEPT = (motion, layer = 0) => [motion, 1, 0, 0, 0, layer, 1];

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

function sphereCast(px, py, pz, radius, dx, dy, dz, mask = 0) {
    if (!m._physics3d_sphereCast(px, py, pz, radius, dx, dy, dz, mask)) return null;
    const base = m._physics3d_queryResult() >> 2;
    const f = (i) => m.HEAPF32[base + i];
    return { entity: f(0), fraction: f(1), x: f(2), y: f(3), z: f(4),
             nx: f(5), ny: f(6), nz: f(7) };
}

const raycastMasked = (ox, oy, oz, dx, dy, dz, mask) =>
    (m._physics3d_raycast(ox, oy, oz, dx, dy, dz, mask) ? readRay() : null);

function readRay() {
    const base = m._physics3d_queryResult() >> 2;
    const f = (i) => m.HEAPF32[base + i];
    return { entity: f(0), fraction: f(1), x: f(2), y: f(3), z: f(4),
             nx: f(5), ny: f(6), nz: f(7) };
}

function raycast(ox, oy, oz, dx, dy, dz) {
    if (!m._physics3d_raycast(ox, oy, oz, dx, dy, dz, 0)) return null;
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
                                       DYNAMIC, 0, 0, 0, 0, 0, 0, 0.5, 0, 0);
step(60);
check('gravityScale 0 leaves a body where it was', near(bodyState(floatId).y, 5, 0.01),
      `y=${bodyState(floatId).y.toFixed(4)} want 5`);

// fixedRotation freezes the orientation a body was given — it does not right it.
// This capsule starts tilted and lands on the floor; free to turn it would topple
// flat, so the tilt it KEEPS is what says the solver may not turn it.
const UPRIGHT = 6;
const uprightId = m._physics3d_addCapsule(UPRIGHT, 0.3, 0.5, -6, 3, 0,
                                          0.3, 0, 0, 0.954, DYNAMIC, 1, 0, 0, 1, 0, 0, 0.5, 0, 0);
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
const hero = m._physics3d_addCharacter(9, 0.3, 0.5, -20, 3, 0, 0.87, 70, 0, 5000);
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

// ★ Pushing a crate, as two runs of the same setup. A swept character does not
// solve against the world, so nothing moves out of its way unless it is given
// the strength to move it — and `mass` alone never was that.
const CRATE_STRONG = 12, CRATE_WEAK = 13;
const strongCrate = m._physics3d_addBox(CRATE_STRONG, 0.2, 0.2, 0.2, -38.5, 0.2, 10,
                                        ...IDENTITY, ...FREE(DYNAMIC), 0.2, 0, 0);
const weakCrate = m._physics3d_addBox(CRATE_WEAK, 0.2, 0.2, 0.2, -38.5, 0.2, 20,
                                      ...IDENTITY, ...FREE(DYNAMIC), 0.2, 0, 0);
const strongHero = m._physics3d_addCharacter(14, 0.3, 0.5, -40, 0.8, 10, 0.87, 70, 0, 6000);
const weakHero = m._physics3d_addCharacter(15, 0.3, 0.5, -40, 0.8, 20, 0.87, 70, 0, 0);
m._physics3d_optimize();
for (let i = 0; i < 150; i++) {
    m._physics3d_moveCharacter(strongHero, 2, 0, 0, 1 / 60, 0.4, 0.5);
    m._physics3d_moveCharacter(weakHero, 2, 0, 0, 1 / 60, 0.4, 0.5);
    m._physics3d_step(1 / 60, 1);
}
const shoved = bodyState(strongCrate);
const unmoved = bodyState(weakCrate);
check('a character shoves a crate out of its way', shoved && shoved.x > -38.0,
      `x=${shoved?.x.toFixed(3)} from -38.5`);
check('and one with no push force does not', unmoved && unmoved.x < -38.35,
      `x=${unmoved?.x.toFixed(3)} from -38.5`);

m._physics3d_removeCharacter(strongHero);
m._physics3d_removeCharacter(weakHero);

m._physics3d_removeCharacter(hero);
check('a removed character can no longer be moved',
      (m._physics3d_moveCharacter(hero, 1, 0, 0, 1 / 60, 0.4, 0.5),
       m._physics3d_queryResultBytes() === 0));

// ── 7) What touched what ───────────────────────────────────────────────────
// Contact events name BOTH entities and where they met. A falling sphere landing
// on a fresh floor is one enter; nothing leaves until it is moved away.
const pairs = (ptr, bytes, stride) => {
    const base = m[ptr]() >> 2;
    const out = [];
    for (let i = 0; i < m[bytes]() / 4; i += stride) {
        out.push(Array.from({ length: stride }, (_, k) => m.HEAPF32[base + i + k]));
    }
    return out;
};
const contactEnters = () => pairs('_physics3d_contactEnters', '_physics3d_contactEntersBytes', 8);
const contactExits = () => pairs('_physics3d_contactExits', '_physics3d_contactExitsBytes', 2);
const sensorEnters = () => pairs('_physics3d_sensorEnters', '_physics3d_sensorEntersBytes', 2);
const sensorExits = () => pairs('_physics3d_sensorExits', '_physics3d_sensorExitsBytes', 2);

const PAD = 20, DROP = 21;
m._physics3d_addBox(PAD, 2, 0.5, 2, 20, -0.5, 0, ...IDENTITY, ...FREE(STATIC), 0.5, 0, 0);
const dropId = m._physics3d_addSphere(DROP, 0.5, 20, 2, 0, ...IDENTITY,
                                      ...FREE(DYNAMIC), 0.5, 0, 0);
m._physics3d_optimize();
let landing = null;
for (let i = 0; i < 180 && !landing; i++) {
    step(1);
    landing = contactEnters().find((e) => e[1] === DROP || e[0] === DROP) ?? null;
}
check('a contact names both entities', landing != null
      && (landing[0] === PAD || landing[1] === PAD), JSON.stringify(landing));
check('and where they met', landing != null && near(landing[6], 0.0, 0.15),
      `contact y=${landing?.[6]?.toFixed(4)} want the pad's top at 0`);
// A buffer holds ONE step's events, so they are collected as the steps run —
// reading after a run of steps catches only the last one's.
const collect = (read, steps) => {
    const seen = [];
    for (let i = 0; i < steps; i++) { step(1); seen.push(...read()); }
    return seen;
};
const settledEnters = [];
const seenExits = [];
for (let i = 0; i < 90; i++) {
    step(1);
    settledEnters.push(...contactEnters());
    seenExits.push(...contactExits());
}
check('a contact does not fire again while it persists', settledEnters.length === 0,
      `${settledEnters.length} re-fired`);

// The contact ends on its own once the sphere settles and sleeps; moving it away
// is the other way it ends. Either is the claim — that an ended contact is
// REPORTED — so both windows count toward it.
m._physics3d_setTransform(dropId, 40, 5, 0, ...IDENTITY);
seenExits.push(...collect(contactExits, 30));
check('an ended contact reports an exit', seenExits.some((e) => e.includes(DROP)),
      JSON.stringify(seenExits));

// A sensor reports the overlap without stopping anything, and names ITSELF first.
// The visitor is registered first on purpose: Jolt orders a contact by body id, so
// a sensor created first would lead on its own and prove nothing.
const FIELD = 22, VISITOR = 23;
const visitorId = m._physics3d_addSphere(VISITOR, 0.5, -20, 6, 0, ...IDENTITY,
                                         ...FREE(DYNAMIC), 0.5, 0, 0);
m._physics3d_addBox(FIELD, 2, 2, 2, -20, 0, 0, ...IDENTITY, ...FREE(STATIC), 0, 0, 1);
m._physics3d_optimize();
let entered = null;
for (let i = 0; i < 240 && !entered; i++) {
    step(1);
    entered = sensorEnters().find((e) => e[0] === FIELD) ?? null;
}
check('a sensor reports its visitor', entered != null && entered[1] === VISITOR,
      JSON.stringify(entered));
// It carries on to the floor below (top at 0, so a 0.5 sphere rests at 0.5). A
// sensor that stopped it would hold it on its own top face at 2.5 instead.
const sensorLeft = collect(sensorExits, 180).find((e) => e[0] === FIELD) ?? null;
check('and does not stop it', near(bodyState(visitorId).y, 0.5, 0.1),
      `visitor y=${bodyState(visitorId)?.y?.toFixed(4)} want 0.5 (through it, onto the floor)`);
check('and reports when it leaves', sensorLeft != null && sensorLeft[1] === VISITOR,
      JSON.stringify(sensorLeft));

// ── 8) Imported geometry as a collider ─────────────────────────────────────
// A shallow ramp from two triangles, 4 wide and rising 1, at y=3 well clear of
// the floor. Shallow on purpose: a steep one only proves that things slide.
const alloc = (values, Ctor) => {
    const ptr = m._malloc(values.length * 4);
    new Ctor(m.HEAPU8.buffer, ptr, values.length).set(values);
    return ptr;
};
const RAMP = 30;
const rampVerts = alloc(new Float32Array([
    0, 0, -2,   4, 1, -2,   0, 0, 2,   4, 1, 2,
]), Float32Array);
// Counter-clockwise from above, so the normals point UP. A mesh shape is
// ONE-SIDED: reversed, a body falls through while a ray still reports a hit.
const rampIndices = alloc(new Uint32Array([0, 2, 1, 2, 3, 1]), Uint32Array);
const rampId = m._physics3d_addMeshBody(RAMP, rampVerts, 4, rampIndices, 6,
                                        30, 3, 0, ...IDENTITY, 0, 0.5, 0);
m._free(rampVerts);
m._free(rampIndices);
check('imported geometry becomes a body', rampId !== 0, `id=${rampId}`);
m._physics3d_optimize();

// A ray finds it at the height the slope predicts: over x=31 the surface is at
// 3.25, so the hit is 6.75 of the ray's 20 units.
const onRamp = raycast(31, 10, 0, 0, -20, 0);
check('a ray meets the ramp where it slopes', onRamp != null && onRamp.entity === RAMP
      && near(onRamp.fraction, 0.3375, 0.02),
      `entity=${onRamp?.entity} fraction=${onRamp?.fraction?.toFixed(4)} want 0.3375`);

// And it says HOW steep, not just how far: the up component of a hit normal is
// the cosine of the slope, which is what a nav bake reads to tell ground from
// wall. This ramp rises 1 over 4, so 4/sqrt(17).
check('and reports the tilt in the normal it returns',
      onRamp != null && near(onRamp.ny, 4 / Math.sqrt(17), 0.01) && onRamp.ny < 1,
      `ny=${onRamp?.ny?.toFixed(4)} want ${(4 / Math.sqrt(17)).toFixed(4)}`);

// Over x=32 the surface is at 3.5, so a half-metre box settles near 4; the floor
// is at 0. A BOX, not a sphere — a sphere rolls off any slope, however shallow.
const CRATE = 31;
const crateId = m._physics3d_addBox(CRATE, 0.5, 0.5, 0.5, 32, 8, 0, ...IDENTITY,
                                    ...FREE(DYNAMIC), 0.9, 0, 0);
step(240);
const crate = bodyState(crateId);
check('and a body rests on its triangles', crate && crate.y > 3.4,
      `y=${crate?.y?.toFixed(4)} want about 4 (ramp surface 3.5 + half-extent)`);

// Degenerate input is REFUSED, not quietly trimmed — an out-of-range index would
// read past the vertices. One good triangle and one bad, so silently dropping the
// bad one would still build a body.
const badVerts = alloc(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), Float32Array);
const badIndices = alloc(new Uint32Array([0, 1, 2, 0, 1, 99]), Uint32Array);
check('an index past the vertices is refused',
      m._physics3d_addMeshBody(32, badVerts, 3, badIndices, 6, 0, 0, 0, ...IDENTITY, 0, 0.5, 0) === 0);
check('and so is a non-triangle count',
      m._physics3d_addMeshBody(32, badVerts, 3, badIndices, 5, 0, 0, 0, ...IDENTITY, 0, 0.5, 0) === 0);
m._free(badVerts);
m._free(badIndices);

// ── 9) Layers decide who meets whom ────────────────────────────────────────
// Layer 1 is the world, 2 is bullets, 3 is the team firing them: bullets pass
// through their own team and stop on the world.
m._physics3d_setLayerMask(2, ~(1 << 3) >>> 0);   // bullets ignore their team
m._physics3d_setLayerMask(3, ~(1 << 2) >>> 0);   // and the team ignores bullets

const TEAMMATE = 40, BULLET = 41, WALL = 42;
m._physics3d_addBox(WALL, 5, 0.5, 5, 60, -0.5, 0, ...IDENTITY, ...FREE(STATIC, 1), 0.5, 0, 0);
// Wide enough to cover both drop points: the second bullet has to fall past the
// teammate too, and landing on the FIRST bullet would prove nothing about layers.
m._physics3d_addBox(TEAMMATE, 5, 1, 5, 60, 1, 0, ...IDENTITY, ...FREE(STATIC, 3), 0.5, 0, 0);
const bulletId = m._physics3d_addSphere(BULLET, 0.2, 60, 6, 0, ...IDENTITY,
                                        ...FREE(DYNAMIC, 2), 0.5, 0, 0);
m._physics3d_optimize();
step(240);
const bullet = bodyState(bulletId);
// It fell past the teammate (whose top is at 2) and landed on the world at 0.2.
check('a body passes through a layer it ignores', bullet && bullet.y < 1.5,
      `y=${bullet?.y?.toFixed(4)} — it stopped on the teammate it should ignore`);
check('and still lands on one it does not', bullet && near(bullet.y, 0.2, 0.1),
      `y=${bullet?.y?.toFixed(4)} want 0.2 (resting on the world)`);

// One side saying no is enough: the team never stopped naming bullets, but
// bullets stopped naming the team, and they still pass.
m._physics3d_setLayerMask(3, 0xFFFFFFFF);
const SECOND = 43;
const secondId = m._physics3d_addSphere(SECOND, 0.2, 63, 6, 0, ...IDENTITY,
                                        ...FREE(DYNAMIC, 2), 0.5, 0, 0);
step(240);
check('one side refusing is enough', near(bodyState(secondId).y, 0.2, 0.1),
      `y=${bodyState(secondId)?.y?.toFixed(4)} want 0.2`);

// ── 10) Queries with a shape, not just a line ──────────────────────────────
// Two pillars 0.8 apart on their own layer, so nothing else in this world can
// answer for them.
const PILLAR_LAYER = 7, MASK = 1 << PILLAR_LAYER;
const LEFT = 50, RIGHT = 51;
m._physics3d_addBox(LEFT, 0.25, 1, 0.25, 80, 1, -0.65, ...IDENTITY,
                    ...FREE(STATIC, PILLAR_LAYER), 0.5, 0, 0);
m._physics3d_addBox(RIGHT, 0.25, 1, 0.25, 80, 1, 0.65, ...IDENTITY,
                    ...FREE(STATIC, PILLAR_LAYER), 0.5, 0, 0);
m._physics3d_optimize();

const overlaps = (count) => {
    const base = m._physics3d_queryResult() >> 2;
    return Array.from({ length: count }, (_, i) => ({
        entity: m.HEAPF32[base + i * 4], x: m.HEAPF32[base + i * 4 + 1],
    }));
};

// A sphere over the gap touches neither pillar; widened, it touches both.
check('a small overlap finds nothing between them',
      m._physics3d_overlapSphere(80, 1, 0, 0.3, MASK) === 0);
const found = m._physics3d_overlapSphere(80, 1, 0, 0.6, MASK);
check('a wider one finds both', found === 2, `found ${found}`);
const names = overlaps(found).map((h) => h.entity).sort();
check('and names them', names.length === 2 && names[0] === LEFT && names[1] === RIGHT,
      JSON.stringify(names));

// A box query answers the same question in the shape a room is.
check('a box overlap finds them too',
      m._physics3d_overlapBox(80, 1, 0, 0.4, 0.5, 1, MASK) === 2);

// Layers narrow a query: nothing else lives on layer 6.
check('a query only sees the layers it asked for',
      m._physics3d_overlapSphere(80, 1, 0, 0.6, 1 << 6) === 0);

// ★ What a ray cannot answer. The gap is 0.8 wide, so an infinitely thin ray
// passes between the pillars while a 0.5-radius sphere — one metre across —
// cannot. This is the whole reason a shape cast exists.
check('a ray slips through the gap',
      raycastMasked(78, 1, 0, 6, 0, 0, MASK) === null);
const swept = sphereCast(78, 1, 0, 0.5, 6, 0, 0, MASK);
check('a swept sphere does not', swept != null, JSON.stringify(swept));
check('and stops at the pillars', swept != null && swept.fraction < 0.5
      && (swept.entity === LEFT || swept.entity === RIGHT),
      `entity=${swept?.entity} fraction=${swept?.fraction?.toFixed(4)}`);

// ── 11) Joints: what holds two bodies to each other ─────────────────────────
// Each asserts a distance the geometry fixes, not "it moved": a joint that was
// never installed leaves a body in free fall, which is motion too.
const HELD = (motion, gravity = 1) => [motion, gravity, 0.4, 0.4, 0, 0, 0];
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

// A hinge holds an arm at arm's length and lets it swing down to hang.
const HINGE_ANCHOR = 60, HINGE_ARM = 61, HINGE_JOINT = 62;
const hingeAnchorId = m._physics3d_addBox(HINGE_ANCHOR, 0.1, 0.1, 0.1, 300, 10, 0,
                                          ...IDENTITY, ...HELD(STATIC), 0.5, 0, 0);
const hingeArmId = m._physics3d_addBox(HINGE_ARM, 1, 0.1, 0.1, 301, 10, 0,
                                       ...IDENTITY, ...HELD(DYNAMIC), 0.5, 0, 0);
check('a hinge is made when both bodies are in the world',
      m._physics3d_addHingeJoint(HINGE_JOINT, hingeAnchorId, hingeArmId,
                                 300, 10, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0) === 1);
step(600);
const arm = bodyState(hingeArmId);
check('the arm stays one metre from the hinge', arm && near(dist(arm, { x: 300, y: 10, z: 0 }), 1, 0.05),
      `r=${arm ? dist(arm, { x: 300, y: 10, z: 0 }).toFixed(4) : 'null'}`);
// Hanging, not merely held: an arm the hinge failed to swing would still be at
// x=301. The tolerance is where a damped swing goes to sleep, not a rounding.
check('and hangs below it rather than beside it', arm && near(arm.y, 9, 0.2) && near(arm.x, 300, 0.2),
      `y=${arm?.y.toFixed(3)} x=${arm?.x.toFixed(3)}`);

// A distance joint is a rope: slack until it is not, then it holds.
const ROPE_ANCHOR = 63, ROPE_BALL = 64, ROPE_JOINT = 65;
const ropeAnchorId = m._physics3d_addBox(ROPE_ANCHOR, 0.1, 0.1, 0.1, 320, 20, 0,
                                         ...IDENTITY, ...HELD(STATIC), 0.5, 0, 0);
const ropeBallId = m._physics3d_addSphere(ROPE_BALL, 0.3, 320, 19, 0,
                                          ...IDENTITY, ...HELD(DYNAMIC), 0.5, 0, 0);
m._physics3d_addDistanceJoint(ROPE_JOINT, ropeAnchorId, ropeBallId,
                              320, 20, 0, 320, 19, 0, 0, 3, 0, 0, 0);
step(300);
const ball = bodyState(ropeBallId);
check('a rope stops the fall at its own length', ball && near(dist(ball, { x: 320, y: 20, z: 0 }), 3, 0.05),
      `r=${ball ? dist(ball, { x: 320, y: 20, z: 0 }).toFixed(4) : 'null'}`);

// A fixed joint: two bodies, one motion. Both fall, their offset does not change.
const WELD_A = 66, WELD_B = 67, WELD_JOINT = 68;
const weldAId = m._physics3d_addBox(WELD_A, 0.5, 0.5, 0.5, 340, 20, 0,
                                    ...IDENTITY, ...HELD(DYNAMIC), 0.5, 0, 0);
const weldBId = m._physics3d_addBox(WELD_B, 0.5, 0.5, 0.5, 342, 20, 0,
                                    ...IDENTITY, ...HELD(DYNAMIC), 0.5, 0, 0);
m._physics3d_addFixedJoint(WELD_JOINT, weldAId, weldBId, 0);
step(60);
const weldA = bodyState(weldAId);
const weldB = bodyState(weldBId);
check('a fixed joint keeps the offset it was made with',
      weldA && weldB && near(weldB.x - weldA.x, 2, 0.05) && near(weldB.y - weldA.y, 0, 0.05),
      `d=(${(weldB?.x - weldA?.x).toFixed(3)}, ${(weldB?.y - weldA?.y).toFixed(3)})`);
check('and both of them fell', weldA && weldA.y < 19, `y=${weldA?.y.toFixed(3)}`);

// A slider travels on one axis and stops at its limit.
const RAIL = 69, CAR = 70, RAIL_JOINT = 71;
const railId = m._physics3d_addBox(RAIL, 0.1, 0.1, 0.1, 360, 20, 0,
                                   ...IDENTITY, ...HELD(STATIC), 0.5, 0, 0);
const carId = m._physics3d_addBox(CAR, 0.5, 0.5, 0.5, 360, 19, 0,
                                  ...IDENTITY, ...HELD(DYNAMIC), 0.5, 0, 0);
m._physics3d_addSliderJoint(RAIL_JOINT, railId, carId, 360, 19, 0, 0, 1, 0,
                            1, -2, 0, 0, 0, 0, 0);
step(300);
const car = bodyState(carId);
check('a slider stops at its lower limit', car && near(car.y, 17, 0.05), `y=${car?.y.toFixed(3)}`);
check('and does not leave its axis', car && near(car.x, 360, 0.02) && near(car.z, 0, 0.02),
      `x=${car?.x.toFixed(3)} z=${car?.z.toFixed(3)}`);

// ★ collideConnected, as two runs of the same setup. Both pairs overlap and are
// joined by a rope far longer than the gap, so the rope pulls on neither: the
// ONLY thing that can push them apart is contact between them.
const KEEP_A = 72, KEEP_B = 73, KEEP_JOINT = 74;
const PUSH_A = 75, PUSH_B = 76, PUSH_JOINT = 77;
const keepAId = m._physics3d_addSphere(KEEP_A, 0.5, 380, 30, 0, ...IDENTITY, ...HELD(DYNAMIC, 0), 0.5, 0, 0);
const keepBId = m._physics3d_addSphere(KEEP_B, 0.5, 380.2, 30, 0, ...IDENTITY, ...HELD(DYNAMIC, 0), 0.5, 0, 0);
m._physics3d_addDistanceJoint(KEEP_JOINT, keepAId, keepBId,
                              380, 30, 0, 380.2, 30, 0, 0, 5, 0, 0, 0);
const pushAId = m._physics3d_addSphere(PUSH_A, 0.5, 390, 30, 0, ...IDENTITY, ...HELD(DYNAMIC, 0), 0.5, 0, 0);
const pushBId = m._physics3d_addSphere(PUSH_B, 0.5, 390.2, 30, 0, ...IDENTITY, ...HELD(DYNAMIC, 0), 0.5, 0, 0);
m._physics3d_addDistanceJoint(PUSH_JOINT, pushAId, pushBId,
                              390, 30, 0, 390.2, 30, 0, 0, 5, 1, 0, 1);
step(120);
const keepGap = dist(bodyState(keepAId), bodyState(keepBId));
const pushGap = dist(bodyState(pushAId), bodyState(pushBId));
check('joined bodies pass through each other when the joint says so',
      near(keepGap, 0.2, 0.05), `gap=${keepGap.toFixed(4)}`);
check('and collide when it does not', pushGap > 0.9, `gap=${pushGap.toFixed(4)}`);

// A motor drives the joint, and the joint says where it got to.
const MOTOR_ANCHOR = 78, MOTOR_ARM = 79, MOTOR_JOINT = 80;
const motorAnchorId = m._physics3d_addBox(MOTOR_ANCHOR, 0.1, 0.1, 0.1, 400, 10, 0,
                                          ...IDENTITY, ...HELD(STATIC), 0.5, 0, 0);
const motorArmId = m._physics3d_addBox(MOTOR_ARM, 1, 0.1, 0.1, 401, 10, 0,
                                       ...IDENTITY, ...HELD(DYNAMIC, 0), 0.5, 0, 0);
m._physics3d_addHingeJoint(MOTOR_JOINT, motorAnchorId, motorArmId, 400, 10, 0, 0, 0, 1,
                           0, 0, 0, 1, 2, 1e7, 0);
check('a joint with nothing turned yet reads zero', near(m._physics3d_jointValue(MOTOR_JOINT), 0, 0.02),
      `angle=${m._physics3d_jointValue(MOTOR_JOINT).toFixed(4)}`);
step(30);
const driven = m._physics3d_jointValue(MOTOR_JOINT);
// Half a second at 2 rad/s, less whatever the motor spent getting there.
check('a motor turns the hinge at the speed it was given', driven > 0.6 && driven < 1.3,
      `angle=${driven.toFixed(4)}`);
// Driven the other way rather than switched off: a motor that stopped answering
// would leave the arm coasting on the momentum it already has, which reads the
// same as "the new speed was applied" until the sign changes.
m._physics3d_setJointMotor(MOTOR_JOINT, 1, -2);
step(45);
const reversed = m._physics3d_jointValue(MOTOR_JOINT);
check('and a new speed reaches a joint that already exists', reversed < 0.4,
      `angle=${reversed.toFixed(4)} was=${driven.toFixed(4)}`);

// Removing the joint gives the body back to gravity.
m._physics3d_removeJoint(ROPE_JOINT, ropeAnchorId, ropeBallId);
step(120);
const freed = bodyState(ropeBallId);
check('a removed joint lets go', freed && freed.y < 15, `y=${freed?.y.toFixed(3)}`);

// ── 12) A fast body and a thin wall, twice ─────────────────────────────────
// ★ 240 m/s lands the discrete body's endpoints at 598 then 602, never inside
// the wall. At 200 m/s a 3.33m step lands one dead ON it and it stops by luck.
const WALL_A = 90, WALL_B = 91, SLUG_A = 92, SLUG_B = 93;
const SLUG = (continuous) => [DYNAMIC, 0, 0, 0, 0, 0, continuous];
m._physics3d_addBox(WALL_A, 0.05, 2, 2, 600, 20, 0, ...IDENTITY, ...FREE(STATIC), 0.5, 0, 0);
m._physics3d_addBox(WALL_B, 0.05, 2, 2, 600, 30, 0, ...IDENTITY, ...FREE(STATIC), 0.5, 0, 0);
const discrete = m._physics3d_addSphere(SLUG_A, 0.05, 590, 20, 0, ...IDENTITY,
                                        ...SLUG(0), 0.5, 0, 0);
const sweptSlug = m._physics3d_addSphere(SLUG_B, 0.05, 590, 30, 0, ...IDENTITY,
                                         ...SLUG(1), 0.5, 0, 0);
m._physics3d_optimize();
m._physics3d_setLinearVelocity(discrete, 240, 0, 0);
m._physics3d_setLinearVelocity(sweptSlug, 240, 0, 0);
step(10);
const throughIt = bodyState(discrete);
const stopped = bodyState(sweptSlug);
check('a fast body passes through a thin wall when only its endpoints are checked',
      throughIt && throughIt.x > 601, `x=${throughIt?.x.toFixed(3)} wall at 600`);
check('and continuous collision stops it at the wall', stopped && stopped.x < 600,
      `x=${stopped?.x.toFixed(3)} wall at 600`);

// ── 13) A convex hull of imported geometry, which a mesh collider cannot be ──
// Eight corners handed over as points: the hull rests at its own half-height,
// and it is DYNAMIC, which a mesh collider of the same geometry never is.
const HULL = 95;
const corners = [];
for (const sx of [-0.5, 0.5]) for (const sy of [-0.5, 0.5]) for (const sz of [-0.5, 0.5]) {
    corners.push(sx, sy, sz);
}
const hullPtr = m._malloc(corners.length * 4);
m.HEAPF32.set(corners, hullPtr >> 2);
const hullId = m._physics3d_addConvexBody(HULL, hullPtr, 8, 0, 5, 30, ...IDENTITY,
                                          ...FREE(DYNAMIC), 0.5, 0, 0);
check('a convex hull is handed back', hullId !== 0, `id=${hullId}`);
// Three points are a triangle: no volume, and a body with no shape falls forever.
check('and a degenerate one is refused',
      m._physics3d_addConvexBody(96, hullPtr, 3, 0, 5, 35, ...IDENTITY,
                                 ...FREE(DYNAMIC), 0.5, 0, 0) === 0);
m._free(hullPtr);
m._physics3d_optimize();
step(240);
const hull = bodyState(hullId);
check('a hull rests on its own half-extent', hull && near(hull.y, 0.5, 0.06),
      `y=${hull?.y.toFixed(4)} want 0.5`);

// ── 14) A removed body is gone from both the sweep and the getter ───────────
m._physics3d_removeBody(capId);
step(1);
check('a removed body leaves the readback', bodyPos(CAP) === null);
check('and its state can no longer be read', bodyState(capId) === null);

m._physics3d_shutdown();
check('the world reports itself gone', m._physics3d_isReady() === 0);

console.log(pass ? '\nphysics3d smoke: all behaviours hold'
                 : '\nphysics3d smoke: FAILURES');
process.exit(pass ? 0 : 1);
