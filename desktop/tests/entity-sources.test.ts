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

  it('every anchor component has a create source whose build carries that component (coverage guard)', async () => {
    // The previously-missing anchors — the point of E6. If the engine gains a new anchor
    // component, add it to ANCHOR_SPECS; this guards that the wired ones stay covered.
    for (const comp of ['SpineAnimation', 'AudioSource', 'Text', 'BitmapText', 'ShapeRenderer', 'Mesh2D', 'TrailRenderer']) {
      const src = ENTITY_SOURCES.find((s) => s.id === `anchor:${comp}`);
      expect(src, `no create source for anchor ${comp}`).toBeDefined();
      const p = await src!.build({ parent: null });
      expect(p.entities[0].components.map((c) => c.type)).toContain(comp);
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
    const layer = root.components.find((c) => c.type === 'TilemapLayer')!.data as Record<string, unknown>;
    expect(layer.cellSize).toMatchObject({ x: 32, y: 16 });
    expect(layer.tilesetAssets).toBeUndefined(); // no ref → no out-of-band link baked

    // With a tilesetRef the out-of-band link is baked into the prefab (the Reconciler
    // live-pushes it on spawn, so no create-time setLayerTilesets step).
    const withRef = tilemapPrefab('Tilemap', { x: 16, y: 16 }, '@uuid:ts-1').entities[0]
      .components.find((c) => c.type === 'TilemapLayer')!.data as Record<string, unknown>;
    expect(withRef.tilesetAssets).toEqual(['@uuid:ts-1']);
    expect(withRef.tilesetAsset).toBe('@uuid:ts-1');
  });

  it('createFromSource returns null when build throws (aborted source, e.g. a failed prefab load)', async () => {
    const bad = { ...ENTITY_SOURCES[0], id: 'bad', build: () => { throw new Error('nope'); } };
    expect(await createFromSource(bad, { parent: null })).toBeNull();
  });
});
