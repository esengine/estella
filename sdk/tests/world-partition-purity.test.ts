// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  partitionWorld takes a document, not a file, and gives back documents
 *        that are not the one it took.
 *
 * cookWorlds is the filesystem around it — read the staged scene, write the
 * cells, overwrite the persistent one. What the cut itself needs is the
 * document, the entity-ref fields and where a prefab's root sits. Anything that
 * wanted to partition something never written to disk depends on that staying
 * true, and on the input surviving the call unchanged.
 */
import { describe, it, expect } from 'vitest';
import { partitionWorld } from '../src/residency/partitionWorld';
import { registryEntityFields } from '../src/residency/componentRefs';
import type { SceneData } from '../src/scene/scene';

const CELL = 100;

/** A world authored in memory — never written, never read back. */
function world(sentinelX: number): SceneData {
  return {
    version: '1.0', name: 'purity',
    entities: [
      { id: 1, name: 'World', parent: null, children: [],
        components: [{ type: 'StreamedWorld', data: { cellSize: CELL } }] },
      { id: 2, name: 'Anchor', parent: null, children: [],
        components: [{ type: 'Transform', data: { position: { x: 50, y: 0, z: 50 } } }] },
      { id: 3, name: 'Sentinel', parent: null, children: [],
        components: [{ type: 'Transform', data: { position: { x: sentinelX, y: 0, z: 50 } } }] },
    ],
  } as unknown as SceneData;
}

const opts = { entityFieldsOf: registryEntityFields() };
const cellOf = (p: ReturnType<typeof partitionWorld>, name: string): string | null =>
  p!.cells.find((c) =>
    (c.data.entities as unknown as Array<{ name?: string }>).some((e) => e.name === name))?.name ?? null;

describe('partitionWorld over a document that was never staged', () => {
  it('places an entity by the position the document holds', () => {
    const near = partitionWorld(world(50), 'purity', opts);
    const far = partitionWorld(world(250), 'purity', opts);
    expect(near!.errors).toEqual([]);
    expect(far!.errors).toEqual([]);
    expect(cellOf(near, 'Sentinel')).toBe(cellOf(near, 'Anchor'));
    expect(cellOf(far, 'Sentinel')).not.toBe(cellOf(far, 'Anchor'));
  });

  it('leaves the document it was given byte-identical', () => {
    const doc = world(250);
    const snapshot = JSON.stringify(doc);
    expect(partitionWorld(doc, 'purity', opts)!.errors).toEqual([]);
    expect(JSON.stringify(doc)).toBe(snapshot);
  });

  it('gives back cell entities that do not alias the input', () => {
    // A cell that shared entity objects with its source would let a runtime
    // mutation reach back into whatever authored the world.
    const doc = world(250);
    const authored = doc.entities as unknown as unknown[];
    for (const cell of partitionWorld(doc, 'purity', opts)!.cells) {
      for (const e of cell.data.entities as unknown as unknown[]) {
        expect(authored.includes(e)).toBe(false);
      }
    }
  });
});
