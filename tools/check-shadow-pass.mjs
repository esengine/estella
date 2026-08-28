#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-shadow-pass.mjs — the shadow atlas is filled by a graph pass.
 *
 * Two shipped bugs came out of a fill that borrowed the frame's target, camera,
 * draw list and buffer pool and then put them back by hand: a packaged game
 * whose scene landed in the atlas, and a WebGPU frame rejected for sampling an
 * attachment it was writing. Neither was a shadow-maths bug, so what is guarded
 * here is the boundary rather than the picture:
 *
 *   1. Nothing reachable from collectAll() submits to the GPU. Work QUEUED for
 *      the graph is fine — a pass callback runs when the graph runs it — so
 *      lambda bodies are excluded from the walk.
 *   2. openPass() has exactly one caller: begin(), which binds the frame's
 *      target eagerly. A second caller is a pass restoring state behind itself.
 *   3. The scene declares the atlas, so the graph orders the two rather than
 *      the order the passes happen to be added in.
 *   4. The shadow pass draws from its own pool and list and looks through its
 *      own camera. Reaching for the frame's is what makes a restore necessary.
 *
 * Run: node tools/check-shadow-pass.mjs   (exit 1 on violation)
 */

import { existsSync, readFileSync } from 'node:fs';

const FRAME = 'src/esengine/renderer/frame/RenderFrame.cpp';

if (!existsSync(FRAME)) {
  console.error(`Shadow-pass guard is stale: ${FRAME} does not exist.`);
  process.exit(1);
}
/**
 * Code only: the prose above names begin(), openPass() and beginRenderPass(),
 * and describing the boundary must not read as crossing it.
 */
const stripComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, '');

const src = stripComments(readFileSync(FRAME, 'utf8'));

