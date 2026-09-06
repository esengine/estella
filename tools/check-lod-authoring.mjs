// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-lod-authoring.mjs — a LODGroup is explainable, in both creator
 *        surfaces, without becoming component state.
 *
 * A LODGroup was authorable in the sense that its thresholds could be typed into,
 * and in no other: nothing said which level was on screen, nothing said why, and
 * the only way to see LOD2 was to walk the camera back until it appeared. What
 * the `lod-authoring` editor check proves BEHAVES, this holds in SHAPE — the three
 * ways it could be undone with no behaviour changing on the day it happened:
 *
 *   1  the editor working out a level itself, which is a second selector free to
 *      report LOD1 over a viewport drawing LOD0
 *   2  the explanation reaching only one creator surface — the panel a person
 *      reads or the tool an agent calls, but not both
 *   3  the preview becoming a field, which would put "what I am looking at" into
 *      a shipped game, a second camera and the shadow pass
 *
 * Deliberately about ONE component. Nothing in a name makes a view-dependent
 * creator decision discoverable the way a `radius` makes a spatial one, and
 * inventing a rule for the four that do not exist yet would be exactly the
 * hand-written-list mistake check-gizmo-coverage was built out of. It generalises
 * when there is a second subject to generalise FROM.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EDITOR = path.join(ROOT, 'desktop', 'src');
const SNAPSHOT = path.join(ROOT, 'docs', 'astro', 'src', 'data', 'components.generated.json');
const TOOLS = path.join(ROOT, 'desktop', 'shared', 'toolCatalog.mjs');
const DECORATORS = path.join(EDITOR, 'panels', 'inspector', 'componentDecorators.tsx');
const VIEW_STATE = path.join(ROOT, 'src', 'esengine', 'renderer', 'lod', 'LodViewState.hpp');

// The editor is an optional submodule and two of the three claims live in it.
// Reported, never rounded down to a pass.
if (!existsSync(EDITOR)) {
  console.log('check-lod-authoring: no editor checkout — nothing was judged.');
  process.exit(0);
}

const read = (p) => readFileSync(p, 'utf8');
const problems = [];

/** Every editor source, so claim 1 is about the editor rather than about one file. */
function editorSources(dir = EDITOR, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) editorSources(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

// 1. The panel's level is the engine's, read back — and the band is not copied.
//    The weakest claim here, and it says so: a comparison is unfindable by text,
//    so what is held is the two steps a second selector must take first.

const BAND = /\(\s*1(?:\.0)?\s*\+[^)]{0,60}hysteresis/i;
for (const file of editorSources()) {
  const src = read(file);
  if (BAND.test(src)) {
    problems.push(`${path.relative(ROOT, file)} applies the hysteresis band — that arithmetic is`
      + " lod::selectLevel's, and a copy here is a second selector free to disagree with the picture");
  }
}
if (!/Renderer\.lodInspect\(/.test(read(DECORATORS))) {
  problems.push('the LODGroup panel no longer reads the level back from the frame that drew it'
    + ' (Renderer.lodInspect) — whatever it shows now is its own opinion of the viewport');
}

// 2. Both creator surfaces, or neither is finished. An explanation a person can
//    read and an agent cannot is the same gap as a setting an agent can write and
//    a person cannot (check-project-settings, AUTHORING.audioConfig).
if (!/id: 'core\.lodgroup\.[\w.]+'/.test(read(DECORATORS))) {
  problems.push('no inspector decorator is registered for LODGroup — a person opening Details'
    + ' cannot see which level the view chose');
}
const tools = read(TOOLS);
for (const tool of ['get_lod_decision', 'set_lod_preview']) {
  if (!tools.includes(`name: '${tool}'`)) {
    problems.push(`the automation surface has no ${tool} — an agent asked to tune a LODGroup`
      + ' cannot see what a person sees in Details');
  }
}

// 3. A preview is what one view is showing, so it cannot be a field: on the
//    component it is one answer for every view, it serializes into the scene, and
//    it reaches a shipped game.
const group = JSON.parse(read(SNAPSHOT)).components.find((c) => c.name === 'LODGroup');
if (!group) {
  problems.push('LODGroup is not in the component snapshot — has it been renamed?');
} else {
  const authored = (group.fields ?? []).filter((f) => /preview|forced|override/i.test(f.key));
  if (authored.length) {
    problems.push(`LODGroup declares ${authored.map((f) => f.key).join(', ')} — a level held up for`
      + ' inspection belongs to a (view, entity) pair, not to the entity every view shares');
  }
}

// An explanation is only one while the frame records BOTH answers: what it chose,
// and what the bare thresholds asked for. Lose the second and "why is it still
// LOD0" has nothing to answer it — the panel can only restate the level it showed.
if (!/unbiased/.test(read(VIEW_STATE))) {
  problems.push('LodViewState no longer remembers the unbiased level, so hysteresis holding a level'
    + ' becomes unexplainable');
}

if (problems.length) {
  console.error(`check-lod-authoring: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log('check-lod-authoring: the level is read back, both creator surfaces explain it,'
  + ' and no preview is authored onto the component.');
