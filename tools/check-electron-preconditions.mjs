// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-electron-preconditions.mjs — one owner for what Electron needs.
 *
 * A Linux runner needs xvfb and the sandbox off before Electron can open a
 * window. That was written at the call sites: eight steps in build.yml carried
 * the prefix and the env var, and nightly.yml — running the same verifiers as
 * release criteria — carried neither. Nine exit criteria then reported the
 * missing display as a verdict about the engine.
 *
 * Two lists again, and the second one had the hole. So this refuses both shapes
 * of it: a verifier that launches Electron without electronRun, and a workflow
 * that supplies by hand what electronRun now supplies for every caller.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOLS = path.join(ROOT, 'tools');
const WORKFLOWS = path.join(ROOT, '.github', 'workflows');

const tracked = (glob) => execFileSync('git', ['ls-files', glob], { cwd: ROOT, encoding: 'utf8' })
  .split('\n').filter(Boolean);

/**
 * Not every Electron on a runner is ours to condition. The desktop scripts live
 * in the private editor submodule, which cannot import from tools/; the native
 * desktop render host is not Electron at all and wants xvfb for Vulkan.
 */
const NOT_OURS = [/scripts\/editor-checks\//, /scripts\/editor-mcp/, /verify-desktop-render/];

function sources(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sources(abs));
    else if (entry.name.endsWith('.mjs') && statSync(abs).isFile()) out.push(abs);
  }
  return out;
}

const problems = [];
let launchers = 0;

// A tool that names electron as the program it runs has to take its conditions
// from electronRun. Spawning it any other way is how a caller ends up needing
// the prefix that this repo just stopped writing.
for (const file of sources(TOOLS)) {
  const rel = path.relative(ROOT, file);
  if (rel.endsWith('lib/electronRun.mjs') || rel.endsWith('check-electron-preconditions.mjs')) continue;
  const src = readFileSync(file, 'utf8');
  const byHand = /(?:runTool|spawnSync|spawn|execFile)\(\s*'(?:pnpm|npx|xvfb-run|electron)'[\s\S]{0,140}?'electron'/.test(src);
  const viaOwner = /\brunElectron\(/.test(src);
  if (!byHand && !viaOwner) continue;
  launchers++;
  if (byHand) problems.push(`${rel} — launches electron without electronRun`);
}

// A scan that finds nothing reports the same green as a repo with nothing wrong.
// This repo launches Electron from several verifiers, so zero means the scan
// broke — the first version of this file said 0 and passed.
if (!launchers) problems.push('tools/ — found no electron launcher at all; this scan is broken');

// The other half: a runner has no GPU, and Chromium blocklists WebGL2 rather
// than falling back. Six launchers said so and the seventh did not, so the
// flagship blamed its route for a machine where nothing could draw.
let mains = 0;
for (const rel of tracked('tools/launchers/*.mjs').concat(tracked('tools/render-host/*.mjs'))) {
  const src = readFileSync(path.join(ROOT, rel), 'utf8');
  // An Electron MAIN process is the one that can set a command-line switch; the
  // shared modules beside them run in the page and have no say.
  if (!/app\.(commandLine|whenReady)/.test(src)) continue;
  mains++;
  if (!/enable-unsafe-swiftshader/.test(src)) {
    problems.push(`${rel} — launches Electron without the software-GL fallback`);
  }
}
if (!mains) problems.push('tools/launchers — found no Electron main at all; this scan is broken');

// And the other direction: a workflow that still hands a verifier the display
// it now brings itself, which is the second list growing back.
for (const name of readdirSync(WORKFLOWS)) {
  if (!/\.ya?ml$/.test(name)) continue;
  const rel = path.join('.github', 'workflows', name);
  const lines = readFileSync(path.join(WORKFLOWS, name), 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (!/xvfb-run|ELECTRON_DISABLE_SANDBOX/.test(line)) return;
    if (NOT_OURS.some((re) => re.test(line))) return;
    // The env var sits on its own line, so the step it belongs to is the run
    // command below it — near enough that reading a few lines on finds it.
    const near = lines.slice(i, i + 4).join('\n');
    if (NOT_OURS.some((re) => re.test(near))) return;
    // A job-wide display, declared. The private editor's scripts cannot import
    // electronRun, so a job that runs them has to stand one up for everybody —
    // which is not the same as writing the prefix beside a verifier that owns it.
    if (/electron-preconditions: job-wide/.test(lines.slice(Math.max(0, i - 16), i + 2).join('\n'))) return;
    problems.push(`${rel}:${i + 1} — supplies what electronRun supplies: ${line.trim().slice(0, 80)}`);
  });
}

if (problems.length) {
  console.error('check-electron-preconditions: Electron\'s conditions are owned by tools/lib/electronRun.mjs');
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`check-electron-preconditions: ${launchers} verifier(s) launch electron through electronRun,`
  + ` ${mains} Electron main(s) carry the software-GL fallback, and no workflow supplies either by hand.`);