/** Body text of every `RenderFrame::name(...) { ... }` in the file. */
function methodBodies(text) {
  const bodies = new Map();
  const re = /\bRenderFrame::(\w+)\s*\([^;{]*?\)\s*(?:const\s*)?\{/g;
  let m;
  while ((m = re.exec(text))) {
    let depth = 0;
    let i = text.indexOf('{', m.index);
    const start = i;
    for (; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}' && --depth === 0) break;
    }
    bodies.set(m[1], text.slice(start + 1, i));
  }
  return bodies;
}

/**
 * The body with every lambda body removed. What a callback does happens when
 * whoever holds it runs it, so it is not part of the caller's own execution —
 * declaring a graph pass is exactly this, and must not read as doing its work.
 */
function withoutLambdaBodies(body) {
  let out = '';
  for (let i = 0; i < body.length; i++) {
    const rest = body.slice(i);
    const intro = /^\[[^\]]*\]\s*(?:\([^)]*\)\s*)?(?:mutable\s*)?(?:->[^{]+)?\{/.exec(rest);
    if (!intro) { out += body[i]; continue; }
    let depth = 0;
    let j = i + intro[0].length - 1;
    for (; j < body.length; j++) {
      if (body[j] === '{') depth++;
      else if (body[j] === '}' && --depth === 0) break;
    }
    i = j;
  }
  return out;
}

const bodies = methodBodies(src);
for (const required of ['collectAll', 'buildShadowPlan', 'declareShadowPass',
                        'executeShadowPass', 'openPass', 'begin', 'end']) {
  if (!bodies.has(required)) {
    console.error(`Shadow-pass guard is stale: RenderFrame::${required} is gone. `
      + 'If the pass was restructured, restate the invariant here rather than deleting it.');
    process.exit(1);
  }
}

const problems = [];

// --- 1. collect queues work; it does not do it -------------------------------
/**
 * A call to a free/member function of this class BY NAME — not `v.begin()` or
 * `p->end()`, which name a container's. Without the guard every std iterator
 * walk in the file reads as a call to RenderFrame::begin.
 */
const callRe = (name) => new RegExp(`(?<![\\w:.])(?<!->)${name}\\s*\\(`);

const GPU_CALLS = [
  [/\bdevice_\s*\.\s*beginRenderPass\s*\(/, 'device_.beginRenderPass()'],
  [/\bdevice_\s*\.\s*endRenderPass\s*\(/, 'device_.endRenderPass()'],
  [callRe('openPass'), 'openPass()'],
  // Opening a pass is not the only way to draw into one: a submission during
  // collect lands in whatever begin() bound, which is the scene. So the
  // boundary is the SUBMISSION, not the pass.
  [/\b\w*draw_list_\s*\.\s*execute\s*\(/, 'a draw-list submission'],
  [/\b\w*pool_\s*\.\s*upload\s*\(/, 'a transient-buffer upload'],
  [/\bdevice_\s*\.\s*setViewport\s*\(/, 'device_.setViewport()'],
];
const reached = new Set();
const walk = (name) => {
  if (reached.has(name) || !bodies.has(name)) return;
  reached.add(name);
  const body = withoutLambdaBodies(bodies.get(name));
  for (const [re, label] of GPU_CALLS) {
    if (re.test(body)) {
      problems.push(`collectAll reaches ${label} through RenderFrame::${name}() — `
        + 'a pass opened during collect swallows the host draws that follow it. '
        + 'Declare the work as a graph pass instead.');
    }
  }
  for (const callee of bodies.keys()) {
    if (callee === name) continue;
    if (callRe(callee).test(body)) walk(callee);
  }
};
walk('collectAll');

// --- 2. one caller binds the frame's target; nothing restores it -------------
const openPassCallers = [];
for (const [name, body] of bodies) {
  if (name === 'openPass') continue;
  if (callRe('openPass').test(withoutLambdaBodies(body))) openPassCallers.push(name);
}
if (openPassCallers.join(',') !== 'begin') {
  problems.push(`openPass() is called by [${openPassCallers.join(', ') || 'nobody'}] — `
    + 'it may only be called by begin(), which binds the frame\'s target eagerly. '
    + 'A second caller is a pass putting state back behind itself.');
}

// --- 3. the graph is told, not trusted to guess ------------------------------
const declare = bodies.get('declareShadowPass');
if (!/\bshadow\.write\s*=\s*shadow_resource_/.test(declare)) {
  problems.push('the shadow pass does not declare shadow_resource_ as its write — '
    + 'the graph cannot order or recycle a target nobody claims.');
}
if (!/dependencies\.push_back\(shadow_resource_\)/.test(bodies.get('end'))) {
  problems.push('the scene pass does not name shadow_resource_ in its dependencies — '
    + 'culling walks back from the final target, so the shadow pass would be dropped '
    + 'entirely, and the order of the two would be an accident of addPass order.');
}

// --- 4. the pass brings its own buffers and its own camera -------------------
const OWN_STATE = [
  [/\bview_projection_\s*=/, "assigns the frame's view_projection_"],
  [/\bfrustum_\s*\./, "reaches for the frame's frustum_"],
  [/(?<![\w])pool_\s*\.\s*(?:beginFrame|upload)\s*\(/, "drives the scene's buffer pool"],
  [/(?<![\w])draw_list_\s*\./, "drives the scene's draw list"],
];
for (const name of ['buildShadowPlan', 'executeShadowPass']) {
  const body = withoutLambdaBodies(bodies.get(name));
  for (const [re, what] of OWN_STATE) {
    if (re.test(body)) {
      problems.push(`RenderFrame::${name}() ${what} — the shadow pass runs between the `
        + 'host\'s draws and the scene\'s, so borrowing either is what a restore then '
        + 'has to undo. It has shadow_pool_, shadow_draw_list_ and its own frustum.');
    }
  }
}

if (problems.length) {
  console.error('Shadow-pass boundary guard failed:\n');
  for (const p of problems) console.error(`  ✗ ${p}\n`);
  process.exit(1);
}
console.log(`shadow-pass: collect reaches ${reached.size} method(s), none of them a render pass; `
  + 'the atlas is declared and the scene names it.');
