// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
// @ts-expect-error a build script, plain JavaScript
import { workerModules } from '../scripts/worker-source.mjs';

describe('the scripts the engine starts its workers from', () => {
    it('are what their sources make now (run node scripts/build-worker.mjs after changing a worker or what it draws with)', async () => {
        const made = await workerModules() as { path: string; source: string; entry: string }[];
        expect(made.map((m) => m.entry)).toEqual(['src/worldgen/planWorker.ts', 'src/image/recipeWorker.ts', 'src/sound/soundWorker.ts']);
        for (const m of made) expect(readFileSync(m.path, 'utf8'), m.entry).toBe(m.source);
    });
});
