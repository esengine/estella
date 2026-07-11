// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { ENTITY_SOURCES, matchSources } from '@/engine/entitySources';

describe('Create catalog (searchable source registry)', () => {
  it('spans Basic / 2D / UI, preserving order + carrying category', () => {
    expect(ENTITY_SOURCES.map((s) => s.label)).toEqual(
      expect.arrayContaining(['Empty', 'Sprite', 'Camera', 'Canvas', 'Button', 'Slider']),
    );
    expect(new Set(ENTITY_SOURCES.map((s) => s.category))).toEqual(new Set(['Basic', '2D', 'UI']));
  });

  it('builds one-entity presets from the registered component defaults', async () => {
    const camera = (await ENTITY_SOURCES.find((s) => s.label === 'Camera')!.build({ parent: null })).entities[0];
    expect(camera.components.map((c) => c.type)).toEqual(['Transform', 'Camera']);
    const cam = camera.components.find((c) => c.type === 'Camera')!.data as Record<string, unknown>;
    expect(cam.isActive).toBe(true); // orthographic + active come from Camera's defaults

    const empty = (await ENTITY_SOURCES.find((s) => s.label === 'Empty')!.build({ parent: null })).entities[0];
    expect(empty.components.map((c) => c.type)).toEqual(['Transform']);
  });

  it('matches on item label, case-insensitively', () => {
    expect(matchSources(ENTITY_SOURCES, 'CAM').map((s) => s.label)).toEqual(['Camera']);
  });

  it('matches on category label', () => {
    expect(matchSources(ENTITY_SOURCES, '2d').map((s) => s.label)).toEqual(['Sprite', 'Camera', 'Particles', 'Light']);
  });

  it('empty query returns everything; no match returns nothing', () => {
    expect(matchSources(ENTITY_SOURCES, '   ')).toEqual(ENTITY_SOURCES);
    expect(matchSources(ENTITY_SOURCES, 'zzzzz')).toEqual([]);
  });
});
