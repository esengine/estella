// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-gizmo-coverage.mjs — a component that describes a SPACE is drawn.
 *
 * `gizmo-chrome` proves that the gizmos it lists paint something. What it cannot
 * do is notice a new component: its list is written by hand, so a component added
 * with a radius or a box on it is invisible in the editor AND invisible to the
 * gate — which is how a NavVolume shipped with a number nobody could see the
 * extent of.
 *
 * The rule here is the one that can be decided statically: a field named for a
 * spatial extent means the component occupies a volume of the world, and the
 * viewport must name it somewhere — the only place a gizmo is computed. Whether
 * the drawing actually reaches the screen is gizmo-chrome's question, so add a
 * case there too; this one is about not forgetting.
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SNAPSHOT = path.join(ROOT, 'docs', 'astro', 'src', 'data', 'components.generated.json');
/** The one file where a gizmo's geometry is computed. */
const VIEWPORT = path.join(ROOT, 'desktop', 'src', 'engine', 'ViewportController.ts');

/**
 * Field names that mean "this component occupies a volume of world". Deliberately
 * short: a name that also describes something flat (`size` on a UI node, `scale`)
 * would make the rule about layout rather than about space.
 */
const SPATIAL_FIELDS = new Set(['halfExtents', 'radius', 'shapeRadius', 'halfHeight', 'extents']);

/** Components whose extent is deliberately not drawn, and why. */
const DECLARED_GAPS = {};

const components = JSON.parse(readFileSync(SNAPSHOT, 'utf8')).components;

// The editor is an optional submodule, and it is where every gizmo lives. Without
// it there is nothing to judge — reported, never rounded down to a pass.
if (!existsSync(VIEWPORT)) {
    console.log('check-gizmo-coverage: no editor checkout — the viewport was not scanned,'
        + ' so no component was judged.');
    process.exit(0);
}
const viewport = readFileSync(VIEWPORT, 'utf8');

const problems = [];
const unusedGaps = new Set(Object.keys(DECLARED_GAPS));
let judged = 0;
for (const component of components) {
    const spatial = (component.fields ?? []).map((f) => f.key).filter((k) => SPATIAL_FIELDS.has(k));
    if (spatial.length === 0) continue;
    judged++;
    if (DECLARED_GAPS[component.name]) {
        unusedGaps.delete(component.name);
        continue;
    }
    // Named in the viewport at all: every gizmo path starts by asking the world
    // for the component, so the name is there by construction when one exists.
    if (new RegExp(`\\b${component.name}\\b`).test(viewport)) continue;
    problems.push(`${component.name} declares ${spatial.join(', ')} and the viewport never names it`
        + ' — its extent is a number with nothing on screen to show it');
}

for (const name of unusedGaps) {
    problems.push(`DECLARED_GAPS names "${name}", which no longer declares a spatial field`);
}

if (problems.length) {
    console.error(`check-gizmo-coverage: ${problems.length} problem(s)`);
    for (const p of problems) console.error(`  ${p}`);
    console.error('\n  Draw it in ViewportController and add a case to the editor\'s gizmo-chrome check,');
    console.error('  or record it in DECLARED_GAPS with the reason its extent needs no picture.');
    process.exit(1);
}
console.log(`check-gizmo-coverage: ${judged} component(s) declare a spatial extent and the viewport draws each`
    + `${Object.keys(DECLARED_GAPS).length ? `; ${Object.keys(DECLARED_GAPS).length} declared gap(s)` : ''}.`);
