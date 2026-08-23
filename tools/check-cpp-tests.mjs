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
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
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

/** Every harness the test tree declares — the set CI's list has to cover. */
function declaredHarnesses() {
    const cmake = readFileSync(path.join(ROOT, 'tests', 'CMakeLists.txt'), 'utf8');
    return [...cmake.matchAll(/add_test\(NAME\s+(\w+)/g)].map((m) => m[1]);
}

/**
 * Harnesses compiled on purpose and never run — a link is the whole claim.
 * Anything else on disk with no `add_test` is a harness nobody schedules, which
 * is what both lists above are blind to: they compare two DECLARATIONS.
 */
const COMPILE_ONLY = new Set(['webgpu_bringup', 'webgpu_engine_bringup']);

/** Harness sources on disk, by the name their target would carry. */
function harnessSources() {
    const out = [];
    const walk = (dir) => {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) walk(p);
            else if (e.name.endsWith('.cpp')) out.push(e.name.replace(/\.cpp$/, ''));
        }
    };
    walk(path.join(ROOT, 'tests'));
    return out;
}

/**
 * Which cmake options each harness sits behind, from the test tree's own `if()`s.
 *
 * A target CI names but its configure never defines is not a skip — it is
 * `No rule to make target`, which fails the build. That is a question about two
 * files, so it is answered here rather than by a compiler that may be absent.
 */
