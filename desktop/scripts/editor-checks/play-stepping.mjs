// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  play-stepping — a driver can make the running game advance, and see it.
 *
 * The game runs in its own frame on the browser's rAF clock, which is throttled to
 * roughly one frame a second whenever the editor window is not the focused one — and
 * it never is, for anything driving the editor from outside. So a driver that pressed
 * Play and then read the same component twice got the same answer twice, concluded the
 * game was frozen, and went looking for a reason. `step` existed and advanced the EDIT
 * World, which holds no gameplay: the verb was right and it went to the wrong world.
 *
 * What that cost is on the record. One dogfood run spent 75 of its 158 tool calls
 * probing, found `app.runFrame_` by enumerating prototypes, drove the game through
 * that private method, ran out of tool rounds, and delivered a Breakout that is GAME
 * OVER within half a second — with every component reporting exactly the value it
 * should have.
 *
 * So: press Play, step, and check the world moved by the amount asked for.
 */
import path from 'node:path';
import { cp } from 'node:fs/promises';
import { makeProject, checker, DESKTOP } from '../lib/editorDriver.mjs';

const EXAMPLE = path.resolve(DESKTOP, '..', 'examples', 'sprite-rendering');

export const name = 'play-stepping';
export const describes = 'step advances the RUNNING game deterministically, and the probe can see it';

export async function run(ed) {
  // The example's own systems animate every frame, so "did time pass" is visible in
  // the world rather than only on the clock.
  const root = await makeProject({});
  await cp(EXAMPLE, root, { recursive: true });
  const check = checker();

  await ed.open(root, 'assets/scenes/main.esscene');
  await ed.call('toggle_play', {}, 120000);

  // Ready before stepping: a realm still booting has no app to advance.
  let ready = false;
  for (let i = 0; i < 40 && !ready; i++) {
    ready = (await ed.json('get_play_state', {}))?.ready === true;
    if (!ready) await ed.sleep(500);
  }
  if (!check(ready, 'the play realm never reported ready')) return check.failures;

  const clock = async () => (await ed.json('play_probe', {
    code: 'return resource("Time")',   // bare, no window.__estellaPlay prefix
  }, 60000)) ?? {};

  const before = await clock();
  if (!check(typeof before.frameCount === 'number', `the probe scope has no bare resource(): ${JSON.stringify(before)}`)) {
    return check.failures;
  }

  const stepped = await ed.json('step', { frames: 30, dt: 1 / 60 }, 60000);
  check(stepped?.world === 'play', `step reported world=${JSON.stringify(stepped?.world)} — it stepped the wrong one`);

  const after = await clock();
  const advanced = (after.frameCount ?? 0) - (before.frameCount ?? 0);
  // At least the 30 asked for: the throttled loop may also land a frame of its own,
  // and pinning it EXACTLY would fail on a machine that happened to be focused.
  check(advanced >= 30, `30 frames of step moved the clock by ${advanced}`);
  check(
    (after.elapsed ?? 0) - (before.elapsed ?? 0) >= 30 / 60 - 1e-6,
    `elapsed moved by ${(after.elapsed ?? 0) - (before.elapsed ?? 0)}s, not the 0.5s asked for`,
  );

  // The other half of the loop: what a player would see.
  const shot = await ed.screenshot('play-stepping');
  check(shot.w > 0 && shot.h > 0, 'the window did not capture');

  // And the same picture in the form a model without vision can read. Half the
  // endpoints an editor gets pointed at cannot receive a PNG, and for those this is
  // the ONLY answer to "did anything draw at all".
  const grid = await ed.json('screenshot', { format: 'grid', cols: 48, rows: 24 }, 60000);
  const rows = String(grid).split('\n').filter((l) => /^\s*\d+ /.test(l));
  check(rows.length === 24, `the grid came back ${rows.length} rows deep, not 24`);
  check(/colour grid of the RUNNING GAME/.test(String(grid)), 'the grid did not crop to the running game');
  // A grid of one repeated letter is a capture of nothing — a black frame, or a crop
  // that landed off the canvas. The example draws sprites, so it must have colour.
  const inks = new Set(rows.flatMap((l) => [...l.replace(/^\s*\d+ /, '')]));
  check(inks.size >= 3, `the grid is all one colour (${[...inks].join('')}) — nothing drew, or the crop missed`);

  return check.failures;
}
