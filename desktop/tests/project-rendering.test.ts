// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  parseManifest — rendering feature (Project Settings → Rendering). Guards the
 *        colorSpace project setting: 'linear' persists, the default 'gamma' is expressed
 *        by absence, and junk values are dropped.
 */
import { describe, it, expect } from 'vitest';
import { parseManifest } from '../src/project/format';

describe('parseManifest — rendering.colorSpace', () => {
  it("keeps 'linear'", () => {
    const m = parseManifest({ name: 'X', features: { rendering: { colorSpace: 'linear' } } });
    expect(m.features?.rendering?.colorSpace).toBe('linear');
  });

  it("drops 'gamma' (default = absence) and junk values", () => {
    for (const v of ['gamma', 'LINEAR', 42, true, null]) {
      const m = parseManifest({ name: 'X', features: { rendering: { colorSpace: v } } });
      expect(m.features?.rendering?.colorSpace).toBeUndefined();
    }
  });

  it('coexists with sorting/y-sort config', () => {
    const m = parseManifest({
      name: 'X',
      features: { rendering: { sortingLayers: ['BG', 'FG'], ySortLayers: [1], colorSpace: 'linear' } },
    });
    expect(m.features?.rendering).toEqual({
      sortingLayers: ['BG', 'FG'],
      ySortLayers: [1],
      colorSpace: 'linear',
    });
  });
});
