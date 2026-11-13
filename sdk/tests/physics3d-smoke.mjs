// Headless validation of the 3D physics module: loads the built wasm and asserts
// each behaviour against a value arithmetic predicts. A world that steps without
// throwing proves nothing about where anything ended up.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { requireWasm } from '../../tools/lib/wasmDir.mjs';

// Either backend: both export the same entry points, and every assertion below is
// a statement about physics, not about Jolt. PHYSICS3D_MODULE=physics3d-physx runs
// them against PhysX.
const MODULE = process.env.PHYSICS3D_MODULE || 'physics3d';
const wasmDir = requireWasm(`${MODULE}.wasm`);
const factory = (await import('file://' + path.join(wasmDir, `${MODULE}.js`).replace(/\\/g, '/'))).default;
const wasmBinary = readFileSync(path.join(wasmDir, `${MODULE}.wasm`));
console.log(`backend: ${MODULE}`);
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
m._physics3d_addBox(FLOOR, 50, 0.5, 50, 0, -0.5, 0, ...IDENTITY, ...FREE(STATIC), 0.5, 0, 0, 0, 0, 0);
const ballId = m._physics3d_addSphere(BALL, 0.5, 0, 4, 0, ...IDENTITY, ...FREE(DYNAMIC), 0.5, 0, 0, 0, 0, 0);
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
                                       ...FREE(KINEMATIC), 0.5, 0, 0, 0, 0, 0);
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

// A shot has to meet a character; line of sight and a camera's boom must not. A ray across the hero's capsule at
// chest height: the plain one passes it, the one that asks for characters stops on its surface, 0.3 short of its axis.
{
    const ox = walked.x, ray = (flags, mask = 0) => (m._physics3d_raycastWith(ox, 0.8, -5, 0, 0, 10, mask, flags) ? readRay() : null);
    const plain = ray(0);
    check('a plain ray passes through a character', !plain || plain.entity !== 9, JSON.stringify(plain));
    const shot = ray(1);
    check('a ray asking for characters meets one', shot && shot.entity === 9, JSON.stringify(shot));
    check('on its capsule, 0.3 before its axis', shot && near(shot.z, -0.3, 0.02) && near(shot.fraction, 0.47, 0.01),
          `z=${shot?.z?.toFixed(4)} fraction=${shot?.fraction?.toFixed(4)}`);
    check('with the normal facing the ray', shot && near(shot.nz, -1, 0.05), `nz=${shot?.nz?.toFixed(4)}`);
    check('and not when its layer is masked out', !ray(1, 1 << 1));
}

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
// Taller than the 0.4 step the heroes walk with: a crate a character can step onto
// is climbed rather than pushed (PhysX's controller, Unity's, climbs it).
const strongCrate = m._physics3d_addBox(CRATE_STRONG, 0.3, 0.3, 0.3, -38.5, 0.3, 10,
                                        ...IDENTITY, ...FREE(DYNAMIC), 0.2, 0, 0);
