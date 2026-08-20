// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  soak — Play, Stop, reload, repeat, and demand the editor gives it back.
 *
 * The headless soak (sdk/tests/soak) churns entities and prefabs, and cannot
 * reach the half that actually ends a session: there is no GL context in Node,
 * so no textures, no shader programs, no render targets. Those are what the
 * complaint is about — Play/Stop forty times and the editor crawls; hot-reload
 * a shader all afternoon and the GPU is holding 1.8 GB.
 *
 * So this drives the REAL editor and censuses the EDIT realm between cycles.
 * The edit realm is the right subject: the play realm is an out-of-process frame
 * that Stop destroys, taking its counters with it, while this window and its GL
 * context live for the whole session and are where a leak accumulates.
 *
 *   SOAK_CYCLES=50 node scripts/editor-checks/run.mjs soak
 */
import path from 'node:path';
import { cp } from 'node:fs/promises';
import { makeProject, checker, DESKTOP } from '../lib/editorDriver.mjs';
import { analyzeCensusSeries, formatCensusReport } from '../lib/censusJudge.mjs';

const EXAMPLE = path.resolve(DESKTOP, '..', 'examples', 'sprite-rendering');
const CYCLES = Number(process.env.SOAK_CYCLES ?? 12);

export const name = 'soak';
export const describes = 'Play/Stop and hot reload return every conserved counter, GL objects included';

/** One census, as the judge wants it. */
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
  const check = checker();

  await ed.open(root, 'assets/scenes/main.esscene');

  const first = await census(ed);
  if (!check(first.entries.size > 0, 'resource_census came back empty — nothing was measured')) {
    return check.failures;
  }
  // The GL counters are the reason this check exists at all. Absent means the
  // engine build predates them or no device booted; either way the run below
  // would pass while watching none of what it claims to watch.
  const glKeys = [...first.entries.keys()].filter((k) => k.startsWith('render.gl.'));
  if (!check(glKeys.length > 0, `no render.gl.* counters — GL was not measured (saw: ${[...first.entries.keys()].join(', ')})`)) {
    return check.failures;
  }
  check(first.failedProbes.length === 0, `probes failed: ${first.failedProbes.join('; ')}`);

  const samples = [];
  for (let cycle = 0; cycle < CYCLES; cycle++) {
    // Which cycle it was is the whole point here — a realm that comes up nine
    // times and not the tenth is the leak this check exists to catch.
    try {
      await ed.play();
      await ed.call('step', { frames: 10, dt: 1 / 60 }, 60000);
      await ed.play('stopped');
    } catch (err) {
      check(false, `cycle ${cycle}: ${err.message}`);
      return check.failures;
    }

    // A rescan every cycle: the path that releases a GL texture before uploading
    // its replacement. Whether it re-uploaded is not assumed — render.gl.textures
    // is in the census, so a rescan that did nothing shows as a flat line.
    await ed.call('refresh_assets', {}, 60000);
    await ed.call('step', { frames: 4, dt: 1 / 60 }, 60000);

    samples.push(await census(ed));
  }

  const report = analyzeCensusSeries(samples, { projectCycles: 10_000 });
  if (process.env.SOAK_REPORT) console.log(formatCensusReport(report));
  check(report.failedProbes.length === 0, `probes stopped answering: ${report.failedProbes.join('; ')}`);
  for (const leak of report.leaks) check(false, `${leak.key} — ${leak.reason}`);
  if (report.leaks.length > 0) console.error(formatCensusReport(report));

  return check.failures;
}
