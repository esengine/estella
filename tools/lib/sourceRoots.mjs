// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  sourceRoots.mjs — listing tracked sources across the editor boundary.
 *
 * The editor is a submodule: its files are not in this repo's index, so a plain
 * `git ls-files desktop/src` answers with nothing at all. A gate that scans it
 * would then quietly judge a smaller corpus and still print green — the failure
 * mode this exists to refuse. Ask the submodule's own index, and say when there
 * is none to ask.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const EDITOR = 'desktop';

/** Whether an editor checkout is present at all. */
export function hasEditor() {
    return existsSync(path.join(ROOT, EDITOR, 'package.json'));
}

function ls(cwd, args) {
    if (!args.length) return [];
    const tracked = execFileSync('git', ['ls-files', ...args], { cwd, encoding: 'utf8' })
        .split('\n').filter(Boolean);
    // The index still lists a file deleted from the working tree until the
    // deletion is staged, and every caller goes on to READ what it is handed —
    // so a gate run mid-edit died on ENOENT instead of reporting a finding.
    return tracked.filter((rel) => existsSync(path.join(cwd, rel)));
}

/**
 * Tracked files under `roots` (repo-relative), reading the editor's own index for
 * anything under `desktop/`. Returns `{ files, missing }` — `missing` names the
 * roots that had no checkout, for the caller to report rather than swallow.
 */
export function listTrackedSources(roots) {
    const editorRoots = roots.filter((r) => r === EDITOR || r.startsWith(`${EDITOR}/`));
    const ownRoots = roots.filter((r) => !editorRoots.includes(r));

    const files = ls(ROOT, ownRoots);
    if (!editorRoots.length) return { files, missing: [] };
    if (!hasEditor()) return { files, missing: editorRoots };

    const inner = editorRoots.map((r) => (r === EDITOR ? '.' : r.slice(EDITOR.length + 1)));
    for (const rel of ls(path.join(ROOT, EDITOR), inner)) files.push(`${EDITOR}/${rel}`);
    return { files, missing: [] };
}

export { ROOT, EDITOR };
