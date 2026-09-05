// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Which space is an entity's interest position in?
 *
 * `RadiusInterestOptions.position` documents its default as WORLD space. It read
 * the authoring input for a long time because a headless server had no composed
 * world transform to read — composition was scheduled by the renderer. This
 * measures whether an authoritative server has that fact now.
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
    // What a consumer does before reading world space: composition is owned by
    // an epoch now, not by a render frame this server never has.
    world.ensureTransformsComposed();
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
console.log(headless === 105
    ? '  A composed world transform is available here, and the radius default reads it.'
    : '  No composed world transform is available here, so the radius default cannot'
      + '\n  read one: every entity would sit at the origin.');
console.log('');
