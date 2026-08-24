// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  moduleBinary.mjs — is there a binary that answers for THIS code?
 *
 * A side module is built by hand and read by a gate, so the gate can be handed a
 * binary that predates the behaviour it asserts. That happened: `physics3d.wasm`
 * was five days old and the two character-controller cases added with the fix
 * reported the 3D world misbehaving, which was a true statement about a stale
 * binary and a false one about the engine.
 *
 * Missing and stale are the same condition — no binary answers for this code — so
 * they get one policy. Locally: a note and a skip, because building it is a
 * choice. Under ESTELLA_REQUIRE_WASM (the job that HAS the binary): fail, because
 * there a stale answer is worse than none.
 */
import { existsSync, statSync, readdirSync } from 'node:fs';
import path from 'node:path';

/** Newest mtime under a file or directory tree, 0 for a path that is not there. */
function newestMtime(target) {
    if (!existsSync(target)) return 0;
    const st = statSync(target);
    if (!st.isDirectory()) return st.mtimeMs;
    return readdirSync(target, { withFileTypes: true })
        .reduce((newest, e) => Math.max(newest, newestMtime(path.join(target, e.name))), 0);
}

/**
 * Exits the calling gate when no current binary exists; returns otherwise.
 *
 * @param {object} o
 * @param {string} o.gate    the gate's own name, for the message
 * @param {string} o.wasm    absolute path to the module binary
 * @param {string} o.rel     how to spell that path to a reader
 * @param {string[]} o.sources files/dirs it is built from, plus what asserts about it
 * @param {string} o.build   the command that rebuilds it
 */
export function requireCurrentModule({ gate, wasm, rel, sources, build }) {
    const required = Boolean(process.env.ESTELLA_REQUIRE_WASM);
    const verdict = (problem) => {
        if (required) {
            console.error(`${gate}: ESTELLA_REQUIRE_WASM is set but ${rel} ${problem}.\n`);
            console.error(`  ${build}`);
            process.exit(1);
        }
        console.log(`${gate}: ${rel} ${problem} — skipped (rebuild with \`${build}\`;`
            + ' CI sets ESTELLA_REQUIRE_WASM).');
        process.exit(0);
    };

    if (!existsSync(wasm)) verdict('is not built');

    const built = statSync(wasm).mtimeMs;
    const newest = sources.reduce((n, s) => Math.max(n, newestMtime(s)), 0);
    if (newest > built) {
        const days = Math.round((newest - built) / 86_400_000);
        verdict(`is older than the code it answers for (by ${days > 0 ? `${days}d` : 'under a day'})`);
    }
}
