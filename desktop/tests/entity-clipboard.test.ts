// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  remapClipboardEntities — the pure re-keying behind entity paste: fresh
 *        ids, internal links remapped, roots reparented + offset.
 */
import { describe, it, expect } from 'vitest';
import { remapClipboardEntities } from '@/engine/entityClipboard';
import type { SceneData } from 'esengine';

type SceneEntity = SceneData['entities'][number];

const ent = (id: number, parent: number | null, children: number[], x = 0, y = 0): SceneEntity =>
  ({ id, name: `e${id}`, parent, children, visible: true,
     components: [{ type: 'Transform', data: { position: { x, y } } }] }) as unknown as SceneEntity;

function counter(start = 100) {
  let n = start;
  return () => n++;
}

const posOf = (e: SceneEntity) =>
  ((e.components.find((c) => c.type === 'Transform')!.data as { position: { x: number; y: number } }).position);

describe('remapClipboardEntities', () => {
  it('re-keys a single root: fresh id, reparented, offset applied', () => {
    const { entities, rootIds } = remapClipboardEntities([ent(1, null, [], 10, 20)], counter(), 7, { x: 24, y: -24 });
    expect(entities).toHaveLength(1);
    expect(entities[0].id).toBe(100);
    expect((entities[0] as { parent: number | null }).parent).toBe(7);
    expect(posOf(entities[0])).toEqual({ x: 34, y: -4 });
    expect(rootIds).toEqual([100]);
  });

  it('preserves internal parent/child links of a subtree', () => {
    // 1 (root) → 2 (child)
    const payload = [ent(1, null, [2], 0, 0), ent(2, 1, [], 5, 5)];
    const { entities, rootIds } = remapClipboardEntities(payload, counter(), null, { x: 1, y: 1 });
    const [root, child] = entities;
    expect(root.id).toBe(100);
    expect(child.id).toBe(101);
    expect((root as { parent: number | null }).parent).toBe(null); // reparented to scene root
    expect((root as { children: number[] }).children).toEqual([101]); // remapped
    expect((child as { parent: number | null }).parent).toBe(100); // internal link remapped
    expect(rootIds).toEqual([100]);
    // Offset applies to the root only, not the child.
    expect(posOf(root)).toEqual({ x: 1, y: 1 });
    expect(posOf(child)).toEqual({ x: 5, y: 5 });
  });

  it('treats each entity whose parent is outside the set as a root', () => {
    const payload = [ent(1, null, [], 0, 0), ent(2, 99, [], 0, 0)]; // 2's parent 99 not in set
    const { rootIds } = remapClipboardEntities(payload, counter(), 7, { x: 0, y: 0 });
    expect(rootIds).toEqual([100, 101]);
  });

  it('drops child links that point outside the copied set', () => {
    const payload = [ent(1, null, [2, 88], 0, 0), ent(2, 1, [], 0, 0)];
    const { entities } = remapClipboardEntities(payload, counter(), null, { x: 0, y: 0 });
    expect((entities[0] as { children: number[] }).children).toEqual([101]); // 88 dropped, 2→101
  });

  it('does not mutate the input payload (pure)', () => {
    const payload = [ent(1, null, [], 10, 20)];
    remapClipboardEntities(payload, counter(), 7, { x: 24, y: -24 });
    expect(payload[0].id).toBe(1);
    expect((payload[0] as { parent: number | null }).parent).toBe(null);
    expect(posOf(payload[0])).toEqual({ x: 10, y: 20 });
  });
});
