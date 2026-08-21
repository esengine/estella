// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The plugin API's two self-consistency rules.
 *
 * 1. `types.ts` must describe the WHOLE public surface, runtime functions included.
 *    It is copied verbatim into a project as `editor-api.d.ts`, so a runtime export
 *    that isn't declared there is a function authors can call but cannot type —
 *    exactly the gap `definePlugin` fell into.
 *
 * 2. `types.ts` must stay import-free. One import and the copied file stops being
 *    valid standalone typings, silently breaking every plugin's tsconfig.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as api from '@/plugins/api';
import { importsAnotherModule } from '../../tools/lib/moduleImports.mjs';

const TYPES_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../editor-api/index.ts');
const source = readFileSync(TYPES_FILE, 'utf8');

describe('plugin API surface', () => {
  it('declares every runtime export of @estella/editor-api', () => {
    const runtimeExports = Object.keys(api).filter((k) => typeof (api as Record<string, unknown>)[k] === 'function');
    expect(runtimeExports.length).toBeGreaterThan(0);
    for (const name of runtimeExports) {
      expect(
        new RegExp(`export declare (function|const) ${name}\\b`).test(source),
        `types.ts does not declare runtime export "${name}" — authors can call it but cannot type it`,
      ).toBe(true);
    }
  });

  it('keeps types.ts import-free so the shipped .d.ts stands alone', () => {
    // The push gate refuses the same thing, through this same predicate — two
    // regexes for one rule is how one of them ends up accepting what the other
    // refuses (a method named `import(` was exactly that).
    const imports = source
      .split('\n')
      .filter((line) => importsAnotherModule(line) && !line.trim().startsWith('*'));
    expect(imports, 'types.ts must not import anything (it ships as standalone typings)').toEqual([]);
    for (const line of ["import x from 'y';", "import{a}from'y'", 'import * as y from "y"', "import 'y'",
      '  import type { A } from "y"', "export * from './x'", "export { a } from './x'"]) {
      expect(importsAnotherModule(line), `${line} must count as an import`).toBe(true);
    }
    expect(importsAnotherModule('  import(path: string): void;')).toBe(false);
  });

  it('exposes definePlugin as an identity function', () => {
    const plugin = { activate: () => {} };
    expect(api.definePlugin(plugin)).toBe(plugin);
  });

  it('localize falls back to en, then to any value', () => {
    expect(api.localize({ en: 'Tools', 'zh-CN': '工具' }, 'zh-CN')).toBe('工具');
    expect(api.localize({ en: 'Tools' }, 'de')).toBe('Tools');
    expect(api.localize('plain', 'de')).toBe('plain');
    expect(api.localize(undefined, 'en')).toBe('');
  });
});
