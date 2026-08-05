// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The project's TypeScript service: diagnostics, symbol lookup, search.
 *
 * Driven against a real temp project with a real tsconfig, because every
 * interesting failure of a language service is a resolution failure — a fake host
 * would answer questions about a compilation that does not exist.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { adoptProjectScripts, scriptDiagnostics, lookupScriptSymbol, isScriptPath } from '../electron/scriptService';
import { searchInRoot } from '../electron/projectFs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SDK_DIST = path.join(HERE, '..', '..', 'sdk', 'dist');
const SDK_TYPES = path.join(SDK_DIST, 'index.d.ts');
let root: string;

/** Stage the SDK .d.ts tree where ensureSdkTypes puts it for a real project. */
function stageSdkTypes(into: string): void {
  const dest = path.join(into, '.esengine', 'sdk');
  mkdirSync(dest, { recursive: true });
  cpSync(SDK_DIST, dest, { recursive: true, filter: (src) => !src.endsWith('.js') && !src.endsWith('.map') });
}

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'estella-scripts-'));
  mkdirSync(path.join(root, 'src'), { recursive: true });
  // The SDK types as a real project carries them: the WHOLE staged tree, because
  // the declarations live across it (defineComponent is in shared/app.d.ts, not
  // in the index that re-exports it) and a hand-picked subset silently answers
  // "no such symbol" for everything it left out.
  stageSdkTypes(root);
  writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      target: 'ES2020', module: 'ESNext', moduleResolution: 'bundler',
      strict: true, skipLibCheck: true,
      paths: { esengine: ['./.esengine/sdk/index.d.ts'] },
    },
    include: ['src/**/*'],
  }));
  adoptProjectScripts(root);
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('the project script service', () => {
  it('reports nothing for a file that compiles', () => {
    writeFileSync(path.join(root, 'src', 'clean.ts'), `
      export const add = (a: number, b: number): number => a + b;
    `);
    expect(scriptDiagnostics('src/clean.ts')).toEqual([]);
  });

  it('names the line and the reason for one that does not', () => {
    writeFileSync(path.join(root, 'src', 'broken.ts'), `
      export const n: number = 'not a number';
    `);
    const found = scriptDiagnostics('src/broken.ts');
    expect(found.length).toBeGreaterThan(0);
    expect(found[0]).toMatchObject({ file: path.join('src', 'broken.ts'), line: 2, category: 'error' });
    expect(found[0].message).toContain('not assignable');
  });

  it('sees a file written after it started', () => {
    // The service is built once and the agent writes scripts all turn: a service
    // whose file list froze at construction answers "no errors" for every file
    // created since, which is the most confident way to be wrong.
    writeFileSync(path.join(root, 'src', 'later.ts'), `export const x: string = 1;`);
    expect(scriptDiagnostics('src/later.ts').map((d) => d.category)).toContain('error');
  });

  it('sees a REWRITE, not the version it first read', () => {
    const file = path.join(root, 'src', 'edited.ts');
    writeFileSync(file, `export const y: string = 1;`);
    expect(scriptDiagnostics('src/edited.ts').length).toBeGreaterThan(0);
    writeFileSync(file, `export const y: string = 'fixed';`);
    expect(scriptDiagnostics('src/edited.ts')).toEqual([]);
  });

  it('catches the mistake the agent brief used to teach', () => {
    // `MouseButton.Left` — the whole reason this service exists. The failure was
    // silent at runtime (undefined reads false forever); the compiler has always
    // known, and now something asks it.
    if (!existsSync(SDK_TYPES)) return;
    writeFileSync(path.join(root, 'src', 'mouse.ts'), `
      import { MouseButton } from 'esengine';
      export const pressed = (input: { isMouseButtonPressed(b: number): boolean }) =>
        input.isMouseButtonPressed(MouseButton.Left);
    `);
    const found = scriptDiagnostics('src/mouse.ts');
    expect(found.map((d) => d.message).join(' ')).toContain('Left');
  });

  it('looks a symbol up instead of paging the .d.ts', () => {
    if (!existsSync(SDK_TYPES)) return;
    writeFileSync(path.join(root, 'src', 'uses.ts'), `
      import { Input } from 'esengine';
      export type UseInput = typeof Input;
    `);
    const hits = lookupScriptSymbol('isMouseButtonPressed');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].name).toBe('isMouseButtonPressed');
    expect(hits[0].signature).toContain('button');
  });

  it('answers about the SDK before any project file imports it', () => {
    // The state every project starts in: src/main.ts imports './components' and
    // nothing else, so `esengine` is in no compilation — and that is exactly when
    // someone asks what `Input` is. An empty answer here reads as "no such API".
    if (!existsSync(SDK_TYPES)) return;
    const bare = mkdtempSync(path.join(tmpdir(), 'estella-bare-'));
    mkdirSync(path.join(bare, 'src'), { recursive: true });
    stageSdkTypes(bare);
    writeFileSync(path.join(bare, 'src', 'main.ts'), "import './components';\n");
    writeFileSync(path.join(bare, 'src', 'components.ts'), 'export {};\n');
    adoptProjectScripts(bare);
    const hits = lookupScriptSymbol('isMouseButtonPressed');
    adoptProjectScripts(root); // hand the shared service back to the other cases
    rmSync(bare, { recursive: true, force: true });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].name).toBe('isMouseButtonPressed');
    expect(hits[0].signature).toContain('button');
  });

  it('gives a declared function its parameters, not just its name', () => {
    // quickInfo at a navigate-to hit degrades to "function defineComponent" for
    // a declared function — the asker learns nothing and comes back for another
    // round trip, which is the cost this tool exists to remove.
    if (!existsSync(SDK_TYPES)) return;
    for (const name of ['defineComponent', 'defineSystem']) {
      const hit = lookupScriptSymbol(name, 4).find((h) => h.name === name);
      expect([name, !!hit]).toEqual([name, true]);
      expect([name, hit!.signature.includes('(')]).toEqual([name, true]);
      expect([name, hit!.signature]).not.toEqual([name, `function ${name}`]);
    }
  });

  it('knows which paths it has an opinion about', () => {
    expect([isScriptPath('src/a.ts'), isScriptPath('assets/a.png'), isScriptPath('a.json')])
      .toEqual([true, false, false]);
  });
});

