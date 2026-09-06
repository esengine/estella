// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-shadow-plan.mjs — a caster the shadow atlas turns down is recorded.
 *
 * A light the atlas could not fit kept no tiles and cast nothing. The frame
 * counted the tiles it handed OUT, so "why does this object have no shadow" had
 * no answer anywhere in the engine — while the light cap two hundred lines up in
 * the same file logged every light it dropped.
 *
 * What test_shadow_atlas proves about the giving-way rule, this holds about the
 * wiring: the recording path is the ONLY way to claim a tile, the reason is kept,
 * and a denial still reaches a reader. Each is a line somebody could delete
 * without a pixel moving.
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FRAME = 'src/esengine/renderer/frame/RenderFrame.cpp';
const PLAN = 'src/esengine/renderer/store/ShadowPlan.hpp';

const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const problems = [];
const frame = read(FRAME);
const plan = read(PLAN);

// 1. One door. `claimTiles` is the only thing that writes a grant, so a claim made
//    around it is a caster that can be refused with nothing recording it — which is
//    the state this whole file exists to have left.
const direct = [...frame.matchAll(/shadow_atlas_\.allocate\(/g)].length;
if (direct > 0) {
  problems.push(`${FRAME} claims atlas tiles directly (${direct} site(s)) instead of through`
    + ' claimTiles — a claim that does not go through the recording path is a light that can'
    + ' stop casting with nothing to say why');
}
if (!/claimTiles\(/.test(frame)) {
  problems.push(`${FRAME} never calls claimTiles — nothing is recording what the atlas refused`);
}

// 2. The reason, kept. Which of the three refusals happened decides what a reader
//    would do about it: only one of them is fixed by a bigger atlas.
if (!/grant\.refusal = why/.test(plan)) {
  problems.push(`${PLAN} no longer keeps the refusal — a denial becomes a fact with no cause,`
    + ' and "atlas full" stops being distinguishable from "tile budget"');
}
if (!/if \(take == want\)/.test(plan)) {
  problems.push(`${PLAN} no longer takes the FIRST attempt's refusal — the reason a caster did`
    + ' not get what it ASKED for is not the reason one tile fewer also failed');
}

// 3. It reaches somebody. A record nothing reports is the same silence in a struct.
if (!/ES_LOG_WARN\("shadow atlas/.test(frame)) {
  problems.push(`${FRAME} no longer warns on a denied caster — the light cap in this same file`
    + ' warns, and these are the same contention over the same frame');
}
for (const counter of ['render.shadow.denied', 'render.shadow.requested']) {
  if (!frame.includes(counter)) {
    problems.push(`${FRAME} no longer reports ${counter} — tiles handed out without tiles asked`
      + ' for is a number that cannot be read as a shortfall');
  }
}

// 4. One reader, for the reason check-light-cap holds the same rule: the panel a
//    person reads and the tool an agent calls answer through one method, so the
//    behavioural check exercises both. Two calls is one of them never checked.
const SURFACE = 'desktop/src/engine/EditorControlSurface.ts';
const DECORATORS = 'desktop/src/panels/inspector/componentDecorators.tsx';
if (existsSync(path.join(ROOT, 'desktop', 'src'))) {
  if (!/Renderer\.shadowStatus\(/.test(read(SURFACE))) {
    problems.push(`${SURFACE} no longer reads the frame back (Renderer.shadowStatus)`);
  }
  const decorators = read(DECORATORS);
  if (!/EditorControlSurface\.shadowStatus\(/.test(decorators)) {
    problems.push(`${DECORATORS} no longer asks the surface for a caster's standing`);
  }
  // Reduction and denial are the distinction the record exists for; a reader
  // that only knows `denied` reports a sun with two cascades as casting nothing.
  if (!/granted > 0 && \w+\.granted < /.test(decorators)) {
    problems.push(`${DECORATORS} no longer tells a REDUCTION from a denial — a caster that kept`
      + ' fewer tiles still casts, and the frame records the two apart');
  }
}

if (problems.length) {
  console.error(`check-shadow-plan: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('check-shadow-plan: every atlas claim goes through the recording path, the refusal is'
  + ' kept, and a denied caster is both warned and counted.');
