// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The packaged host looks each name up in the registry that holds it.
 *
 * A package may ship without any given subsystem, so the host reaches its
 * diagnostics by NAME rather than by import. There are two registries behind
 * those names — components and resources — and asking the wrong one answers
 * `null` rather than throwing: `pathBetween` asked the component registry for
 * `Nav`, got nothing, and every route it was asked for came back as no route,
 * which read as a game that could not walk.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const HOST = readFileSync(path.resolve(__dirname, '../src/runtime/gameHost.ts'), 'utf8');

/**
 * Every name `defineResource` was given, which is the only author of what a
 * resource is called. `resourceShapes.ts` holds only the ones a compiled module
 * has to marshal — `Nav` is not in it, so a test that read that list would have
 * been blind to the exact case this exists for.
 */
function resourceNames(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) resourceNames(p, out);
    else if (e.name.endsWith('.ts')) {
      for (const m of readFileSync(p, 'utf8').matchAll(/defineResource\s*(?:<[^>]*>)?\s*\([^)]*?['"]([A-Za-z0-9_]+)['"]\s*\)/g)) {
        out.push(m[1]);
      }
    }
  }
  return out;
}
const RESOURCES = [...new Set(resourceNames(path.resolve(__dirname, '../../sdk/src')))];

/** Every name handed to a COMPONENT-registry lookup in the host. */
function componentLookups(src: string): string[] {
  return [...src.matchAll(/(?:optionalDef|optionalRead\([^,]+,\s*[^,]+,|countOfIn\([^,]+,|optionalEntities\([^,]+,)\s*\(?'([A-Za-z0-9_]+)'/g)]
    .map((m) => m[1]);
}

describe('the packaged host’s by-name lookups', () => {
  it('never asks the component registry for something that is a resource', () => {
    const asked = componentLookups(HOST);
    expect(asked.length, 'no lookups found — the pattern stopped matching the host').toBeGreaterThan(0);
    expect(RESOURCES, 'no defineResource names found — the scan stopped matching').toContain('Nav');
    const resources = asked.filter((n) => RESOURCES.includes(n));
    expect(resources, 'these are resources; ask app.getResourceByName instead').toEqual([]);
  });
});
