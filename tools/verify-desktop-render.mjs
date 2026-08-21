// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  verify-desktop-render.mjs — a game packaged from the desktop template draws.
 *
 * `verify-template` proves an archive holds its files, which v0.36.0's Android
 * template also did while every game made from it opened on a black screen. The
 * native runtime could only ever be judged on a simulator or a phone — where an
 * OS dialog over the frame once made a dead app look healthy — because no runner
 * was the platform. The desktop runners ARE: this packages a real project the way
 * the editor's Package dialog does, runs the assembled app, and reads the frame it
 * put on the swapchain.
 *
 * The verdict is the host's own (native/host/Shot.cpp), which computes it exactly
 * as the web render checks do. Nothing here re-decides what "drew" means — a
 * second threshold would be a second answer to one question.
 *
 *   node tools/verify-desktop-render.mjs --tier pr
 *   node tools/verify-desktop-render.mjs --examples hello-world,particle-demo
 *   node tools/verify-desktop-render.mjs --project examples/hello-world
 *
 * A missing template FAILS rather than skipping: this exists to gate a release,
 * and the release is the run that builds the template it is given.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installedTemplateDir } from '../build-tools/utils/nativeTemplate.js';
import { atTier, projectDir, GOLDEN, desktopPixels, desktopPixelsSkip } from './goldenProjects.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOST_OS = process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'linux';

/** The frame the shot is taken on. Late enough that the first scene has loaded
 *  and its assets are resident; early enough that a hang is still a red run. */
const SHOT_FRAME = 60;

function parseArgs(argv) {
    const opts = { examples: 'hello-world' };
    for (let i = 0; i < argv.length; i += 2) {
        const key = argv[i]?.replace(/^--/, '');
        if (key && argv[i + 1] !== undefined) opts[key] = argv[i + 1];
    }
    return opts;
}

/**
 * Points a packaged game must have drawn, read out of the raw capture — the
 * host's verdict only answers "did anything draw".
 *
 * The capture is bottom-up and BGRA unless the host says RGBA (Shot.cpp logs
 * which); `y` is measured from the TOP, as every other expectation here is.
 */
function probePixels(rawPath, verdict, output, points) {
    const bytes = readFileSync(rawPath);
    const { w, h } = { w: verdict.w, h: verdict.h };
    if (bytes.length < w * h * 4) return [{ ok: false, why: `capture is ${bytes.length} bytes, ${w}x${h} needs ${w * h * 4}` }];
    const bgra = !/shot: \d+x\d+ RGBA bottom-up/.test(output);
    return points.map((pt) => {
        const px = Math.min(w - 1, Math.max(0, Math.round(pt.x * (w - 1))));
        const py = Math.min(h - 1, Math.max(0, Math.round(pt.y * (h - 1))));
        const i = ((h - 1 - py) * w + px) * 4;
        const got = bgra ? [bytes[i + 2], bytes[i + 1], bytes[i]] : [bytes[i], bytes[i + 1], bytes[i + 2]];
        const tol = pt.tol ?? 30;
        const ok = got.every((c, k) => Math.abs(c - pt.rgb[k]) <= tol);
        return { ok, why: ok ? '' : `${pt.x}x${pt.y}: want [${pt.rgb}] ±${tol}, got [${got}]` };
    });
}

/** The verdict line the host logs, parsed. Null when it never got that far. */
function verdictIn(output) {
    const at = output.lastIndexOf('shot verdict:');
    if (at < 0) return null;
    const brace = output.indexOf('{', at);
    const end = output.indexOf('}', brace);
    if (brace < 0 || end < 0) return null;
    try {
        return JSON.parse(output.slice(brace, end + 1));
    } catch {
        return null;
    }
}

function packageAndRun(project, templateDir, work) {
    const out = path.join(work, path.basename(project));
    mkdirSync(out, { recursive: true });
    execFileSync(process.execPath, [
        path.join(ROOT, 'pipeline', 'bin', 'estella.mjs'), 'export', project,
        '--platform', 'desktop', '--out', out, '--template', templateDir,
    ], { cwd: ROOT, stdio: 'inherit' });

    const name = JSON.parse(readFileSync(path.join(out, 'app.config.json'), 'utf8')).name;
    // Three layouts, not two: Linux is Windows' shape without the extension, and
    // treating "not macOS" as Windows looks for a .exe that a Linux build never
    // produced — a judge failing on its own path arithmetic.
    const exe = HOST_OS === 'macos' ? path.join(out, `${name}.app`, 'Contents', 'MacOS', name)
        : HOST_OS === 'windows' ? path.join(out, name, `${name}.exe`)
            : path.join(out, name, name);
    if (!existsSync(exe)) throw new Error(`no assembled app at ${exe}`);

    // From a directory that is NOT the app's: a player's launcher does the same,
    // and anything the host resolves relative to the working directory rather than
    // to itself passes here and fails on their machine.
    const run = spawnSync(exe, [], {
        cwd: ROOT,
        env: { ...process.env, ESTELLA_SHOT: path.join(out, 'frame.raw'), ESTELLA_SHOT_FRAME: String(SHOT_FRAME), ESTELLA_SHOT_QUIT: '1' },
        encoding: 'utf8',
        timeout: 120_000,
    });
    const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
    return { verdict: verdictIn(output), status: run.status, output, raw: path.join(out, 'frame.raw') };
}

