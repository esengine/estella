// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readToolArgs, ToolArgsError } from '../lib/toolArgs.mjs';

const SPEC = { tier: ['pr', 'nightly', 'release'], only: '', work: null, 'no-build': false };

describe('toolArgs', () => {
    it('reads values, switches and defaults', () => {
        expect(readToolArgs(SPEC, [])).toEqual({ _: [], tier: 'pr', only: '', work: null, 'no-build': false });
        expect(readToolArgs(SPEC, ['--tier', 'nightly', '--no-build', '--only=a,b'])).toEqual({
            _: [], tier: 'nightly', only: 'a,b', work: null, 'no-build': true,
        });
    });

    it('refuses a misspelled flag instead of running the default', () => {
        expect(() => readToolArgs(SPEC, ['--teir', 'nightly'])).toThrow(ToolArgsError);
    });

    it('refuses a value outside its set', () => {
        expect(() => readToolArgs(SPEC, ['--tier', 'nigthly'])).toThrow(/not one of: pr, nightly, release/);
    });

    it('refuses a value flag with nothing after it', () => {
        expect(() => readToolArgs(SPEC, ['--tier'])).toThrow(ToolArgsError);
        expect(() => readToolArgs(SPEC, ['--tier', '--no-build'])).toThrow(ToolArgsError);
    });

    it('refuses a positional unless the tool takes them', () => {
        expect(() => readToolArgs(SPEC, ['stray'])).toThrow(ToolArgsError);
        expect(readToolArgs(SPEC, ['stray'], { positionals: true })._).toEqual(['stray']);
    });

    it('steps over the separator electron needs on windows', () => {
        expect(readToolArgs(SPEC, ['--', '--tier', 'release']).tier).toBe('release');
    });

    it('names the default apart from the set', () => {
        const spec = { scope: { oneOf: ['pre-commit', 'local'], value: 'local' } };
        expect(readToolArgs(spec, []).scope).toBe('local');
        expect(readToolArgs(spec, ['--scope', 'pre-commit']).scope).toBe('pre-commit');
    });

    it('ends the process with status 2', () => {
        const lib = pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'toolArgs.mjs')).href;
        const run = spawnSync(process.execPath, [
            '--input-type=module', '-e',
            `import { toolArgs } from ${JSON.stringify(lib)}; toolArgs({ tier: ['pr'] }, { argv: ['--teir', 'x'] }); console.log('ran');`,
        ], { encoding: 'utf8' });
        expect(run.status).toBe(2);
        expect(run.stdout).not.toContain('ran');
        expect(run.stderr).toContain('--teir');
    });
});