describe('project search', () => {
  it('finds a line and says where it is', async () => {
    writeFileSync(path.join(root, 'src', 'needle.ts'), 'const a = 1;\nconst findMeHere = 2;\n');
    const hits = await searchInRoot(root, { query: 'findMeHere', glob: '.ts' });
    expect(hits.some((h) => h.file.endsWith('needle.ts') && h.line === 2)).toBe(true);
  });

  it('takes a regular expression when asked', async () => {
    const hits = await searchInRoot(root, { query: 'const \\w+Here', regex: true, glob: '.ts' });
    expect(hits.some((h) => h.text.includes('findMeHere'))).toBe(true);
  });

  it('refuses an empty query rather than returning the project', async () => {
    await expect(searchInRoot(root, { query: '' })).rejects.toThrow(/needs a query/);
  });

  it('answers to the name `glob`, and still takes a substring', async () => {
    // The first real caller wrote `*.ts` — the thing the parameter's name
    // promises — and a search that had matches returned nothing.
    writeFileSync(path.join(root, 'src', 'globbed.ts'), 'const globTarget = 1;\n');
    const forms = ['*.ts', 'src/*.ts', 'src/**', '.ts'];
    for (const glob of forms) {
      const hits = await searchInRoot(root, { query: 'globTarget', glob });
      expect([glob, hits.some((h) => h.file.endsWith('globbed.ts'))]).toEqual([glob, true]);
    }
    // And still excludes what it should: a pattern that matches nothing matches nothing.
    expect(await searchInRoot(root, { query: 'globTarget', glob: '*.json' })).toEqual([]);
  });

  it('clips a very long line instead of returning it whole', async () => {
    writeFileSync(path.join(root, 'src', 'long.ts'), `// ${'x'.repeat(5000)} marker\n`);
    const hits = await searchInRoot(root, { query: 'xxxxx', glob: 'long.ts' });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].text.length).toBeLessThanOrEqual(400);
  });
});
