// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  One target screen, obeyed by both the edit viewport and the running game.
 *
 * The device selection used to shape only the authoring overlay: a game played in
 * the viewport or the Game panel filled whatever the dock had been dragged to, so
 * a project authored for a phone was never actually RUN at a phone's shape. These
 * pin the sizing rule the play hosts apply.
 */
import { describe, it, expect } from 'vitest';
import { playHostAspectStyle, targetScreenLabel } from '@/mode/TargetScreen';
import { deviceDims, screenPresets, screenPresetById, RESOLUTION_PRESETS } from '@/mode/resolutionPresets';
import { parseManifest } from '../../pipeline/src/project/format';

describe('play host sizing', () => {
  it('leaves the host unconstrained for the `design` sentinel', () => {
    // No simulated device means "fill the panel" — the behaviour someone
    // authoring for desktop expects, and what every view did before.
    expect(playHostAspectStyle('design', 'landscape')).toBeNull();
    expect(playHostAspectStyle('design', 'portrait')).toBeNull();
    expect(targetScreenLabel('design', 'landscape')).toBeNull();
  });

  it('constrains the host to the device aspect, orientation applied', () => {
    const portrait = playHostAspectStyle('iphone', 'portrait');
    const landscape = playHostAspectStyle('iphone', 'landscape');

    expect(portrait?.aspectRatio).toBe('1170 / 2532');
    expect(landscape?.aspectRatio).toBe('2532 / 1170');
    // Fits INSIDE the panel either way rather than overflowing it.
    expect(portrait?.maxWidth).toBe('100%');
    expect(portrait?.maxHeight).toBe('100%');
  });

  it('reports the simulated pixel size the aspect came from', () => {
    expect(targetScreenLabel('iphone', 'portrait')).toBe('1170 × 2532');
    expect(targetScreenLabel('ipad', 'landscape')).toBe('2360 × 1640');
    expect(targetScreenLabel('720p', 'portrait')).toBe('720 × 1280');
  });

  it('agrees with the dims the authoring overlay draws from', () => {
    // The frame the edit viewport draws and the box the game runs in must come
    // from one source, or the preview stops predicting the run.
    for (const device of ['iphone', 'ipad', '1080p', '720p'] as const) {
      for (const orientation of ['portrait', 'landscape'] as const) {
        const d = deviceDims(device, orientation)!;
        expect(playHostAspectStyle(device, orientation)?.aspectRatio).toBe(`${d.w} / ${d.h}`);
      }
    }
  });
});

describe('project-declared screens', () => {
  const project = [
    { id: 'studio-tablet', label: 'Studio Tablet', width: 1200, height: 1920 },
    // Same id as a built-in: the project MEANS something specific by it.
    { id: 'iphone', label: 'iPhone 15 Pro', width: 1179, height: 2556 },
  ];

  it('offers the project screens beside the built-ins', () => {
    const ids = screenPresets(project).map((p) => p.id);
    expect(ids).toContain('studio-tablet');
    expect(ids).toContain('design');
    expect(ids).toContain('720p');
  });

  it('lets a project redefine a built-in id rather than duplicating it', () => {
    const ids = screenPresets(project).map((p) => p.id);
    expect(ids.filter((id) => id === 'iphone')).toHaveLength(1);
    expect(screenPresetById('iphone', project).label).toBe('iPhone 15 Pro');
    expect(deviceDims('iphone', 'portrait', project)).toEqual({ w: 1179, h: 2556 });
  });

  it('sizes the play host from a project screen', () => {
    expect(playHostAspectStyle('studio-tablet', 'portrait', project)?.aspectRatio).toBe('1200 / 1920');
    expect(targetScreenLabel('studio-tablet', 'landscape', project)).toBe('1920 × 1200');
  });

  it('falls back to the design sentinel for an id nothing declares', () => {
    // A selection persisted before a preset was deleted must not size the host
    // from a screen that no longer exists.
    expect(screenPresetById('deleted-device', project).id).toBe('design');
    expect(playHostAspectStyle('deleted-device', 'portrait', project)).toBeNull();
  });

  it('is untouched when the project declares none', () => {
    expect(screenPresets()).toBe(RESOLUTION_PRESETS);
    expect(screenPresets([])).toBe(RESOLUTION_PRESETS);
  });
});

describe('manifest parsing of screenPresets', () => {
  const parse = (presets: unknown): unknown =>
    parseManifest({ formatVersion: '1', name: 'p', screenPresets: presets }).screenPresets;

  it('keeps well-formed entries', () => {
    expect(parse([{ id: 'a', label: 'A', width: 800, height: 1200 }]))
      .toEqual([{ id: 'a', label: 'A', width: 800, height: 1200 }]);
  });

  it('drops malformed entries rather than failing the project load', () => {
    // Hand-edited manifests are normal; one bad preset must not cost the project.
    expect(parse([
      { id: 'ok', label: 'OK', width: 800, height: 1200 },
      { id: 'no-size', label: 'X' },
      { label: 'no-id', width: 1, height: 2 },
      { id: 'zero', label: 'Z', width: 0, height: 100 },
      null,
    ])).toEqual([{ id: 'ok', label: 'OK', width: 800, height: 1200 }]);
  });

  it('carries safe-area insets only when complete', () => {
    const safe = { top: 44, bottom: 34, left: 0, right: 0 };
    expect(parse([{ id: 'a', label: 'A', width: 8, height: 9, safe }])).toEqual([
      { id: 'a', label: 'A', width: 8, height: 9, safe },
    ]);
    expect(parse([{ id: 'a', label: 'A', width: 8, height: 9, safe: { top: 44 } }])).toEqual([
      { id: 'a', label: 'A', width: 8, height: 9 },
    ]);
  });
});
