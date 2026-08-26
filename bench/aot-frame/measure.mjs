// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  measure.mjs — one world, N frames, one number per frame.
 *
 * Shared by both hosts of this benchmark: `frame-bench.mjs` runs it under node
 * on a desktop, `web/bench.js` runs it in a browser on a phone. What differs
 * between them is only how an engine module is made, so that is the one thing
 * passed in — a second copy of the loop would be a second thing to keep honest,
 * and the two numbers are meant to be comparable.
 *
 * No node built-ins here, for the same reason.
 */

/** The same scene every time: comparing two engines needs one workload. */
export function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];

const now = (typeof performance !== 'undefined' && typeof performance.now === 'function')
    ? () => performance.now() : () => Date.now();

/**
 * `body` of null schedules no project system — the idle run every other one is
 * read against. `compiled` installs the twins BEFORE anything is spawned, the
 * only moment it can: the rows a twin reads have to be allocated in the memory
 * it reads.
 */
export async function measure({
    sdk, fixture, newModule, aot, body, compiled,
    entities = 5000, frames = 600, warmup = 120, dt = 1 / 60,
}) {
    const { createHeadlessApp, Transform, Schedule } = sdk;
    const module = await newModule();
    const app = createHeadlessApp(module);
    if (compiled) {
        const installed = await app.installCompiledSystems(aot.wasm, aot.manifest);
        if (installed === 0) throw new Error('the module installed no twins');
    }

    const world = app.world;
    const cppRegistry = world.getCppRegistry();
    const rand = mulberry32(0x1234abcd);
    const ids = [];
    for (let i = 0; i < entities; i++) {
        const e = world.spawn();
        world.insert(e, Transform, { position: { x: (rand() - 0.5) * 2000, y: (rand() - 0.5) * 2000, z: 0 } });
        world.insert(e, fixture.Mover, {
            dx: rand() - 0.5, dy: rand() - 0.5, speed: 40 + rand() * 80, boost: rand() < 0.5 ? 1 : 0,
        });
        if (body === 'script') world.insert(e, fixture.Pos, { x: 0, y: 0, z: 0 });
        ids.push(e);
    }
    const systems = {
        thin: fixture.thinSystem, thick: fixture.thickSystem,
        heavy: fixture.heavySystem, script: fixture.scriptSystem,
    };
    if (body) app.addSystemToSchedule(Schedule.Update, systems[body]);

    const step = async () => {
        await app.tick(dt);
        if (cppRegistry) module.transform_update(cppRegistry);
    };
    for (let f = 0; f < warmup; f++) await step();

    const samples = new Float64Array(frames);
    const batch0 = now();
    for (let f = 0; f < frames; f++) {
        const t0 = now();
        await step();
        samples[f] = now() - t0;
    }
    // The whole run divided by its frames, because a browser coarsens
    // `performance.now()` to about 100us: per-frame samples there quantise to 0
    // or 0.1 while the total stays exact. A desktop clock has both.
    const mean = (now() - batch0) / frames;

    // What the frames actually computed. Two runs that disagree here are not two
    // measurements of one thing, and the ratio between them means nothing.
    let checksum = 0;
    for (const e of ids) {
        const p = body === 'script' ? world.get(e, fixture.Pos) : world.get(e, Transform).position;
        checksum += p.x + p.y + p.z;
    }

    const sorted = Array.from(samples).sort((a, b) => a - b);
    return { median: pct(sorted, 50), mean, p95: pct(sorted, 95), checksum };
}

/** The configurations both hosts run, in the order they run them. */
export const CONFIGS = [
    { key: 'thin interpreted', body: 'thin', compiled: false },
    { key: 'thin compiled', body: 'thin', compiled: true },
    { key: 'thick interpreted', body: 'thick', compiled: false },
    { key: 'thick compiled', body: 'thick', compiled: true },
    { key: 'heavy interpreted', body: 'heavy', compiled: false },
    { key: 'heavy compiled', body: 'heavy', compiled: true },
    { key: 'script interpreted', body: 'script', compiled: false },
    { key: 'script compiled', body: 'script', compiled: true },
    { key: 'idle scene', body: null, compiled: false },
];
