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
 * The migration is DONE: what remains declares the field, publishes it, or asks
 * the camera a camera's question. Nothing left reads it to decide where a piece
 * of UI goes — the layout box comes from `ScreenLayout` and the projection from
 * `ScreenOverlay`, neither of which has a parameter a camera could reach. So a
 * new entry here is now a regression, not a step: it means something has started
 * asking a camera where the screen is again.
 *
 *   node tools/check-screen-domain.mjs
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listTrackedSources } from './lib/sourceRoots.mjs';

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
]);

// Through the shared lister: `git ls-files` answers from the INDEX, so a file
// deleted and not yet staged is still named, and reading it throws. That is
// already handled there — handling it again here is the second copy that drifts.
const files = listTrackedSources(['sdk/src']).files.filter((f) => f.endsWith('.ts'));

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
