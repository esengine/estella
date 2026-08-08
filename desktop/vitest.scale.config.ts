// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

/**
 * @file  Config for the scale suite, which runs against a 50,000-asset corpus.
 *
 * Kept out of `vitest.config.ts` so an ordinary test run neither generates that
 * tree nor waits for it — drive it through `node tools/perf-budget.mjs`, which
 * makes the corpus first. One process and no parallelism, because the
 * calibration every budget divides by is measured once per process and two
 * suites racing for the same two cores would each be measuring the other.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/scale/**/*.scale.ts'],
    fileParallelism: false,
    // One module graph for the whole run, so the three suites share one
    // calibration and append to one report instead of each isolating its own
    // copy of the harness and overwriting the others' numbers.
    isolate: false,
    pool: 'forks',
    poolOptions: {
      // --expose-gc: the retained-heap budgets are meaningless without a
      // collection they can force.
      forks: { singleFork: true, execArgv: ['--expose-gc'] },
    },
    testTimeout: 600_000,
    hookTimeout: 600_000,
  },
});
