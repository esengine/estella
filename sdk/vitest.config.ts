// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { defineConfig } from 'vitest/config';
import path from 'path';
import { stripShaderComments } from './scripts/strip-shader-comments.mjs';

export default defineConfig({
    // The suites run on the shader text the bundle ships: the build strips its comments and indentation, and code that reads a
    // shader by its text (modelDetail, Ground Blend, Voxel Ground) has to hold on that text, not only on the source as written.
    plugins: [{ ...stripShaderComments(), enforce: 'pre' }],
    test: {
        globals: true,
        environment: 'happy-dom',
        setupFiles: ['tests/setup.ts'],
        // Proves the engine build is REACHABLE before anything collects, so an
        // unavailable one fails rather than skipping. See globalSetup.ts.
        globalSetup: ['tests/globalSetup.ts'],
        include: ['tests/**/*.test.ts'],
        // The soak suite judges heap growth, and a heap nobody can collect only
        // climbs. Without this the census downgrades its heap counters to
        // unasserted `info` rather than reporting every run as a leak.
        poolOptions: {
            forks: { execArgv: ['--expose-gc'] },
            threads: { execArgv: ['--expose-gc'] },
        },
        benchmark: {
            include: ['benchmarks/**/*.bench.ts'],
        },
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
            include: ['src/**/*.ts'],
            exclude: [
                'src/**/*.d.ts',
                'src/wasm.ts',
                'src/index.*.ts',
            ],
        },
    },
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
});
