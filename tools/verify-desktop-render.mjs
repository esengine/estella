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
        path.join(ROOT, 'desktop', 'scripts', 'export-project.mjs'), project,
        '--platform', 'desktop', '--out', out, '--template', templateDir,
    ], { cwd: ROOT, stdio: 'inherit' });

    const name = JSON.parse(readFileSync(path.join(out, 'app.config.json'), 'utf8')).name;
    const exe = HOST_OS === 'macos'
        ? path.join(out, `${name}.app`, 'Contents', 'MacOS', name)
        : path.join(out, name, `${name}.exe`);
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
    return { verdict: verdictIn(`${run.stdout ?? ''}${run.stderr ?? ''}`), status: run.status, output: `${run.stdout ?? ''}${run.stderr ?? ''}` };
}

const opts = parseArgs(process.argv.slice(2));
const templateDir = opts.template ?? installedTemplateDir(
    JSON.parse(readFileSync(path.join(ROOT, 'desktop', 'package.json'), 'utf8')).version, HOST_OS);
if (!templateDir || !existsSync(templateDir)) {
    console.error(`verify-desktop-render: no ${HOST_OS} runtime template installed — build one with `
        + `\`node build-tools/cli.js native --target ${HOST_OS}\`.`);
    process.exit(1);
}

const projects = opts.project
    ? [path.resolve(opts.project)]
    : opts.examples.split(',').map((n) => path.join(ROOT, 'examples', n.trim()));

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
            console.log(`✓ ${label}: ${verdict.w}x${verdict.h}, spread ${verdict.spread}`);
        }
    }
} finally {
    rmSync(work, { recursive: true, force: true });
}

if (failed > 0) {
    console.error(`verify-desktop-render: ${failed} of ${projects.length} did not draw.`);
    process.exit(1);
}
console.log(`verify-desktop-render: ${projects.length} packaged game(s) drew on ${HOST_OS}.`);
