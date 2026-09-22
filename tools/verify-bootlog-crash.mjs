// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The boot record survives a crash, watched doing it on a device.
 *
 * Builds the real BootLog.cpp with the NDK for the ABI the device reports,
 * pushes it, faults on purpose, and reads the file back. Skips (not passes)
 * without a device or an NDK: `node tools/verify-bootlog-crash.mjs`.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'build', 'bootlog-crash');
const DEVICE_DIR = '/data/local/tmp/estella-bootlog';

function sdkRoot() {
    return process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT
        || path.join(process.env.LOCALAPPDATA || process.env.HOME || '', 'Android', 'Sdk');
}

function adbPath() {
    const exe = process.platform === 'win32' ? 'adb.exe' : 'adb';
    const inSdk = path.join(sdkRoot(), 'platform-tools', exe);
    return existsSync(inSdk) ? inSdk : exe;
}

/** The NDK driver for what the DEVICE runs. An x86_64 emulator — the only
 *  Android most machines can offer — cannot execute an arm64 binary, and would
 *  fail for a reason that has nothing to do with the handler. */
const NDK_TRIPLE = {
    'arm64-v8a': 'aarch64-linux-android',
    'armeabi-v7a': 'armv7a-linux-androideabi',
    x86_64: 'x86_64-linux-android',
    x86: 'i686-linux-android',
};

function deviceAbi(adb) {
    try {
        return execFileSync(adb, ['shell', 'getprop', 'ro.product.cpu.abi'], { encoding: 'utf8' }).trim();
    } catch {
        return '';
    }
}

function ndkClang(abi) {
    const triple = NDK_TRIPLE[abi];
    if (!triple) return null;
    const ndkRoot = process.env.ANDROID_NDK_HOME
        || (() => {
            const dir = path.join(sdkRoot(), 'ndk');
            if (!existsSync(dir)) return null;
            const versions = readdirSync(dir).sort();
            return versions.length ? path.join(dir, versions[versions.length - 1]) : null;
        })();
    if (!ndkRoot) return null;
    const host = process.platform === 'win32' ? 'windows-x86_64'
        : process.platform === 'darwin' ? 'darwin-x86_64' : 'linux-x86_64';
    const exe = process.platform === 'win32' ? '.cmd' : '';
    const clang = path.join(ndkRoot, 'toolchains', 'llvm', 'prebuilt', host, 'bin', `${triple}33-clang++${exe}`);
    return existsSync(clang) ? clang : null;
}

function device(adb) {
    try {
        const out = execFileSync(adb, ['devices'], { encoding: 'utf8' });
        return out.split('\n').slice(1).some((l) => /\tdevice\s*$/.test(l.trim() + '  ') || /\tdevice/.test(l));
    } catch {
        return false;
    }
}

// Skipping is right on a laptop with no phone and wrong when a release is being
// cut against this, so the caller says which it is. Exit 0 either way would make
// "there was no device" indistinguishable from "the record survived the crash".
const REQUIRE_DEVICE = process.argv.includes('--require-device');
function unavailable(why) {
    if (REQUIRE_DEVICE) {
        // 2, not 1: a release is short either way, but no phone here is not a
        // finding about the boot record, and the two want different people.
        console.error(`verify-bootlog-crash: CANNOT RUN — ${why}. This was asked for with`
            + ' --require-device, so it is not a pass.');
        process.exit(2);
    }
    // caller-asked-to-skip: right on a laptop; the criterion passes
    // --require-device precisely so it never reaches here.
    console.log(`verify-bootlog-crash: SKIP — ${why}`);
    process.exit(0);
}

const adb = adbPath();
if (!device(adb)) unavailable('no adb device attached');
const abi = deviceAbi(adb);
const clang = ndkClang(abi);
if (!clang) unavailable(abi ? `no Android NDK for ${abi}` : 'no Android NDK found');

mkdirSync(OUT, { recursive: true });
const bin = path.join(OUT, 'bootlog_crash_test');
console.log(`building the record + handler for ${abi}…`);
// `shell: true` because the NDK's Windows driver is a .cmd, which node refuses
// to spawn directly (EINVAL) — the same reason every Windows toolchain wrapper
// has to be invoked through a shell.
execFileSync(clang, [
    '-std=c++17', '-O1', '-g0', '-static-libstdc++',
    '-o', bin,
    path.join(ROOT, 'native', 'tools', 'bootlog_crash_test.cpp'),
    path.join(ROOT, 'native', 'host', 'BootLog.cpp'),
], { stdio: 'inherit', shell: process.platform === 'win32' });

const sh = (cmd) => execFileSync(adb, ['shell', cmd], { encoding: 'utf8' });
sh(`rm -rf ${DEVICE_DIR}; mkdir -p ${DEVICE_DIR}`);
execFileSync(adb, ['push', bin, `${DEVICE_DIR}/t`], { stdio: 'ignore' });
sh(`chmod 755 ${DEVICE_DIR}/t`);

console.log('crashing it on the device…');
let exitLine = '';
try {
    exitLine = sh(`${DEVICE_DIR}/t ${DEVICE_DIR}; echo EXIT=$?`);
} catch (err) {
    exitLine = String(err.stdout ?? '');
}
const record = sh(`cat ${DEVICE_DIR}/estella-boot.log`);

// The launch AFTER the crash: the record of the death has moved aside, and its
// copy should now be somewhere a player could reach.
console.log('opening it again, the way a player would…');
let second = '';
try {
    second = sh(`${DEVICE_DIR}/t ${DEVICE_DIR} --no-crash`);
} catch (err) {
    second = String(err.stdout ?? '');
}
const publishedTo = (/PUBLISHED=(\S+)/.exec(second) ?? [])[1] ?? '';
const publishedText = publishedTo ? sh(`cat ${publishedTo}`) : '';

console.log('\n--- the file a player would send ---');
console.log(record.trimEnd());
console.log('------------------------------------\n');

console.log(`the crash record was published to: ${publishedTo || '(nowhere)'}`);

const problems = [];
if (!/FATAL SIGSEGV/.test(record)) problems.push('no FATAL SIGSEGV line');
if (!publishedTo) problems.push('the crash record was not published anywhere a player could reach');
if (publishedTo && !/FATAL SIGSEGV/.test(publishedText)) {
    problems.push('the published copy does not carry the crash');
}
if (!/during phase: js runtime/.test(record)) problems.push('the phase it died in was not recorded');
if (!/backtrace/.test(record)) problems.push('no backtrace');
if (!/libc|bootlog_crash_test|\+0x/.test(record)) problems.push('no resolved frames in the backtrace');
if (/EXIT=0\b/.test(exitLine)) problems.push('the process did not die — the handler swallowed the signal');

sh(`rm -rf ${DEVICE_DIR}`);

if (problems.length) {
    console.error('verify-bootlog-crash: FAIL');
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
}
console.log('verify-bootlog-crash: PASS — the crash reached the file, with the phase and a backtrace');
