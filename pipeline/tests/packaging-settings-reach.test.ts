// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A packaging setting a project declares reaches the thing it controls.
 *
 * The gate next door proves the parser reads every field. This proves the two
 * that decide a mini-game's main-package size are still connected all the way
 * through the derivation the headless export spreads — the step that was missing
 * when `compressWasm` was honoured by the Build dialog and by nothing else.
 */
import { describe, it, expect } from 'vitest';
import { parseManifest } from '../src/project/format';
import { packagingOptionsOf, cookOptionsOf } from '../src/project/runtimeConfig';

const project = (packaging: Record<string, unknown>) =>
  parseManifest({ formatVersion: '1', name: 'p', packaging });

describe('a packaging setting a project declares', () => {
    it('survives the parser and reaches the export options', () => {
        const m = project({ compressWasm: true, engineSubpackage: true });
        expect(m.packaging?.compressWasm).toBe(true);
        expect(packagingOptionsOf(m)).toMatchObject({ compressWasm: true, engineSubpackage: true });
    });

    it('defaults to off rather than to undefined, so a host cannot read it as "unset"', () => {
        expect(packagingOptionsOf(project({}))).toMatchObject({
            compressWasm: false, engineSubpackage: false, excludeScenes: [],
        });
    });

    it('carries the asset-compression choice the cook reads', () => {
        expect(cookOptionsOf(project({ assetCompression: 'skip' })).compressTextures).toBe(false);
        expect(cookOptionsOf(project({ assetCompression: 'auto' })).compressTextures).toBe(true);
        // Absent is the default, and the default is on.
        expect(cookOptionsOf(project({})).compressTextures).toBe(true);
    });

    it('keeps the scenes a project asked not to ship out of the options', () => {
        const m = project({ excludeScenes: ['assets/scenes/dev.esscene'] });
        expect(packagingOptionsOf(m).excludeScenes).toEqual(['assets/scenes/dev.esscene']);
    });
});
