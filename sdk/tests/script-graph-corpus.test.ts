// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    script-graph-corpus.test.ts
 * @brief   Every `.esgraph` the repo ships compiles clean against the real
 *          vocabulary.
 *
 * A graph naming something nothing registered, or wiring a port that does not
 * exist, still loads: the interpreter reports it and runs what is left. That is
 * right at runtime and wrong for a file we ship — it means the demo an author
 * opens quietly does less than it looks like it does. Compiling is cheap and the
 * answer is exact, so the corpus is held to zero problems.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { aiRegistry } from '../src/ai/fsm/AiContext';
import { ensureBuiltinAiRegistrations } from '../src/ai/builtins';
import { ensureBuiltinScriptNodes } from '../src/logic/builtinNodes';
import { compileScriptGraph } from '../src/logic/ScriptGraphRunner';
import type { ScriptGraph } from '../src/logic/types';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function graphsUnder(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules' || entry === '.esengine' || entry.startsWith('.')) continue;
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) graphsUnder(full, out);
        else if (entry.endsWith('.esgraph')) out.push(full);
    }
    return out;
}

/**
 * The names a PROJECT registers are not in this process — the extractor is what
 * carries those to a reader that does not run game code. A `demo.`-prefixed ref
 * is that case and is not a corpus fault.
 */
const PROJECT_PREFIX = /^demo\./;

describe('the shipped script graphs', () => {
    ensureBuiltinAiRegistrations();
    ensureBuiltinScriptNodes();

    const files = [
        ...graphsUnder(path.join(ROOT, 'examples')),
        ...graphsUnder(path.join(ROOT, 'templates')),
    ];

    it('exist at all — a corpus with none proves nothing', () => {
        expect(files.length).toBeGreaterThan(0);
    });

    for (const file of files) {
        const rel = path.relative(ROOT, file);
        it(`${rel} compiles with nothing missing`, () => {
            const graph = JSON.parse(readFileSync(file, 'utf8')) as ScriptGraph;
            const compiled = compileScriptGraph(graph, aiRegistry);
            const problems = compiled.problems.filter((p) => !PROJECT_PREFIX.test(p.split('"')[1] ?? ''));
            expect(problems).toEqual([]);
            // A graph nothing can start is a picture. Every one of these ships as
            // behaviour, so every one owes an entry.
            const entries = compiled.starts.length + compiled.updates.length
                + compiled.destroys.length + compiled.events.size;
            expect(entries, 'no entry node — nothing would ever run it').toBeGreaterThan(0);
        });
    }
});
