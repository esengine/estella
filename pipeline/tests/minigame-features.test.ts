// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The editor offers a packaging option on a mini-game target's page from the feature table, and the export acts on
 *        the profile. Those must be one answer: an option the export ignores is a switch that does nothing, and an ability
 *        no page offers is one nobody can turn on.
 */
import { describe, it, expect } from 'vitest';
import {
  wechatExportProfile, douyinExportProfile, kuaishouExportProfile, bilibiliExportProfile, quickgameExportProfile,
  alipayExportProfile, huaweiExportProfile, type MiniGameExportProfile,
} from '../src/export/miniGameExportProfile';
import { hasMiniGameFeature, miniGamePlatformsWith } from '../src/project/miniGameFeatures';
import { MINIGAME_PLATFORMS } from '../src/project/platforms';

const PROFILES: readonly MiniGameExportProfile[] = [
  wechatExportProfile, douyinExportProfile, kuaishouExportProfile, bilibiliExportProfile, quickgameExportProfile,
  alipayExportProfile, huaweiExportProfile,
];

describe('mini-game features', () => {
  it('covers every built-in mini-game host, and only those', () => {
    expect(PROFILES.map((p) => p.id).sort()).toEqual([...MINIGAME_PLATFORMS].sort());
    expect(hasMiniGameFeature('web', 'engineSubpackage')).toBe(false);
    expect(hasMiniGameFeature('openpaas', 'compressWasm')).toBe(false);
  });

  it.each(PROFILES.map((p) => [p.id, p] as const))('%s: the export does what the table says', (id, profile) => {
    expect(profile.wasmBrotli).toBe(hasMiniGameFeature(id, 'compressWasm'));
    expect(profile.workers ?? false).toBe(hasMiniGameFeature(id, 'workers'));
    expect(profile.emscriptenGLX ?? false).toBe(hasMiniGameFeature(id, 'emscriptenGLX'));
    // exportMiniGame moves the engine into a subpackage exactly when the host has a global to load one through.
    expect(profile.hostGlobal !== null && profile.subpackageDir !== '').toBe(hasMiniGameFeature(id, 'engineSubpackage'));
  });

  it('offers the engine subpackage beyond WeChat', () => {
    expect(miniGamePlatformsWith('engineSubpackage')).toContain('douyin');
  });
});
