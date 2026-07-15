// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Guards the packaging contract that ships the SDK's TypeScript
 *        declarations. electron-builder strips *.d.ts from node_modules by
 *        default (app-builder-lib excludedExts), so the node_modules/esengine
 *        copy carries the SDK's .js but NONE of its .d.ts. v0.23.0 shipped
 *        exactly that: a fresh project could not resolve `esengine` in the IDE
 *        and every open logged "SDK dist not found". The declarations must ride
 *        along as an explicit extraResource, and main.ts must read them.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const DESKTOP_ROOT = path.resolve(__dirname, '..');
const read = (rel: string): string => readFileSync(path.join(DESKTOP_ROOT, rel), 'utf8');

describe('SDK types packaging contract', () => {
  it('electron-builder stages the SDK .d.ts as a real resource (not via node_modules)', () => {
    const yml = read('electron-builder.yml');
    // The declarations come from the built SDK dist and land under
    // resources/sdk-types, filtered to declarations only. Assert each leg so a
    // partial edit (e.g. dropping the filter) still trips this guard.
    expect(yml).toContain('../sdk/dist');
    expect(yml).toContain('sdk-types');
    expect(yml).toContain('**/*.d.ts');
  });

  it('main.ts reads the shipped sdk-types resource for the types mirror', () => {
    const main = read('electron/main.ts');
    // The packaged candidate must be the resources/sdk-types dir — the
    // node_modules dist (SDK_DIST) has no declarations in a shipped build.
    expect(main).toMatch(/SDK_TYPES_CANDIDATES\s*=/);
    expect(main).toMatch(/process\.resourcesPath,\s*['"]sdk-types['"]/);
  });

  it('the built SDK dist actually carries declarations to ship', () => {
    // sdk/dist is a build artifact (gitignored); CI builds it before these
    // tests. When present, it must hold the declaration tree the mirror needs —
    // a JS-only dist is the failure mode this whole guard exists to catch.
    const dist = path.resolve(DESKTOP_ROOT, '..', 'sdk', 'dist');
    if (!existsSync(dist)) return;
    expect(existsSync(path.join(dist, 'index.d.ts'))).toBe(true);
  });
});
