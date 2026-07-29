// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  verify-native-boot.mjs — packaged games start, and draw.
 *
 * `verify-template` proves an archive carries its files. That is a weaker claim
 * than it sounds: v0.36.0's Android template carried a host that ran, and every
 * game made from it still opened on a black screen. Between "the zip is complete"
 * and "a player sees the game" sit the two failures nobody was checking — a
 * launch that dies, and a launch that survives showing nothing.
 *
 * So an app is installed on a simulator, started, and asked two questions:
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
 *   node tools/verify-native-boot.mjs --platform ios --app <bundle.app>
 *   node tools/verify-native-boot.mjs --platform android --examples all
 *   node tools/verify-native-boot.mjs --platform android --examples all --shard 1/3
 *
 * `--examples` packages each project the way the editor's Package dialog does and
 * runs the same two questions against every one, on ONE booted device: booting is
 * minutes and each app is seconds, so a device per example would spend the whole
 * budget on emulators. Shard across jobs instead.
 *
 * Absent a device this FAILS rather than skipping, because its whole reason to
 * exist is to be a gate. `--allow-skip` is for running it on a machine that may
 * not have a simulator, and says so in the output when it takes that door.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, distinctColors } from '../build-tools/utils/png.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP_ID = 'com.estella.game';
const LOG_NAME = 'estella-boot.log';
const READY = 'ready in';

/**
 * Examples that do not start or draw on a device yet, and why.
 *
 * An entry that PASSES fails this check too. A list nothing reconciles is where
 * work goes to be forgotten: the point of naming a break is to notice when it is
 * fixed, not to make the run green forever.
 */
const KNOWN_FAILURES = {};

