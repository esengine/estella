// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  parseManifest — rendering feature (Project Settings → Rendering). Guards the
 *        colorSpace project setting: 'linear' persists, the default 'gamma' is expressed
 *        by absence, and junk values are dropped.
 */
import { describe, it, expect } from 'vitest';
import {
  parseManifest, cameraScaleModeValue, resolveScreenFit, trimSortingLayers, SORTING_LAYER_COUNT,
} from '../src/project/format';

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

describe('sorting layers — slot count', () => {
  it('names every slot up to the y-sort mask width, and drops the rest', () => {
    const names = Array.from({ length: SORTING_LAYER_COUNT + 4 }, (_, i) => `L${i}`);
    const parsed = parseManifest({ name: 'X', features: { rendering: { sortingLayers: names } } });
    expect(parsed.features?.rendering?.sortingLayers).toHaveLength(SORTING_LAYER_COUNT);
    expect(parsed.features?.rendering?.sortingLayers?.[SORTING_LAYER_COUNT - 1]).toBe(`L${SORTING_LAYER_COUNT - 1}`);
  });

  it('y-sorts the last nameable layer but nothing past it (the mask is 32 bits)', () => {
    const m = parseManifest({
      name: 'X',
      features: { rendering: { ySortLayers: [0, SORTING_LAYER_COUNT - 1, SORTING_LAYER_COUNT, -1] } },
    });
    expect(m.features?.rendering?.ySortLayers).toEqual([0, SORTING_LAYER_COUNT - 1]);
  });
});

describe('trimSortingLayers', () => {
  it('drops trailing empties — the control sends a full-width list', () => {
    expect(trimSortingLayers(['back', 'mid', '', '', ''])).toEqual(['back', 'mid']);
    expect(trimSortingLayers(Array.from({ length: SORTING_LAYER_COUNT }, () => ''))).toEqual([]);
  });

  it('keeps an interior gap — a slot means its index, so the gap is a real z-order step', () => {
    expect(trimSortingLayers(['back', '', 'front', ''])).toEqual(['back', '', 'front']);
  });

  it('never stores more than the nameable slots', () => {
    const names = Array.from({ length: SORTING_LAYER_COUNT + 5 }, (_, i) => `L${i}`);
    expect(trimSortingLayers(names)).toHaveLength(SORTING_LAYER_COUNT);
  });
});

describe('parseManifest — rendering.cameraScaleMode', () => {
  it('keeps every real fit mode + clamps cameraMatch to 0..1', () => {
    for (const mode of ['fixed-width', 'fixed-height', 'expand', 'shrink', 'match'] as const) {
      expect(parseManifest({ name: 'X', features: { rendering: { cameraScaleMode: mode } } })
        .features?.rendering?.cameraScaleMode).toBe(mode);
    }
    expect(parseManifest({ name: 'X', features: { rendering: { cameraMatch: 5 } } })
      .features?.rendering?.cameraMatch).toBe(1);
    expect(parseManifest({ name: 'X', features: { rendering: { cameraMatch: -2 } } })
      .features?.rendering?.cameraMatch).toBe(0);
  });

  it("drops 'none' (default = absence) and junk", () => {
    for (const v of ['none', 'diagonal', 42, true]) {
      expect(parseManifest({ name: 'X', features: { rendering: { cameraScaleMode: v } } })
        .features?.rendering?.cameraScaleMode).toBeUndefined();
    }
  });
});

describe('cameraScaleModeValue / resolveScreenFit', () => {
  it('maps names to the engine CanvasScaleMode value (-1 = off)', () => {
    expect(cameraScaleModeValue('fixed-width')).toBe(0);
    expect(cameraScaleModeValue('fixed-height')).toBe(1);
    expect(cameraScaleModeValue('expand')).toBe(2);
    expect(cameraScaleModeValue('shrink')).toBe(3);
    expect(cameraScaleModeValue('match')).toBe(4);
    expect(cameraScaleModeValue('none')).toBe(-1);
    expect(cameraScaleModeValue(undefined)).toBe(-1);
  });

  it('builds the runtime screenFit from design resolution + fit; off by default', () => {
    expect(resolveScreenFit({ designResolution: { width: 1280, height: 720 } }))
      .toEqual({ designWidth: 1280, designHeight: 720, scaleMode: -1, matchWidthOrHeight: 0.5 });
    expect(resolveScreenFit({
      designResolution: { width: 1080, height: 1920 },
      features: { rendering: { cameraScaleMode: 'expand', cameraMatch: 0.25 } },
    })).toEqual({ designWidth: 1080, designHeight: 1920, scaleMode: 2, matchWidthOrHeight: 0.25 });
    // No design resolution ⇒ the engine default, still off.
    expect(resolveScreenFit({})).toEqual({ designWidth: 1920, designHeight: 1080, scaleMode: -1, matchWidthOrHeight: 0.5 });
  });
});
