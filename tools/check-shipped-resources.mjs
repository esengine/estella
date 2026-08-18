// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-shipped-resources.mjs — what the editor loads off disk, it ships.
 *
 * A `build-tools/<name>` holding a `.wasm` is a real file at runtime, not a
 * module a bundler can inline: its loader finds the binary beside itself. In the
 * repo the relative path resolves; in an installed app it resolves inside
 * `app.asar`, where nothing is — unless electron-builder was told to stage the
 * directory as an extra resource.
 *
 * Nothing fails until someone installs a release and imports a model, which is
 * the worst moment to find out. Both halves are declarations, so this pairs them.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUILDER = path.join('desktop', 'electron-builder.yml');

/** Trees whose code is bundled into the editor's main process. */
const SHIPPED = ['pipeline/src', 'desktop/electron', 'desktop/src'];

/** `build-tools/<name>` referenced from a `from '…'` or `import('…')` specifier. */
const REFERENCE = /(?:from\s*|import\s*\(\s*)['"][^'"]*build-tools\/([\w.-]+)\//g;

/** Whether a directory carries something a bundler cannot inline. */
function hasBinary(name) {
    try {
        return readdirSync(path.join(ROOT, 'build-tools', name))
            .some((f) => /\.(wasm|node|data|bin)$/.test(f));
    } catch {
        return false;
    }
}

const files = execFileSync('git', ['ls-files', ...SHIPPED], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter((f) => /\.(ts|tsx|mts|mjs|js)$/.test(f));

/** name → the files that reach it. */
const needed = new Map();
for (const file of files) {
    const text = readFileSync(path.join(ROOT, file), 'utf8');
    for (const [, name] of text.matchAll(REFERENCE)) {
        if (!hasBinary(name)) continue;
        if (!needed.has(name)) needed.set(name, []);
        needed.get(name).push(file);
    }
}

const builder = readFileSync(path.join(ROOT, BUILDER), 'utf8');
const staged = new Set(
    [...builder.matchAll(/-\s*from:\s*\.\.\/build-tools\/([\w.-]+)\s*$/gm)].map((m) => m[1]));

const problems = [];
for (const [name, readers] of needed) {
    if (staged.has(name)) continue;
    problems.push(`build-tools/${name} carries a binary and is loaded at runtime by ${readers[0]}`
        + `${readers.length > 1 ? ` (and ${readers.length - 1} more)` : ''},`
        + ` but ${BUILDER} does not stage it — an installed editor would not find it.`
        + `\n    Add to extraResources:  - from: ../build-tools/${name}`
        + `\n                              to: build-tools/${name}`);
}

if (problems.length > 0) {
    console.error(problems.join('\n'));
    console.error(`\ncheck-shipped-resources: ${problems.length} unstaged resource(s).`);
    process.exit(1);
}
console.log(`check-shipped-resources: ${needed.size} build-tools binar${needed.size === 1 ? 'y' : 'ies'}`
    + ' reached at runtime, all staged into the package.');
