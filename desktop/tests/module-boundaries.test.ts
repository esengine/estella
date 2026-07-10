// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  module-boundaries.test.ts
 * @brief Guard: shared code lives in components/, panels export nothing but
 *        themselves. `@/panels/X` may be imported only by the dock registry
 *        (src/layout/*) or by X's own feature files (allowlisted sub-parts).
 *        Anything else — a panel reaching into another panel, a component
 *        importing a panel — fails here instead of shipping as drift.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(__dirname, '..', 'src');

/** Same-feature compositions: a panel and its own sub-part file. */
const ALLOWED_SUBPARTS = new Set(['Sequencer -> SequencerCurve']);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe('module boundaries', () => {
  it('only the dock registry (layout/) and own sub-parts import from @/panels', () => {
    const violations: string[] = [];
    for (const file of walk(SRC)) {
      const rel = relative(SRC, file).replaceAll('\\', '/');
      if (rel.startsWith('layout/')) continue; // dock registry mounts panel roots
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/from '@\/panels\/(\w+)'/g)) {
        const imported = m[1];
        const self = rel.match(/^panels\/(\w+)\.tsx?$/)?.[1];
        if (self === imported) continue; // importing your own module is fine
        if (self && ALLOWED_SUBPARTS.has(`${self} -> ${imported}`)) continue;
        violations.push(`${rel} imports @/panels/${imported}`);
      }
    }
    expect(violations, `Shared code belongs in components/ — move it there instead of importing across panel lines:\n${violations.join('\n')}`).toEqual([]);
  });
});
