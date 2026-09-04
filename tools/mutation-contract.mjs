// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  What the engine's access paths actually DO, and what the ChangeTracker
 *        actually SEES — asked of every path a game can reach, one row each.
 *
 * Two questions per path, answered independently:
 *
 *   stored    did the World's value really change? Read back from a value
 *             snapshot, never through the reference the path handed out, so a
 *             live alias cannot confirm itself.
 *   observed  did the tracker emit anything a consumer could have seen?
 *
 * `stored && !observed` is a silent write: state that really changed with
 * nothing anywhere saying so. Replication, `Changed()` filters and the UI
 * layout all read the tracker, so such a path drops out of all three.
 *
 * The expectation on each row is this repo's CURRENT contract, not the one we
 * want. Rows marked `defect: true` are the disagreement PR6c exists to close —
 * they are expected so this file can be run for regressions today, and each is
 * a compile-time negative fixture once the read surface is typed read-only.
 *
 *   node tools/mutation-contract.mjs
 *   node tools/mutation-contract.mjs --json
 *
 * Exit codes: 0 the contract holds, 1 a row disagrees with it, 2 this machine
 * could not answer (unbuilt or stale SDK, no engine binary).
 */
import { existsSync, statSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'sdk', 'dist', 'index.node.js');
const WASM_DIR = process.env.ESENGINE_WASM_DIR ?? path.join(ROOT, 'build', 'wasm', 'web');
const JSON_OUT = process.argv.includes('--json');

/** Exit 2, not 1: a question this machine cannot ask is not a failed answer. */
function undetermined(why) {
    console.log(`UNDETERMINED  ${why}`);
    process.exit(2);
}

/**
 * A dist older than the sources it is built from answers for the previous
 * commit. Three gates in this repo have reported green off a stale artifact;
 * the check is cheap enough to be unconditional.
 */
function newestSourceTime(dir) {
    let newest = 0;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) newest = Math.max(newest, newestSourceTime(full));
        else if (entry.name.endsWith('.ts')) newest = Math.max(newest, statSync(full).mtimeMs);
    }
    return newest;
}

if (!existsSync(DIST)) undetermined(`no SDK build at ${path.relative(ROOT, DIST)} — run \`pnpm --filter ./sdk build\``);
const distTime = statSync(DIST).mtimeMs;
const srcTime = newestSourceTime(path.join(ROOT, 'sdk', 'src'));
if (srcTime > distTime) {
    undetermined('sdk/dist is older than sdk/src — it would answer for the previous commit; run `pnpm --filter ./sdk build`');
}

const sdk = await import(pathToFileURL(DIST).href);

const engineJs = path.join(WASM_DIR, 'esengine.js');
if (!existsSync(engineJs)) {
    undetermined(`no engine build at ${path.relative(ROOT, engineJs)} — builtin components cannot be reached; run \`node build-tools/cli.js build -t web\``);
}
const wasmModule = await (await import(pathToFileURL(engineJs).href)).default({
    locateFile: (f) => path.join(WASM_DIR, f),
});

let seq = 0;
const rows = [];

/** Deep value copy — the point is that it does not alias whatever the path returned. */
function snapshot(world, entity, component) {
    const v = world.tryGet(entity, component);
    return v === null || v === undefined ? null : JSON.parse(JSON.stringify(v));
}

/**
 * One access path against a fresh world.
 *
 * `make` builds the component and its initial value, so a row can choose the
 * storage it needs: an all-scalar script shape is pooled into the wasm heap, a
 * shape with a nested object is a plain JS object, and a builtin lives in C++.
 * Those are three different objects to hand a caller, and the whole question is
 * whether they behave the same.
 */
