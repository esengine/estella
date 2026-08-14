// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-headless-export.mjs — a project ships without the editor.
 *
 * The pipeline can only be called from a build server if nothing in it needs the
 * process that edits a project. `check-pipeline-boundary` keeps the imports
 * honest, but an import graph does not prove a build: a path into the editor's
 * output, a file only its packaging writes, and packaging is quietly editor-only
 * again with every gate still green.
 *
 * So this RUNS one. A real example project, through the command line, with no
 * editor built and no editor process anywhere — and then reads the package.
 *
 * The engine binary is stubbed: it is copied, never parsed, and it is not what
 * this checks. That a package made this way actually boots and draws is
 * `verify-golden`, which runs where a real runtime and a GPU exist.
 *
 *   node tools/check-headless-export.mjs
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT = path.join(ROOT, 'examples', 'hello-world');
const CLI = path.join(ROOT, 'pipeline', 'bin', 'estella.mjs');

/** What a web package has to carry to be one at all. */
const EXPECTED = ['index.html', 'game.js', 'game.config.json', 'scripts.mjs', 'sdk', 'wasm', 'assets'];

const work = mkdtempSync(path.join(tmpdir(), 'estella-headless-'));
const out = path.join(work, 'package');
const wasm = path.join(work, 'runtime');
mkdirSync(wasm, { recursive: true });
for (const name of ['esengine.js', 'esengine.wasm']) writeFileSync(path.join(wasm, name), '');

function fail(message, detail) {
  console.error(`check-headless-export: ${message}`);
  if (detail) console.error(detail);
  rmSync(work, { recursive: true, force: true });
  process.exit(1);
}

const run = spawnSync(process.execPath, [
  CLI, 'export', PROJECT, '--platform', 'web', '--out', out, '--wasm', wasm,
], { encoding: 'utf8', cwd: ROOT });

if (run.status !== 0) fail(`the export exited ${run.status}.`, run.stderr || run.stdout);

const brace = run.stdout.indexOf('{');
let result;
try {
  result = JSON.parse(run.stdout.slice(brace));
} catch {
  fail('the export printed no result JSON.', run.stdout.slice(-2000));
}

if (!result.ok) fail('the export reported failure.', result.errors?.join('\n'));

const missing = EXPECTED.filter((name) => !existsSync(path.join(out, name)));
if (missing.length > 0) fail(`the package is missing ${missing.join(', ')}.`);

rmSync(work, { recursive: true, force: true });
console.log(`check-headless-export: ${path.basename(PROJECT)} packaged for web from the command line — ${EXPECTED.length} artifact(s) present.`);
