// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  What one Transform write costs when it also has to say it happened.
 *
 * Composition needs to know it has gone stale, and no single layer can see every
 * producer — so the write path itself has to notify. This measures the price of
 * that notification on the hottest producer there is: `Query(Mut(Transform))`
 * writing back every row.
 *
 * The counters live in the WASM heap, not a plain ArrayBuffer: the real cost is
 * a second store into linear memory a write is already touching, and a JS-side
 * typed array would not answer that.
 *
 *   node bench/transform-invalidation/arm.mjs --arm B --entities 100000
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const flag = (name, fallback) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
};

const ARM = flag('arm', 'A');
const ENTITIES = Number(flag('entities', '100000'));
const WRITE_RATE = Number(flag('writes', '1'));
const WARMUP = Number(flag('warmup', '30'));
const MEASURE = Number(flag('measure', '120'));
/** The adversarial case: every logical write, no semantic movement. */
const STILL = argv.includes('--still');

const sdk = await import(pathToFileURL(path.join(ROOT, 'sdk', 'dist', 'index.node.js')).href);
const wasmDir = process.env.ESENGINE_WASM_DIR ?? path.join(ROOT, 'build', 'wasm', 'web');
const factory = (await import(pathToFileURL(path.join(wasmDir, 'esengine.js')).href)).default;
const module = await factory({ locateFile: (f) => path.join(wasmDir, f) });

const app = sdk.App.new();
app.connectCpp(new module.Registry(), module, { strict: false });
const world = app.world;
const registry = world.getCppRegistry();

const entities = new Array(ENTITIES);
for (let i = 0; i < ENTITIES; i++) {
    const e = world.spawn();
    world.insert(e, sdk.Transform, { position: { x: i, y: 0, z: 0 } });
    entities[i] = e;
}

// A word of the engine's own linear memory, which is what a generated setter
// would be storing to — not a JS ArrayBuffer that lives somewhere else.
const slot = module._malloc(4);
const view = () => new Uint32Array(module.HEAPU32.buffer, slot, 1);
let counter = view();
counter[0] = 0;

// The write path a Mut row takes, resolved once as the query does.
const getter = world.resolveGetter(sdk.Transform, 'borrowed');
const setter = world.resolveSetter(sdk.Transform);
const abiCall = () => module.registry_getCameraEntities(registry);

const WRITES = Math.max(1, Math.round(ENTITIES * WRITE_RATE));
let notifications = 0;

function pass(tick) {
    // The heap moves when wasm grows it, and a detached view silently writes
    // nowhere — the correctness check at the end is what would catch that.
    if (counter.buffer !== module.HEAPU32.buffer) counter = view();
    for (let i = 0; i < WRITES; i++) {
        const e = entities[i];
        const t = getter(e);
        if (!t) continue;
        if (!STILL) t.position.x = t.position.x + 1;
        setter(e, t);
        switch (ARM) {
            case 'B': counter[0] = counter[0] + 1; notifications++; break;
            case 'C': counter[0] = 1; notifications++; break;
            case 'D': abiCall(); notifications++; break;
            default: break;
        }
    }
    void tick;
}

for (let t = 0; t < WARMUP; t++) pass(t);
if (ARM === 'C') counter[0] = 0;
notifications = 0;
const before = counter[0];
const t0 = process.hrtime.bigint();
for (let t = 0; t < MEASURE; t++) pass(t);
const ns = Number(process.hrtime.bigint() - t0);
const after = counter[0];

let checksum = 0;
for (let i = 0; i < Math.min(ENTITIES, 1000); i++) {
    checksum += world.get(entities[i], sdk.Transform).position.x;
}

const totalWrites = WRITES * MEASURE;
// The notification actually happened: an arm whose store was optimised away, or
// whose view had detached, would time beautifully and mean nothing.
const notified = ARM === 'A' ? after === before
    : ARM === 'B' ? after === (before + totalWrites) >>> 0
        : ARM === 'C' ? after === 1
            : notifications === totalWrites;

process.stdout.write(`${JSON.stringify({
    arm: ARM, entities: ENTITIES, writeRate: WRITE_RATE, still: STILL,
    passes: MEASURE, writes: totalWrites,
    totalMs: ns / 1e6,
    nsPerWrite: ns / totalWrites,
    usPerPass: ns / 1000 / MEASURE,
    // One pass per simulated frame at 60Hz.
    oneCorePercent: (ns / 1000 / MEASURE) * 60 / 1e4,
    notified, epochBefore: before, epochAfter: after, checksum,
})}\n`);