async function probe({ name, kind, expect, defect = false, cpp = false, body }) {
    const app = sdk.App.new();
    if (cpp) app.connectCpp(new wasmModule.Registry(), wasmModule, { strict: false });
    const world = app.world;
    const { component, initial } = kind(sdk, seq++);
    world.enableChangeTracking(component);

    const e = world.spawn();
    world.insert(e, component, initial);
    world.advanceTick();
    const before = snapshot(world, e, component);
    const had = world.has(e, component);
    const since = world.getWorldTick() - 1;

    await body({ world, e, component, app, sdk });

    // Observation is read FIRST: `snapshot` goes through `tryGet`, and whether a
    // read reports as a write is one of the things under test here. Asking after
    // the snapshot would let the fixture's own read answer the question.
    const observed = world.anyChangedSince(component, since)
        && (world.isChangedSince(e, component, since)
            || world.getRemovedEntitiesSince(component, since).includes(e));
    const after = snapshot(world, e, component);
    const stored = had !== world.has(e, component) || JSON.stringify(before) !== JSON.stringify(after);

    rows.push({
        name, stored, observed, defect,
        expected: expect,
        holds: stored === expect.stored && observed === expect.observed,
    });
}

// --- the three storages a component can live in -----------------------------

/** All-scalar script shape: ScriptStorage pools it, and hands out a heap view. */
const pooled = (s, n) => ({
    component: s.defineComponent(`McPooled${n}`, { v: 0, w: 0 }),
    initial: { v: 1, w: 1 },
});

/** Nested shape: not poolable, so storage holds a plain JS object. */
const nested = (s, n) => ({
    component: s.defineComponent(`McNested${n}`, { inner: { x: 0 }, tag: 'a' }),
    initial: { inner: { x: 1 }, tag: 'a' },
});

/** Engine-backed: the value lives in C++ and every read crosses the boundary. */
const builtin = (s) => ({ component: s.Transform, initial: {} });

/** Run one system for a tick — the only way a Query argument is reached at all. */
async function inSystem(app, sdk, queryArgs, fn) {
    app.addSystemToSchedule(sdk.Schedule.Update, sdk.defineSystem([sdk.Query(...queryArgs)], fn));
    await app.tick(1 / 60);
}

// --- declared write paths ---------------------------------------------------

await probe({
    name: 'world.set', kind: pooled, expect: { stored: true, observed: true },
    body: ({ world, e, component }) => { world.set(e, component, { v: 2, w: 1 }); },
});

await probe({
    name: 'world.set (nested shape)', kind: nested, expect: { stored: true, observed: true },
    body: ({ world, e, component }) => { world.set(e, component, { inner: { x: 2 }, tag: 'a' }); },
});

await probe({
    name: 'world.set (builtin)', kind: builtin, cpp: true, expect: { stored: true, observed: true },
    body: ({ world, e, component }) => {
        const v = world.get(e, component);
        v.position.x = 2;
        world.set(e, component, v);
    },
});

await probe({
    name: 'world.insert (replacing)', kind: pooled, expect: { stored: true, observed: true },
    body: ({ world, e, component }) => { world.insert(e, component, { v: 3, w: 1 }); },
});

await probe({
    name: 'world.remove', kind: pooled, expect: { stored: true, observed: true },
    body: ({ world, e, component }) => { world.remove(e, component); },
});

await probe({
    name: 'world.markChanged', kind: pooled, expect: { stored: false, observed: true },
    body: ({ world, e, component }) => { world.markChanged(e, component); },
});

await probe({
    name: 'Query(Mut(C)) write-back', kind: pooled, expect: { stored: true, observed: true },
    body: ({ app, sdk: s, component }) =>
        inSystem(app, s, [s.Mut(component)], (q) => { for (const [, d] of q) d.v = 4; }),
});

await probe({
    name: 'Query(Mut(C)) write-back (builtin)', kind: builtin, cpp: true,
    expect: { stored: true, observed: true },
    body: ({ app, sdk: s, component }) =>
        inSystem(app, s, [s.Mut(component)], (q) => { for (const [, d] of q) d.position.x = 4; }),
});

// --- read paths used as write paths -----------------------------------------

