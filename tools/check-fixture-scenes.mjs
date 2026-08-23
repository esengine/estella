#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    check-fixture-scenes.mjs
 * @brief   Every fixture scene must be driven by something.
 * @details A fixture with no criterion behind it is the shape a deleted gate
 *          leaves: coverage looks whole because the scene is still there. The
 *          four ShadowCaster2D scenes sat like that, so 2D shadows had no pixel
 *          criterion at all.
 *
 * Run: node tools/check-fixture-scenes.mjs   (exit 1 on an undriven fixture)
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listTrackedSources } from './lib/sourceRoots.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCENES = 'fixtures/scenes';

/**
 * Fixtures kept without a criterion, and why. Empty is the intended state: an
 * entry here is a scene someone drew and nothing looks at.
 */
const UNDRIVEN = {
    'ui-layout.esscene': 'flex layout across 25 nodes — no criterion since the layout gates moved to the editor checks',
    'ui-node-absolute.esscene': 'absolute positioning inside a flex parent; see ui-layout',
    'ui-text-effects.esscene': 'outline / shadow text styling; see ui-layout',
    'ui-text-uinode.esscene': 'text sized by its UINode box; see ui-layout',
    'ui-text-zorder.esscene': 'text drawn over and under its siblings; see ui-layout',
    'ui-textinput.esscene': 'a focused TextInput with a caret; see ui-layout',
    'ktx2-orientation.esscene': 'whether a transcoded KTX2 arrives the right way up — the ktx2 criterion checks colour, not orientation',
    'parallax-control.esscene': 'a sprite parallax factor driven per axis',
    'pixel-perfect.esscene': 'a texture sampled 1:1 at an integer camera position',
};

const drivers = [];
const { files, missing } = listTrackedSources(['tools', 'desktop/scripts']);
if (missing.length) {
    console.log(`check-fixture-scenes: no editor checkout — ${missing.join(', ')} not scanned for drivers.`);
}
const SELF = 'tools/check-fixture-scenes.mjs';
for (const f of files) {
    if (!/\.(mjs|js|ts)$/.test(f)) continue;
    // Not this file: it names every undriven scene below, so counting itself
    // would make each of them look driven the moment it entered the index.
    if (f === SELF) continue;
    drivers.push(readFileSync(path.join(ROOT, f), 'utf8'));
}

const scenes = readdirSync(path.join(ROOT, SCENES)).filter((f) => f.endsWith('.esscene'));
const undriven = scenes.filter((s) => !drivers.some((t) => t.includes(s)));
const problems = [];
for (const s of undriven) {
    if (!UNDRIVEN[s]) problems.push(`  ${SCENES}/${s} — nothing drives it`);
}
for (const declared of Object.keys(UNDRIVEN)) {
    if (!undriven.includes(declared)) {
        problems.push(`  UNDRIVEN names ${declared}, which something drives now — drop the entry`);
    }
}

if (problems.length > 0) {
    console.error('Fixture scenes and the criteria that drive them disagree:\n');
    console.error(problems.join('\n'));
    console.error(`\nGive it a criterion (tools/renderScenes.mjs, an editor check) or record it in`
        + ' UNDRIVEN with what it would prove.');
    process.exit(1);
}

console.log(`check-fixture-scenes: ${scenes.length} fixture scene(s), ${scenes.length - undriven.length}`
    + ` driven by a criterion; ${undriven.length} declared undriven.`);