function harnessConditions() {
    const cmake = readFileSync(path.join(ROOT, 'tests', 'CMakeLists.txt'), 'utf8').replace(/\r\n?/g, '\n');
    const conditions = new Map();
    const stack = [];
    for (const line of cmake.split('\n')) {
        const open = line.match(/^\s*if\s*\(\s*([A-Za-z0-9_]+)\s*\)/);
        if (open) { stack.push(open[1]); continue; }
        // Anything this gate cannot read as one plain option is pushed as null,
        // so the nesting stays balanced and the condition reads as "unknown".
        if (/^\s*if\s*\(/.test(line)) { stack.push(null); continue; }
        if (/^\s*endif\s*\(/.test(line)) { stack.pop(); continue; }
        const test = line.match(/add_test\(NAME\s+(\w+)/);
        if (test) conditions.set(test[1], stack.filter(Boolean));
    }
    return conditions;
}

/** Every cmake line that configures the harnesses, and the options it turns on. */
function ciConfigures() {
    const workflow = readFileSync(path.join(ROOT, '.github', 'workflows', 'build.yml'), 'utf8')
        .replace(/\r\n?/g, '\n')
        .replace(/\\\n\s*/g, ' '); // a continued cmake line is one command
    return workflow.split('\n')
        .filter((l) => /\bcmake\b/.test(l) && /-DES_BUILD_TESTS=ON/.test(l))
        .map((l) => {
            const on = new Set([...l.matchAll(/-D([A-Za-z0-9_]+)=ON/g)].map((m) => m[1]));
            // What `emcmake` is for: it hands cmake the toolchain that defines
            // EMSCRIPTEN, which the test tree gates its GPU harnesses on.
            if (/\bemcmake\b/.test(l)) on.add('EMSCRIPTEN');
            return { line: l.trim(), on };
        });
}

/** Targets that link the engine library, which does not build off emscripten. */
function enginelinked() {
    const cmake = readFileSync(path.join(ROOT, 'tests', 'CMakeLists.txt'), 'utf8');
    return new Set([...cmake.matchAll(/target_link_libraries\((\w+)\s+PRIVATE\s+esengine\)/g)].map((m) => m[1]));
}

const targets = harnessTargets();

// The other direction: a harness the test tree declares and CI's list omits is
// built by nobody and run by nobody — the failure that list exists to end,
// from the side it never looks at. No compiler needed, so this half always runs.
// A source with no add_test is invisible to both lists — that is how
// test_bitmap_font sat unbuilt for as long as it did.
const declared = declaredHarnesses();
const unscheduled = harnessSources()
    .filter((n) => !declared.includes(n) && !COMPILE_ONLY.has(n))
    // `add_executable(test_ecs ecs/test_registry.cpp)`: a target may be named
    // for what it covers rather than for its file.
    .filter((n) => !readFileSync(path.join(ROOT, 'tests', 'CMakeLists.txt'), 'utf8').includes(`${n}.cpp`));
if (unscheduled.length) {
    console.error(`check-cpp-tests: ${unscheduled.join(', ')} — harness source(s) tests/CMakeLists.txt`
        + ' never builds, so nothing runs them and neither list can see it.');
    process.exit(1);
}

const uncovered = declared.filter((t) => !targets.includes(t));
if (uncovered.length) {
    console.error(`check-cpp-tests: tests/CMakeLists.txt declares ${uncovered.join(', ')},`
        + " which build.yml's CPP_TESTS does not name — CI builds and runs neither.");
    process.exit(1);
}

// Every harness CI names has to EXIST under the flags CI configures with. No
// compiler needed, and it is the half that was missing: this gate read the same
// absence locally as "not configured here" and passed it.
const conditions = harnessConditions();
const configures = ciConfigures();
if (!configures.length) {
    console.error('check-cpp-tests: build.yml no longer configures the harnesses — this gate reads those lines');
    process.exit(1);
}
for (const { line, on } of configures) {
    for (const target of targets) {
        const missing = (conditions.get(target) ?? []).filter((opt) => !on.has(opt));
        if (!missing.length) continue;
        console.error(`check-cpp-tests: CI builds "${target}", which tests/CMakeLists.txt declares behind`
            + ` ${missing.join(' + ')} — a configure without it has no such target and the build fails.`
            + `\n  the configure: ${line}`);
        process.exit(1);
    }
}

const has = (cmd) => spawnSync(cmd, ['--version'], { stdio: 'ignore' }).status === 0;
if (!has('cmake')) {
    console.log('check-cpp-tests: no cmake on this machine — skipped (CI still builds them).');
    process.exit(0);
}

const skip = enginelinked();
const buildable = targets.filter((t) => !skip.has(t));

mkdirSync(BUILD, { recursive: true });
try {
    // The options CI configures with, minus what no plain cmake can honour
    // (EMSCRIPTEN / ES_BUILD_WEB are the emscripten toolchain's, ES_SANITIZE a
    // build of its own). Absence under the rest is the platform's.
    const fromToolchain = new Set(['EMSCRIPTEN', 'ES_BUILD_WEB', 'ES_SANITIZE']);
    const options = [...new Set(configures.flatMap((c) => [...c.on]))]
        .filter((o) => !fromToolchain.has(o))
        .map((o) => `-D${o}=ON`);
    execFileSync('cmake', ['-S', ROOT, '-B', BUILD, ...options, '-DCMAKE_BUILD_TYPE=Release'],
        { stdio: 'pipe' });
} catch (err) {
    console.log(`check-cpp-tests: cmake could not configure here — skipped.\n${err.stderr ?? ''}`);
    process.exit(0);
}

/** Where a built harness landed — the layout differs by generator. */
function harnessBinary(target) {
    const candidates = [
        path.join(BUILD, 'bin', target),
        path.join(BUILD, 'bin', `${target}.exe`),
        path.join(BUILD, 'bin', 'Release', `${target}.exe`),
    ];
    return candidates.find((c) => existsSync(c)) ?? null;
}

const built = [];
const absent = [];
for (const target of buildable) {
    const run = spawnSync('cmake', ['--build', BUILD, '-j', '8', '--target', target], { encoding: 'utf8' });
    const out = `${run.stdout ?? ''}${run.stderr ?? ''}`;
    if (run.status === 0) {
        // Compiling is half the claim. A harness that builds and then fails its
        // assertions is a red CI job this gate would otherwise call green — which
        // is how two stale shader-variant assertions sat behind a broken build.
        const binary = harnessBinary(target);
        const ran = binary ? spawnSync(binary, [], { encoding: 'utf8' }) : null;
        if (ran && ran.status !== 0) {
            console.error(`check-cpp-tests: ${target} builds but does not pass.\n`);
            console.error(`${ran.stdout ?? ''}${ran.stderr ?? ''}`.split('\n')
                .filter((l) => /FAIL|error|assert/i.test(l)).slice(0, 12).join('\n'));
            console.error(`\nReproduce: ${path.relative(ROOT, binary)}`);
            process.exit(1);
        }
        built.push(target);
        continue;
    }
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

console.log(`check-cpp-tests: ${built.length} harness(es) build and pass`
    + `${absent.length ? `; ${absent.length} not configured here (${absent.join(', ')})` : ''}`
    + `; ${skip.size} link the engine and are CI's to judge (${[...skip].join(', ')}).`);
