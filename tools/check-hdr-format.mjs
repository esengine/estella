// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-hdr-format.mjs — the frame commits to an intermediate format, and
 *        one reader answers for it.
 *
 * test_hdr_format holds the three cases apart. This holds the wiring: the
 * decision taken once per frame, every target reading THAT, and the panel and
 * the tool being one reader rather than two. begin() and declareChain() both
 * build targets, so a format re-derived per call can differ between them.
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PIPE = 'src/esengine/renderer/frame/PostProcessPipeline.cpp';
const SURFACE = 'desktop/src/engine/EditorControlSurface.ts';
const SETTINGS = 'desktop/src/settings/projectSettings.ts';

const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const problems = [];
const pipe = read(PIPE);

// 1. The decision is TAKEN, once, where the frame commits to its resources.
if (!/void PostProcessPipeline::commitFormat\(\)/.test(pipe)) {
  problems.push(`${PIPE} no longer commits a format — the choice is a question re-asked, and two`
    + ' targets in one frame may answer it differently');
}
if (!/commitFormat\(\);[\s\S]{0,400}graph_->begin\(/.test(pipe)) {
  problems.push(`${PIPE} does not commit the format before the graph opens — begin() creates the`
    + ' scene target and declareChain() creates the rest, so a policy flip between them would give'
    + ' one frame two formats');
}

// 2. Every target reads the committed value, not the capability again.
const inter = /GfxPixelFormat PostProcessPipeline::interFormat\(\) const \{([\s\S]*?)\n\}/.exec(pipe);
if (!inter) {
  problems.push(`${PIPE}: interFormat has moved — this gate reads its body`);
} else if (/supportsFloatTargets|linear_output_/.test(inter[1])) {
  problems.push(`${PIPE}: interFormat derives the format again instead of returning the frame's`
    + ' committed decision — which is the state that let one frame hold two answers');
}

// 3. The persistent screen FBO is not exempt. Every other target is rebuilt by
//    the graph each frame; this one outlives the policy that made it.
if (!/screenFBOFormat_ == interFormat\(\)/.test(pipe)) {
  problems.push(`${PIPE}: ensureScreenFBO no longer checks the format it was made with — a`
    + ' colour-space change leaves it holding the old one while the chain has moved on');
}

if (!existsSync(path.join(ROOT, 'desktop', 'src'))) {
  if (problems.length === 0) {
    console.log('check-hdr-format: no editor checkout — the frame commits, the reader was not judged.');
    process.exit(0);
  }
} else {
  // 4. One reader, and it reads the frame rather than the device.
  if (!/post\.hdrFormat\(\)/.test(read(SURFACE))) {
    problems.push(`${SURFACE} no longer reads the committed decision (PostProcess.hdrFormat)`);
  }
  const settings = read(SETTINGS);
  if (!/EditorControlSurface\.hdrFormat\(\)/.test(settings)) {
    problems.push(`${SETTINGS} no longer asks the surface — a second call is a second reader, and`
      + ' the behavioural check exercises only the one the tool goes through');
  }
  if (/supportsFloatTargets/.test(settings)) {
    problems.push(`${SETTINGS} consults the device capability — the effective format is the frame's`
      + ' answer to read back, not one to work out from what the device can do');
  }
  // A project that asked for nothing did not fall back, and saying it did puts a
  // warning in front of every gamma project.
  if (!/seen\.linear/.test(settings)) {
    problems.push(`${SETTINGS} no longer separates "asked and was refused" from "never asked" —`
      + ' requested === effective covers both, and only `linear` tells them apart');
  }
}

if (problems.length) {
  console.error(`check-hdr-format: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('check-hdr-format: the frame commits one format, every target reads it, and the panel'
  + ' and the tool read it through one method.');
