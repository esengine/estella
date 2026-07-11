// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  userComponentSources (REARCH ENTITY_CREATION E4) — a user's defineComponent
 *        components appear in the Create popover as plain Transform + that-component
 *        entities, bucketed under 'Scripts', with zero per-component wiring. Pure TS;
 *        getUserComponents is mocked to a deterministic set.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('esengine', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, getUserComponents: () => new Map([['Health', {}], ['Inventory', {}]]) };
});

import { userComponentSources } from '@/engine/entitySources';

describe('userComponentSources (Create-entity E4 dynamic sources)', () => {
  it('makes one Scripts-category source per user component', () => {
    const srcs = userComponentSources();
    expect(srcs.map((s) => s.label)).toEqual(expect.arrayContaining(['Health', 'Inventory']));
    expect(srcs).toHaveLength(2);
    for (const s of srcs) {
      expect(s.category).toBe('Scripts');
      expect(s.icon).toBeTruthy();
    }
  });

  it('build() yields a plain entity carrying Transform + the component', async () => {
    const health = userComponentSources().find((s) => s.label === 'Health')!;
    const p = await health.build({ parent: null });
    expect(p.entities[0].components.map((c) => c.type)).toEqual(['Transform', 'Health']);
  });
});
