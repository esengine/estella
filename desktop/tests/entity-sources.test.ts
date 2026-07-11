// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  entitySources registry (REARCH ENTITY_CREATION E2). The Create popover is
 *        generated from this data-driven list, so the guarantees are structural:
 *        the legacy catalog labels all survive the migration, every source carries
 *        an icon + a known category + a well-formed build(), placement is a field
 *        (not hardcoded), and search matches label/category/keyword. Pure TS.
 */
import { describe, it, expect } from 'vitest';
import { ENTITY_SOURCES, matchSources, CREATE_CATEGORY_ORDER, tilemapPrefab, createFromSource } from '@/engine/entitySources';

const ctx = { parent: null };

describe('entitySources registry (Create-entity E2)', () => {
  it('covers every legacy catalog label (migration completeness)', () => {
    const labels = ENTITY_SOURCES.map((s) => s.label);
    for (const l of ['Empty', 'Sprite', 'Camera', 'Particles', 'Light', 'Canvas', 'Button', 'Toggle', 'Slider', 'Progress', 'Dropdown', 'ListView']) {
      expect(labels).toContain(l);
    }
  });

  it('every source has a unique id, an icon, and a category in the declared order', () => {
    const ids = ENTITY_SOURCES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of ENTITY_SOURCES) {
      expect(s.icon).toBeTruthy();
      expect(CREATE_CATEGORY_ORDER).toContain(s.category);
    }
  });

  it('build() yields a well-formed prefab whose root entity is present', async () => {
    for (const s of ENTITY_SOURCES) {
      const p = await s.build(ctx);
      expect(p.rootEntityId).toBeDefined();
      expect(p.entities.length).toBeGreaterThan(0);
      expect(p.entities.some((e) => e.prefabEntityId === p.rootEntityId)).toBe(true);
    }
  });

  it('placement is a data field: UI widgets go under the Canvas, others honor the parent', () => {
    expect(ENTITY_SOURCES.find((s) => s.label === 'Button')!.placement).toBe('under-canvas');
    expect(ENTITY_SOURCES.find((s) => s.label === 'Sprite')!.placement).toBeUndefined();
  });

  it('matchSources filters by label / category / keyword, case-insensitively', () => {
    expect(matchSources(ENTITY_SOURCES, 'SPR').map((s) => s.label)).toContain('Sprite');
    expect(matchSources(ENTITY_SOURCES, '2d').length).toBeGreaterThan(0);
    expect(matchSources(ENTITY_SOURCES, '')).toHaveLength(ENTITY_SOURCES.length);
    expect(matchSources(ENTITY_SOURCES, 'zzznope')).toHaveLength(0);
  });

  it('tilemapPrefab seeds cellSize as a vec2 {x,y} on a Transform+TilemapLayer entity', () => {
    const p = tilemapPrefab('Tilemap', { x: 32, y: 16 });
    const root = p.entities.find((e) => e.prefabEntityId === p.rootEntityId)!;
    const types = root.components.map((c) => c.type);
    expect(types).toContain('Transform');
    expect(types).toContain('TilemapLayer');
    const layer = root.components.find((c) => c.type === 'TilemapLayer')!.data as { cellSize: { x: number; y: number } };
    expect(layer.cellSize).toMatchObject({ x: 32, y: 16 });
  });

  it('createFromSource returns null when build throws (aborted source, e.g. a failed prefab load)', async () => {
    const bad = { ...ENTITY_SOURCES[0], id: 'bad', build: () => { throw new Error('nope'); } };
    expect(await createFromSource(bad, { parent: null })).toBeNull();
  });
});
