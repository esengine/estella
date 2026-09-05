// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Can an authoritative server compose world transforms?
 *
 * `worldPosition` is composed by `TransformSystem`, which the binding layer
 * reaches only through `renderer_updateTransforms` — so a headless server never
 * runs it and every entity's composed position stays at the origin. Whether
 * that is a scheduling hole or a missing service decides how large the fix is.
 *
 *   node tools/probe-headless-transform.mjs
 *
 * Reports; asserts nothing. Exit 2 where the engine is not built.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'sdk', 'dist', 'index.node.js');
const WASM = process.env.ESENGINE_WASM_DIR ?? path.join(ROOT, 'build', 'wasm', 'web');

if (!existsSync(DIST) || !existsSync(path.join(WASM, 'esengine.js'))) {
    console.log('probe-headless-transform: no SDK or engine build — did NOT run.');
    process.exit(2);
}

const sdk = await import(pathToFileURL(DIST).href);
const factory = (await import(pathToFileURL(path.join(WASM, 'esengine.js')).href)).default;
const module = await factory({ locateFile: (f) => path.join(WASM, f) });

const say = (s = '') => console.log(s);
const ok = (b) => (b ? 'yes' : 'NO ');

const app = sdk.createHeadlessApp(module);
const world = app.world;
const registry = world.getCppRegistry();

/** What the binding calls: composition, reached through a renderer-named export. */
const compose = () => module.renderer_updateTransforms(registry);
/** What a frame boundary does: let the next compose actually run. */
const invalidate = () => module.renderer_beginFrame(0);

const worldX = (e) => world.get(e, sdk.Transform).worldPosition.x;

say('');
say('Composing world transforms without a renderer');
say('');

// 1 — is the service there at all, before any renderer init?
let reachable = true;
try { compose(); } catch (e) { reachable = false; say(`  compose threw: ${e.message}`); }
say(`  ${ok(reachable)}  TransformSystem is reachable in a headless context`);

// 2/3 — does the dirty propagation carry each shape of change?
const parent = world.spawn('parent');
world.insert(parent, sdk.Transform, { position: { x: 100, y: 0, z: 0 } });
const child = world.spawn('child');
world.insert(child, sdk.Transform, { position: { x: 5, y: 0, z: 0 } });
world.setParent(child, parent);
const grand = world.spawn('grand');
world.insert(grand, sdk.Transform, { position: { x: 1, y: 0, z: 0 } });
world.setParent(grand, child);

invalidate(); compose();
say(`  ${ok(worldX(child) === 105)}  a child composes against its parent          (${worldX(child)}, want 105)`);
say(`  ${ok(worldX(grand) === 106)}  a grandchild composes through the chain      (${worldX(grand)}, want 106)`);

world.update(parent, sdk.Transform, (t) => { t.position.x = 300; });
invalidate(); compose();
say(`  ${ok(worldX(child) === 305)}  a parent's move reaches its child            (${worldX(child)}, want 305)`);
say(`  ${ok(worldX(grand) === 306)}  and the whole subtree below it               (${worldX(grand)}, want 306)`);

const other = world.spawn('other');
world.insert(other, sdk.Transform, { position: { x: 1000, y: 0, z: 0 } });
world.setParent(child, other);
invalidate(); compose();
say(`  ${ok(worldX(child) === 1005)}  a reparent recomposes the moved subtree      (${worldX(child)}, want 1005)`);

// 4 — two fixed steps in one frame: replication samples on each.
world.update(other, sdk.Transform, (t) => { t.position.x = 10; });
compose();
const first = worldX(child);
world.update(other, sdk.Transform, (t) => { t.position.x = 20; });
compose();
const second = worldX(child);
say(`  ${ok(first === 15 && second === 25)}  two composes in ONE frame each see their own state`
    + `  (${first}, ${second}; want 15, 25)`);
if (second !== 25) {
    say('       The second compose was skipped. `transforms_updated` is cleared only');
    say('       by renderer_beginFrame, so a RENDER frame — not a mutation — is what');
    say('       lets composition run again. Writing a Transform does not invalidate');
    say('       it: a builtin write goes straight into the wasm heap through the ptr');
    say('       setter, calling no C++ at all, so nothing on that side can see it.');
}

// Where an invalidation source could come from, if one is to exist.
say('');
say('What could invalidate a composed-transform epoch');
say('  TransformDirty is emplaced in exactly ONE place in the engine: setParent.');
say('  It does not mean "this changed" — a non-static root is recomposed every');
say('  pass whether or not it carries the tag, and the tag exists so a STATIC one');
say('  is recomposed once anyway. So local Transform writes produce no tag, and');
say('  need none today.');
say('  Which also means it is not a mutation seam an epoch could hang off: the');
say('  writes it would have to catch never reach C++.');

// 5 — what does composing a large flat world cost?
const bulk = sdk.createHeadlessApp(module);
const bulkRegistry = bulk.world.getCppRegistry();
const N = 100000;
for (let i = 0; i < N; i++) {
    const e = bulk.world.spawn();
    bulk.world.insert(e, sdk.Transform, { position: { x: i, y: 0, z: 0 } });
}
const time = (label, fn) => {
    const t0 = process.hrtime.bigint();
    fn();
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    say(`  ${label.padEnd(46)} ${ms.toFixed(2)} ms`);
    return ms;
};
say('');
say(`Composing ${N} flat transforms`);
module.renderer_beginFrame(0);
time('first compose, everything dirty', () => module.renderer_updateTransforms(bulkRegistry));
module.renderer_beginFrame(0);
time('second compose, nothing changed', () => module.renderer_updateTransforms(bulkRegistry));
bulk.world.update(bulk.world.getEntitiesWithComponents([sdk.Transform])[0], sdk.Transform,
    (t) => { t.position.x = -1; });
module.renderer_beginFrame(0);
time('compose after one entity moved', () => module.renderer_updateTransforms(bulkRegistry));
say('');