const weakCrate = m._physics3d_addBox(CRATE_WEAK, 0.3, 0.3, 0.3, -38.5, 0.3, 20,
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

// ★ A character is swept against the WORLD, and the world holds no characters —
// so without a character-vs-character check two of them pass straight through,
// which is the one pair of shapes a player is sure to notice interpenetrating.
const LEFT_WALKER = 16, RIGHT_WALKER = 17;
const leftWalker = m._physics3d_addCharacter(LEFT_WALKER, 0.3, 0.5, -45, 0.8, -30, 0.87, 70, 0, 0);
const rightWalker = m._physics3d_addCharacter(RIGHT_WALKER, 0.3, 0.5, -41, 0.8, -30, 0.87, 70, 0, 0);
for (let i = 0; i < 150; i++) {
    m._physics3d_moveCharacter(leftWalker, 2, 0, 0, 1 / 60, 0.4, 0.5);
    m._physics3d_moveCharacter(rightWalker, -2, 0, 0, 1 / 60, 0.4, 0.5);
}
const left = moveCharacter(leftWalker, 0, 0, 0, 1);
const right = moveCharacter(rightWalker, 0, 0, 0, 1);
check('two characters meet rather than pass through each other', right.x > left.x,
      `left=${left.x.toFixed(3)} right=${right.x.toFixed(3)}`);
// Two capsules of radius 0.3 touch at 0.6 apart; they walked at each other for
// two and a half seconds, so anything less is one standing inside the other.
check('and they stop a body apart', right.x - left.x > 0.5,
      `apart=${(right.x - left.x).toFixed(3)}`);
m._physics3d_removeCharacter(leftWalker);
m._physics3d_removeCharacter(rightWalker);

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
let landingSpeed = null;
let landingMass = null;
for (let i = 0; i < 180 && !landing; i++) {
    step(1);
    const enters = contactEnters();
    const at = enters.findIndex((e) => e[1] === DROP || e[0] === DROP);
    landing = at >= 0 ? enters[at] : null;
    if (landing) landingSpeed = pairs('_physics3d_contactEnterSpeeds', '_physics3d_contactEnterSpeedsBytes', 1)[at]?.[0] ?? null;
    if (landing) landingMass = pairs('_physics3d_contactEnterMasses', '_physics3d_contactEnterMassesBytes', 1)[at]?.[0] ?? null;
}
check('a contact names both entities', landing != null
      && (landing[0] === PAD || landing[1] === PAD), JSON.stringify(landing));
check('and where they met', landing != null && near(landing[6], 0.0, 0.15),
      `contact y=${landing?.[6]?.toFixed(4)} want the pad's top at 0`);
// How hard: the sphere fell 1.5 m onto the pad, so it arrives at sqrt(2 g h) = 5.42 m/s, give or take the step it
// was found in (g/60 = 0.16). Closing speed is A on B along A-to-B, so it is the same whichever side the sphere is.
check('a contact says how fast the two came together', landingSpeed != null && near(Math.abs(landingSpeed), Math.sqrt(2 * 9.81 * 1.5), 0.35) && landingSpeed > 0,
      `speed=${landingSpeed?.toFixed(3)} want +${Math.sqrt(2 * 9.81 * 1.5).toFixed(3)}`);
check('one speed for each contact', m._physics3d_contactEnterSpeedsBytes() / 4 === m._physics3d_contactEntersBytes() / 32);
// And with what mass: a 0.5 m sphere at the density of water is 523.6 kg, and the pad does not move, so the two meet
// with the sphere's own.
check('a contact says the mass the two met with', landingMass != null && near(landingMass, 4 / 3 * Math.PI * 0.125 * 1000, 2),
      `mass=${landingMass?.toFixed(2)} want ${(4 / 3 * Math.PI * 0.125 * 1000).toFixed(2)}`);
check('one mass for each contact', m._physics3d_contactEnterMassesBytes() / 4 === m._physics3d_contactEntersBytes() / 32);
// A body given a mass of its own has it.
const LIGHT = 22;
const lightId = m._physics3d_addSphere(LIGHT, 0.5, 30, 2, 0, ...IDENTITY, ...FREE(DYNAMIC), 0.5, 0, 0);
m._physics3d_setMass(lightId, 2);
const lightMass = m._physics3d_getBodyDynamics(lightId) ? m.HEAPF32[m._physics3d_queryResult() >> 2] : null;
check('a body can be given its own mass', lightMass != null && near(lightMass, 2, 1e-3), `mass=${lightMass}`);
m._physics3d_setMass(lightId, -1);
const keptMass = m._physics3d_getBodyDynamics(lightId) ? m.HEAPF32[m._physics3d_queryResult() >> 2] : null;
check('and a mass that is no mass is refused', keptMass != null && near(keptMass, 2, 1e-3), `mass=${keptMass}`);
m._physics3d_removeBody(lightId);
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
// It comes to rest INSIDE the field (the floor is too), so the exit is made to
// happen: carried out of the volume. Jolt also reports one when the body falls
// asleep in it; PhysX, as in Unity, does not, and a sleeping visitor is still in.
const settled = collect(sensorExits, 180).find((e) => e[0] === FIELD) ?? null;
check('and does not stop it', near(bodyState(visitorId).y, 0.5, 0.1),
      `visitor y=${bodyState(visitorId)?.y?.toFixed(4)} want 0.5 (through it, onto the floor)`);
m._physics3d_setTransform(visitorId, -20, 0.5, 30, ...IDENTITY);
const sensorLeft = settled ?? collect(sensorExits, 30).find((e) => e[0] === FIELD) ?? null;
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

// Swing/twist and SixDOF must enforce numeric limits while motors push against them.
const advancedBody = (entity, x, motion) => m._physics3d_addBox(entity, 0.2, 0.2, 0.2,
    x, 50, 0, ...IDENTITY, motion, 0, 0, 0, 0, 0, 0, 0.5, 0, 0);
const swingA = advancedBody(150, 800, STATIC), swingB = advancedBody(151, 800, DYNAMIC);
check('a swing twist joint is created', m._physics3d_addSwingTwistJoint(152, swingA, swingB,
    800, 50, 0, 1, 0, 0, 0, 1, 0, 0, 0, -0.3, 0.3, 0) === 1);
check('an entity cannot silently replace a live constraint', m._physics3d_addSwingTwistJoint(152, swingA, swingB,
    800, 50, 0, 1, 0, 0, 0, 1, 0, 0, 0, -.1, .1, 0) === 0);
m._physics3d_setAdvancedJointMotor(152, 1, 0, 0, 0, 1, 0, 0, 0, 100);
step(120);
const angleX = (body) => {
    m._physics3d_getBodyState(body);
    const o = m._physics3d_queryResult() >> 2;
    return 2 * Math.atan2(m.HEAPF32[o + 3], m.HEAPF32[o + 6]);
};
const twist = angleX(swingB);
check('twist motor reaches the upper limit without passing it', twist > 0.2 && twist < 0.34, `angle=${twist}`);
m._physics3d_setAdvancedJointMotor(152, 1, 0, 0, 0, -1, 0, 0, 0, 100);
step(120);
const reverseTwist = angleX(swingB);
check('twist motor reverses without rebuilding the joint', reverseTwist < -0.2 && reverseTwist > -0.34, `angle=${reverseTwist}`);
const coneA = advancedBody(158, 1000, STATIC), coneB = advancedBody(159, 1000, DYNAMIC);
check('an unequal swing cone is created', m._physics3d_addSwingTwistJoint(160, coneA, coneB,
    1000, 50, 0, 1, 0, 0, 0, 1, 0, .3, .6, 0, 0, 0) === 1);
const angleAxis = (body, axis) => {
    m._physics3d_getBodyState(body);
    const o = m._physics3d_queryResult() >> 2;
    return 2 * Math.atan2(m.HEAPF32[o + 3 + axis], m.HEAPF32[o + 6]);
};
m._physics3d_setAdvancedJointMotor(160, 1, 0, 0, 0, 0, 0, 1, 0, 1000);
step(120);
check('normal half cone matches the displayed Z swing bound', near(angleAxis(coneB, 2), .3, .04), `angle=${angleAxis(coneB, 2)}`);
m._physics3d_setAdvancedJointMotor(160, 1, 0, 0, 0, 0, 1, -1, 0, 1000);
step(120);
check('swing remains inside both unequal cone bounds', Math.abs(angleAxis(coneB, 1)) <= .65 && Math.abs(angleAxis(coneB, 2)) <= .35,
    `y=${angleAxis(coneB, 1)} z=${angleAxis(coneB, 2)}`);
const sixA = advancedBody(153, 900, STATIC), sixB = advancedBody(154, 900, DYNAMIC);
const sixArgs = [155, sixA, sixB, 900, 50, 0, 1, 0, 0, 0, 1, 0,
    33, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0];
check('a six axis joint is created', m._physics3d_addSixDOFJoint(...sixArgs) === 1);
m._physics3d_setAdvancedJointMotor(155, 1, 3, 0, 2, 0, 0, 0, 1000, 100);
step(120);
const sixPos = bodyState(sixB);
check('limited X stops at one metre while locked Y stays put', near(sixPos.x, 901, 0.04) && near(sixPos.y, 50, 0.02), JSON.stringify(sixPos));
check('free Z continues through the numeric limits', sixPos.z > 3, JSON.stringify(sixPos));
m._physics3d_setAdvancedJointMotor(155, 1, -3, 0, 0, 0, 0, 0, 100, 100);
step(120);
check('six axis motor reverses to its lower limit', near(bodyState(sixB).x, 899, 0.04), JSON.stringify(bodyState(sixB)));
check('parallel reference axes are rejected', m._physics3d_addSwingTwistJoint(156, swingA, swingB,
    800, 50, 0, 1, 0, 0, 2, 0, 0, 0.4, 0.4, -0.3, 0.3, 0) === 0);
const invalidSix = [...sixArgs]; invalidSix[0] = 157; invalidSix[14] = 2;
check('reversed limited bounds are rejected', m._physics3d_addSixDOFJoint(...invalidSix) === 0);

// Forces: a floating body is held up by a force the SDK applies each step, so the force has to do what its units say.
// A dynamic sphere of known size and density has a mass the solver reports; with gravity off, a force of F newtons over t seconds
// makes a speed of F * t / mass, and a force off the centre makes it spin.
const FORCE = 6100;
const pushed = m._physics3d_addSphere(FORCE, 0.5, 5000, 50, 0, ...IDENTITY, ...FREE(DYNAMIC), 0.5, 0, 0);
const dynamics = () => {
    if (!m._physics3d_getBodyDynamics(pushed)) return null;
    const base = m._physics3d_queryResult() >> 2;
    return { mass: m.HEAPF32[base], wx: m.HEAPF32[base + 1], wy: m.HEAPF32[base + 2], wz: m.HEAPF32[base + 3] };
};
const before = dynamics();
// A sphere of radius 0.5 at the default density of 1000 kg a cubic metre.
check('a dynamic body reports its mass', !!before && near(before.mass, (4 / 3) * Math.PI * 0.125 * 1000, 1), JSON.stringify(before));
check('a body that is not dynamic has none to report', m._physics3d_getBodyDynamics(pushed + 99999) === 0);
if (before) {
    // Gravity is on in this world, so cancel it with a force of the body's weight and add a push along +x: it should speed up along +x and not fall.
    const weight = before.mass * 9.81;
    const v0 = bodyState(pushed);
    for (let i = 0; i < 60; i++) {
        const at = bodyState(pushed);
        m._physics3d_addForce(pushed, 2000, weight, 0, at.x, at.y, at.z);
        m._physics3d_step(1 / 60, 1);
    }
    const v1 = bodyState(pushed);
    check('a force at the centre of mass pushes by F / mass', near(v1.vx, 2000 / before.mass, 0.1), `vx ${v1.vx.toFixed(3)}, expected ${(2000 / before.mass).toFixed(3)}`);
    check('a force that is the body\'s weight holds it up', Math.abs(v1.vy - v0.vy) < 0.1, `vy ${v1.vy.toFixed(3)}`);
    const spin0 = dynamics();
    for (let i = 0; i < 30; i++) {
        const at = bodyState(pushed);
        m._physics3d_addForce(pushed, 0, weight + 20, 0, at.x + 0.4, at.y, at.z);
        m._physics3d_step(1 / 60, 1);
    }
    const spin1 = dynamics();
    check('a force off the centre turns the body', Math.abs(spin1.wz) > Math.abs(spin0.wz) + 0.05, `wz ${spin1.wz.toFixed(3)}`);
    for (let i = 0; i < 30; i++) { m._physics3d_addTorque(pushed, 0, 0, 5); m._physics3d_step(1 / 60, 1); }
    check('a torque turns it too', dynamics().wz !== spin1.wz, `wz ${dynamics().wz.toFixed(3)}`);
}

// ── Collider centre: a shape off the entity's origin ────────────────────────
// A static box whose body sits at y=0 but whose shape is centred 3 above it: a ball dropped onto it rests on the SHAPE (top at 3.5), not on the body origin.
const OFFSET_BOX = 700, OFFSET_BALL = 701;
m._physics3d_addBox(OFFSET_BOX, 2, 0.5, 2, 700, 0, 0, ...IDENTITY, ...FREE(STATIC), 0.5, 0, 0, 0, 3, 0);
const offsetBall = m._physics3d_addSphere(OFFSET_BALL, 0.5, 700, 8, 0, ...IDENTITY, ...FREE(DYNAMIC), 0.5, 0, 0, 0, 0, 0);
step(180);
const offsetRest = bodyState(offsetBall);
check('a box centred above its body holds a ball at the shape, not the origin', offsetRest && near(offsetRest.y, 4, 0.05), `y=${offsetRest?.y.toFixed(3)}`);


// Compound shape gap, local rotation, mass and trigger use the same public ABI on both backends.
function compound(entity, records, motion = STATIC, sensor = 0, mass = 7) {
    const ptr = m._malloc(records.length * 4);
    m.HEAPF32.set(records, ptr >> 2);
    try { return m._physics3d_addCompound(entity, ptr, records.length / 11, 6200, 10, 0,
        ...IDENTITY, ...FREE(motion), .5, 0, sensor, mass); } finally { m._free(ptr); }
}
const bar = [0, .5, 2, .5, -3, 0, 0, ...IDENTITY, 0, .5, 2, .5, 3, 0, 0, ...IDENTITY];
const pair = compound(8100, bar);
check('compound creates one body', pair !== 0);
check('compound leaves its middle gap empty', !raycast(6200, 15, 0, 0, -10, 0));
check('compound left offset shape participates in queries', raycast(6197,15,0,0,-10,0)?.entity === 8100);
check('compound right offset shape participates in queries', raycast(6203,15,0,0,-10,0)?.entity === 8100);
const rotated = compound(8101, [0, .25, 2, .25, 0, 5, 0, 0, 0, Math.SQRT1_2, Math.SQRT1_2]);
check('compound local rotation is preserved', raycast(6201.5,20,0,0,-10,0)?.entity === 8101);
m._physics3d_removeBody(rotated); m._physics3d_removeBody(pair);
const movingCompound = compound(8102, [1,.5,0,0, -1,0,0,...IDENTITY, 1,.5,0,0,1,0,0,...IDENTITY], DYNAMIC);
check('dynamic compound reports explicit mass', m._physics3d_getBodyDynamics(movingCompound) === 1 && near(m.HEAPF32[m._physics3d_queryResult() >> 2],7,.01));
step(30); check('dynamic compound falls as one body', bodyState(movingCompound)?.y < 9);
check('invalid compound data rejected', compound(8103, [0,-1,1,1,0,0,0,...IDENTITY]) === 0);
m._physics3d_removeBody(movingCompound);
const sensorCompound = compound(8104,[1,2,0,0,0,0,0,...IDENTITY],KINEMATIC,1);
const visitor = m._physics3d_addSphere(8105,.5,6200,10,0,...IDENTITY,...FREE(DYNAMIC),.5,0,0);
step(1);
check('compound sensor reports overlap', m._physics3d_sensorEntersBytes() > 0);
m._physics3d_removeBody(visitor); m._physics3d_removeBody(sensorCompound);

// ── The project's solver settings reach the solver ─────────────────────────
// A fully elastic ball dropped 1 m meets the floor at ~4.4 m/s. Under a bounce threshold of 10 m/s
// that impact is too slow to bounce; with the backend's own threshold (Jolt 1, PhysX 2) it bounces
// most of the way back. The same drop, one number changed: what differs is the setting.
const peakAfterImpact = (entity, x) => {
    const id = m._physics3d_addSphere(entity, 0.5, x, 1.5, 0, ...IDENTITY, ...FREE(DYNAMIC), 0, 1, 0, 0, 0, 0);
    let touched = false, peak = -Infinity;
    for (let i = 0; i < 120; i++) {
        step(1);
        const y = bodyState(id)?.y ?? NaN;
        if (y < 0.56) touched = true;
        else if (touched) peak = Math.max(peak, y);
    }
    m._physics3d_removeBody(id);
    return touched ? peak : NaN;
};
const solverFloor = m._physics3d_addBox(9300, 5, 0.5, 5, 9000, -0.5, 0, ...IDENTITY, ...FREE(STATIC), 0.5, 1, 0, 0, 0, 0);
m._physics3d_setSolver(0, 0, 1, 10);
const dead = peakAfterImpact(9301, 9000);
check('under a 10 m/s bounce threshold a 4.4 m/s impact does not bounce', !(dead > 0.6), `peak=${dead}`);
m._physics3d_setSolver(0, 0, 1, 0);
const live = peakAfterImpact(9302, 9002);
check('with the backend\'s own threshold the same impact bounces', live > 1.0, `peak=${live}`);
m._physics3d_removeBody(solverFloor);

// ── Pushing bodies by hand ─────────────────────────────────────────────────
// Spheres of 2 kg, 0.5 m across the middle out, weightless and undamped, far from everything else: what a blow does
// is then exactly what it should. A solid sphere's inertia is 2/5 m r^2 = 0.2 kg m^2.
{
const FLOATING = [DYNAMIC, 0, 0, 0, 0, 0, 0];
let nextBall = 9400;
const floatingBall = () => {
    const id = m._physics3d_addSphere(nextBall, 0.5, 5000 + (nextBall - 9400) * 10, 50, 0, ...IDENTITY, ...FLOATING, 0.5, 0, 0);
    nextBall++;
    m._physics3d_setMass(id, 2);
    return id;
};
const velocityOf = (id) => { m._physics3d_getBodyState(id); const o = m._physics3d_queryResult() >> 2; return [m.HEAPF32[o + 7], m.HEAPF32[o + 8], m.HEAPF32[o + 9]]; };
const spinOf = (id) => { m._physics3d_getBodyDynamics(id); const o = m._physics3d_queryResult() >> 2; return [m.HEAPF32[o + 1], m.HEAPF32[o + 2], m.HEAPF32[o + 3]]; };
const centreOf = (id) => { m._physics3d_getBodyState(id); const o = m._physics3d_queryResult() >> 2; return [m.HEAPF32[o], m.HEAPF32[o + 1], m.HEAPF32[o + 2]]; };
const fmt = (v) => v.map((x) => x.toFixed(3)).join(',');

const struck = floatingBall();
m._physics3d_addImpulse(struck, 4, 0, 0, NaN, NaN, NaN);
step(1);
check('an impulse at the centre changes the speed by impulse / mass', near(velocityOf(struck)[0], 2, 1e-3), fmt(velocityOf(struck)));
check('and turns nothing', spinOf(struck).every((w) => near(w, 0, 1e-4)), fmt(spinOf(struck)));

const clipped = floatingBall();
const [cx, cy, cz] = centreOf(clipped);
m._physics3d_addImpulse(clipped, 0, 0, 1, cx, cy + 0.5, cz);
step(1);
// r x J = (0, 0.5, 0) x (0, 0, 1) = (0.5, 0, 0); over 0.2 kg m^2 that is 2.5 rad/s about x.
check('an impulse off the centre turns it as r x J / inertia says', near(spinOf(clipped)[0], 2.5, 0.01) && near(velocityOf(clipped)[2], 0.5, 1e-3),
      `spin ${fmt(spinOf(clipped))} velocity ${fmt(velocityOf(clipped))}`);

const twisted = floatingBall();
m._physics3d_addAngularImpulse(twisted, 0, 0.2, 0);
step(1);
check('an angular impulse turns it by impulse / inertia', near(spinOf(twisted)[1], 1, 0.01), fmt(spinOf(twisted)));

const spun = floatingBall();
m._physics3d_setAngularVelocity(spun, 0, 0, 3);
step(1);
check('a spin can be set', near(spinOf(spun)[2], 3, 0.01), fmt(spinOf(spun)));

const pushed = floatingBall();
m._physics3d_addForce(pushed, 120, 0, 0, NaN, NaN, NaN);
step(1);
// 120 N on 2 kg for a sixtieth of a second: 1 m/s, and only the one step.
check('a force at the centre lasts one step', near(velocityOf(pushed)[0], 1, 1e-3) && spinOf(pushed).every((w) => near(w, 0, 1e-4)), fmt(velocityOf(pushed)));
step(1);
check('and is gone the step after', near(velocityOf(pushed)[0], 1, 1e-3), fmt(velocityOf(pushed)));

const sleeper = floatingBall();
m._physics3d_setAwake(sleeper, 0);
check('a body can be put to sleep', m._physics3d_isAwake(sleeper) === 0);
m._physics3d_setAwake(sleeper, 1);
check('and woken', m._physics3d_isAwake(sleeper) === 1);
const ledge = m._physics3d_addBox(9498, 1, 0.5, 1, 7000, 0, 0, ...IDENTITY, ...FREE(STATIC), 0.5, 0, 0);
check('a body that does not move is never awake', m._physics3d_isAwake(ledge) === 0);

const faller = m._physics3d_addSphere(9499, 0.5, 6000, 50, 0, ...IDENTITY, ...FREE(DYNAMIC), 0.5, 0, 0);
m._physics3d_setGravity(0, -2, 0);
step(30);
const fall = velocityOf(faller)[1];
m._physics3d_setGravity(0, -9.81, 0);
check('the world\'s gravity can be changed', near(fall, -1, 0.02), `vy=${fall.toFixed(4)} after half a second at 2 m/s^2`);

}


// ── Swept boxes and capsules, and what a body weighs ───────────────────────
{
    // A slab whose top is at y 0.5, far from everything; shapes are swept down onto it from y 5, ten metres.
    m._physics3d_addBox(9600, 1, 0.5, 1, 8000, 0, 0, ...IDENTITY, ...FREE(STATIC), 0.5, 0, 0);
    m._physics3d_optimize();
    const castHit = () => { const o = m._physics3d_queryResult() >> 2; return { entity: m.HEAPF32[o], fraction: m.HEAPF32[o + 1], y: m.HEAPF32[o + 3] }; };
    const S = Math.SQRT1_2;
    const box = m._physics3d_boxCast(8000, 5, 0, 0.5, 0.5, 0.5, ...IDENTITY, 0, -10, 0, 0) ? castHit() : null;
    // A box half a metre each way lands with its centre at 1.0: four metres of ten.
    check('a box swept down lands on what is under it', box && box.entity === 9600 && near(box.fraction, 0.4, 0.006), JSON.stringify(box));
    const turned = m._physics3d_boxCast(8000, 5, 0, 0.5, 0.5, 0.5, 0, 0, Math.sin(Math.PI / 8), Math.cos(Math.PI / 8), 0, -10, 0, 0) ? castHit() : null;
    // Turned an eighth of a turn about z it stands on an edge, its centre 0.707 above the slab.
    check('and a turned box lands on its edge', turned && near(turned.fraction, (5 - 0.5 - S) / 10, 0.006), JSON.stringify(turned));
    const upright = m._physics3d_capsuleCast(8000, 5, 0, 0.25, 0.5, ...IDENTITY, 0, -10, 0, 0) ? castHit() : null;
    // Standing, its foot is 0.75 below its centre; lying (a quarter turn about z), 0.25.
    check('an upright capsule swept down lands on its foot', upright && near(upright.fraction, (5 - 0.5 - 0.75) / 10, 0.006), JSON.stringify(upright));
    const lying = m._physics3d_capsuleCast(8000, 5, 0, 0.25, 0.5, 0, 0, S, S, 0, -10, 0, 0) ? castHit() : null;
    check('and a lying one on its side', lying && near(lying.fraction, (5 - 0.5 - 0.25) / 10, 0.006), JSON.stringify(lying));
    check('a cast that meets nothing says so', m._physics3d_boxCast(8000, 5, 0, 0.5, 0.5, 0.5, ...IDENTITY, 0, 10, 0, 0) === 0);

    // A 2 m x 1 m x 0.5 m block at the density of water: 1000 kg, and a block's moments m/12 (b^2 + c^2).
    const block = m._physics3d_addBox(9601, 1, 0.5, 0.25, 8100, 50, 0, ...IDENTITY, ...FREE(DYNAMIC), 0.5, 0, 0);
    const data = m._physics3d_getBodyMassData(block) ? Array.from(m.HEAPF32.subarray(m._physics3d_queryResult() >> 2, (m._physics3d_queryResult() >> 2) + 7)) : null;
    const want = [1000, 8100, 50, 0, 1000 / 12 * (1 + 0.25), 1000 / 12 * (4 + 0.25), 1000 / 12 * (4 + 1)];
    check('a body says its mass, its centre and its moments of inertia', data && data.every((v, i) => Math.abs(v - want[i]) <= Math.max(0.01 * Math.abs(want[i]), 1e-3)),
          `${data?.map((v) => v.toFixed(2)).join(',')} want ${want.map((v) => v.toFixed(2)).join(',')}`);
    check('and a body that does not move has none to say', m._physics3d_getBodyMassData(m._physics3d_addBox(9602, 1, 1, 1, 8200, 0, 0, ...IDENTITY, ...FREE(STATIC), 0.5, 0, 0)) === 0);
}

// ── A joint changed while it runs ───────────────────────────────────────────
{
    // A door on a vertical hinge, weightless, made with its motor off and a motor limit of nothing.
    const post = m._physics3d_addBox(9700, 0.1, 1, 0.1, 8300, 50, 0, ...IDENTITY, ...FREE(STATIC), 0.5, 0, 0);
    const door = m._physics3d_addBox(9701, 0.5, 1, 0.05, 8300.6, 50, 0, ...IDENTITY, ...[DYNAMIC, 0, 0, 0, 0, 0, 0], 0.5, 0, 0);
    m._physics3d_addHingeJoint(9702, post, door, 8300, 50, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0);
    m._physics3d_setJointMotor(9702, 1, 2);
    step(30);
    // A motor allowed no torque turns nothing - in both worlds, where Jolt's used to push without bound when it was
    // switched on after the joint was made.
    check('a motor turned on later keeps the limit it was given', near(m._physics3d_jointValue(9702), 0, 0.01), `angle=${m._physics3d_jointValue(9702).toFixed(4)}`);
    m._physics3d_setJointMotorLimit(9702, 1000);
    step(30);
    const swung = m._physics3d_jointValue(9702);
    check('and turns once it is allowed to', Math.abs(swung) > 0.5, `angle=${swung.toFixed(4)} after half a second at 2 rad/s`);
    m._physics3d_setJointLimits(9702, 1, -0.3, 0.3);
    step(60);
    const held = m._physics3d_jointValue(9702);
    check('a range set while it runs stops it at the end', Math.abs(Math.abs(held) - 0.3) < 0.05, `angle=${held.toFixed(4)}`);
    m._physics3d_setJointLimits(9702, 0, 0, 0);
    step(30);
    check('and taken away lets it go on', Math.abs(m._physics3d_jointValue(9702)) > 0.6, `angle=${m._physics3d_jointValue(9702).toFixed(4)}`);

    // A ball on a three-metre rope, which is shortened to one while it hangs.
    const hook = m._physics3d_addBox(9710, 0.1, 0.1, 0.1, 8400, 50, 0, ...IDENTITY, ...FREE(STATIC), 0.5, 0, 0);
    const bob = m._physics3d_addSphere(9711, 0.3, 8400, 49, 0, ...IDENTITY, ...FREE(DYNAMIC), 0.5, 0, 0);
    m._physics3d_addDistanceJoint(9712, hook, bob, 8400, 50, 0, 8400, 49, 0, 0, 3, 0, 0, 0);
    step(120);
    const centre = () => { m._physics3d_getBodyState(bob); const o = m._physics3d_queryResult() >> 2; return Math.hypot(m.HEAPF32[o] - 8400, m.HEAPF32[o + 1] - 50, m.HEAPF32[o + 2]); };
    const long = centre();
    m._physics3d_setDistanceJoint(9712, 0, 1, 0, 0);
    step(120);
    const short = centre();
    check('a rope shortened while it hangs pulls up what hangs on it', near(long, 3, 0.05) && near(short, 1, 0.05), `${long.toFixed(3)} then ${short.toFixed(3)}`);
}

m._physics3d_shutdown();
check('the world reports itself gone', m._physics3d_isReady() === 0);

console.log(pass ? '\nphysics3d smoke: all behaviours hold'
                 : '\nphysics3d smoke: FAILURES');
process.exit(pass ? 0 : 1);
