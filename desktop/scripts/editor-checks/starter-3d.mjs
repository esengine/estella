// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  starter-3d — the 3D template a new project starts from actually runs.
 *
 * It is the first 3D thing a person sees: geometry, lights, a character, gravity
 * and a key that moves it. Every one of those is a seam a document validator and a
 * type-check pass straight over — they say the scene parses and the scripts
 * compile, not that the world stands up.
 *
 * So this opens the template as a project, plays it, and asks the running game:
 * does the character rest on the ground at the height its own mesh implies, and
 * does the key the script reads move it there. The height is the claim that keeps
 * the drawn shape and the solved shape the same size — a capsule sits radius plus
 * half-height above what it stands on, and nothing but agreement puts it there.
 */
import path from 'node:path';
import { checker, DESKTOP } from '../lib/editorDriver.mjs';

const TEMPLATE = path.resolve(DESKTOP, 'templates', '3d-starter');

export const name = 'starter-3d';
export const describes = 'the 3D starter template stands up, and its key moves the character';

/** `builtin:capsule` is built at radius 25 with a 25-unit cylinder half, so a
 *  uniform scale is the only thing between it and the shape a solver is given. */
const CAPSULE_RADIUS = 25;
const CAPSULE_HALF = 25;

/** What the running game says about the one character in it. */
const PROBE = 'const h = find("CharacterController3D")[0];'
  + ' return { p: get(h.entity, "Transform").position, floor: h.data.isOnFloor,'
  + ' r: h.data.radius, hh: h.data.halfHeight };';

export async function run(ed) {
  const check = checker();
  await ed.open(TEMPLATE, 'assets/scenes/main.esscene');
  await ed.call('run_editor_command', { id: 'mode.scene' }, 30000);
  await ed.sleep(800);

  await ed.call('set_play', { state: 'play' }, 180000);
  await ed.sleep(2500);

  const at = async () => ed.json('play_probe', { code: PROBE }, 60000);
  const rest = await at();
  if (!check(rest?.p != null, 'the running game has no character in it')) return check.failures;

  check(rest.floor === true, 'the character is not on the floor — it fell through the ground or hangs above it');

  // What the character is DRAWN as, from the document: the primitive's own size
  // times the scale the template gives it.
  const scale = await ed.json('get_field_value',
    { entity: 8, component: 'Transform', key: 'scale' }, 30000);
  if (!check(Array.isArray(scale) && scale[0] > 0, 'the character has no scale to read')) {
    return check.failures;
  }
  const drawnRadius = CAPSULE_RADIUS * scale[0];
  const drawnHalf = CAPSULE_HALF * scale[1];

  // The shape drawn and the shape solved have to be one shape.
  check(
    Math.abs(rest.r - drawnRadius) < 0.5 && Math.abs(rest.hh - drawnHalf) < 0.5,
    `the character is solved as radius ${rest.r} / half ${rest.hh} and drawn as ${drawnRadius} / `
    + `${drawnHalf} — the capsule in the picture is not the capsule in the world`,
  );

  // And it rests exactly that far above the ground's surface at y = 0: a capsule
  // stands on its lower cap.
  const stand = drawnRadius + drawnHalf;
  check(
    Math.abs(rest.p.y - stand) < 1,
    `the character rests at y = ${rest.p.y.toFixed(1)}, where the capsule it is drawn as puts it `
    + `at ${stand} — it is sunk into the ground or hovering over it`,
  );

  // The key the template's own script reads, held over frames the game runs.
  const before = rest.p.z;
  await ed.call('play_input', { kind: 'key_down', code: 'KeyW' }, 30000);
  await ed.json('play_probe', { code: 'await step(30, 1/60); return 1;' }, 60000);
  const moved = await at();
  await ed.call('play_input', { kind: 'key_up', code: 'KeyW' }, 30000);

  check(
    moved.p.z < before - 20,
    `holding the walk key left the character at z = ${moved.p.z.toFixed(1)} from ${before.toFixed(1)} `
    + '— the template ships a key that moves nothing',
  );
  check(
    Math.abs(moved.p.y - stand) < 2,
    `walking left the character at y = ${moved.p.y.toFixed(1)} rather than on the ground at ${stand}`,
  );

  await ed.call('set_play', { state: 'stop' }, 60000);
  return check.failures;
}
