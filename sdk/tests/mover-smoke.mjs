// Headless validation of the native character mover (physics_moveCharacter).
// Loads the built physics wasm directly, builds static geometry, and checks the
// resting/wedge/landing behavior plus the skin-width, floor-snap, and ceiling
// options wired through from the CharacterController component.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { requireWasm } from './helpers/wasmDir.mjs';

const wasmDir = requireWasm('physics.wasm');
const factory = (await import('file://' + path.join(wasmDir, 'physics.js').replace(/\\/g, '/'))).default;
const wasmBinary = readFileSync(path.join(wasmDir, 'physics.wasm'));
const m = await factory({ wasmBinary });

// Static ground: box 8×0.4 m centered at (0,-2.5) → top surface at y=-2.3.
const GROUND = 2, CEILING = 3, SELF = 9;
m._physics_init(0, -9.81, 1 / 60, 4, 30, 10, 3);
m._physics_createBody(GROUND, 0 /*static*/, 0, -2.5, 0, 1, 0, 0, 0, 0);
m._physics_addBoxShape(GROUND, 4.0, 0.2, 0, 0, 0, 1, 0.3, 0, 0, /*cat*/1, /*mask*/0xffff);
// Static ceiling: box 8×0.4 m centered at (0,2.5) → bottom surface at y=2.3.
m._physics_createBody(CEILING, 0, 0, 2.5, 0, 1, 0, 0, 0, 0);
m._physics_addBoxShape(CEILING, 4.0, 0.2, 0, 0, 0, 1, 0.3, 0, 0, 1, 0xffff);

const buf = () => {
    const b = m._physics_getMoveCharacterBuffer() >> 2;
    const h = m.HEAPF32;
    return { dx: h[b], dy: h[b + 1], vx: h[b + 2], vy: h[b + 3], floor: h[b + 4], wall: h[b + 5], ceil: h[b + 6] };
};
// capsule from a 0.16×0.24 box: spine ±0.08 on Y, radius 0.16
const move = (py, vx, vy, opts = {}) => {
    const { skin = 0, maxSlides = 5, snap = 0, slideCeil = 1, px = 0 } = opts;
    const ok = m._physics_moveCharacter(px, py, 0, 0.08, 0, -0.08, 0.16, vx, vy, 1 / 60, 0, 1,
        Math.cos(Math.PI / 4), 0xfffd, SELF, skin, maxSlides, snap, slideCeil);
    return ok ? buf() : null;
};

let pass = true;
const check = (name, cond, detail) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}  ${detail}`); if (!cond) pass = false; };

// 1) Resting on the ground (center at -2.06 → feet at -2.30), pushing right.
const rest = move(-2.06, 3.2, -0.5);
check('resting slides horizontally', rest && rest.dx > 0.02, `dx=${rest?.dx.toFixed(4)} (want >0.02)`);
check('resting reads on-floor', rest && rest.floor === 1, `floor=${rest?.floor}`);
check('resting keeps horizontal velocity', rest && rest.vx > 1.0, `vx=${rest?.vx.toFixed(3)}`);

// 2) Falling from well above the ground — moves down freely, not grounded.
const air = move(0.5, 0, -5);
check('airborne falls', air && air.dy < -0.05, `dy=${air?.dy.toFixed(4)} (want <-0.05)`);
check('airborne not grounded', air && air.floor === 0, `floor=${air?.floor}`);

// 3) Realistic fall: start 1.3m above the ground, integrate gravity each frame,
//    confirm it lands, grounds, and settles at the surface (feet ≈ -2.30 → center ≈ -2.06).
let py = -1.0, vy = 0, grounded = false;
for (let i = 0; i < 180; i++) {
    vy += -16 * (1 / 60); // game gravity ≈ -1600 px/s² = -16 m/s²
    const r = move(py, 0, vy);
    py += r.dy;
    vy = r.vy; // mover clips downward velocity on contact
    if (r.floor) grounded = true;
}
check('fall lands and grounds', grounded, `grounded=${grounded}`);
check('rests at the surface', Math.abs(py - -2.06) < 0.05, `center=${py.toFixed(3)} (want ≈-2.06)`);
check('does not sink through', py > -2.35, `center=${py.toFixed(3)} (floor top ~-2.30)`);

// 4) skinWidth keeps a margin off surfaces: a resting character with skin>0 is
//    pushed up out of the floor by ~skin (its inflated radius overlaps otherwise).
const skinned = move(-2.06, 0, 0, { skin: 0.1 });
check('skinWidth lifts the character off the floor', skinned && skinned.dy > 0.05,
    `dy=${skinned?.dy.toFixed(4)} (want >0.05 ≈ skin 0.1)`);
const noSkin = move(-2.06, 0, 0, { skin: 0 });
check('no skin: rests flush', noSkin && Math.abs(noSkin.dy) < 0.02, `dy=${noSkin?.dy.toFixed(4)}`);

// 5) Floor snap: a character hovering 0.16m over the floor and not rising sticks
//    to it when snapLength reaches, and floats free without it (launch-off-ledge).
const noSnap = move(-1.9, 2, -0.5, { snap: 0 });
check('without snap: floats over the gap', noSnap && noSnap.floor === 0, `floor=${noSnap?.floor}`);
const snapped = move(-1.9, 2, -0.5, { snap: 0.3 });
check('snap sticks to the floor within reach', snapped && snapped.floor === 1, `floor=${snapped?.floor}`);
check('snap pulls the character down', snapped && snapped.dy < -0.05, `dy=${snapped?.dy.toFixed(4)}`);
// Snapping must not fire while rising (jumping away from the floor).
const rising = move(-1.9, 2, 3, { snap: 0.3 });
check('snap does not fire while rising', rising && rising.floor === 0, `floor=${rising?.floor}`);

// 6) Ceiling: touching it while moving up is detected, and the upward velocity is
//    clipped (a flat ceiling stops the rise regardless of slideOnCeiling). Start
//    just in contact (capsule top 2.32 vs ceiling bottom 2.30) so the collide pass
//    reports the plane this frame.
const ceil = move(2.08, 1.0, 4.0, { slideCeil: 0 });
check('ceiling detected moving up', ceil && ceil.ceil === 1, `ceil=${ceil?.ceil}`);
check('ceiling stops the upward velocity', ceil && ceil.vy <= 0.01, `vy=${ceil?.vy.toFixed(3)}`);

// 7) maxSlides = 0 is clamped to at least one slide (never a frozen no-op move).
const clamped = move(-2.06, 3.2, 0, { maxSlides: 0 });
check('maxSlides<1 still moves', clamped && clamped.dx > 0.02, `dx=${clamped?.dx.toFixed(4)}`);

console.log(pass ? '\nMOVER_SMOKE PASS' : '\nMOVER_SMOKE FAIL');
process.exit(pass ? 0 : 1);
