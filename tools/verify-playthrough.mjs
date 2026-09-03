// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  verify-playthrough.mjs — the flagship can still be played to its end.
 *
 * Every other gate asks whether something works: a package boots, a frame is
 * lively, an input is answered. None of them asks the only question a player
 * asks, which is whether the game can be finished — and a game whose second
 * door cannot be opened passes all of them.
 *
 * Packages the flagship and hands it to the closed-loop driver, which walks the
 * route by asking the running game where things are. What that proves is the
 * game's own progression: the pickups its doors ask for, the doors those open,
 * and that the boss can be REACHED. Defeating her is not measured — this driver
 * walks and swings, it does not fight a phased boss, and the route's last leg
 * declares the arrival it ends on rather than implying a kill.
 *
 *   node tools/verify-playthrough.mjs [--project <id>] [--route <file>] [--keep]
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runElectron } from './lib/electronRun.mjs';
import { retryOnDeadGpu, deadGpuVerdict, launchNeverHappenedVerdict } from './lib/deadGpu.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DESKTOP = path.join(ROOT, 'desktop');
const WORK = path.join(ROOT, '.playthrough');

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};

const PROJECT = flag('project', 'celestial-heights');
const projectDir = path.join(ROOT, 'examples', PROJECT);
const ROUTE = path.resolve(flag('route', path.join(projectDir, 'playthrough.json')));

if (!existsSync(path.join(projectDir, 'project.esproject'))) {
  console.error(`verify-playthrough: no project at ${projectDir}`);
  process.exit(2);
}
if (!existsSync(ROUTE)) {
  console.error(`verify-playthrough: ${PROJECT} declares no route at ${ROUTE}`);
  process.exit(2);
}

rmSync(WORK, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
mkdirSync(WORK, { recursive: true });
const out = path.join(WORK, PROJECT);

const exported = spawnSync(process.execPath, [
  path.join(ROOT, 'pipeline', 'bin', 'estella.mjs'), 'export', projectDir,
  '--platform', 'web', '--out', out,
], { encoding: 'utf8', cwd: ROOT });

if (exported.status !== 0) {
  console.error(`✗ ${PROJECT} — packaging failed`);
  console.error((exported.stderr || exported.stdout || '').trim().slice(-600));
  process.exit(1);
}

// A runner whose GPU dies mid-walk loses the WebGL context, and the driver
// counts that as the game's errors (10/10 legs, errors=4, "unplayable"). Retried
// like every other launch; the route's own failures still come straight through.
const played = retryOnDeadGpu(() => {
  const r = runElectron([
    path.join(ROOT, 'tools', 'launchers', 'play-through.mjs'),
    '--dir', out, '--route', ROUTE,
    '--out', path.join(WORK, `${PROJECT}.png`),
    '--budget', '26000',
  ], { encoding: 'utf8', cwd: ROOT });
  return { ok: r.status === 0, output: `${r.stdout ?? ''}${r.stderr ?? ''}`, stdout: r.stdout, stderr: r.stderr };
}, (died) => console.log(`↻ ${PROJECT} — ${died
  ? 'the GPU went away under the walk' : 'no frame after a GPU death'}; walking again`));
for (const line of (played.stdout || '').split('\n')) if (line.trim()) console.log(line);
if (!argv.includes('--keep')) rmSync(WORK, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
if (!played.ok) {
  console.error(played.launchFailed ? `✗ ${launchNeverHappenedVerdict('the walk')}`
    : played.gpuDied ? `✗ ${deadGpuVerdict('the route')}`
      : `✗ ${PROJECT} cannot be played to the end of its route`);
  const why = (played.stderr || '').trim();
  if (why) console.error(why.slice(-800));
  process.exit(1);
}
console.log(`verify-playthrough: ${PROJECT} plays through — ok`);
