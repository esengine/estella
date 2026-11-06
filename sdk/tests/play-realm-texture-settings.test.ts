// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/** A map a material names beside itself reaches a Play realm as a URL, and keeps its import settings there. */
import { describe, expect, it } from 'vitest';
import { indexTextureImportSettings } from '../src/asset/textureImportSettings';
import { playRealmTextureSettings } from '../src/runtime/playRealmRuntime';

const DATA = { srgb: false };
const lookup = indexTextureImportSettings([{ uuid: 'u1', path: 'assets/models/rock_surface.png', settings: DATA }]);
const manifest = { u1: 'estella://project/assets/models/rock_surface.png' };

describe('texture settings in a Play realm', () => {
    it('are found for the URL a material resolves its map to', () => {
        expect(playRealmTextureSettings(lookup, manifest)('estella://project/assets/models/rock_surface.png')).toEqual(DATA);
    });

    it('are found under the realm\'s base for a map the manifest does not list', () => {
        const unlisted = playRealmTextureSettings(lookup, {}, 'estella://project/');
        expect(unlisted('estella://project/assets/models/rock_surface.png')).toEqual(DATA);
    });

    it('still answer by path and by uuid', () => {
        const settings = playRealmTextureSettings(lookup, manifest);
        expect(settings('assets/models/rock_surface.png')).toEqual(DATA);
        expect(settings('@uuid:u1')).toEqual(DATA);
    });

    it('are nothing for a texture nobody said anything about', () => {
        expect(playRealmTextureSettings(lookup, manifest, 'estella://project')('estella://project/assets/other.png')).toBeUndefined();
        expect(playRealmTextureSettings(lookup, manifest)('https://elsewhere/assets/models/rock_surface.png')).toBeUndefined();
    });
});
