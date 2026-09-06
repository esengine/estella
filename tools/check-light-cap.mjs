// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-light-cap.mjs — the frame records which lights it left out, and
 *        one reader answers for them.
 *
 * The cap logged a COUNT and dropped the rest: "three lights exceed the cap"
 * says something went dark and not what, so the only way to find out was to
 * delete lights until one came back.
 *
 * `light-cap` (the editor check) proves the answer MOVES with the frame's. This
 * holds the two things that could be undone with nothing moving on the day: the
 * record itself, and the panel and the tool being one reader rather than two.
 * Two readers is how a panel starts guessing and fails nothing — the behavioural
 * check drives the tool, and would never touch the other one.
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FRAME = 'src/esengine/renderer/frame/RenderFrame.cpp';
const SURFACE = 'desktop/src/engine/EditorControlSurface.ts';
const DECORATORS = 'desktop/src/panels/inspector/componentDecorators.tsx';

const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const problems = [];
const frame = read(FRAME);

// 1. The identities, not the count. Recorded between the sort and the resize,
//    which is the one moment the frame knows who it is about to stop carrying.
if (!/light_cap_\.refused\.push_back/.test(frame)) {
  problems.push(`${FRAME} no longer records WHICH lights the cap dropped — a count says something`
    + ' went dark and not what, which is the state this replaced');
}
if (!/light_cap_\.requested/.test(frame) || !/light_cap_\.accepted/.test(frame)) {
  problems.push(`${FRAME} no longer records asked beside kept — "16 lights" cannot be read as a`
    + ' shortfall without the number it fell short of');
}

// The editor is an optional submodule; the reader lives in it.
if (!existsSync(path.join(ROOT, 'desktop', 'src'))) {
  if (problems.length === 0) {
    console.log('check-light-cap: no editor checkout — the frame records, the reader was not judged.');
    process.exit(0);
  }
} else {
  // 2. One reader. The panel a person reads and the tool an agent calls answer
  //    through the same method, so exercising either exercises both.
  if (!/Renderer\.lightStatus\(/.test(read(SURFACE))) {
    problems.push(`${SURFACE} no longer reads the frame back (Renderer.lightStatus) — whatever it`
      + ' answers is its own opinion of which lights are lit');
  }
  const decorators = read(DECORATORS);
  if (!/EditorControlSurface\.lightStatus\(/.test(decorators)) {
    problems.push(`${DECORATORS} no longer asks the surface — a second call is a second reader,`
      + ' and the behavioural check exercises only the one the tool goes through');
  }
  if (/Renderer\.lightStatus\(/.test(decorators)) {
    problems.push(`${DECORATORS} calls Renderer.lightStatus directly, beside the surface — two`
      + ' readers for one fact, and only one of them is ever checked');
  }
}

if (problems.length) {
  console.error(`check-light-cap: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('check-light-cap: the frame names the lights it left out, and the panel and the tool'
  + ' read them through one method.');
