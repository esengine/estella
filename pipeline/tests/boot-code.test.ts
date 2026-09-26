// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The code a web page loads before its boot can report.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { bootCodeBytes } from '../src/export/bootCode';

let root: string;
const size = (f: string) => statSync(path.join(root, f)).size;

beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), 'boot-code-'));
    mkdirSync(path.join(root, 'sdk', 'shared'), { recursive: true });
    writeFileSync(path.join(root, 'game.js'), 'import { a } from "esengine";\nimport("./later.js");\nconsole.log(a);\n');
    writeFileSync(path.join(root, 'later.js'), 'export const late = 1;\n');
    writeFileSync(path.join(root, 'sdk', 'index.js'), 'import{t as x}from"./shared/one.js";export{b}from"./shared/two.js";export const a=x;\n');
    writeFileSync(path.join(root, 'sdk', 'shared', 'one.js'), 'import"./two.js";export const t=1;\n');
    writeFileSync(path.join(root, 'sdk', 'shared', 'two.js'), 'export const b=2;\n');
});
afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));

describe('the code a page loads before its boot can report', () => {
    it('is the entry and everything it statically imports, each once, through the import map', () => {
        expect(bootCodeBytes(root, 'game.js', { esengine: './sdk/index.js' }))
            .toBe(size('game.js') + size('sdk/index.js') + size('sdk/shared/one.js') + size('sdk/shared/two.js'));
    });

    it('leaves out what the running game imports later, and specifiers the map does not name', () => {
        expect(bootCodeBytes(root, 'game.js', {})).toBe(size('game.js'));
    });
});
