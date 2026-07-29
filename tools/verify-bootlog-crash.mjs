// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// Prove the boot record survives a crash, on a device.
//
// The record exists so that a game that dies on someone else's phone leaves
// something they can send. That claim is only worth making if the handler has
// been watched doing it: this builds the real BootLog.cpp for arm64 with the
// NDK, pushes it, faults on purpose, and reads the file back.
//
//   node tools/verify-bootlog-crash.mjs           (needs an adb device + NDK)
//
// Skips with a message when there is no device or no NDK, so it can be run
// anywhere without pretending to have checked something it did not.

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

function ndkClang() {
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
    const clang = path.join(ndkRoot, 'toolchains', 'llvm', 'prebuilt', host, 'bin', `aarch64-linux-android33-clang++${exe}`);
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

const adb = adbPath();
const clang = ndkClang();
if (!clang) {
    console.log('verify-bootlog-crash: SKIP — no Android NDK found');
    process.exit(0);
}
if (!device(adb)) {
    console.log('verify-bootlog-crash: SKIP — no adb device attached');
    process.exit(0);
}

mkdirSync(OUT, { recursive: true });
const bin = path.join(OUT, 'bootlog_crash_test');
console.log('building the record + handler for arm64…');
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
