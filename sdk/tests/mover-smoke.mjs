// Headless validation of the native character mover (physics_moveCharacter).
// Loads the built physics wasm directly, builds a static ground, and checks that a
// resting character slides horizontally (the wedge bug) and a falling one lands.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const wasmDir = path.resolve(dir, '../../desktop/public/wasm');
const factory = (await import('file://' + path.join(wasmDir, 'physics.js').replace(/\\/g, '/'))).default;
const wasmBinary = readFileSync(path.join(wasmDir, 'physics.wasm'));
const m = await factory({ wasmBinary });

// Static ground: box 8×0.4 m centered at (0,-2.5) → top surface at y=-2.3.
const GROUND = 2, SELF = 9;
m._physics_init(0, -9.81, 1 / 60, 4, 30, 10, 3);
m._physics_createBody(GROUND, 0 /*static*/, 0, -2.5, 0, 1, 0, 0, 0, 0);
m._physics_addBoxShape(GROUND, 4.0, 0.2, 0, 0, 0, 1, 0.3, 0, 0, /*cat*/1, /*mask*/0xffff);

const buf = () => {
    const b = m._physics_getMoveCharacterBuffer() >> 2;
    const h = m.HEAPF32;
    return { dx: h[b], dy: h[b + 1], vx: h[b + 2], vy: h[b + 3], floor: h[b + 4], wall: h[b + 5], ceil: h[b + 6] };
};
// capsule from a 0.16×0.24 box: spine ±0.08 on Y, radius 0.16
const move = (py, vx, vy) => {
    const ok = m._physics_moveCharacter(0, py, 0, 0.08, 0, -0.08, 0.16, vx, vy, 1 / 60, 0, 1, Math.cos(Math.PI / 4), 0xfffd, SELF);
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

console.log(pass ? '\nMOVER_SMOKE PASS' : '\nMOVER_SMOKE FAIL');
process.exit(pass ? 0 : 1);
