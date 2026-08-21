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
 * For a compatibility run — the same APK on one emulator per Android version —
 * `--no-frame-judge` drops the pixel question entirely and `--metrics-out` files
 * what the launch cost, so the versions can be compared and the frames reviewed
 * by someone. There, a dark frame is a thing to look at, not a thing to fail on:
 *
 *   node tools/verify-native-boot.mjs --platform android --apk game.apk \
 *       --label api29 --no-frame-judge --metrics-out build/compat/api29.json
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
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, distinctColors } from '../build-tools/utils/png.js';
import { GOLDEN, launchTimeoutFor } from './goldenProjects.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP_ID = 'com.estella.game';
const LOG_NAME = 'estella-boot.log';
const READY = 'ready in';
/** Captures per app. See the comment at the capture site for why >1 and why
 *  the richest one wins. */
const FRAME_SAMPLES = 3;
/** How long window focus gets to land on the game before something else holding
 *  it counts as covering it. See `foreground` for why this is a wait and not a
 *  question. */
const FOCUS_WAIT_MS = 8000;
/// Longest a slow scene may spend reaching `--frames` before it is judged anyway.
const FRAME_WAIT_S = 45;

/**
 * That budget for @p name, in ms. A project the golden registry already calls
 * expensive gets ITS number here too — one place says what a scene costs on a
 * rasteriser without a GPU, and both native gates read it.
 */
function frameBudgetMs(name) {
    return launchTimeoutFor(GOLDEN.find((g) => g.id === name)) ?? FRAME_WAIT_S * 1000;
}

/**
 * Examples that do not start or draw on a device yet, and why.
 *
 * An entry that PASSES fails this check too. A list nothing reconciles is where
 * work goes to be forgotten: the point of naming a break is to notice when it is
 * fixed, not to make the run green forever.
 */
const KNOWN_FAILURES = {};

/**
 * Examples whose FRAME one capture cannot judge, and why.
 *
 * They are still installed, still have to reach `ready`, and still have to record
 * no error — only "is it more than one flat color" is skipped, because for these
 * the honest answer changes from run to run and a gate that flips with it teaches
 * everyone to ignore it. Listing one here is an admission that this instrument is
 * too blunt for it, not a claim that the example is broken; the deterministic
 * capture that would settle it is the next piece of work, not a smaller number.
 */
const FRAME_NOT_JUDGED = {
    cutscene: 'a timeline that is legitimately dark when the frame is taken (4 colors on iOS, 1 on Android)',
    // Nothing is on screen until 1.5 s of SIMULATED time has passed — that is when
    // the first collectible spawns — and simulated time is not wall time: delta is
    // clamped (0.25 s), so a starved runner advances the world slower than the
    // clock this waits on. Two runs of identical code, one booting in 344 ms with
    // two squares on screen and one booting in 2956 ms with none, is the same
    // example on a busier machine, not a regression.
    'event-system': 'its first sprite needs 1.5 s of simulated time, which a loaded runner reaches later than the wall clock does',
};

