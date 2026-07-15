// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Guards the video asset-type wiring (M1): the content-browser type table,
 *        the `.meta` type vocabulary, and the import-settings schema all recognize
 *        video containers, while `webm` stays with audio (the disambiguated
 *        extension the two families share).
 */
import { describe, it, expect } from 'vitest';
import { assetTypeOf } from '../src/project/assetTypes';
import { metaTypeFor } from '../electron/assetMeta';
import { importerDefaults, hasImporterSettings } from '../src/project/assetImporter';

describe('video asset type', () => {
  it('classifies video containers as "video" in the content browser', () => {
    expect(assetTypeOf('intro.mp4')).toBe('video');
    expect(assetTypeOf('clip.m4v')).toBe('video');
    expect(assetTypeOf('capture.MOV')).toBe('video');
  });

  it('keeps the shared webm extension with audio (disambiguated by .meta)', () => {
    expect(assetTypeOf('sound.webm')).toBe('audio');
  });

  it('mints a "video" .meta type on import', () => {
    expect(metaTypeFor('intro.mp4')).toBe('video');
    expect(metaTypeFor('clip.mov')).toBe('video');
    expect(metaTypeFor('sound.webm')).toBe('audio');
  });

  it('exposes video import settings (playback defaults + cook fields)', () => {
    expect(hasImporterSettings('video')).toBe(true);
    expect(importerDefaults('video')).toEqual({
      loop: true, autoplay: true, muted: true,
      quality: 4, audioBitrateKbps: 128,
    });
  });
});
