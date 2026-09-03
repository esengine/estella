// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    hostCC.ts
 * @brief   The C compiler that builds for the machine this is running on.
 *
 * @details Two callers want the same answer and must not each have their own:
 *          the differentials, which compile the runtime header and compare bits,
 *          and the AOT build step, which compiles a project's systems into a
 *          library a native host loads into its own process.
 *
 *          clang first because it is what the wasm and aarch64 paths are; gcc is
 *          accepted, and is arguably the better witness — agreeing with a SECOND
 *          implementation of C says more than agreeing with the one the lowering
 *          was written against.
 *
 *          The candidate has to BUILD something, not merely answer `--version`.
 *          emsdk's clang shadows the system one on PATH, reports `Target:
 *          unknown`, and answers `--version` with 0 while refusing every host
 *          compile — so the wrong probe reddens exactly the machines that can
 *          run AOT.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** What a loadable module is called here. The host resolves it by name. */
export function nativeModuleExt(platform: string = process.platform): string {
    if (platform === 'win32') return '.dll';
    return platform === 'darwin' ? '.dylib' : '.so';
}

/**
 * Linking a compiled system into a module a native host loads.
 *
 * `-fPIC` because it is loaded, not linked; nothing else, because the C calls
 * only what `estella_abi.h` defines `static inline` — the module has no
 * undefined symbol to resolve and wants none of libc.
 *
 * Windows takes only `-shared`: a DLL is position-independent by construction,
 * and clang on the MSVC ABI REJECTS `-fPIC` rather than ignoring it.
 */
export function nativeLinkFlags(platform: string = process.platform): readonly string[] {
    return platform === 'win32' ? ['-shared'] : ['-shared', '-fPIC'];
}

/**
 * The host C compiler, or null where this machine has none.
 *
 * Never throws and never installs anything: a machine without one still builds
 * every project that promised nothing, so the refusal belongs to the step that
 * knows whether anything was promised.
 */
export function findHostCC(): string | null {
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

/** How a checkout with no compiler says so, rather than skipping in silence. */
export const NO_HOST_CC = 'ESTELLA_NO_HOST_CC';

/**
 * Prove the machine can compile before a suite claims to have compared
 * anything. The differentials are the only thing holding the C half of the ABI
 * to the TypeScript, so a run either has a compiler or declares that it has
 * none — a skip nobody declared reads exactly like a test that ran.
 */
export function proveHostCC(suite: string): void {
    if (findHostCC()) return;
    if (process.env[NO_HOST_CC] === '1') {
        console.warn(`\n[${suite}] ${NO_HOST_CC}=1 — nothing that needs a C compiler ran.\n`
            + '            This run does not compare the emitted C against the interpreter,\n'
            + '            and does not compile the ABI struct checks.\n');
        return;
    }
    throw new Error(
        'no C compiler on PATH (tried clang, gcc, cc).\n'
        + '  The differentials need one, and skipping them would report a partial run as a\n'
        + `  clean one. Install one, or declare the gap with ${NO_HOST_CC}=1 — which the\n`
        + '  gate runner then counts as something this machine could not answer.');
}
