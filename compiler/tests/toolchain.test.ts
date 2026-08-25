// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    toolchain.test.ts
 * @brief   The TypeScript this compiler is tested with is the one it will get.
 *
 * @details The frontend parses a project with the real `typescript`, and the
 *          CLI resolves it from the PIPELINE package — the export bundle keeps
 *          it external, because it is CommonJS that probes `__filename` and
 *          throws inside an ESM bundle. So two versions can be in play: the one
 *          these tests prove the subset against, and the one that actually
 *          lowers a shipped project. That difference is a parser difference.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('the parser this compiler gets', () => {
    it('is the same file the CLI would hand it', () => {
        const here = createRequire(import.meta.url).resolve('typescript');
        const viaPipeline = createRequire(resolve(ROOT, 'pipeline/package.json')).resolve('typescript');
        expect(here).toBe(viaPipeline);
    });
});
