#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// Build the zip Device Farm unpacks onto its test host.
//
//   node tools/devicefarm/pack-test-bundle.mjs [out.zip]
//
// The bundle is small on purpose: the verifier and what it imports, nothing
// else. It is NOT the repository — a device farm run should carry the thing that
// decides "did it boot", not a checkout, or the next person to add a dependency
// somewhere unrelated breaks a run they cannot see.
//
// It is uploaded as an APPIUM_NODE package, which is Device Farm's vocabulary for
// "a Node test bundle" rather than a claim that Appium is involved: the test spec
// replaces every command, and no Appium server is started. That type validates
// the presence of `node_modules`, so one is written even though the verifier has
// no dependencies — an empty directory does not survive a zip.
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, copyFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.resolve(process.argv[2] ?? path.join(ROOT, 'build/devicefarm/tests.zip'));
const STAGE = path.join(ROOT, 'build/devicefarm/bundle');

/** What the test spec invokes, plus anything it reaches. Kept explicit: a glob
 *  would quietly start shipping whatever lands in tools/ next. */
const FILES = ['tools/verify-native-boot.mjs'];

rmSync(STAGE, { recursive: true, force: true });
mkdirSync(path.join(STAGE, 'tools'), { recursive: true });

for (const rel of FILES) {
    const src = path.join(ROOT, rel);
    if (!existsSync(src)) {
        console.error(`::error::${rel} is missing — the bundle would ship without the verifier`);
        process.exit(1);
    }
    copyFileSync(src, path.join(STAGE, rel));
}

// The type's package validation wants these; the run does not.
writeFileSync(path.join(STAGE, 'package.json'), `${JSON.stringify({
    name: 'estella-devicefarm-bundle',
    version: '0.0.0',
    private: true,
    description: 'Drives tools/verify-native-boot.mjs against a Device Farm device. See tools/devicefarm/testspec.yml.',
}, null, 2)}\n`);
mkdirSync(path.join(STAGE, 'node_modules'), { recursive: true });
writeFileSync(path.join(STAGE, 'node_modules', '.keep'), 'The verifier has no dependencies; this exists so the directory survives the zip.\n');

mkdirSync(path.dirname(OUT), { recursive: true });
rmSync(OUT, { force: true });

// Zipped from INSIDE the stage, so the archive has no wrapper directory — the
// test spec cd's to $DEVICEFARM_TEST_PACKAGE_PATH and runs `node tools/...`
// from there.
//
// `zip` on the runner, PowerShell where there is none: this is meant to be
// runnable by hand while working out a test spec, and on the machine most of
// that happens on there is no `zip`.
function archive() {
    try {
        execFileSync('zip', ['-r', '-q', OUT, '.'], { cwd: STAGE, stdio: 'inherit' });
        return 'zip';
    } catch (err) {
        if (err?.code !== 'ENOENT') throw err;
    }
    execFileSync('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command',
        `Compress-Archive -Path '${STAGE.replace(/'/g, "''")}\\*' -DestinationPath '${OUT.replace(/'/g, "''")}' -Force`,
    ], { stdio: 'inherit' });
    return 'Compress-Archive';
}
const tool = archive();

// Compress-Archive writes Windows separators into the entry names, which Linux
// unzips into one flat directory of files literally called `tools\verify-...`.
// Fine for looking at what went in; not fine for a run. The bundle a device farm
// consumes is built on the runner, where `zip` exists.
if (tool !== 'zip') {
    console.warn('warning: built with Compress-Archive — entry paths use backslashes, so this archive is for LOCAL inspection only');
}

console.log(`${path.relative(ROOT, OUT)} — ${(statSync(OUT).size / 1024).toFixed(1)} KB (via ${tool})`);
