// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { defineConfig } from 'vitest/config';

/**
 * Stated rather than inferred. Vitest walks UP from its cwd for a config, so a
 * package without one runs on whatever it finds above — a root config once
 * pointed these at the engine's include list and left them with no test files,
 * passing by having nothing to run.
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Cook and export shell out and touch temp directories.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
