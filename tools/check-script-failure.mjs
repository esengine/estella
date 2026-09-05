// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-script-failure.mjs — a packaged game does not hide its own boot.
 *
 * A build with no project code has nothing to import, and one whose module
 * throws at load has something that failed. A host that cannot tell those apart
 * boots an empty world, paints a frame and reports a healthy start — and every
 * symptom after that points somewhere else.
 *
 * The package DECLARES whether it has scripts, so they are three cases. This
 * drives a real package for each:
 *
 *   declared and sound     boots, systems run, no errors
 *   not declared           boots, no import attempted, no errors
 *   declared and throwing  startup fails, the original message is observable
 *
 *   node tools/check-script-failure.mjs
 */
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runElectron } from './lib/electronRun.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORK = path.join(ROOT, '.golden', 'script-failure');
const SOURCE = path.join(ROOT, 'examples', 'hello-world');
const LAUNCHER = path.join(ROOT, 'tools', 'launchers', 'launch-export.mjs');
const MARKER = 'DOGFOOD_BOOT_FAILURE';

const results = [];
const check = (what, ok, detail) => {
    results.push(ok);
    console.log(`${ok ? '✓' : '✗'} ${what}${detail ? ` — ${detail}` : ''}`);
};

/** A copy of the fixture project, optionally with its entry made to throw. */
function project(name, mutate) {
    const dir = path.join(WORK, name);
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    cpSync(SOURCE, dir, { recursive: true });
    rmSync(path.join(dir, '.esengine'), { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    mutate?.(dir);
    return dir;
}

function pack(dir, name) {
    const out = path.join(WORK, `${name}-web`);
    const r = spawnSync(process.execPath, [
        path.join(ROOT, 'pipeline', 'bin', 'estella.mjs'), 'export', dir,
        '--platform', 'web', '--out', out,
    ], { encoding: 'utf8', cwd: ROOT });
    if (r.status !== 0) {
        console.error(`✗ ${name}: the package did not build`);
        console.error((r.stderr || r.stdout || '').split('\n').slice(-6).join('\n'));
        process.exit(1);
    }
    return out;
}

/** Boot it headless and report what the page said while doing so. */
function boot(dir) {
    const r = runElectron([
        LAUNCHER, '--dir', dir, '--w', '480', '--h', '320',
        '--settle', '20', '--timeout', '60000',
        '--out', path.join(WORK, 'frame.png'),
    ], { encoding: 'utf8', cwd: ROOT });
    const text = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    const line = text.split('\n').find((l) => /^[✓✗] /.test(l.trim())) ?? '';
    // No verdict line at all means the browser never ran — this machine cannot
    // answer the question, which is neither a pass nor a failure of the claim.
    if (!line) {
        console.log('check-script-failure: the packaged game never started here — nothing to judge');
        console.log((text.trim().split('\n').slice(-4).join('\n')));
        process.exit(2);
    }
    return { text, ok: line.includes('✓'), errors: Number(/errors=(\d+)/.exec(line)?.[1] ?? -1) };
}

rmSync(WORK, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
mkdirSync(WORK, { recursive: true });

// 1. Declared and sound.
{
    const out = pack(project('sound'), 'sound');
    const cfg = JSON.parse(readFileSync(path.join(out, 'game.config.json'), 'utf8'));
    check('a project with code declares it in the package', cfg.scripts === 'scripts.mjs',
          `scripts ${JSON.stringify(cfg.scripts)}`);
    const run = boot(out);
    check('and boots clean', run.ok && run.errors === 0, `errors ${run.errors}`);
}

// 2. Not declared. The host must not go looking, and must not mind.
{
    const out = pack(project('none', (dir) => {
        const file = path.join(dir, 'project.esproject');
        const proj = JSON.parse(readFileSync(file, 'utf8'));
        delete proj.scriptEntry;
        delete proj.scripts;
        writeFileSync(file, JSON.stringify(proj, null, 2));
        rmSync(path.join(dir, 'src'), { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }), 'none');
    const cfg = JSON.parse(readFileSync(path.join(out, 'game.config.json'), 'utf8'));
    check('a project with no code declares none', cfg.scripts === undefined,
          `scripts ${JSON.stringify(cfg.scripts)}`);
    const run = boot(out);
    check('and boots clean without importing anything', run.ok && run.errors === 0,
          `errors ${run.errors}`);
}

// 3. Declared and throwing. The whole point.
{
    const out = pack(project('throwing', (dir) => {
        const entry = path.join(dir, 'src', 'main.ts');
        writeFileSync(entry, `throw new Error(${JSON.stringify(MARKER)});\n${readFileSync(entry, 'utf8')}`);
    }), 'throwing');
    const run = boot(out);
    check('a project whose code throws does not report a healthy boot', !run.ok && run.errors > 0,
          `errors ${run.errors}`);
    check('and the original message reaches the page', run.text.includes(MARKER),
          run.text.includes(MARKER) ? MARKER : 'marker not observed');
    check('named as a startup failure rather than a stray log',
          /startup failed/.test(run.text), '');
}

const failed = results.filter((ok) => !ok).length;
console.log(failed === 0
    ? `check-script-failure: ${results.length} claim(s) — a package cannot hide a boot it did not do`
    : `check-script-failure: ${failed} of ${results.length} claim(s) failed`);
process.exit(failed === 0 ? 0 : 1);
