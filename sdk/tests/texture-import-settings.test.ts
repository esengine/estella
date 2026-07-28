// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The `.meta` importer block → texture load settings.
 *
 * One parser for the editor viewport and a shipped build, so this is where the
 * meaning of that block is pinned. The 9-slice rule earns its own cases: an
 * all-zero border means "not sliced" and must stay ABSENT, because a present
 * border is stamped onto the texture and would clear one set elsewhere.
 */
import { describe, it, expect } from 'vitest';
import { textureImportSettingsFrom } from '../src/asset/textureImportSettings';

describe('textureImportSettingsFrom', () => {
    it('maps filterMode/wrapMode to the loader filter/wrap shape', () => {
        expect(textureImportSettingsFrom({ filterMode: 'nearest', wrapMode: 'clamp' }))
            .toEqual({ filter: 'nearest', wrap: 'clamp', srgb: undefined, sliceBorder: undefined });
        expect(textureImportSettingsFrom({ filterMode: 'linear' }))
            .toEqual({ filter: 'linear', wrap: undefined, srgb: undefined, sliceBorder: undefined });
    });

    it('carries sRGB only when the block states it', () => {
        expect(textureImportSettingsFrom({ sRGB: false })?.srgb).toBe(false);
        expect(textureImportSettingsFrom({ sRGB: true })?.srgb).toBe(true);
        expect(textureImportSettingsFrom({ filterMode: 'linear' })?.srgb).toBeUndefined();
    });

    it('is undefined when the block carries nothing the loader needs', () => {
        expect(textureImportSettingsFrom({ maxSize: 2048 })).toBeUndefined();
        expect(textureImportSettingsFrom({})).toBeUndefined();
        expect(textureImportSettingsFrom(undefined)).toBeUndefined();
        expect(textureImportSettingsFrom(null)).toBeUndefined();
    });

    it('ignores junk values rather than passing them to the loader', () => {
        expect(textureImportSettingsFrom({ filterMode: 'wobbly', wrapMode: 7 })).toBeUndefined();
        expect(textureImportSettingsFrom({ sRGB: 'yes' })).toBeUndefined();
    });

    describe('9-slice border', () => {
        it('reads a full border', () => {
            expect(textureImportSettingsFrom({ sliceBorder: { left: 12, right: 13, top: 14, bottom: 15 } })?.sliceBorder)
                .toEqual({ left: 12, right: 13, top: 14, bottom: 15 });
        });

        it('keeps a partial border, zero-filling the edges that do not slice', () => {
            expect(textureImportSettingsFrom({ sliceBorder: { left: 24, right: 24 } })?.sliceBorder)
                .toEqual({ left: 24, right: 24, top: 0, bottom: 0 });
        });

        it('treats an all-zero border as NOT sliced, so it is never stamped', () => {
            expect(textureImportSettingsFrom({ sliceBorder: { left: 0, right: 0, top: 0, bottom: 0 } }))
                .toBeUndefined();
        });

        it('drops negative and non-finite edges', () => {
            expect(textureImportSettingsFrom({ sliceBorder: { left: -5, right: NaN, top: 8, bottom: 'x' } })?.sliceBorder)
                .toEqual({ left: 0, right: 0, top: 8, bottom: 0 });
        });

        it('survives a hand-edited block that is not an object', () => {
            expect(textureImportSettingsFrom({ sliceBorder: 12 })).toBeUndefined();
            expect(textureImportSettingsFrom({ sliceBorder: null })).toBeUndefined();
        });

        it('comes through alongside sampler settings', () => {
            expect(textureImportSettingsFrom({ filterMode: 'nearest', sliceBorder: { left: 4 } }))
                .toEqual({
                    filter: 'nearest', wrap: undefined, srgb: undefined,
                    sliceBorder: { left: 4, right: 0, top: 0, bottom: 0 },
                });
        });
    });
});
