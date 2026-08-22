// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  `Could not resolve "crypto"` is true and useless.
 *
 * npm packages bundle into a game fine — until one reaches for a Node built-in,
 * and then the export fails with a bundler message that names no cause, no
 * culprit file and no fix. A developer who has just run `npm install` reads it
 * as "this engine cannot handle npm", which is the wrong conclusion and an
 * expensive one.
 *
 * The rule this file holds: explain the ONE case that can be identified with
 * certainty, and leave everything else exactly as the bundler said it. A guess
 * appended to a real compile error costs more than the explanation is worth.
 */
import { describe, it, expect } from 'vitest';
import { explainBundleError, explainBundleErrors, isNodeBuiltin } from '../src/bundle/bundleDiagnostics';

describe('recognizing a Node built-in', () => {
    it('knows the built-ins in both spellings', () => {
        expect(isNodeBuiltin('crypto')).toBe(true);
        expect(isNodeBuiltin('node:crypto')).toBe(true);
        expect(isNodeBuiltin('fs/promises')).toBe(true);
        expect(isNodeBuiltin('node:fs/promises')).toBe(true);
    });

    it('does not mistake an npm package for one', () => {
        expect(isNodeBuiltin('protobufjs')).toBe(false);
        expect(isNodeBuiltin('protobufjs/minimal')).toBe(false);
        expect(isNodeBuiltin('./local-module')).toBe(false);
    });
});

describe('explaining', () => {
    it('says why, and points at web APIs when the import is the developer\'s own', () => {
        const said = explainBundleError({
            text: 'Could not resolve "crypto"',
            location: { file: 'src/net/sign.ts' },
        });
        expect(said).toContain('Could not resolve "crypto"');   // the original, kept
        expect(said).toContain('src/net/sign.ts');              // who asked
        expect(said).toContain('does not run in Node');         // why
        expect(said).toContain('crypto.subtle');                // what instead
    });

    it('points at the package when a dependency is the one reaching', () => {
        // The developer's own code is fine here — telling them to "use a web API
        // instead" would be advice about code they did not write.
        const said = explainBundleError({
            text: 'Could not resolve "fs"',
            location: { file: 'node_modules/some-lib/dist/index.js' },
        });
        expect(said).toContain('came from a dependency');
        expect(said).toContain('browser');            // the "browser" field / browser entry
        expect(said).not.toContain('crypto.subtle');  // not the own-code advice
    });

    it('recognizes a windows path under node_modules too', () => {
        const said = explainBundleError({
            text: 'Could not resolve "path"',
            location: { file: 'C:\\proj\\node_modules\\some-lib\\index.js' },
        });
        expect(said).toContain('came from a dependency');
    });

    it('still explains when the bundler named no file', () => {
        const said = explainBundleError({ text: 'Could not resolve "os"' });
        expect(said).toContain('is a Node built-in');
        expect(said).not.toContain('imported by');
    });
});

describe('leaving well enough alone', () => {
    it('passes through an unresolved npm package untouched', () => {
        // A missing dependency is a different problem with a different fix
        // (`npm install`), and this has nothing to add to it.
        const text = 'Could not resolve "protobufjs"';
        expect(explainBundleError({ text })).toBe(text);
    });

    it('passes through an ordinary compile error untouched', () => {
        const text = 'Expected ";" but found "}"';
        expect(explainBundleError({ text, location: { file: 'src/main.ts' } })).toBe(text);
    });

    it('maps a batch, explaining only what it can', () => {
        const out = explainBundleErrors([
            { text: 'Could not resolve "fs"' },
            { text: 'Expected ";" but found "}"' },
        ]);
        expect(out[0]).toContain('Node built-in');
        expect(out[1]).toBe('Expected ";" but found "}"');
    });
});
