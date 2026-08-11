// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-cpp-tests.mjs — the C++ harnesses still compile and link.
 *
 * They are built with emscripten in CI, which no local gate can run, so a break
 * in them passed every check a push goes through and only turned up in a job
 * nobody was watching. `test_batch_builder` was red on every push for fourteen
 * hours that way: a hand-listed source set stopped naming everything the units
 * in it needed, and the message was an undefined symbol about materials on work
 * about achievements.
 *
 * The harnesses that do not link the engine build NATIVELY — that is how that
 * break was diagnosed in one minute after fourteen hours — so this configures a
 * plain cmake tree and builds them. It cannot cover the ones that link
 * `esengine` (the engine needs emscripten's headers); those stay CI's to judge,
 * and this says which ones it skipped rather than implying it checked them.
 *
 * Skips itself, loudly, where there is no cmake or no compiler: it is a
 * shift-left convenience, not a claim about the machine it did not run on.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUILD = path.join(ROOT, 'build', 'cmake', 'native-tests');

/** The harness targets, read off the CI list so the two cannot drift. */
function harnessTargets() {
    // Normalised first: a Windows checkout has CRLF here and the line pattern
    // would not match, so this gate could only ever run on the LF side.
    const workflow = readFileSync(path.join(ROOT, '.github', 'workflows', 'build.yml'), 'utf8')
        .replace(/\r\n?/g, '\n');
    const block = workflow.match(/CPP_TESTS:\s*>-\s*\n((?:\s{4}.*\n)+)/);
    if (!block) throw new Error('build.yml no longer declares CPP_TESTS — this gate reads it');
    return block[1].split(/\s+/).filter(Boolean);
}

/** Targets that link the engine library, which does not build off emscripten. */
function enginelinked() {
    const cmake = readFileSync(path.join(ROOT, 'tests', 'CMakeLists.txt'), 'utf8');
    return new Set([...cmake.matchAll(/target_link_libraries\((\w+)\s+PRIVATE\s+esengine\)/g)].map((m) => m[1]));
}

const has = (cmd) => spawnSync(cmd, ['--version'], { stdio: 'ignore' }).status === 0;
if (!has('cmake')) {
    console.log('check-cpp-tests: no cmake on this machine — skipped (CI still builds them).');
    process.exit(0);
}

const targets = harnessTargets();
const skip = enginelinked();
const buildable = targets.filter((t) => !skip.has(t));

mkdirSync(BUILD, { recursive: true });
try {
    execFileSync('cmake', ['-S', ROOT, '-B', BUILD, '-DES_BUILD_TESTS=ON', '-DCMAKE_BUILD_TYPE=Release'],
        { stdio: 'pipe' });
} catch (err) {
    console.log(`check-cpp-tests: cmake could not configure here — skipped.\n${err.stderr ?? ''}`);
    process.exit(0);
}

const built = [];
const absent = [];
for (const target of buildable) {
    const run = spawnSync('cmake', ['--build', BUILD, '-j', '8', '--target', target], { encoding: 'utf8' });
    const out = `${run.stdout ?? ''}${run.stderr ?? ''}`;
    if (run.status === 0) { built.push(target); continue; }
    // A target the native configure never produced is not a broken one: some are
    // declared behind an option this tree does not set. Saying which is the
    // difference between a gate and a green light. MSB1009 is matched by code
    // because MSBuild says "project file does not exist" in the host's language.
    if (/No rule to make target|unknown target|does not exist|MSB1009/i.test(out)) { absent.push(target); continue; }
    console.error(`check-cpp-tests: ${target} does not build.\n`);
    console.error(out.split('\n').filter((l) => /error|Undefined|undefined symbol/i.test(l)).slice(0, 12).join('\n'));
    console.error(`\nReproduce: cmake -S . -B ${path.relative(ROOT, BUILD)} -DES_BUILD_TESTS=ON`
        + `\n            cmake --build ${path.relative(ROOT, BUILD)} --target ${target}`);
    process.exit(1);
}

console.log(`check-cpp-tests: ${built.length} harness(es) build`
    + `${absent.length ? `; ${absent.length} not configured here (${absent.join(', ')})` : ''}`
    + `; ${skip.size} link the engine and are CI's to judge (${[...skip].join(', ')}).`);