function parseArgs(argv) {
    const opts = {
        platform: 'android', timeout: 120, settle: 3, frames: 30,
        // Two, not a threshold that sounds more rigorous. A 2D scene of flat
        // sprites is legitimately four colors, and "8" red-flagged camera-follow
        // for rendering exactly what it is supposed to render. The claim this can
        // honestly make is "not a uniform clear"; anything finer needs a baseline
        // to compare against, not a bigger number.
        minColors: 2,
        out: path.join(ROOT, 'build', 'native-boot'),
        template: path.join(ROOT, 'template'),
        // Names the artifacts. One compatibility job per Android version writes
        // into a directory the PR comment reads as a whole, so the version has to
        // be in the filename or eight runs land on top of each other.
        label: 'app',
    };
    for (let i = 0; i < argv.length; i++) {
        const key = argv[i].replace(/^--/, '');
        if (key === 'allow-skip') { opts.allowSkip = true; continue; }
        if (key === 'no-frame-judge') { opts.frameJudge = false; continue; }
        if (key === 'recreate') { opts.recreate = true; continue; }
        opts[key.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = argv[++i];
    }
    opts.timeout = Number(opts.timeout);
    opts.minColors = Number(opts.minColors);
    opts.settle = Number(opts.settle);
    opts.frames = Number(opts.frames);
    return opts;
}

const sh = (cmd, args, o = {}) => execFileSync(cmd, args, { encoding: 'utf8', ...o });
// 64MB, not the default megabyte: every use of this reads a device — a boot record,
// a /proc file, a log — and the biggest project in the corpus writes more than a
// megabyte before it is done booting. ENOBUFS there reads as a broken game.
const trySh = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
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
    const all = `${got.stdout ?? ''}\n${got.stderr ?? ''}`.trim().split('\n').filter((l) => l.trim());
    const blamed = all.filter((l) => /error|Error|fatal|FAILED/.test(l));
    // A tool that fails without saying "error" still said something, and the tail
    // is better than the empty string this used to report.
    const said = (blamed.length ? blamed : all).slice(-8).join('\n  ');
    throw new Error(`${what} failed (exit ${got.status})${said ? `:\n  ${said}` : ''}`);
}

// =============================================================================
// Android — adb against whatever emulator or phone is attached
// =============================================================================

/** `+1s234ms`, `+834ms` — how the platform writes a launch duration. */
function launchDuration(text) {
    const m = /\+(?:(\d+)m)?(?:(\d+)s)?(\d+)ms/.exec(text ?? '');
    if (!m) return null;
    return Number(m[1] ?? 0) * 60_000 + Number(m[2] ?? 0) * 1000 + Number(m[3]);
}

const firstNumber = (re, text) => {
    const m = re.exec(text ?? '');
    return m ? Number(m[1]) : null;
};

/**
 * utime+stime for a pid, in clock ticks.
 *
 * `comm` is parenthesised and may itself contain spaces and parentheses, so the
 * positional fields start after the LAST `)` — splitting the whole line on
 * whitespace misreads any process whose name has a space in it.
 */
function cpuTicks(adb, pid) {
    const stat = trySh(adb, ['shell', 'cat', `/proc/${pid}/stat`]).stdout ?? '';
    const fields = stat.slice(stat.lastIndexOf(')') + 1).trim().split(/\s+/);
    if (fields.length < 13) return null;
    const utime = Number(fields[11]);
    const stime = Number(fields[12]);
    return Number.isFinite(utime + stime) ? utime + stime : null;
}

