// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    hostCC.ts
 * @brief   The host C compiler a differential needs, or nothing.
 *
 * @details clang first because it is what Stage 2 ships with — emcc is clang and
 *          the aarch64 path is clang. gcc is accepted, and is arguably the better
 *          witness: agreeing with a SECOND independent implementation of C says
 *          more than agreeing with the one the lowering was written against.
 *
 *          The candidate has to BUILD something, not merely answer `--version`.
 *          emsdk's clang shadows the system one on PATH, reports `Target:
 *          unknown`, and answers `--version` with 0 while refusing every host
 *          compile — so the wrong probe reddens these differentials on exactly
 *          the machines that can run AOT.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function findCC(): string | null {
    const dir = mkdtempSync(join(tmpdir(), 'estella-cc-'));
    const src = join(dir, 'probe.c');
    writeFileSync(src, 'int main(void) { return 0; }\n');
    for (const cc of ['clang', 'gcc', 'cc']) {
        if (spawnSync(cc, ['-std=c11', '-o', join(dir, `probe-${cc}`), src], { encoding: 'utf8' }).status === 0) {
            return cc;
        }
    }
    return null;
}
