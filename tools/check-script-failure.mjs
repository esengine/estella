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
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runElectron } from './lib/electronRun.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORK = path.join(ROOT, '.golden', 'script-failure');
const SOURCE = path.join(ROOT, 'examples', 'hello-world');

// It BOOTS what it packages, so it needs a real engine — the same two places the
// exporter looks. Skipped where building one is a choice, an error where CI has
// the artifact: otherwise "no runtime here" reads as "the package is broken".
const RUNTIME = [path.join(ROOT, 'build', 'wasm', 'web'),
                 path.join(ROOT, 'desktop', 'public', 'wasm')]
  .find((d) => existsSync(path.join(d, 'esengine.wasm')));
if (!RUNTIME) {
  const build = 'node build-tools/cli.js build -t web';
  if (process.env.ESTELLA_REQUIRE_WASM) {
    console.error('check-script-failure: ESTELLA_REQUIRE_WASM is set and there is no engine'
      + ` runtime in build/wasm/web or desktop/public/wasm.\n  ${build}`);
    process.exit(1);
  }
  console.log('check-script-failure: no engine runtime to boot — skipped'
    + ` (build it with \`${build}\`; the engine-coupled CI job sets ESTELLA_REQUIRE_WASM).`);
  process.exit(0);
}
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

/**
 * Errors that say the MACHINE could not render, not that the package is broken.
 *
 * A software rasteriser losing its context at frame 0 leaves a boot with
 * nothing drawn and three errors, none of them about the game. Judging that as
 * an unclean boot reports the runner's GPU as the package's defect.
 */
const GPU_GONE = /GPU device lost|createTexture failed|Failed to create texture/;

/**
 * What the launcher said the errors WERE, not how many.
 *
 * It prints each one indented under its verdict; this kept only the count, so a
 * failure read "errors 3" and left nothing to act on — a gate that saw the
 * answer and reported the arithmetic.
 */
function errorLines(text) {
    return text.split('\n').filter((l) => /^ {4}\S/.test(l.trimEnd())).map((l) => l.trim());
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
    const said = errorLines(run.text);
    // Every one of them, or none: a real script error beside a lost context is
    // still a real script error, and only a wholly environmental failure is
    // something this machine cannot answer.
    if (run.errors > 0 && said.length > 0 && said.every((l) => GPU_GONE.test(l))) {
        console.log('check-script-failure: the GPU went away before anything could be drawn'
            + ' — this machine cannot judge whether the package boots clean');
        for (const l of said) console.log(`    ${l}`);
        cleanup();
        process.exit(2);
    }
    check('and boots clean', run.ok && run.errors === 0,
          `errors ${run.errors}${run.errors > 0 ? ` — ${said.join(' | ')}` : ''}`);
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
          `errors ${run.errors}${run.errors > 0 ? ` — ${errorLines(run.text).join(' | ')}` : ''}`);
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
