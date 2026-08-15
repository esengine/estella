// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-native-build.mjs — the engine still compiles off emscripten.
 *
 * The web build defines `__EMSCRIPTEN__` and the native one does not, so a
 * header included under that guard and used outside it compiles on the web and
 * nowhere else. That is not hypothetical: `rm_supportsCompressedFormat` reached
 * a `GfxDevice` whose declaration sat under the guard, and every native target
 * — desktop, iOS, Android — failed to build for half a day while every web gate
 * and all 52 pixel gates stayed green.
 *
 * CI does catch it, in a job that takes twenty minutes and was cancelled by the
 * next push each time. This builds the `esengine` library alone, out of the tree
 * `cli native` already configured, so the answer arrives before the push.
 *
 * Skips itself, loudly, where that tree does not exist: the deps are a pinned
 * Dawn checkout and a build of it, which is not something a gate should download.
 * A machine that has never built native gets a note, not a green light.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DESKTOP_BUILD_DIR } from '../build-tools/tasks/native.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOST = { darwin: 'macos', linux: 'linux', win32: 'windows' }[process.platform];

const skip = (why) => {
    console.log(`check-native-build: ${why} — skipped (CI still builds every native target).`);
    process.exit(0);
};

if (!HOST) skip(`no native desktop target for ${process.platform}`);
if (spawnSync('cmake', ['--version'], { stdio: 'ignore' }).status !== 0) skip('no cmake on this machine');

const buildDir = path.join(ROOT, DESKTOP_BUILD_DIR[HOST]);
if (!existsSync(path.join(buildDir, 'CMakeCache.txt'))) {
    skip(`no configured native tree (run \`node build-tools/cli.js native --target ${HOST}\` once)`);
}

const run = spawnSync('cmake', ['--build', buildDir, '--target', 'esengine'], { encoding: 'utf8' });
const out = `${run.stdout ?? ''}${run.stderr ?? ''}`;
if (run.status === 0) {
    console.log(`check-native-build: the engine compiles for ${HOST}.`);
    process.exit(0);
}

console.error('check-native-build: the engine does not compile off emscripten.\n');
console.error(out.split('\n').filter((l) => /error|Error/.test(l)).slice(0, 12).join('\n'));
console.error(`\nReproduce: cmake --build ${path.relative(ROOT, buildDir)} --target esengine`);
process.exit(1);
