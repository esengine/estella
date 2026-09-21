// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The headless SDK a benchmark measures, and what build it was.
 *
 * One author: three replication benchmarks had each written this out, and a
 * benchmark that loads the wrong build does not fail — it reports very stable
 * numbers for yesterday's code.
 */
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const NODE_ENTRY = ['sdk', 'dist', 'index.node.js'];
/** Replication is a subpath, on the headless entry as on every other. */
const REPLICATION = ['sdk', 'dist', 'net', 'replication', 'index.js'];

/** The newest hand-written .ts under `dir`, in epoch ms. */
function newestSource(dir) {
    let newest = 0;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue;
        const full = path.join(dir, entry.name);
        newest = Math.max(newest, entry.isDirectory() ? newestSource(full)
            : entry.name.endsWith('.ts') ? statSync(full).mtimeMs : 0);
    }
    return newest;
}

/**
 * What was actually measured: the commit, and the artifact the arms imported.
 * A benchmark cannot tell a stale build from a fast one, so the identity ships
 * with the result.
 */
export function sdkIdentity(root) {
    const entry = path.join(root, ...NODE_ENTRY);
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim();
    return {
        gitHead: head,
        workingTreeClean: dirty.length === 0,
        sdkArtifactSha256: createHash('sha256').update(readFileSync(entry)).digest('hex').slice(0, 16),
        sdkBuiltAt: new Date(statSync(entry).mtimeMs).toISOString(),
    };
}

/**
 * Load the SDK's headless build, refusing one older than the sources it is
 * built from. The replication subpath comes with it: both entries share one
 * chunk graph, so this is one core — merged rather than returned separately so
 * an arm names `sdk.Net` the way it always did.
 */
export async function loadSdk(root) {
    const entry = path.join(root, ...NODE_ENTRY);
    if (newestSource(path.join(root, 'sdk', 'src')) > statSync(entry).mtimeMs) {
        throw new Error('sdk/dist is older than sdk/src — this run would measure the previous'
            + ' commit. Build it with `pnpm --filter ./sdk build`.');
    }
    const [core, replication] = await Promise.all([
        import(pathToFileURL(entry).href),
        import(pathToFileURL(path.join(root, ...REPLICATION)).href),
    ]);
    return { ...core, ...replication };
}
