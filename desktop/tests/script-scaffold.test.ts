// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The New Script door: a scaffolded module lands in the project's SOURCE
 *        root and the entry its kind belongs to gains the one line that pulls it
 *        in. The wiring is the whole point — a `.ts` neither entry reaches is
 *        never bundled and never extracted, so its component would never appear
 *        in Add Component no matter how correct the file is.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { scaffoldScript } from '../electron/scriptScaffold';
import {
  importSpecifier, scriptModulePath, scriptNameProblem, scriptTargetDir, scriptWiring,
} from '@/project/scripts';

const ENTRIES = { register: 'src/components.ts', main: 'src/main.ts' };

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'estella-script-'));
  mkdirSync(path.join(root, 'src'), { recursive: true });
  writeFileSync(path.join(root, 'src/components.ts'), 'export {};\n');
  writeFileSync(path.join(root, 'src/main.ts'), "import './components';\n");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const read = (rel: string): string => readFileSync(path.join(root, rel), 'utf8');

describe('scriptNameProblem', () => {
  it('accepts an identifier and rejects what cannot be one', () => {
    expect(scriptNameProblem('Patrol')).toBeNull();
    expect(scriptNameProblem('  Patrol  ')).toBeNull();
    expect(scriptNameProblem('_private$1')).toBeNull();
    expect(scriptNameProblem('')).toMatch(/required/);
    expect(scriptNameProblem('2fast')).toMatch(/digit/);
    expect(scriptNameProblem('my component')).toMatch(/letters/);
    expect(scriptNameProblem('my-component')).toMatch(/letters/);
    expect(scriptNameProblem('class')).toMatch(/reserved/);
  });
});

describe('where a script goes', () => {
  it('honours the browsed folder when it is inside the source root', () => {
    expect(scriptTargetDir('src', ENTRIES)).toBe('src');
    expect(scriptTargetDir('src/systems', ENTRIES)).toBe('src/systems');
  });

  it('redirects a folder outside the source root — a module out there is never reached', () => {
    expect(scriptTargetDir('assets/spine', ENTRIES)).toBe('src');
    expect(scriptTargetDir('', ENTRIES)).toBe('src');
    expect(scriptTargetDir(undefined, ENTRIES)).toBe('src');
    // "srcish" must not pass as being under "src".
    expect(scriptTargetDir('srcish/deep', ENTRIES)).toBe('src');
  });

  it('follows a project that renamed its entries, rather than the convention', () => {
    const custom = { register: 'game/decl.ts', main: 'game/boot.ts' };
    expect(scriptTargetDir('assets', custom)).toBe('game');
    expect(scriptTargetDir('game/ai', custom)).toBe('game/ai');
  });
});

describe('importSpecifier', () => {
  it('is relative to the entry, extensionless, and always dot-prefixed', () => {
    expect(importSpecifier('src/components.ts', 'src/Patrol.ts')).toBe('./Patrol');
    expect(importSpecifier('src/main.ts', 'src/systems/Chase.ts')).toBe('./systems/Chase');
    expect(importSpecifier('src/deep/main.ts', 'src/Patrol.ts')).toBe('../Patrol');
    expect(importSpecifier('main.ts', 'src/Patrol.ts')).toBe('./src/Patrol');
  });
});