/** What a golden project says its packaged frame must contain, or null. */
function desktopPixelsFor(id) {
    try {
        return desktopPixels(GOLDEN.find((g) => g.id === id), HOST_OS);
    } catch {
        return null;
    }
}

const opts = parseArgs(process.argv.slice(2));
const templateDir = opts.template ?? installedTemplateDir(
    JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version, HOST_OS);
if (!templateDir || !existsSync(templateDir)) {
    console.error(`verify-desktop-render: no ${HOST_OS} runtime template installed — build one with `
        + `\`node build-tools/cli.js native --target ${HOST_OS}\`.`);
    process.exit(1);
}

/** Golden projects at `tier` that ask for a desktop package. A tier nobody spells
 *  right is a workflow typo, and it should read as one rather than as a stack. */
function goldenDesktopProjects(tier) {
    try {
        return atTier(tier).filter((g) => g.targets.includes('desktop')).map((g) => projectDir(g.id));
    } catch (err) {
        console.error(`✗ ${err.message}`);
        process.exit(2);
    }
}

// `--tier` takes the corpus from the golden registry — the same projects the web
// and mini-game launchers carry, so "desktop is covered" means the same set of
// games rather than whichever two were named here years ago.
const projects = opts.project
    ? [path.resolve(opts.project)]
    : opts.tier
        ? goldenDesktopProjects(opts.tier)
        : opts.examples.split(',').map((n) => path.join(ROOT, 'examples', n.trim()));

if (projects.length === 0) {
    console.error(`✗ no projects selected${opts.tier ? ` — no golden project at tier "${opts.tier}" targets desktop` : ''}`);
    process.exit(1);
}
console.log(`${projects.length} project(s)${opts.tier ? ` (golden ${opts.tier})` : ''}`);

const work = mkdtempSync(path.join(tmpdir(), 'estella-desktop-render-'));
let failed = 0;
try {
    for (const project of projects) {
        const label = path.basename(project);
        let result;
        try {
            result = packageAndRun(project, templateDir, work);
        } catch (err) {
            console.error(`✗ ${label}: ${err.message}`);
            failed += 1;
            continue;
        }
        const { verdict } = result;
        if (!verdict) {
            // No verdict at all is the launch that died, and the tail is the only
            // evidence of where.
            console.error(`✗ ${label}: no frame was captured (exit ${result.status})`);
            console.error(result.output.split('\n').slice(-25).join('\n'));
            failed += 1;
        } else if (!verdict.rendered) {
            console.error(`✗ ${label}: ran and drew nothing — ${JSON.stringify(verdict)}`);
            failed += 1;
        } else {
            const points = desktopPixelsFor(label);
            // Never silently: a check that does not run has to say so where the
            // result is read, or its absence reads as a pass.
            const skipped = desktopPixelsSkip(GOLDEN.find((g) => g.id === label), HOST_OS);
            if (skipped) console.log(`  … ${skipped}`);
            const probes = points ? probePixels(result.raw, verdict, result.output, points) : [];
            const bad = probes.filter((r) => !r.ok);
            if (bad.length > 0) {
                console.error(`✗ ${label}: drew, but not what it declared`);
                for (const b of bad) console.error(`    ${b.why}`);
                failed += 1;
            } else {
                console.log(`✓ ${label}: ${verdict.w}x${verdict.h}, spread ${verdict.spread}`
                    + (probes.length ? `, ${probes.length} point(s) as declared` : ''));
            }
        }
    }
} finally {
    rmSync(work, { recursive: true, force: true });
}

if (failed > 0) {
    console.error(`verify-desktop-render: ${failed} of ${projects.length} did not draw what they declare.`);
    process.exit(1);
}
console.log(`verify-desktop-render: ${projects.length} packaged game(s) drew on ${HOST_OS}.`);
