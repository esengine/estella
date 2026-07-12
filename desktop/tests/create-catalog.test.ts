// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { ENTITY_SOURCES, matchSources, CREATE_CATEGORY_ORDER, sourceById, SOURCE_DND_MIME } from '@/engine/entitySources';

describe('Create catalog (searchable source registry)', () => {
  it('covers builtins + anchor components, every category in the declared order', () => {
    expect(ENTITY_SOURCES.map((s) => s.label)).toEqual(
      expect.arrayContaining(['Empty', 'Sprite', 'Camera', 'Spine', 'Audio', 'Text', 'Canvas', 'Button']),
    );
    for (const s of ENTITY_SOURCES) expect(CREATE_CATEGORY_ORDER).toContain(s.category);
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

  it('matches on category — create reuses the componentCategory taxonomy', () => {
    const rendering = matchSources(ENTITY_SOURCES, 'rendering').map((s) => s.label);
    expect(rendering).toEqual(expect.arrayContaining(['Sprite', 'Shape']));
  });

  it('empty query returns everything; no match returns nothing', () => {
    expect(matchSources(ENTITY_SOURCES, '   ')).toEqual(ENTITY_SOURCES);
    expect(matchSources(ENTITY_SOURCES, 'zzzzz')).toEqual([]);
  });

  // The UI-mode widget palette (UIWidgetsPanel) and the viewport drop handler both
  // read this registry — the palette lists the UI category, the drop resolves the id.
  it('UI category backs the widget palette (Canvas + the builtin widgets)', () => {
    const ui = ENTITY_SOURCES.filter((s) => s.category === 'UI').map((s) => s.label);
    expect(ui).toEqual(expect.arrayContaining(['Canvas', 'Button', 'Toggle', 'Slider']));
  });

  it('sourceById round-trips a dragged palette id back to its source', () => {
    for (const s of ENTITY_SOURCES.filter((x) => x.category === 'UI')) {
      expect(sourceById(s.id)).toBe(s);
    }
    expect(sourceById('nope::missing')).toBeNull();
    expect(SOURCE_DND_MIME).toMatch(/^application\//);
  });
});
