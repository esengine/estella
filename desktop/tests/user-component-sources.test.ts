// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  userComponentSources (REARCH ENTITY_CREATION E4) — a project's own
 *        components appear in the Create popover as plain Transform + that-component
 *        entities, bucketed under 'Scripts', with zero per-component wiring.
 *
 *        Driven through `setUserSchemas`, which is the real seam: `schemas.json` is
 *        how a project's components reach an editor that never runs project code.
 *        This file used to mock the engine's `getUserComponents()` instead, and
 *        passed while the shipped list was empty for every project — that registry
 *        only ever holds what the EDITOR realm itself defined.
 */
import { describe, it, expect, afterEach } from 'vitest';

import { userComponentSources } from '@/engine/entitySources';
import { setUserSchemas, type UserComponentSchema } from '@/engine/schema';

const schema = (name: string, def: Record<string, unknown> = {}): UserComponentSchema =>
  ({ name, isTag: false, default: def, colorKeys: [] });

afterEach(() => setUserSchemas([]));

describe('userComponentSources (Create-entity E4 dynamic sources)', () => {
  it('makes one Scripts-category source per project component', () => {
    setUserSchemas([schema('Health', { hp: 100 }), schema('Inventory')]);
    const srcs = userComponentSources();
    expect(srcs.map((s) => s.label)).toEqual(expect.arrayContaining(['Health', 'Inventory']));
    expect(srcs).toHaveLength(2);
    for (const s of srcs) {
      expect(s.category).toBe('Scripts');
      expect(s.icon).toBeTruthy();
    }
  });

  it('build() yields a plain entity carrying Transform + the component', async () => {
    setUserSchemas([schema('Health', { hp: 100 })]);
    const health = userComponentSources().find((s) => s.label === 'Health')!;
    const p = await health.build!({ parent: null });
    expect(p.entities[0].components.map((c) => c.type)).toEqual(['Transform', 'Health']);
  });

  it('lists nothing when the project has declared no components', () => {
    setUserSchemas([]);
    expect(userComponentSources()).toEqual([]);
  });

  it('leaves an engine component to its own curated preset', () => {
    // Marker is an engine component and reaches the picker through a preset with a
    // real icon and category; a generic entry would be a second, worse duplicate.
    setUserSchemas([schema('Marker'), schema('Health')]);
    expect(userComponentSources().map((s) => s.label)).toEqual(['Health']);
  });
});
