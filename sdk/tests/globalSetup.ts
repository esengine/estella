// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    globalSetup.ts — the engine build has to be REACHABLE before a run
 *          claims to have covered the boundary.
 *
 * @details A `skip` says "this test does not apply to how you are configured".
 *          It was also saying "I could not get at the thing this test needs",
 *          and those read the same in a summary: an invocation whose working
 *          directory put the build outside vite's reach reported 5110 passed and
 *          309 skipped, no failures, while 43 suites had not run at all.
 *
 *          So the environment is proved ONCE, here, by doing exactly what the
 *          suites do — importing the engine's glue — and a run that cannot is
 *          stopped before it can report a partial pass as a clean one. A run
 *          that genuinely has no engine build says so with SDK_TEST_MODE, and
 *          then a skip means what it should.
 */
import { existsSync } from 'fs';
import { resolve } from 'path';
import { WASM_DIR, WASM_FILE, SIDE_MODULES, NO_WASM_MODE } from './helpers/loadWasm';

/** The package this suite belongs to — where it has to be run from. */
const SDK_ROOT = resolve(__dirname, '..');

/** The command that is known to place the build within reach. */
const CANONICAL = 'pnpm --filter ./sdk test   (or: cd sdk && npx vitest run)';

export default async function setup(): Promise<void> {
    if (NO_WASM_MODE) {
        console.warn(
            '\n[sdk-tests] SDK_TEST_MODE=no-wasm — the engine boundary suites will NOT run.\n'
            + '            This run does not cover the C++/TS boundary, the side modules, '
            + 'or anything that poses a skeleton.\n',
        );
        return;
    }

    if (!existsSync(WASM_FILE)) {
        throw new Error(
            `no engine build at ${WASM_FILE}.\n`
            + '  The boundary suites need it, and skipping them would report a partial run '
            + 'as a clean one.\n'
            + '  Build it (`node build-tools/cli.js build -t web`), or declare the gap with '
            + 'SDK_TEST_MODE=no-wasm.',
        );
    }

    // Existence is not REACH: vite derives its allowed roots from the working
    // directory, not from `--root`. Checked rather than probed — an import from
    // here takes a different loader than the test files do.
    if (resolve(process.cwd()) !== resolve(SDK_ROOT)) {
        throw new Error(
            `the SDK suite must run with ${SDK_ROOT} as the working directory.\n`
            + `  It is ${process.cwd()}, and from there the engine build at ${WASM_DIR}\n`
            + '  is outside what this run may load — the boundary suites would not collect,\n'
            + '  and vitest would report their tests as SKIPPED rather than as unavailable.\n'
            + `  Run the SDK suite as: ${CANONICAL}`,
        );
    }

    const missing = SIDE_MODULES.filter((name) => !existsSync(resolve(WASM_DIR, `${name}.wasm`)));
    if (missing.length === 0) return;
    // Said out loud rather than failed: a partial build is a normal thing to be
    // iterating on. Silence is what it may not be.
    const message = `\n[sdk-tests] ${missing.length} side module(s) not built: ${missing.join(', ')}\n`
        + '            Their suites will not run. Build with `node build-tools/cli.js build -t all`.\n';
    if (process.env.ESTELLA_REQUIRE_WASM) {
        throw new Error(`${message}  ESTELLA_REQUIRE_WASM is set — this job is meant to cover them.`);
    }
    console.warn(message);
}