function androidDriver(opts) {
    const adb = process.env.ANDROID_HOME
        ? path.join(process.env.ANDROID_HOME, 'platform-tools', 'adb') : 'adb';
    const logFile = `/sdcard/Android/data/${APP_ID}/files/${LOG_NAME}`;
    let lastReadError = '';

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
        // An emulator running forty apps in a row starves its launcher, which then
        // ANRs, and the system paints "Pixel Launcher isn't responding" over the
        // game. That dialog does not change the resumed activity, so a foreground
        // check waves it through — and its antialiased text is hundreds of colors,
        // so the frame "passed" while the game behind it was black. The dialog is
        // noise from a busy runner, and Android can simply not draw it.
        prepare() {
            trySh(adb, ['shell', 'settings', 'put', 'global', 'hide_error_dialogs', '1']);
            trySh(adb, ['shell', 'settings', 'put', 'global', 'anr_show_background', '0']);
            // A game going fullscreen earns itself the system's "swipe down to
            // exit" panel, which takes focus for a few seconds — on a first run
            // of a freshly installed app, which is every app this checks. So the
            // one signal that says the game reached fullscreen also says
            // something is on top of it, and the whole matrix reds on a working
            // engine. Confirming it once, per device, is how Android turns it
            // off; the wait in `foreground` covers a device that refuses.
            trySh(adb, ['shell', 'settings', 'put', 'secure', 'immersive_mode_confirmations', 'confirmed']);
            // The boot record lives in the app's external files directory, which
            // scoped storage put out of the shell user's reach — on API 30 the game
            // ran, drew, and reported "never reported ready", because the reader
            // could not open a file that was there. An emulator image is userdebug,
            // so take root ONCE here rather than inside the loop that polls the
            // file. A device that refuses simply stays unrooted and the read falls
            // back to saying why it failed.
            if (trySh(adb, ['root']).status === 0) trySh(adb, ['wait-for-device']);
        },
        install(apk) {
            trySh(adb, ['uninstall', APP_ID]);
            sh(adb, ['install', '-r', '-t', apk]);
            // A record left by an earlier app would answer for this one.
            trySh(adb, ['shell', 'rm', '-f', logFile]);
            trySh(adb, ['logcat', '-c']);
        },
        // `-W` makes this wait for the launch to finish and print what it cost, so
        // the timing comes from the platform's own measurement rather than from a
        // stopwatch around adb — which would also be timing adb.
        launch() {
            return sh(adb, ['shell', 'am', 'start', '-W', '-n', `${APP_ID}/android.app.NativeActivity`]);
        },
        stop() {
            trySh(adb, ['shell', 'am', 'force-stop', APP_ID]);
        },
        // Counting colors on a SCREEN, not on the game: an emulator that pops
        // "Pixel Launcher isn't responding" over a black app hands the check a
        // dialog full of colors and it calls that a rendered frame.
        /** Has the launch already died? `am start -W` waits for the launch to
         *  finish, so by the time this is asked the process either exists or is
         *  gone for good. */
        died() {
            return !trySh(adb, ['shell', 'pidof', APP_ID]).stdout.trim();
        },
        async foreground() {
            const out = trySh(adb, ['shell', 'dumpsys', 'activity', 'activities']).stdout ?? '';
            const line = out.split('\n').find((l) => /ResumedActivity/.test(l));
            if (line && !line.includes(APP_ID)) return `on screen instead: ${line.trim().slice(0, 100)}`;
            if (!line && !trySh(adb, ['shell', 'pidof', APP_ID]).stdout.trim()) return 'the app process is gone';
            // The resumed activity is still OURS while a dialog sits on top of
            // it, which is the hole this check had: the frame judge counts
            // colours on the SCREEN, and a system dialog is hundreds of them —
            // so a game that had gone black passed on the dialog's antialiased
            // text. Focus is what actually moves when something covers us.
            //
            // But focus MOVES, and asking once times the question against
            // whatever holds it at that instant. A launch hands focus over some
            // time after the activity resumes, and what the system puts up on a
            // first run holds it first — so asked once, forty-two working games
            // answered "covered", one shard blaming the fullscreen panel and
            // another the launcher focus had not yet left. Waiting is what makes
            // the answer mean something, and it costs nothing when the game has
            // focus already: what this catches is a window that never gives it
            // back, which is exactly what an ANR dialog does.
            const deadline = Date.now() + FOCUS_WAIT_MS;
            for (;;) {
                // Focus is reported more than once — the policy state and each
                // display keep their own line — and they do not all update
                // together, so the FIRST one is whichever the dump happens to
                // print first. Reading only that is how a shard spent a whole
                // matrix blaming a launcher window whose handle never changed.
                // Any line naming us is the game holding focus.
                const focus = (trySh(adb, ['shell', 'dumpsys', 'window']).stdout ?? '')
                    .split('\n').filter((l) => /mCurrentFocus/.test(l));
                // No focus line at all is not evidence of anything — some versions
                // word it differently, and inventing a failure from a parse miss is
                // how a gate teaches people to ignore it. Neither is a focus of
                // null, which is what a display in transition reports.
                const held = focus.filter((l) => !/mCurrentFocus=null/.test(l));
                if (!held.length || held.some((l) => l.includes(APP_ID))) return null;
                if (Date.now() >= deadline) return `something is on top of it: ${held[0].trim().slice(0, 100)}`;
                await sleep(500);
            }
        },
        clearScreen() {
            trySh(adb, ['shell', 'am', 'broadcast', '-a', 'android.intent.action.CLOSE_SYSTEM_DIALOGS']);
        },
        // A uiMode change the manifest does not handle, so the platform recreates
        // the activity: the process and the booted engine survive, every later JS
        // call runs on a NEW glue thread. That thread swap is what broke three
        // releases' smoke runs intermittently (QuickJS's stack-overflow anchor),
        // and ASLR decides whether a given recreate trips it — hence a probe that
        // recreates several times rather than once.
        recreate(night) {
            trySh(adb, ['shell', 'cmd', 'uimode', 'night', night ? 'yes' : 'no']);
        },
        readLog() {
            const got = trySh(adb, ['shell', 'cat', logFile]);
            // Why it failed, kept for the diagnostics. "No such file" (the app never
            // got that far) and "Permission denied" (it did, and this cannot see it)
            // are opposite conclusions that both arrive here as an empty string, and
            // one of them spent a run looking like a broken Android version.
            lastReadError = got.status === 0 ? '' : `${got.stderr ?? ''}`.trim();
            return got.status === 0 ? got.stdout : '';
        },
        screenshot() {
            return execFileSync(adb, ['exec-out', 'screencap', '-p'], { maxBuffer: 64 * 1024 * 1024 });
        },
        /**
         * What the run cost on THIS platform version, read while the app is still
         * up — every number here is gone the moment the process is.
         *
         * A field this version cannot answer for is `null`, never 0: the whole
         * point is comparing one Android release against another, and a zero
         * would read as "free" rather than "not measurable here". `notes` says
         * which ones those were, so a gap in the table is explained rather than
         * looking like a regression.
         */
        async metrics(launchOutput) {
            const notes = [];
            // The DEVICE first, before anything that depends on the app being
            // alive. Read after the early return below, the one row that matters
            // most — the version that crashed — came out labelled "Android ? (API
            // ?)", which is the row a reader needs the version on.
            const device = {
                api: Number(trySh(adb, ['shell', 'getprop', 'ro.build.version.sdk']).stdout.trim()) || null,
                release: trySh(adb, ['shell', 'getprop', 'ro.build.version.release']).stdout.trim() || null,
                renderer: /GLES:\s*(.+)/.exec(
                    trySh(adb, ['shell', 'dumpsys', 'SurfaceFlinger']).stdout ?? '')?.[1]?.trim() ?? null,
            };
            const pid = trySh(adb, ['shell', 'pidof', APP_ID]).stdout.trim().split(/\s+/)[0] || null;

            const startup = {
                // TotalTime is the activity reaching drawable; WaitTime adds the
                // system's own work before it got there.
                totalMs: firstNumber(/^TotalTime:\s*(\d+)/m, launchOutput),
                waitMs: firstNumber(/^WaitTime:\s*(\d+)/m, launchOutput),
                // The tag is ActivityTaskManager from API 29 and ActivityManager
                // below it, so both are asked for rather than branching on version.
                displayedMs: launchDuration(
                    (trySh(adb, ['logcat', '-d', '-s', 'ActivityTaskManager:I', 'ActivityManager:I']).stdout ?? '')
                        .split('\n').filter((l) => l.includes('Displayed') && l.includes(APP_ID)).pop()),
                readyMs: null,   // the caller fills this from the boot record
            };

            if (!pid) {
                notes.push('the process was gone before anything could be sampled');
                return { ...device, startup, memory: null, cpu: null, frames: null, notes };
            }

            const meminfo = trySh(adb, ['shell', 'dumpsys', 'meminfo', APP_ID]).stdout ?? '';
            // The colon is optional because the same figure is labelled both ways in
            // one dumpsys: the per-process table writes "Native Heap    1234" and
            // the App Summary below it writes "Native Heap:    1234". Requiring
            // whitespace after the label found neither Graphics nor Native Heap, so
            // Dawn's Vulkan allocations read as "—" on every version.
            const memRow = (label) => firstNumber(new RegExp(`^\\s*${label}:?\\s+(\\d+)`, 'm'), meminfo);
            const memory = {
                // "TOTAL PSS:" is the App Summary line on API 29+; older releases
                // label the same figure "TOTAL" in the table above it.
                totalPssKb: firstNumber(/^\s*TOTAL PSS:\s*(\d+)/m, meminfo) ?? memRow('TOTAL'),
                nativeHeapKb: memRow('Native Heap'),
                // Dawn's Vulkan allocations land here, not in Native Heap — which is
                // why a renderer regression is invisible in the heap figure alone.
                graphicsKb: memRow('Graphics'),
                vmHwmKb: firstNumber(/^VmHWM:\s*(\d+)/m,
                    trySh(adb, ['shell', 'cat', `/proc/${pid}/status`]).stdout),
            };
            if (memory.totalPssKb === null) notes.push('dumpsys meminfo named no total this version parses');

            const ticksPerSec = Number(trySh(adb, ['shell', 'getconf', 'CLK_TCK']).stdout.trim()) || 100;
            const before = cpuTicks(adb, pid);
            const threads = firstNumber(/^Threads:\s*(\d+)/m,
                trySh(adb, ['shell', 'cat', `/proc/${pid}/status`]).stdout);
            let cpu = null;
            if (before === null) {
                notes.push('/proc is not readable for another uid on this version — no CPU figure');
            } else {
                const windowMs = 2000;
                await sleep(windowMs);
                const after = cpuTicks(adb, pid);
                cpu = after === null ? null : {
                    percent: Math.round(((after - before) / ticksPerSec) / (windowMs / 1000) * 1000) / 10,
                    threads,
                    windowMs,
                };
            }

            // SurfaceFlinger, not `dumpsys gfxinfo`: gfxinfo reports HWUI, and a
            // NativeActivity drawing to its own ANativeWindow through Vulkan never
            // touches HWUI, so gfxinfo's framestats for this app are empty.
            let frames = null;
            const layer = (trySh(adb, ['shell', 'dumpsys', 'SurfaceFlinger', '--list']).stdout ?? '')
                .split('\n').map((l) => l.trim()).filter((l) => l.includes(APP_ID)).pop();
            if (!layer) {
                notes.push('SurfaceFlinger listed no layer for the app — no frame timing');
            } else {
                const raw = trySh(adb, ['shell', 'dumpsys', 'SurfaceFlinger', '--latency', `'${layer}'`]).stdout ?? '';
                const lines = raw.trim().split('\n');
                const refreshNs = Number(lines[0]);
                // Three timestamps a row; the middle one is actual present. A pending
                // frame is reported as INT64_MAX and a dropped one as 0 — both are
                // "no measurement", not a zero-length frame.
                const present = lines.slice(1)
                    .map((l) => Number(l.trim().split(/\s+/)[1]))
                    .filter((n) => Number.isFinite(n) && n > 0 && n < 9.2e18);
                const gaps = present.slice(1).map((n, i) => (n - present[i]) / 1e6).filter((ms) => ms > 0);
                gaps.sort((a, b) => a - b);
                frames = gaps.length < 2 ? null : {
                    count: gaps.length + 1,
                    medianMs: Math.round(gaps[Math.floor(gaps.length / 2)] * 100) / 100,
                    p95Ms: Math.round(gaps[Math.floor(gaps.length * 0.95)] * 100) / 100,
                    refreshHz: Number.isFinite(refreshNs) && refreshNs > 0
                        ? Math.round(1e9 / refreshNs) : null,
                };
                if (!frames) notes.push('SurfaceFlinger had too few presented frames to time');
            }

            return { ...device, startup, memory, cpu, frames, notes };
        },
        diagnostics() {
            return [
                // First, because an unreadable record is a different failure from an
                // unwritten one and the report cannot tell them apart on its own.
                ['reading the boot record', lastReadError
                    ? `${lastReadError}\n${trySh(adb, ['shell', 'ls', '-l', path.posix.dirname(logFile)]).stdout ?? ''}`
                    : ''],
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
        prepare() {},
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
            // Read, not `cat`: execFileSync buffers a megabyte and the flagship's
            // boot log is bigger, so the shard died on ENOBUFS instead of judging.
            return existsSync(file) ? readFileSync(file, 'utf8') : '';
        },
        screenshot() {
            const shot = path.join(opts.out, 'raw.png');
            simctl('io', udid, 'screenshot', shot);
            // Read, not `cat`: a phone-sized PNG of a busy scene is over the
            // megabyte execFileSync buffers, and the flagship's was.
            return readFileSync(shot);
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

/**
 * How far the render loop got, from the frame lines the host writes on a ramp.
 * 0 before the first one — which is the answer for a loop that never ran.
 */
function framesDrawn(log) {
    let n = 0;
    for (const m of log.matchAll(/real-SDK frame (\d+)/g)) n = Math.max(n, Number(m[1]));
    return n;
}

async function verifyApp(driver, artifact, label, opts, judgeFrame = true) {
    driver.install(artifact);

    let log = '';
    let offScreen = null;
    let launchOutput = '';
    // One retry, because a system dialog stealing focus is the emulator having a
    // bad minute, not the game being broken — and a gate that reds on that gets
    // ignored within a week.
    for (let attempt = 0; attempt < 2; attempt++) {
        launchOutput = driver.launch() ?? '';
        const deadline = Date.now() + opts.timeout * 1000;
        while (Date.now() < deadline) {
            log = driver.readLog();
            if (log.includes(READY)) break;
            // A launch that is already dead will not report ready in another two
            // minutes. Sitting out the full timeout twice turned each crashing
            // version into seven minutes of waiting for nothing, which is what
            // pushed the slower emulators past the job cap and cost the matrix a
            // version per run — reported as "no data" on a version that had in
            // fact crashed, which is the wrong answer twice over.
            if (driver.died?.()) break;
            await sleep(2000);
        }
        // `ready` is the first frame SUBMITTED, and what the capture needs is a
        // loop that has been running: a software rasterizer spends about a second
        // on a lit frame, so a flat wait judges a lit scene on its first few.
        const settleBy = Date.now() + Math.max(opts.settle, 1) * 1000;
        // Its own budget, not the ready timeout: a scene this slow is worth
        // waiting out, a hung one is not, and the set is 40-odd apps per device.
        const framesBy = Date.now() + frameBudgetMs(label);
        await sleep(Math.max(settleBy - Date.now(), 0));
        // Backing off rather than polling flat out: reading the record spawns a
        // process on the device, and asking a struggling app ninety times is the
        // instrument leaning on what it measures.
        for (let wait = 500; framesDrawn(log = driver.readLog()) < opts.frames;) {
            if (driver.died?.() || Date.now() >= framesBy) break;
            await sleep(Math.min(wait, Math.max(framesBy - Date.now(), 0)));
            wait = Math.min(wait * 2, 4000);
        }
        offScreen = await driver.foreground();
        if (!offScreen) break;
        driver.clearScreen();
        driver.stop();
    }

    driver.clearScreen();
    // More than one, and keep the richest.
    //
    // A single capture is a coin flip against everything transient: a toast
    // fading in, a frame taken between two the game drew, a compositor that
    // handed back the previous buffer. Every one of those makes a WORKING game
    // look broken, which is the failure that gets a gate ignored. Three is
    // enough to make that unlucky rather than likely, and they cost a
    // screencap each.
    //
    // Richest, not median: the question is "did it ever draw", so one good
    // frame is proof and the others cannot un-prove it. The dialog case runs
    // the other way and is not this check's to catch — `foreground` above is,
    // because a dialog's colours would win exactly this comparison.
    let frame = driver.screenshot();
    let image = decodePng(frame);
    let colors = distinctColors(image);
    for (let i = 1; i < FRAME_SAMPLES; i++) {
        await sleep(120);
        const again = driver.screenshot();
        const decoded = decodePng(again);
        const n = distinctColors(decoded);
        if (n > colors) { frame = again; image = decoded; colors = n; }
    }
    const shot = path.join(opts.out, `${driver.name}-${label}.png`);
    writeFileSync(shot, frame);
    writeFileSync(path.join(opts.out, `${driver.name}-${label}.log`), log);

    // Before stop(): a dead process has no memory, no threads and no layer.
    const metrics = driver.metrics ? await driver.metrics(launchOutput) : null;

    // The recreate probe, after the frame is already banked so it cannot disturb
    // the pixel question. Each uiMode toggle recreates the activity over the
    // LIVING engine; the errors that only this path produces (a JS runtime
    // entered from a fresh thread) land in the boot record, and the diff below
    // attributes them to the recreate rather than to the boot.
    let recreateWhy = '';
    let bootErrorCount = null;
    if (opts.recreate && driver.recreate && !offScreen && log.includes(READY)) {
        const errorsBefore = log.split('\n').filter((l) => l.startsWith('ERROR [')).length;
        bootErrorCount = errorsBefore;
        for (let i = 0; i < 3; i++) {
            driver.recreate(true); await sleep(2000);
            driver.recreate(false); await sleep(2000);
        }
        const after = driver.readLog();
        if (after) log = after;
        const fresh = log.split('\n').filter((l) => l.startsWith('ERROR [')).slice(errorsBefore);
        const gone = await driver.foreground();
        if (fresh.length) recreateWhy = `after an activity recreate: ${fresh[0].trim()}`;
        else if (gone) recreateWhy = `after an activity recreate: ${gone}`;
        writeFileSync(path.join(opts.out, `${driver.name}-${label}.log`), log);
    }
    driver.stop();

    // `image` and `colors` come from the sampling above — decoding the kept
    // frame a second time would be two sources for one number.
    const ready = log.includes(READY);
    const readyLine = log.split('\n').find((l) => l.includes(READY))?.trim() ?? '';
    if (metrics) metrics.startup.readyMs = firstNumber(/ready in (\d+) ms/, readyLine);
    // The record already carries structured errors, and they say far more than a
    // pixel count can: drawing-demo drew a black screen because a resize sent
    // es_onNativeVisibility into infinite recursion, and the record said so.
    // Errors the recreate probe provoked are its to report (with attribution),
    // not this list's — the boot slice is what the plain branch judges.
    const errors = log.split('\n').filter((l) => l.startsWith('ERROR ['));
    const bootErrors = bootErrorCount === null ? errors : errors.slice(0, bootErrorCount);

    // `--no-frame-judge` turns the pixel question off entirely: a compatibility
    // run compares one Android version against another, and the frame is there to
    // be LOOKED AT, not counted. Counting colors would red the run on a scene that
    // is legitimately dark and still say nothing about what a reviewer can see.
    const countColors = judgeFrame && opts.frameJudge !== false;
    // How far the loop got, in the verdict: a flat frame after six frames is a
    // capture that outran the game, one after three hundred is the game, and
    // without the number they read as the same failure.
    const frames = framesDrawn(log);
    const why = !ready ? 'never reported ready'
        : offScreen ? `the game was not on screen — ${offScreen}`
            : bootErrors.length ? bootErrors[0].trim()
                : (countColors && colors < opts.minColors)
                    ? `the frame is ${colors} flat color after ${frames} frame(s)`
                    : recreateWhy;

    return {
        ok: !why, ready, colors, frames, readyLine, errors, offScreen, metrics,
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
        path.join(ROOT, 'pipeline', 'bin', 'estella.mjs'), 'export',
        path.join(ROOT, 'examples', name),
        '--platform', driver.name,
        '--template', opts.template,
        '--out', path.join(work, 'dist'),
        '--json', report,
    ]);
    if (!existsSync(report)) throw new Error('the export wrote no result');
    const exported = JSON.parse(readFileSync(report, 'utf8'));
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
driver.prepare();

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
    const r = await verifyApp(driver, artifact, opts.label, opts);
    console.log(`boot record: ${r.ready ? r.readyLine : 'never reached "ready in"'}`);
    console.log(`frame:       ${r.size}${opts.frameJudge === false ? '' : `, ${r.colors} distinct colors (need ${opts.minColors})`}`);
    console.log(`written:     ${r.shot}`);
    if (r.metrics) console.log(`metrics:\n${JSON.stringify(r.metrics, null, 2)}`);

    // Written whether or not the launch worked. A version that crashes is the
    // result a compatibility matrix most needs to report, and a run that files
    // nothing leaves a hole in the table that reads like the job never ran.
    if (opts.metricsOut) {
        mkdirSync(path.dirname(opts.metricsOut), { recursive: true });
        writeFileSync(opts.metricsOut, `${JSON.stringify({
            label: opts.label, device, ok: r.ok, why: r.why, ready: r.ready,
            readyLine: r.readyLine, errors: r.errors, shot: path.basename(r.shot),
            ...r.metrics,
        }, null, 2)}\n`);
        console.log(`metrics written: ${opts.metricsOut}`);
    }

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
    // A shard with nothing in it is what a named set smaller than the matrix
    // looks like, not a mistake.
    console.log(opts.shard ? `nothing in shard ${opts.shard}` : '✗ no examples selected');
    process.exit(opts.shard ? 0 : 2);
}
console.log(`${examples.length} example(s)${opts.shard ? ` (shard ${opts.shard})` : ''}\n`);

const results = [];
for (const name of examples) {
    let r;
    try {
        const { app, work } = packageExample(driver, name, opts);
        r = await verifyApp(driver, app, name, opts, !FRAME_NOT_JUDGED[name]);
        // Each APK carries the whole runtime template; keeping 40 of them around
        // is gigabytes for no reason.
        rmSync(work, { recursive: true, force: true });
    } catch (err) {
        r = { ok: false, why: err.message, log: '', colors: 0, size: '-' };
    }
    results.push({ name, ...r });
    const frameNote = FRAME_NOT_JUDGED[name] ? ' (frame not judged)' : '';
    console.log(`[smoke] ${name.padEnd(22)} ${r.ok ? `✓ ${r.size}, ${r.colors} colors, ${r.frames} frames${frameNote}` : `✗ ${r.why.split('\n')[0]}`}`);
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
    const state = r.ok ? '✓'
        : (KNOWN_FAILURES[r.name] ? `✗ known — ${KNOWN_FAILURES[r.name]}` : `✗ ${r.why.split('\n')[0]}`);
    note(`| ${r.name} | ${state} | ${r.ok ? `${r.size}, ${r.colors} colors` : '—'} |`);
}

// Printed rather than silently applied: a list nobody sees is a list nobody
// shortens.
if (known.length) {
    console.log(`\n${known.length} example(s) are recorded as already broken:`);
    for (const name of known) console.log(`  ${name} — ${KNOWN_FAILURES[name]}`);
}
const unjudged = Object.keys(FRAME_NOT_JUDGED).filter((n) => examples.includes(n));
if (unjudged.length) {
    console.log(`\n${unjudged.length} example(s) launched but had their frame taken on trust:`);
    for (const name of unjudged) console.log(`  ${name} — ${FRAME_NOT_JUDGED[name]}`);
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
