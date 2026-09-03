import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
    test: {
        include: ['tests/**/*.test.ts'],
        environment: 'node',
        // The differentials need a C compiler; a run without one must declare
        // it rather than skip. See globalSetup.ts.
        globalSetup: ['tests/globalSetup.ts'],
    },
    resolve: {
        alias: {
            // So a test can import a real example system, whose own imports the
            // stub answers. Without this the oracle would be a re-typed copy.
            esengine: fileURLToPath(new URL('./tests/stubs/esengine.ts', import.meta.url)),
        },
    },
});
