// Validates that a static sensor detects a (non-sensor) kinematic visitor after the
// enableSensorEvents fix. Run against the freshly built physics wasm.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const wasmDir = path.resolve(dir, '../../desktop/public/wasm');
const factory = (await import('file://' + path.join(wasmDir, 'physics.js').replace(/\\/g, '/'))).default;
const m = await factory({ wasmBinary: readFileSync(path.join(wasmDir, 'physics.wasm')) });

const COIN = 2, PLAYER = 9;
m._physics_init(0, -9.81, 1 / 60, 4, 30, 10, 3);

// Coin: static body + sensor box (category 2), at origin.
m._physics_createBody(COIN, 0 /*static*/, 0, 0, 0, 1, 0, 0, 0, 0);
m._physics_addBoxShape(COIN, 0.12, 0.12, 0, 0, 0, 0, 0, 0, /*isSensor*/1, /*cat*/2, /*mask*/0xffff);

// Player: kinematic body + solid box (category 1), starts away from the coin.
m._physics_createBody(PLAYER, 1 /*kinematic*/, 0, 3, 0, 1, 0, 0, 0, 0);
m._physics_addBoxShape(PLAYER, 0.16, 0.24, 0, 0, 0, 1, 0.3, 0, /*isSensor*/0, /*cat*/1, /*mask*/0xffff);

const enters = () => { m._physics_step(1 / 60); m._physics_collectEvents(); return m._physics_getSensorEnterCount(); };

let pass = true;
const check = (name, cond, detail) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}  ${detail}`); if (!cond) pass = false; };

const away = enters();
check('no enter while apart', away === 0, `count=${away}`);

m._physics_setBodyTransform(PLAYER, 0, 0, 0); // move player onto the coin sensor
const over = enters();
check('sensor detects kinematic visitor', over >= 1, `count=${over} (want ≥1)`);

console.log(pass ? '\nSENSOR_SMOKE PASS' : '\nSENSOR_SMOKE FAIL');
process.exit(pass ? 0 : 1);
