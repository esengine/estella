// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A UI widget ('under-canvas' placement) must be hosted by a Canvas — a
 *        UINode with no Canvas can't lay out or be positioned. createFromSource
 *        spins one up when the scene has none, reuses an existing one, and yields
 *        to an explicit parent.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const rec = vi.hoisted(() => ({ calls: [] as { name: string; parent: number | null }[], hasCanvas: false }));
vi.mock('@/engine/SceneCommands', () => ({
  SceneCommands: {
    findCanvas: () => (rec.hasCanvas ? 1 : null),
    create: (prefab: { name: string }, opts: { parent: number | null }) => {
      rec.calls.push({ name: prefab.name, parent: opts.parent });
      return 100 + rec.calls.length; // a fresh id per create
    },
  },
}));

import { ENTITY_SOURCES, createFromSource } from '@/engine/entitySources';
const button = () => ENTITY_SOURCES.find((s) => s.label === 'Button')!;

describe('UI widget creation ensures a Canvas host', () => {
  beforeEach(() => { rec.calls = []; rec.hasCanvas = false; });

  it('a Canvas-less scene spins up a Canvas first, then parents the widget under it', async () => {
    await createFromSource(button(), { parent: null });
    expect(rec.calls.map((c) => c.name)).toEqual(['Canvas', 'Button']);
    expect(rec.calls[0].parent).toBeNull(); // Canvas at root
    expect(rec.calls[1].parent).toBe(101); // Button under the just-made Canvas (id 100+1)
  });

  it('an existing Canvas is reused — no second Canvas', async () => {
    rec.hasCanvas = true;
    await createFromSource(button(), { parent: null });
    expect(rec.calls.map((c) => c.name)).toEqual(['Button']);
    expect(rec.calls[0].parent).toBe(1);
  });

  it('an explicit drop parent wins — no Canvas auto-created', async () => {
    await createFromSource(button(), { parent: 42 });
    expect(rec.calls.map((c) => c.name)).toEqual(['Button']);
    expect(rec.calls[0].parent).toBe(42);
  });
});
