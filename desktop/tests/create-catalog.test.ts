// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { flattenCatalog, matchCatalog } from '@/engine/entityTemplates';

describe('Create catalog (searchable template list)', () => {
  it('spans Basic / 2D / UI, preserving order + carrying category', () => {
    const all = flattenCatalog();
    expect(all.map((e) => e.template.label)).toEqual(
      expect.arrayContaining(['Empty', 'Sprite', 'Camera', 'Canvas', 'Button', 'Slider']),
    );
    expect(new Set(all.map((e) => e.category))).toEqual(new Set(['Basic', '2D', 'UI']));
  });

  it('builds one-entity presets from the registered component defaults', () => {
    const all = flattenCatalog();
    const camera = all.find((e) => e.template.label === 'Camera')!.template.prefab.entities[0];
    expect(camera.components.map((c) => c.type)).toEqual(['Transform', 'Camera']);
    const cam = camera.components.find((c) => c.type === 'Camera')!.data as Record<string, unknown>;
    expect(cam.isActive).toBe(true); // orthographic + active come from Camera's defaults

    const empty = all.find((e) => e.template.label === 'Empty')!.template.prefab.entities[0];
    expect(empty.components.map((c) => c.type)).toEqual(['Transform']);
  });

  it('matches on item label, case-insensitively', () => {
    const all = flattenCatalog();
    expect(matchCatalog(all, 'CAM').map((e) => e.template.label)).toEqual(['Camera']);
  });

  it('matches on category label', () => {
    const all = flattenCatalog();
    expect(matchCatalog(all, '2d').map((e) => e.template.label)).toEqual(['Sprite', 'Camera', 'Particles', 'Light']);
  });

  it('empty query returns everything; no match returns nothing', () => {
    const all = flattenCatalog();
    expect(matchCatalog(all, '   ')).toEqual(all);
    expect(matchCatalog(all, 'zzzzz')).toEqual([]);
  });
});
