// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Which space is an entity's interest position in?
 *
 * `RadiusInterestOptions.position` documents its default as the Transform's
 * WORLD-space position, and `defaultPosition` reads `t.position` — the
 * authoring input, relative to the parent. Whether that is a one-line fix
 * depends on something this probe measures rather than assumes: whether a
 * composed world transform exists on an authoritative server at all.
 *
 *   node tools/probe-interest-position-space.mjs
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
    console.log('probe-interest-position-space: no SDK or engine build — did NOT run.');
    process.exit(2);
}

const sdk = await import(pathToFileURL(DIST).href);
const factory = (await import(pathToFileURL(path.join(WASM, 'esengine.js')).href)).default;
const module = await factory({ locateFile: (f) => path.join(WASM, f) });

/** A parent at 100 and a child 5 to its right, stepped like a server steps. */
async function measure(makeApp, label) {
    const app = makeApp();
    const world = app.world;
    const parent = world.spawn('parent');
    world.insert(parent, sdk.Transform, { position: { x: 100, y: 0, z: 0 } });
    const child = world.spawn('child');
    world.insert(child, sdk.Transform, { position: { x: 5, y: 0, z: 0 } });
    world.setParent(child, parent);
    await app.tick(1 / 60);
    await app.tick(1 / 60);
    const t = world.get(child, sdk.Transform);
    console.log(`  ${label}`);
    console.log(`    child authoring position.x = ${t.position.x}`);
    console.log(`    child composed worldPosition.x = ${t.worldPosition.x}   (expected 105)`);
    return t.worldPosition.x;
}

console.log('');
console.log('Where a server reads an entity\'s place from:');
const headless = await measure(
    () => sdk.createHeadlessApp(module),
    'createHeadlessApp — the authoritative-server shape',
);
console.log('');
console.log(`  radiusInterest's default reads position, not worldPosition.`);
console.log(headless === 105
    ? '  A composed world transform IS available here, so reading it is a fix.'
    : '  No composed world transform is available here: transform composition runs'
      + '\n  in the renderer backend, which a headless server does not install. Reading'
      + '\n  worldPosition instead would place every entity at the origin.');
console.log('');
