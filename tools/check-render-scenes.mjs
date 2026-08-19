// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-render-scenes.mjs — the pixel gates have one list, and it is run.
 *
 * The registry replaced two lists that had drifted both ways. A gate is what
 * stops a third from growing: a scene declared here must load a scene that
 * exists, sit in a tier something runs, and be reachable by name — and CI must
 * get its list from here rather than inlining its own again.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TIERS, SCENES, scenesAtTier, sceneFileOf, WEBGPU_GAP } from './renderScenes.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'desktop', 'public');
const WORKFLOW = path.join(ROOT, '.github', 'workflows', 'build.yml');

const problems = [];
const fail = (m) => problems.push(m);

const seen = new Set();
for (const s of SCENES) {
  if (!s.id || /[^a-z0-9-]/.test(s.id)) fail(`"${s.id}" is not a usable scene id (lower-case, digits, dashes)`);
  if (seen.has(s.id)) fail(`"${s.id}" is listed twice — --only would run one and mean the other`);
  seen.add(s.id);
  if (!TIERS.includes(s.tier)) fail(`"${s.id}" has tier "${s.tier}" (have: ${TIERS.join(', ')})`);
  if (!s.env || typeof s.env !== 'object') fail(`"${s.id}" has no env — an empty one is {}, not missing`);

  // A scene path that does not resolve is a check that passes by never drawing
  // the thing it was written for.
  const file = sceneFileOf(s);
  if (file && !existsSync(path.join(PUBLIC, file))) {
    fail(`"${s.id}" loads ${s.env.ESTELLA_VERIFY_SCENE}, which is not under desktop/public`);
  }
  const manifest = s.env.ESTELLA_VERIFY_MANIFEST;
  if (manifest && !existsSync(path.join(PUBLIC, manifest.replace(/^\//, '')))) {
    fail(`"${s.id}" names manifest ${manifest}, which is not under desktop/public`);
  }
  // An expectation is the whole point: a scene with none passes as long as it
  // renders anything at all. Allowed, as a sentence — the same bargain the
  // golden corpus strikes with parityGap.
  const asserts = s.env.ESTELLA_VERIFY_EXPECT || s.env.ESTELLA_VERIFY_GRID || s.env.ESTELLA_VERIFY_PREVIEW
    || s.env.ESTELLA_VERIFY_MESH_PREVIEW || s.env.ESTELLA_VERIFY_DEPTH_LAYERS
    || s.env.ESTELLA_VERIFY_YSORT || s.id === 'sprite-default';
  if (!asserts && !s.rendersOnly) {
    fail(`"${s.id}" asserts nothing — give it an ESTELLA_VERIFY_EXPECT, or say in rendersOnly why it has none`);
  }
  if (s.rendersOnly && asserts) fail(`"${s.id}" both probes pixels and says it cannot`);
  if (s.rendersOnly !== undefined && !(typeof s.rendersOnly === 'string' && s.rendersOnly.trim())) {
    fail(`"${s.id}" sets rendersOnly without a reason`);
  }
}

// CI has to take its list from here. Inlining scene invocations again is exactly
// how the two lists came to disagree in the first place.
if (existsSync(WORKFLOW)) {
  const wf = readFileSync(WORKFLOW, 'utf8');
  if (!wf.includes('tools/verify-render.mjs')) {
    fail('build.yml does not run tools/verify-render.mjs — CI would be back to a list of its own');
  }
  if (/^\s*run_scene\s+\S/m.test(wf)) {
    fail('build.yml still inlines run_scene invocations — the registry is the list');
  }
}

// The convenience scripts are shims over the registry. Letting one carry its own
// env again is how desktop/package.json became the second list.
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'desktop', 'package.json'), 'utf8'));
for (const [name, body] of Object.entries(pkg.scripts ?? {})) {
  if (!name.startsWith('verify:render') || !body.includes('headless-verify.mjs')) continue;
  fail(`desktop script "${name}" invokes headless-verify itself — make it a verify-render.mjs shim`);
}
for (const [name, body] of Object.entries(pkg.scripts ?? {})) {
  const m = /^node \.\.\/tools\/verify-render\.mjs --only (\S+)$/.exec(body ?? '');
  if (!m) continue;
  if (!seen.has(m[1])) fail(`desktop script "${name}" names scene "${m[1]}", which the registry does not have`);
}

if (problems.length) {
  console.error('check-render-scenes: the pixel gates do not hold up.\n');
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}

const byTier = TIERS.map((t) => `${t} ${scenesAtTier(t).length}`).join(' / ');
const weak = SCENES.filter((s) => s.rendersOnly);
console.log(`check-render-scenes: ${SCENES.length} pixel gate(s) with a scene CI can find — ok (${byTier})`);
const gpu = SCENES.filter((s) => s.webgpu);
console.log(`  ${gpu.length} declare the second backend: ${WEBGPU_GAP}`);
console.log(`  ${SCENES.length - weak.length} probe pixels; ${weak.length} only assert that something drew:`);
for (const s of weak) console.log(`    ${s.id}: ${s.rendersOnly}`);
