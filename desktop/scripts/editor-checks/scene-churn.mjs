// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  scene-churn — open one scene, then another, then back, and count.
 *
 * The Play/Stop soak keeps one scene open for its whole run, so the question it
 * cannot ask is what a session of AUTHORING costs: an editor that pins every
 * asset it ever loaded accumulates one scene's worth of GPU memory per scene
 * opened, and the texture pool's budget can never evict any of it because
 * everything still holds a reference.
 *
 * This alternates two scenes and reads the census between. `render.gl.textures`
 * climbing across a cycle is the whole finding; the counters that do NOT move
 * say where it is not.
 *
 *   SOAK_CYCLES=8 SOAK_REPORT=1 node scripts/editor-checks/run.mjs scene-churn
 */
import path from 'node:path';
import { cp, writeFile, mkdir, readFile } from 'node:fs/promises';
import { makeProject, checker, DESKTOP } from '../lib/editorDriver.mjs';
import { analyzeCensusSeries, formatCensusReport } from '../lib/censusJudge.mjs';

const EXAMPLE = path.resolve(DESKTOP, '..', 'examples', 'sprite-rendering');
const CYCLES = Number(process.env.SOAK_CYCLES ?? 6);

export const name = 'scene-churn';
export const describes = 'opening scenes back and forth does not accumulate GPU resources';

async function census(ed) {
  const raw = await ed.json('resource_census', {}, 60000);
  return {
    atMs: 0,
    entries: new Map((raw?.entries ?? []).map((e) => [e.key, e])),
    failedProbes: raw?.failedProbes ?? [],
  };
}

export async function run(ed) {
  const root = await makeProject({});
  await cp(EXAMPLE, root, { recursive: true });

  // A second scene that references the SAME texture as the first, so switching
  // between them is the ordinary authoring loop rather than two disjoint sets.
  const scenesDir = path.join(root, 'assets', 'scenes');
  await mkdir(scenesDir, { recursive: true });
  const first = JSON.parse(await readFile(path.join(scenesDir, 'main.esscene'), 'utf8'));
  await writeFile(path.join(scenesDir, 'second.esscene'), JSON.stringify({ ...first, name: 'second' }, null, 2));

  const check = checker();
  await ed.open(root, 'assets/scenes/main.esscene');

  const first_ = await census(ed);
  if (!check(first_.entries.size > 0, 'resource_census came back empty')) return check.failures;
  const glKeys = [...first_.entries.keys()].filter((k) => k.startsWith('render.gl.'));
  if (!check(glKeys.length > 0, 'no render.gl.* counters — GL was not measured')) return check.failures;

  const samples = [];
  for (let cycle = 0; cycle < CYCLES; cycle++) {
    for (const scene of ['assets/scenes/second.esscene', 'assets/scenes/main.esscene']) {
      await ed.call('open_scene', { path: scene, discardChanges: true }, 120000);
      await ed.call('step', { frames: 4, dt: 1 / 60 }, 60000);
    }
    samples.push(await census(ed));
  }

  const report = analyzeCensusSeries(samples, { projectCycles: 10_000 });
  if (process.env.SOAK_REPORT) console.log(formatCensusReport(report));
  check(report.failedProbes.length === 0, `probes stopped answering: ${report.failedProbes.join('; ')}`);
  for (const leak of report.leaks) check(false, `${leak.key} — ${leak.reason}`);
  if (report.leaks.length > 0) console.error(formatCensusReport(report));

  return check.failures;
}
