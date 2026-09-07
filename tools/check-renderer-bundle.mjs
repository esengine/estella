#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-renderer-bundle.mjs — the editor's renderer runs in a browser,
 *        and a browser has no `require`.
 *
 * One import of a node-only module reaches the renderer bundle as a `require`
 * that throws at module scope, so the WHOLE editor fails to load: no React, no
 * automation hook, and every driver reporting the aftermath — a dead GPU
 * process, a missing play frame — instead of a renderer that never started. One
 * such import (a size helper that sat beside a PNG decoder) cost two days of red.
 *
 * Nothing else notices. Type-checking passes, the build prints no warning, and
 * only an editor somebody actually launched says a word. So this reads the
 * artifact: rolldown injects one helper when a bundle keeps an external CJS
 * require, and that helper's message is the thing to look for.
 *
 * Run: node tools/check-renderer-bundle.mjs
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTool } from './lib/runTool.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EDITOR = path.join(ROOT, 'desktop');
const ASSETS = path.join(EDITOR, 'dist', 'assets');

/** Rolldown's own words, injected only when a chunk kept an external require. */
const MARKER = "doesn't expose the `require` function";

if (!existsSync(path.join(EDITOR, 'package.json'))) {
    console.log('check-renderer-bundle: no editor checkout — nothing to read.');
    process.exit(0);
}

// Built here rather than assumed: a stale dist answers about a bundle this
// checkout does not have, which is the shape of green this gate exists to deny.
const newest = (dir) => {
    let at = 0;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules') continue;
        const child = path.join(dir, entry.name);
        at = Math.max(at, entry.isDirectory() ? newest(child) : statSync(child).mtimeMs);
    }
    return at;
};
const built = existsSync(ASSETS) ? newest(ASSETS) : 0;
if (built < newest(path.join(EDITOR, 'src'))) {
    const r = runTool('pnpm', ['exec', 'vite', 'build'], { cwd: EDITOR, encoding: 'utf8' });
    if (r.status !== 0) {
        console.error('check-renderer-bundle: the editor renderer does not build.');
        console.error(`${r.stdout ?? ''}${r.stderr ?? ''}`.slice(-2000));
        process.exit(1);
    }
}

const chunks = readdirSync(ASSETS).filter((f) => f.endsWith('.js'));
if (chunks.length === 0) {
    console.error(`check-renderer-bundle: ${path.relative(ROOT, ASSETS)} holds no chunk — this scan reads nothing.`);
    process.exit(1);
}
const guilty = chunks.filter((f) => readFileSync(path.join(ASSETS, f), 'utf8').includes(MARKER));

if (guilty.length) {
    console.error('check-renderer-bundle: a node-only module reached the renderer, where it throws on load.');
    for (const f of guilty) console.error(`  desktop/dist/assets/${f}`);
    console.error('  Find it with `pnpm exec vite build --sourcemap` and read the chunk around the'
        + ' require helper; the fix is to move what the renderer wants into a module without the'
        + ' node dependency, not to stub the dependency.');
    process.exit(1);
}
console.log(`check-renderer-bundle: ${chunks.length} renderer chunk(s), none of them keeps a require.`);