await probe({
    name: 'world.get(...).f = v', kind: pooled, defect: true,
    expect: { stored: true, observed: false },
    body: ({ world, e, component }) => { world.get(e, component).v = 5; },
});

await probe({
    name: 'world.tryGet(...).f = v', kind: pooled, defect: true,
    expect: { stored: true, observed: false },
    body: ({ world, e, component }) => { world.tryGet(e, component).v = 5; },
});

await probe({
    name: 'world.get(...).nested.x = v', kind: nested, defect: true,
    expect: { stored: true, observed: false },
    body: ({ world, e, component }) => { world.get(e, component).inner.x = 5; },
});

await probe({
    name: 'world.tryGet(...).nested.x = v', kind: nested, defect: true,
    expect: { stored: true, observed: false },
    body: ({ world, e, component }) => { world.tryGet(e, component).inner.x = 5; },
});

await probe({
    name: 'world.get(...).nested.x = v (builtin)', kind: builtin, cpp: true,
    expect: { stored: false, observed: false },
    body: ({ world, e, component }) => { world.get(e, component).position.x = 5; },
});

await probe({
    name: 'world.tryGet(...).nested.x = v (builtin)', kind: builtin, cpp: true,
    expect: { stored: false, observed: false },
    body: ({ world, e, component }) => { world.tryGet(e, component).position.x = 5; },
});

await probe({
    name: 'bare Query(C) row write', kind: pooled, defect: true,
    expect: { stored: true, observed: false },
    body: ({ app, sdk: s, component }) =>
        inSystem(app, s, [component], (q) => { for (const [, d] of q) d.v = 6; }),
});

await probe({
    name: 'bare Query(C) row write (nested shape)', kind: nested, defect: true,
    expect: { stored: true, observed: false },
    body: ({ app, sdk: s, component }) =>
        inSystem(app, s, [component], (q) => { for (const [, d] of q) d.inner.x = 6; }),
});

await probe({
    name: 'bare Query(C) row write (builtin)', kind: builtin, cpp: true,
    expect: { stored: false, observed: false },
    body: ({ app, sdk: s, component }) =>
        inSystem(app, s, [component], (q) => { for (const [, d] of q) d.position.x = 6; }),
});

/**
 * A reference kept past the tick it was taken on. If the alias is live, the
 * write lands whenever it happens — the tracker is not merely late, it never
 * hears about it at all.
 */
await probe({
    name: 'reference held across ticks, written later', kind: pooled, defect: true,
    expect: { stored: true, observed: false },
    body: ({ world, e, component }) => {
        const ref = world.get(e, component);
        world.advanceTick();
        world.advanceTick();
        ref.v = 7;
    },
});

// --- reporting --------------------------------------------------------------

const broken = rows.filter((r) => !r.holds);

if (JSON_OUT) {
    console.log(JSON.stringify({ rows, broken: broken.length }, null, 2));
} else {
    const w = Math.max(...rows.map((r) => r.name.length));
    console.log('');
    console.log(`  ${'access path'.padEnd(w)}  stored  observed  verdict`);
    console.log(`  ${'-'.repeat(w)}  ------  --------  -------`);
    for (const r of rows) {
        const mark = (b) => (b ? 'yes' : 'no ');
        const verdict = !r.holds ? 'CONTRACT MOVED'
            : r.defect ? 'silent write'
            : r.stored || r.observed ? 'reported' : 'inert';
        console.log(`  ${r.name.padEnd(w)}  ${mark(r.stored).padStart(6)}  ${mark(r.observed).padStart(8)}  ${verdict}`);
    }
    const silent = rows.filter((r) => r.stored && !r.observed).length;
    console.log('');
    console.log(`  ${rows.length} paths, ${silent} of them silent writes (changed the World, told nobody).`);
    for (const r of broken) {
        console.log(`  MOVED  ${r.name}: expected stored=${r.expected.stored} observed=${r.expected.observed}, got stored=${r.stored} observed=${r.observed}`);
    }
    console.log('');
}

process.exit(broken.length === 0 ? 0 : 1);
