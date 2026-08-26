// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  bench.js — the AOT frame benchmark, in a browser, for a real device.
 *
 * The desktop runner answers what a compiled system costs on a workstation. This
 * one answers it on the machine games actually ship to, and it runs the SAME
 * loop (`measure.mjs`) against the same three artifacts a shipped web build
 * carries: the engine wasm, the SDK, and the module the AOT step compiled.
 *
 * It reports on the page and posts the same JSON back to whoever served it, so a
 * phone needs no cable and no devtools — open the URL, read the table.
 *
 * Reps run in one page rather than one process each (a browser has no second
 * process to offer), so the fastest rep is what is reported: noise on a phone
 * only ever adds time, and a thermally throttled rep measured the phone's
 * temperature.
 */
import { CONFIGS, measure, pct } from '../measure.mjs';

const params = new URLSearchParams(location.search);
const int = (name, def) => {
    const v = Number(params.get(name));
    return Number.isFinite(v) && v > 0 ? Math.floor(v) : def;
};
const ENTITIES = int('entities', 5000);
const FRAMES = int('frames', 300);
const WARMUP = int('warmup', 60);
const REPS = int('reps', 2);

const out = document.getElementById('out');
const say = (line) => {
    out.textContent += `${line}\n`;
    window.scrollTo(0, document.body.scrollHeight);
};
const ms = (x) => x.toFixed(3);

async function main() {
    say(`entities ${ENTITIES}  frames ${FRAMES} (+${WARMUP})  reps ${REPS}`);
    say(navigator.userAgent);
    say('-'.repeat(52));

    const sdk = await import('/sdk/index.js');
    const fixture = await import('/build/systems.web.js');
    const manifest = await (await fetch('/build/systems.json')).json();
    const { default: createModule } = await import('/wasm/esengine.js');
    // One engine for the whole run: each measurement builds its own App on a
    // fresh Registry, and eighteen wasm heaps is how a phone runs out of memory.
    const engine = await createModule({
        locateFile: (p) => `/wasm/${p}`,
        print: () => {}, printErr: (t) => say(`[wasm] ${t}`),
    });
    const newModule = () => engine;

    const runs = new Map(CONFIGS.map((c) => [c.key, []]));
    for (let rep = 0; rep < REPS; rep++) {
        for (const c of CONFIGS) {
            runs.get(c.key).push(await measure({
                sdk, fixture, newModule,
                aot: { wasm: '/build/systems.wasm', manifest },
                body: c.body, compiled: c.compiled,
                entities: ENTITIES, frames: FRAMES, warmup: WARMUP,
            }));
            // Yield to the browser between configurations: a page that never
            // returns to the event loop is a page the phone may decide to kill.
            await new Promise((r) => setTimeout(r, 50));
        }
        say(`rep ${rep + 1}/${REPS} done`);
    }

    // The batch mean, not the per-frame median: a browser's clock is too coarse
    // for one frame of a compiled system (see measure.mjs). Fastest rep, because
    // a throttled one measured the phone's temperature.
    const of = (key) => {
        const means = runs.get(key).map((r) => r.mean).sort((a, b) => a - b);
        return {
            median: means[0], hi: means[means.length - 1],
            p95: pct(runs.get(key).map((r) => r.p95).sort((a, b) => a - b), 50),
            checksum: runs.get(key)[0].checksum,
        };
    };

    const idle = of('idle scene');
    const table = [];
    say('config              ms/frame   slowest    the system   ns/entity');
    for (const c of CONFIGS) {
        const r = of(c.key);
        const own = c.body ? r.median - idle.median : null;
        table.push({ key: c.key, median: r.median, p95: r.p95, own, checksum: r.checksum });
        say(`${c.key.padEnd(20)} ${ms(r.median).padStart(8)}   ${ms(r.hi).padStart(8)}   `
            + `${(own === null ? '' : ms(own)).padStart(10)}   `
            + `${c.body ? (own * 1e6 / ENTITIES).toFixed(1) : ''}`);
    }
    say('-'.repeat(52));
    const ratios = {};
    for (const body of ['thin', 'thick', 'heavy', 'script']) {
        const i = of(`${body} interpreted`);
        const c = of(`${body} compiled`);
        const agree = i.checksum === c.checksum;
        ratios[body] = {
            system: (i.median - idle.median) / (c.median - idle.median),
            frame: i.median / c.median,
            agree,
        };
        say(`${body}: system ${ratios[body].system.toFixed(2)}x   frame ${ratios[body].frame.toFixed(2)}x   `
            + `${agree ? 'same result' : 'RESULT MISMATCH'}`);
    }

    const report = {
        userAgent: navigator.userAgent,
        entities: ENTITIES, frames: FRAMES, warmup: WARMUP, reps: REPS,
        hardwareConcurrency: navigator.hardwareConcurrency ?? null,
        table, ratios,
    };
    try {
        await fetch('/result', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify(report),
        });
        say('posted to the server');
    } catch (e) {
        say(`could not post: ${e}`);
    }
}

main().catch((e) => say(`FAILED: ${e?.stack || e}`));
