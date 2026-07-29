// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  verify-native-boot.mjs — a packaged game starts, and draws.
 *
 * `verify-template` proves an archive carries its files. That is a weaker claim
 * than it sounds: v0.36.0's Android template carried a host that ran, and every
 * game made from it still opened on a black screen. Between "the zip is complete"
 * and "a player sees the game" sit the two failures nobody was checking — a
 * launch that dies, and a launch that survives showing nothing.
 *
 * So the app is installed on a simulator, started, and asked two questions:
 *
 *   1. did the boot record reach `ready in` — the line the host writes only once
 *      the first frame is up, so its absence is where the launch stopped;
 *   2. is the frame more than one flat color — because a launch that reports
 *      ready and clears to black is exactly the bug that shipped.
 *
 * The record is read from the FILE rather than the platform log on purpose:
 * `bootPhase`/`bootReady` write to the file only (BootLog.cpp), so grepping
 * logcat for "ready" finds nothing and calls a dead app healthy.
 *
 *   node tools/verify-native-boot.mjs --platform android --apk <file>
 *   node tools/verify-native-boot.mjs --platform ios --app <bundle.app>
 *
 * Absent a device this FAILS rather than skipping, because its whole reason to
 * exist is to be a gate. `--allow-skip` is for running it on a machine that may
 * not have a simulator, and says so in the output when it takes that door.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, distinctColors } from '../build-tools/utils/png.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP_ID = 'com.estella.game';
const LOG_NAME = 'estella-boot.log';
const READY = 'ready in';

