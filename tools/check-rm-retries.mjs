#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-rm-retries.mjs — a recursive delete on Windows retries, or it is
 *        a flake somebody will spend an afternoon on.
 *
 * Deleting on Windows is not synchronous at the filesystem level: an unlinked
 * file sits in a pending-delete state, its directory entry still there, and the
 * `rmdir` that follows sees a directory that is not empty. So a test that writes
 * a temp tree and removes it fails with `ENOTEMPTY` at random — on a machine
 * with an indexer or a virus scanner, often. It reads as a bug in whatever ran
 * last, which is how it costs an afternoon.
 *
 * Node retries exactly these errors, and `fs.rm` already carries the loop —
 * but `maxRetries` DEFAULTS TO 0, so every call written the obvious way has it
 * switched off. `force: true` does not help: that suppresses `ENOENT`, nothing
 * else. There were 133 such calls and not one set it.
 *
 * Only recursive removes are asked: `maxRetries` is ignored without `recursive`,
 * so requiring it there would be cargo.
 *
 *   node tools/check-rm-retries.mjs
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listTrackedSources } from './lib/sourceRoots.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOTS = ['sdk', 'pipeline', 'tools', 'compiler', 'plugins', 'bench', 'build-tools', 'desktop'];

const { files, missing } = listTrackedSources(ROOTS);
const findings = [];

for (const rel of files) {
    if (!/\.(ts|tsx|mts|mjs|js)$/.test(rel)) continue;
    let text;
    try {
        text = readFileSync(path.join(ROOT, rel), 'utf8');
    } catch {
        continue;
    }
    if (!/\brm(Sync)?\(/.test(text)) continue;
    text.split('\n').forEach((line, i) => {
        if (!/\brm(Sync)?\(/.test(line)) return;
        if (!/recursive:\s*true/.test(line)) return;
        if (/maxRetries/.test(line)) return;
        findings.push(`${rel}:${i + 1}  ${line.trim()}`);
    });
}

// A skipped root has to say so: silence there reads as a clean bill.
for (const m of missing) console.log(`not checked (no checkout): ${m}`);

if (findings.length) {
    console.error(`check-rm-retries: ${findings.length} recursive delete(s) with retries off.`);
    console.error('Add `maxRetries: 10, retryDelay: 50` — on Windows the rmdir races the unlink.');
    for (const f of findings) console.error(`  ${f}`);
    process.exit(1);
}
console.log('check-rm-retries: every recursive delete retries.');
