// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-screen-domain.mjs — who is still asking a camera where the screen is.
 *
 * Screen-space UI has one coordinate authority (`ScreenLayoutData`) and a camera
 * is not part of it. `UICameraInfo.worldLeft/Right/Top/Bottom` is a camera's
 * world rect; under a 2D camera it happens to be the screen, which is the
 * equivalence a 3D camera breaks.
 *
 * Migrating the readers one at a time is only safe if the set is CLOSED, so this
 * lists every one and fails on an undeclared reader. A reader that still belongs
 * to the camera says so here, with the reason it is not screen-space.
 *
 *   node tools/check-screen-domain.mjs
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIELD = /\b(?:worldLeft|worldRight|worldTop|worldBottom)\b/;

/**
 * The readers that may still exist, and why each is not the screen. Removing an
 * entry is the migration; adding one needs a reason that survives being read
 * aloud next to "a camera does not know where the screen is".
 */
const DECLARED = new Map([
    ['sdk/src/ui/core/ui-camera-info.ts', 'declares the fields'],
    ['sdk/src/camera/CameraPlugin.ts', 'publishes them from the camera'],
    ['sdk/src/app/corePlugin.ts', 'zeroes the resource at startup'],
    ['sdk/src/ecs/resourceShapes.ts', 'declares the resource shape'],
    ['sdk/src/camera/Camera.ts', 'getWorldBounds is a camera query, not a UI one'],
    ['sdk/src/ui/layout/layout.ts',
     'still hands the box to uiLayout_update — moves with the collection split'],
    ['sdk/src/ui/text/plugin.ts',
     'glyph raster scale is camera-correct for WORLD text; screen text needs the '
     + 'two told apart, which is the collection split'],
]);

const files = execFileSync('git', ['ls-files', 'sdk/src'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter((f) => f.endsWith('.ts'));

const found = [];
for (const file of files) {
    const text = readFileSync(path.join(ROOT, file), 'utf8');
    const lines = text.split('\n');
    for (const [i, line] of lines.entries()) {
        if (!FIELD.test(line)) continue;
        found.push({ file, line: i + 1, text: line.trim() });
    }
}

const readers = new Set(found.map((f) => f.file));
const undeclared = [...readers].filter((f) => !DECLARED.has(f)).sort();
const stale = [...DECLARED.keys()].filter((f) => !readers.has(f)).sort();

for (const f of undeclared) {
    console.log(`✗ ${f} reads a camera's world rect for what looks like screen space`);
    for (const hit of found.filter((h) => h.file === f)) {
        console.log(`    ${hit.line}: ${hit.text.slice(0, 100)}`);
    }
}
// A declaration nothing needs any more is the migration finishing; it must be
// deleted, or the list stops describing the tree it claims to.
for (const f of stale) console.log(`✗ ${f} is declared but no longer reads one — drop the entry`);

const bad = undeclared.length + stale.length;
console.log(bad === 0
    ? `check-screen-domain: ${readers.size} declared reader(s) of the camera's world rect, `
      + 'and no undeclared one'
    : `check-screen-domain: ${bad} finding(s)`);
process.exit(bad === 0 ? 0 : 1);