function parseArgs(argv) {
    const opts = { platform: 'android', timeout: 120, minColors: 8, out: path.join(ROOT, 'build', 'native-boot') };
    for (let i = 0; i < argv.length; i++) {
        const key = argv[i].replace(/^--/, '');
        if (key === 'allow-skip') { opts.allowSkip = true; continue; }
        opts[key.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = argv[++i];
    }
    opts.timeout = Number(opts.timeout);
    opts.minColors = Number(opts.minColors);
    return opts;
}

const sh = (cmd, args, o = {}) => execFileSync(cmd, args, { encoding: 'utf8', ...o });
const trySh = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8' });
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

// =============================================================================
// Android — adb against whatever emulator or phone is attached
// =============================================================================

function androidDriver(opts) {
    const adb = process.env.ANDROID_HOME
        ? path.join(process.env.ANDROID_HOME, 'platform-tools', 'adb') : 'adb';
    const shell = (...a) => sh(adb, ['shell', ...a]);
    const logFile = `/sdcard/Android/data/${APP_ID}/files/${LOG_NAME}`;

    return {
        name: 'android',
        available() {
            const probe = trySh(adb, ['devices']);
            if (probe.status !== 0) return null;
            const devices = probe.stdout.split('\n').slice(1)
                .filter((l) => /\tdevice$/.test(l.trim()));
            return devices.length ? devices[0].split('\t')[0] : null;
        },
        install(apk) {
            trySh(adb, ['uninstall', APP_ID]);
            sh(adb, ['install', '-r', '-t', apk], { stdio: 'inherit' });
            // A record left by an earlier run would answer for this one.
            trySh(adb, ['shell', 'rm', '-f', logFile]);
            trySh(adb, ['logcat', '-c']);
        },
        launch() {
            sh(adb, ['shell', 'am', 'start', '-W', '-n', `${APP_ID}/android.app.NativeActivity`],
                { stdio: 'inherit' });
        },
        readLog() {
            const got = trySh(adb, ['shell', 'cat', logFile]);
            return got.status === 0 ? got.stdout : '';
        },
        screenshot() {
            return execFileSync(adb, ['exec-out', 'screencap', '-p'], { maxBuffer: 64 * 1024 * 1024 });
        },
        diagnostics() {
            return [
                ['logcat (EstellaSDK)', trySh(adb, ['logcat', '-d', '-s', 'EstellaSDK:*']).stdout],
                ['logcat (crashes)', trySh(adb, ['logcat', '-d', '-b', 'crash']).stdout],
            ];
        },
    };
}

// =============================================================================
// iOS — simctl against a booted simulator
// =============================================================================

function iosDriver(opts) {
    let udid = null;
    const simctl = (...a) => sh('xcrun', ['simctl', ...a]);

    return {
        name: 'ios',
        available() {
            if (process.platform !== 'darwin') return null;
            const probe = trySh('xcrun', ['simctl', 'list', 'devices', 'available', '--json']);
            if (probe.status !== 0) return null;
            const all = Object.values(JSON.parse(probe.stdout).devices).flat();
            const want = opts.device
                ? all.find((d) => d.name === opts.device)
                : all.find((d) => d.state === 'Booted' && /iPhone/.test(d.name))
                    ?? all.find((d) => /iPhone/.test(d.name));
            if (!want) return null;
            udid = want.udid;
            if (want.state !== 'Booted') {
                simctl('boot', udid);
                sh('xcrun', ['simctl', 'bootstatus', udid, '-b']);
            }
            return `${want.name} (${udid})`;
        },
        install(app) {
            trySh('xcrun', ['simctl', 'terminate', udid, APP_ID]);
            trySh('xcrun', ['simctl', 'uninstall', udid, APP_ID]);
            simctl('install', udid, app);
        },
        launch() {
            simctl('launch', udid, APP_ID);
        },
        readLog() {
            const container = trySh('xcrun', ['simctl', 'get_app_container', udid, APP_ID, 'data']);
            if (container.status !== 0) return '';
            const file = path.join(container.stdout.trim(), 'Documents', LOG_NAME);
            if (!existsSync(file)) return '';
            return sh('cat', [file]);
        },
        screenshot() {
            const shot = path.join(opts.out, 'raw.png');
            simctl('io', udid, 'screenshot', shot);
            return sh('cat', [shot], { encoding: 'buffer' });
        },
        diagnostics() {
            const crash = trySh('xcrun', ['simctl', 'spawn', udid, 'log', 'show',
                '--last', '3m', '--predicate', 'senderImagePath CONTAINS "Estella"']);
            return [['simulator log', crash.stdout]];
        },
    };
}

// =============================================================================

const opts = parseArgs(process.argv.slice(2));
const driver = opts.platform === 'ios' ? iosDriver(opts) : androidDriver(opts);
const artifact = opts.platform === 'ios' ? opts.app : opts.apk;

if (!artifact || !existsSync(artifact)) {
    console.error(`✗ no ${opts.platform} app to verify (pass --${opts.platform === 'ios' ? 'app' : 'apk'} <path>)`);
    process.exit(2);
}
mkdirSync(opts.out, { recursive: true });

const device = driver.available();
if (!device) {
    const what = `no ${driver.name} device or simulator is available`;
    if (opts.allowSkip) {
        console.log(`— skipped: ${what} (nothing was checked)`);
        process.exit(0);
    }
    console.error(`✗ ${what}. This check is a gate; pass --allow-skip to run it where one may be absent.`);
    process.exit(1);
}

console.log(`device: ${device}`);
console.log(`app:    ${artifact}`);
driver.install(artifact);
driver.launch();

let log = '';
const deadline = Date.now() + opts.timeout * 1000;
while (Date.now() < deadline) {
    log = driver.readLog();
    if (log.includes(READY)) break;
    await sleep(2000);
}

const frame = driver.screenshot();
const shotPath = path.join(opts.out, `${driver.name}-frame.png`);
writeFileSync(shotPath, frame);
writeFileSync(path.join(opts.out, `${driver.name}-boot.log`), log);

const image = decodePng(frame);
const colors = distinctColors(image);
const ready = log.includes(READY);
const drew = colors >= opts.minColors;

console.log(`\nboot record: ${ready ? log.trim().split('\n').filter((l) => l.includes(READY))[0] : 'never reached "ready in"'}`);
console.log(`frame:       ${image.width}x${image.height}, ${colors} distinct colors (need ${opts.minColors})`);
console.log(`written:     ${shotPath}`);

if (ready && drew) {
    console.log(`\n✓ ${driver.name}: the packaged game started and drew a frame`);
    process.exit(0);
}

console.error(`\n✗ ${driver.name}: ${!ready ? 'the launch never reported ready' : 'the launch reported ready but the frame is blank'}`);
console.error('\n--- boot record ---');
console.error(log.trim() || '(empty — the app wrote no record at all)');
for (const [title, text] of driver.diagnostics()) {
    if (!text?.trim()) continue;
    console.error(`\n--- ${title} ---`);
    console.error(text.trim().split('\n').slice(-60).join('\n'));
}
process.exit(1);