function parseArgs(argv) {
    const opts = {
        platform: 'android', timeout: 120, settle: 3,
        // Two, not a threshold that sounds more rigorous. A 2D scene of flat
        // sprites is legitimately four colors, and "8" red-flagged camera-follow
        // for rendering exactly what it is supposed to render. The claim this can
        // honestly make is "not a uniform clear"; anything finer needs a baseline
        // to compare against, not a bigger number.
        minColors: 2,
        out: path.join(ROOT, 'build', 'native-boot'),
        template: path.join(ROOT, 'template'),
    };
    for (let i = 0; i < argv.length; i++) {
        const key = argv[i].replace(/^--/, '');
        if (key === 'allow-skip') { opts.allowSkip = true; continue; }
        opts[key.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = argv[++i];
    }
    opts.timeout = Number(opts.timeout);
    opts.minColors = Number(opts.minColors);
    opts.settle = Number(opts.settle);
    return opts;
}

const sh = (cmd, args, o = {}) => execFileSync(cmd, args, { encoding: 'utf8', ...o });
const trySh = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8' });
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

/**
 * Run a build step quietly, but keep its output for the failure.
 *
 * execFileSync's message is the command line, which is exactly what a reader of
 * a failed build already knows. What they need is the compiler's last words.
 */
function quietly(what, cmd, args) {
    const got = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (got.status === 0) return got.stdout ?? '';
    const said = `${got.stdout ?? ''}\n${got.stderr ?? ''}`.trim().split('\n')
        .filter((l) => /error|Error|fatal|FAILED/.test(l)).slice(-6).join('\n  ');
    throw new Error(`${what} failed${said ? `:\n  ${said}` : ` (exit ${got.status})`}`);
}

// =============================================================================
// Android — adb against whatever emulator or phone is attached
// =============================================================================

function androidDriver(opts) {
    const adb = process.env.ANDROID_HOME
        ? path.join(process.env.ANDROID_HOME, 'platform-tools', 'adb') : 'adb';
    const logFile = `/sdcard/Android/data/${APP_ID}/files/${LOG_NAME}`;

    return {
        name: 'android',
        artifactFlag: 'apk',
        available() {
            const probe = trySh(adb, ['devices']);
            if (probe.status !== 0) return null;
            const devices = probe.stdout.split('\n').slice(1)
                .filter((l) => /\tdevice$/.test(l.trim()));
            if (!devices.length) return null;
            const serial = devices[0].split('\t')[0];
            const model = trySh(adb, ['shell', 'getprop', 'ro.product.model']).stdout.trim();
            const release = trySh(adb, ['shell', 'getprop', 'ro.build.version.release']).stdout.trim();
            const size = trySh(adb, ['shell', 'wm', 'size']).stdout.trim().replace(/^.*:\s*/, '');
            return `${serial} — ${model}, Android ${release}, ${size}`;
        },
        install(apk) {
            trySh(adb, ['uninstall', APP_ID]);
            sh(adb, ['install', '-r', '-t', apk]);
            // A record left by an earlier app would answer for this one.
            trySh(adb, ['shell', 'rm', '-f', logFile]);
            trySh(adb, ['logcat', '-c']);
        },
        launch() {
            sh(adb, ['shell', 'am', 'start', '-W', '-n', `${APP_ID}/android.app.NativeActivity`]);
        },
        stop() {
            trySh(adb, ['shell', 'am', 'force-stop', APP_ID]);
        },
        // Counting colors on a SCREEN, not on the game: an emulator that pops
        // "Pixel Launcher isn't responding" over a black app hands the check a
        // dialog full of colors and it calls that a rendered frame.
        foreground() {
            const out = trySh(adb, ['shell', 'dumpsys', 'activity', 'activities']).stdout ?? '';
            const line = out.split('\n').find((l) => /ResumedActivity/.test(l));
            if (line) return line.includes(APP_ID) ? null : `on screen instead: ${line.trim().slice(0, 100)}`;
            return trySh(adb, ['shell', 'pidof', APP_ID]).stdout.trim() ? null : 'the app process is gone';
        },
        clearScreen() {
            trySh(adb, ['shell', 'am', 'broadcast', '-a', 'android.intent.action.CLOSE_SYSTEM_DIALOGS']);
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
        /** Package an exported project into an installable app. */
        build(exported) {
            if (!exported.apkFile) throw new Error('the export wrote no APK');
            return exported.apkFile;
        },
    };
}

// =============================================================================
// iOS — simctl against a booted simulator
// =============================================================================

function iosDriver(opts) {
    let udid = null;
    const simctl = (...a) => sh('xcrun', ['simctl', ...a]);
    const derived = path.join(ROOT, 'build', 'smoke-derived');

    return {
        name: 'ios',
        artifactFlag: 'app',
        available() {
            if (process.platform !== 'darwin') return null;
            const probe = trySh('xcrun', ['simctl', 'list', 'devices', 'available', '--json']);
            if (probe.status !== 0) return null;
            const all = Object.values(JSON.parse(probe.stdout).devices).flat();
            // A named device that is not there is a configuration error, not an
            // absent simulator: fail saying what this runner actually has, rather
            // than quietly testing a different phone than the one asked for.
            if (opts.device) {
                const want = all.find((d) => d.name === opts.device);
                if (!want) {
                    throw new Error(`no simulator named "${opts.device}". This runner has:\n  `
                        + all.map((d) => d.name).join('\n  '));
                }
                udid = want.udid;
                if (want.state !== 'Booted') {
                    simctl('boot', udid);
                    sh('xcrun', ['simctl', 'bootstatus', udid, '-b']);
                }
                return `${want.name} (${udid})`;
            }
            const any = all.find((d) => d.state === 'Booted' && /iPhone/.test(d.name))
                ?? all.find((d) => /iPhone/.test(d.name));
            if (!any) return null;
            udid = any.udid;
            if (any.state !== 'Booted') {
                simctl('boot', udid);
                sh('xcrun', ['simctl', 'bootstatus', udid, '-b']);
            }
            return `${any.name} (${udid}) — not pinned, whatever this runner listed first`;
        },
        install(app) {
            trySh('xcrun', ['simctl', 'terminate', udid, APP_ID]);
            trySh('xcrun', ['simctl', 'uninstall', udid, APP_ID]);
            simctl('install', udid, app);
        },
        launch() {
            simctl('launch', udid, APP_ID);
        },
        stop() {
            trySh('xcrun', ['simctl', 'terminate', udid, APP_ID]);
        },
        foreground() {
            const out = trySh('xcrun', ['simctl', 'spawn', udid, 'launchctl', 'list']);
            // Only answer when the probe itself worked — a failed probe is not
            // evidence that the app died.
            if (out.status !== 0) return null;
            return out.stdout.includes(APP_ID) ? null : 'the app is no longer running';
        },
        clearScreen() {},
        readLog() {
            const container = trySh('xcrun', ['simctl', 'get_app_container', udid, APP_ID, 'data']);
            if (container.status !== 0) return '';
            const file = path.join(container.stdout.trim(), 'Documents', LOG_NAME);
            return existsSync(file) ? sh('cat', [file]) : '';
        },
        screenshot() {
            const shot = path.join(opts.out, 'raw.png');
            simctl('io', udid, 'screenshot', shot);
            return sh('cat', [shot], { encoding: 'buffer' });
        },
        diagnostics() {
            const log = trySh('xcrun', ['simctl', 'spawn', udid, 'log', 'show',
                '--last', '3m', '--predicate', 'senderImagePath CONTAINS "Estella"']);
            return [['simulator log', log.stdout]];
        },
        build(exported) {
            if (!exported.xcodeProject) throw new Error('the export wrote no Xcode project');
            const scheme = path.basename(exported.xcodeProject, '.xcodeproj');
            quietly('xcodebuild', 'xcodebuild', [
                '-project', exported.xcodeProject, '-scheme', scheme, '-configuration', 'Release',
                '-sdk', 'iphonesimulator', '-destination', 'generic/platform=iOS Simulator',
                '-derivedDataPath', derived, 'CODE_SIGNING_ALLOWED=NO', 'build',
            ]);
            const app = path.join(derived, 'Build', 'Products', 'Release-iphonesimulator', `${scheme}.app`);
            if (!existsSync(app)) throw new Error(`xcodebuild produced no ${scheme}.app`);
            return app;
        },
    };
}

// =============================================================================
// The two questions, asked of one installed app
// =============================================================================

async function verifyApp(driver, artifact, label, opts) {
    driver.install(artifact);

    let log = '';
    let offScreen = null;
    // One retry, because a system dialog stealing focus is the emulator having a
    // bad minute, not the game being broken — and a gate that reds on that gets
    // ignored within a week.
    for (let attempt = 0; attempt < 2; attempt++) {
        driver.launch();
        const deadline = Date.now() + opts.timeout * 1000;
        while (Date.now() < deadline) {
            log = driver.readLog();
            if (log.includes(READY)) break;
            await sleep(2000);
        }
        // `ready` is the first frame submitted; presenting it is not instant.
        await sleep(opts.settle * 1000);
        offScreen = driver.foreground();
        if (!offScreen) break;
        driver.clearScreen();
        driver.stop();
    }

    const frame = driver.screenshot();
    const shot = path.join(opts.out, `${driver.name}-${label}.png`);
    writeFileSync(shot, frame);
    writeFileSync(path.join(opts.out, `${driver.name}-${label}.log`), log);
    driver.stop();

    const image = decodePng(frame);
    const colors = distinctColors(image);
    const ready = log.includes(READY);
    const readyLine = log.split('\n').find((l) => l.includes(READY))?.trim() ?? '';
    // The record already carries structured errors, and they say far more than a
    // pixel count can: drawing-demo drew a black screen because a resize sent
    // es_onNativeVisibility into infinite recursion, and the record said so.
    const errors = log.split('\n').filter((l) => l.startsWith('ERROR ['));

    const why = !ready ? 'never reported ready'
        : offScreen ? `the game was not on screen — ${offScreen}`
            : errors.length ? errors[0].trim()
                : colors < opts.minColors ? `the frame is ${colors} flat color` : '';

    return {
        ok: !why, ready, colors, readyLine, errors, offScreen,
        size: `${image.width}x${image.height}`, log, shot, why,
    };
}

// =============================================================================
// Packaging an example the way the Package dialog does
// =============================================================================

function listExamples(opts) {
    const dir = path.join(ROOT, 'examples');
    const all = opts.only
        ? opts.only.split(',').map((s) => s.trim()).filter(Boolean)
        : readdirSync(dir, { withFileTypes: true })
            .filter((e) => e.isDirectory() && existsSync(path.join(dir, e.name, 'project.esproject')))
            .map((e) => e.name)
            .sort();
    // Sharding applies to a named set too — the matrix runs every shard, so a
    // list that ignored it would be packaged three times over.
    if (!opts.shard) return all;
    const [index, total] = opts.shard.split('/').map(Number);
    return all.filter((_, i) => i % total === index);
}

function packageExample(driver, name, opts) {
    const work = path.join(ROOT, 'build', 'smoke-work', name);
    const report = path.join(work, 'export.json');
    rmSync(work, { recursive: true, force: true });
    mkdirSync(work, { recursive: true });
    quietly('export', process.execPath, [
        path.join(ROOT, 'desktop', 'scripts', 'export-project.mjs'),
        path.join(ROOT, 'examples', name),
        '--platform', driver.name,
        '--template', opts.template,
        '--out', path.join(work, 'dist'),
        '--json', report,
    ]);
    if (!existsSync(report)) throw new Error('the export wrote no result');
    const exported = JSON.parse(sh('cat', [report]));
    if (!exported.ok) throw new Error(`export failed: ${(exported.errors ?? []).join('; ') || 'no reason given'}`);
    return { app: driver.build(exported), work };
}

// =============================================================================

const opts = parseArgs(process.argv.slice(2));
const driver = opts.platform === 'ios' ? iosDriver(opts) : androidDriver(opts);
mkdirSync(opts.out, { recursive: true });

let device;
try {
    device = driver.available();
} catch (err) {
    console.error(`✗ ${err.message}`);
    process.exit(1);
}
if (!device) {
    const what = `no ${driver.name} device or simulator is available`;
    if (opts.allowSkip) {
        console.log(`— skipped: ${what} (nothing was checked)`);
        process.exit(0);
    }
    console.error(`✗ ${what}. This check is a gate; pass --allow-skip to run it where one may be absent.`);
    process.exit(1);
}
console.log(`device: ${device}\n`);

const summary = [];
// Printed as well as filed: the emulator writes its own Vulkan chatter to this
// same stream, so a table that existed only in the job summary left the log
// unreadable exactly when someone was reading it to find out what broke.
const note = (line) => {
    summary.push(line);
    console.log(line);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`);
};

// --- one prebuilt app -------------------------------------------------------

if (!opts.examples) {
    const artifact = opts[driver.artifactFlag];
    if (!artifact || !existsSync(artifact)) {
        console.error(`✗ no ${driver.name} app to verify (pass --${driver.artifactFlag} <path>)`);
        process.exit(2);
    }
    const r = await verifyApp(driver, artifact, 'app', opts);
    console.log(`boot record: ${r.ready ? r.readyLine : 'never reached "ready in"'}`);
    console.log(`frame:       ${r.size}, ${r.colors} distinct colors (need ${opts.minColors})`);
    console.log(`written:     ${r.shot}`);
    if (r.ok) {
        console.log(`\n✓ ${driver.name}: the packaged game started and drew a frame`);
        process.exit(0);
    }
    console.error(`\n✗ ${driver.name}: ${r.why}`);
    console.error('\n--- boot record ---');
    console.error(r.log.trim() || '(empty — the app wrote no record at all)');
    for (const [title, text] of driver.diagnostics()) {
        if (!text?.trim()) continue;
        console.error(`\n--- ${title} ---`);
        console.error(text.trim().split('\n').slice(-60).join('\n'));
    }
    process.exit(1);
}

// --- every example ----------------------------------------------------------

const examples = listExamples(opts);
if (!examples.length) {
    console.error('✗ no examples selected');
    process.exit(2);
}
console.log(`${examples.length} example(s)${opts.shard ? ` (shard ${opts.shard})` : ''}\n`);

const results = [];
for (const name of examples) {
    let r;
    try {
        const { app, work } = packageExample(driver, name, opts);
        r = await verifyApp(driver, app, name, opts);
        // Each APK carries the whole runtime template; keeping 40 of them around
        // is gigabytes for no reason.
        rmSync(work, { recursive: true, force: true });
    } catch (err) {
        r = { ok: false, why: err.message.split('\n')[0], log: '', colors: 0, size: '-' };
    }
    results.push({ name, ...r });
    console.log(`[smoke] ${name.padEnd(22)} ${r.ok ? `✓ ${r.size}, ${r.colors} colors` : `✗ ${r.why}`}`);
}

const known = Object.keys(KNOWN_FAILURES);
const brokeUnexpectedly = results.filter((r) => !r.ok && !KNOWN_FAILURES[r.name]);
const fixedUnexpectedly = results.filter((r) => r.ok && KNOWN_FAILURES[r.name]);

note(`### ${driver.name} — ${results.filter((r) => r.ok).length}/${results.length} examples started and drew`);
note('');
note(`Device: \`${device}\``);
note('');
note('| example | result | frame |');
note('| --- | --- | --- |');
for (const r of results) {
    const state = r.ok ? '✓' : (KNOWN_FAILURES[r.name] ? `✗ known — ${KNOWN_FAILURES[r.name]}` : `✗ ${r.why}`);
    note(`| ${r.name} | ${state} | ${r.ok ? `${r.size}, ${r.colors} colors` : '—'} |`);
}

if (known.length) {
    console.log(`\n${known.length} example(s) are recorded as already broken:`);
    for (const name of known) console.log(`  ${name} — ${KNOWN_FAILURES[name]}`);
}

for (const r of brokeUnexpectedly) {
    console.error(`\n✗ ${r.name}: ${r.why}`);
    console.error((r.log || '').trim() || '(no boot record)');
}
for (const r of fixedUnexpectedly) {
    console.error(`\n✗ ${r.name} now starts and draws, but is still on the known-failure list — remove it.`);
}

if (brokeUnexpectedly.length || fixedUnexpectedly.length) {
    for (const [title, text] of driver.diagnostics()) {
        if (!text?.trim()) continue;
        console.error(`\n--- ${title} ---`);
        console.error(text.trim().split('\n').slice(-80).join('\n'));
    }
    process.exit(1);
}

console.log(`\n✓ ${driver.name}: ${results.filter((r) => r.ok).length}/${results.length} examples started and drew a frame`);
