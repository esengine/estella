// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { defineConfig } from 'vitest/config';

/**
 * The engine's own TypeScript suites — the asset pipeline and the build tooling.
 *
 * They used to live in desktop/tests, which made them the EDITOR's tests to run:
 * once the editor became an optional private submodule, a checkout without it had
 * no coverage of cook, export, the asset database or the gate libraries at all,
 * and nothing said so. What a test exercises decides where it lives.
 *
 * The SDK keeps its own config (sdk/vitest.config.ts) because it builds and runs
 * against a different target.
 *
 * NOT named vitest.config.ts: vitest walks up from its cwd, so a config at the
 * repo root becomes the one every workspace without its own picks up — which
 * pointed plugins/* at this include list and left them with no test files.
 */
export default defineConfig({
  test: {
    include: ['pipeline/tests/**/*.test.ts', 'tools/tests/**/*.test.ts'],
    environment: 'node',
    // The cook and export suites shell out and touch temp directories; the
    // default 5s is not enough for the ones that package a whole project.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