describe('scaffoldScript — component', () => {
  it('writes the module and re-exports it from the DECLARATION entry', async () => {
    const res = await scaffoldScript(root, { kind: 'component', name: 'Patrol', dir: 'src', entries: ENTRIES });
    expect(res.ok).toBe(true);
    expect(res.path).toBe('src/Patrol.ts');
    expect(res.wiredInto).toBe('src/components.ts');

    const src = read('src/Patrol.ts');
    expect(src).toContain("import { defineComponent } from 'esengine';");
    expect(src).toContain("export const Patrol = defineComponent('Patrol', {");
    expect(read('src/components.ts')).toContain("export * from './Patrol';");
    // The startup entry is not touched — a declaration is not behaviour.
    expect(read('src/main.ts')).toBe("import './components';\n");
  });

  it('redirects a create from an assets folder into the source root', async () => {
    const res = await scaffoldScript(root, { kind: 'component', name: 'Health', dir: 'assets/art', entries: ENTRIES });
    expect(res.path).toBe('src/Health.ts');
    expect(existsSync(path.join(root, 'assets/art/Health.ts'))).toBe(false);
  });

  it('wires a nested module by a path the entry can actually import', async () => {
    const res = await scaffoldScript(root, { kind: 'component', name: 'Ammo', dir: 'src/gameplay', entries: ENTRIES });
    expect(res.path).toBe('src/gameplay/Ammo.ts');
    expect(read('src/components.ts')).toContain("export * from './gameplay/Ammo';");
  });
});

describe('scaffoldScript — system', () => {
  it('writes a self-registering module and imports it from the STARTUP entry', async () => {
    const res = await scaffoldScript(root, { kind: 'system', name: 'Chase', dir: 'src', entries: ENTRIES });
    expect(res.ok).toBe(true);
    expect(res.wiredInto).toBe('src/main.ts');

    const src = read('src/Chase.ts');
    expect(src).toContain('export const chaseSystem = defineSystem(');
    expect(src).toContain('addSystemToSchedule(Schedule.Update, chaseSystem);');
    expect(read('src/main.ts')).toContain("import './Chase';");
    // The declaration entry is not touched — behaviour is not a declaration.
    expect(read('src/components.ts')).toBe('export {};\n');
  });
});

describe('scaffoldScript — safety', () => {
  it('refuses a name that cannot be an identifier, writing nothing', async () => {
    const res = await scaffoldScript(root, { kind: 'component', name: 'my comp', dir: 'src', entries: ENTRIES });
    expect(res.ok).toBe(false);
    expect(read('src/components.ts')).toBe('export {};\n');
  });

  it('never clobbers an existing module', async () => {
    writeFileSync(path.join(root, 'src/Patrol.ts'), '// mine\n');
    const res = await scaffoldScript(root, { kind: 'component', name: 'Patrol', dir: 'src', entries: ENTRIES });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/already exists/);
    expect(read('src/Patrol.ts')).toBe('// mine\n');
  });

  it('does not duplicate a line the entry already carries (hand-wired module)', async () => {
    writeFileSync(path.join(root, 'src/components.ts'), "export {};\nexport * from './Patrol';\n");
    rmSync(path.join(root, 'src/Patrol.ts'), { force: true });
    await scaffoldScript(root, { kind: 'component', name: 'Patrol', dir: 'src', entries: ENTRIES });
    const wired = read('src/components.ts').split('\n').filter((l) => l.includes("'./Patrol'"));
    expect(wired).toHaveLength(1);
  });

  it('creates a missing entry rather than dropping the wiring on the floor', async () => {
    rmSync(path.join(root, 'src/components.ts'));
    const res = await scaffoldScript(root, { kind: 'component', name: 'Patrol', dir: 'src', entries: ENTRIES });
    expect(res.ok).toBe(true);
    expect(read('src/components.ts')).toBe("export * from './Patrol';\n");
  });

  it('separates the appended line from an entry that lacks a trailing newline', async () => {
    writeFileSync(path.join(root, 'src/components.ts'), 'export {};');
    await scaffoldScript(root, { kind: 'component', name: 'Patrol', dir: 'src', entries: ENTRIES });
    expect(read('src/components.ts')).toBe("export {};\nexport * from './Patrol';\n");
  });
});

describe('scriptWiring', () => {
  it('names the entry and the line each kind needs', () => {
    const modulePath = scriptModulePath(scriptTargetDir('src', ENTRIES), 'Patrol');
    expect(scriptWiring('component', ENTRIES, modulePath))
      .toEqual({ entry: 'src/components.ts', line: "export * from './Patrol';" });
    expect(scriptWiring('system', ENTRIES, modulePath))
      .toEqual({ entry: 'src/main.ts', line: "import './Patrol';" });
  });
});
