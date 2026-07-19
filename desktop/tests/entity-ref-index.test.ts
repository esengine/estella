// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  EntityRefIndex — the reverse index the Reconciler consults on spawn to
 *        re-project a just-spawned entity's referrers in O(referrers) rather than
 *        scanning the whole model. The correctness bar: after ANY sequence of
 *        incremental mutations (spawn / despawn / entity-ref field write /
 *        component remove), the index must equal one rebuilt from scratch — the
 *        same equivalence the reconciler relies on to drop the full-model scan.
 */
import { describe, it, expect } from 'vitest';
import { EntityRefIndex } from '@/engine/EntityRefIndex';

// A minimal model + the entity-ref field map the reconciler reads from the
// component registry (Joint.connectedEntity, a made-up two-ref component).
type Comp = { type: string; data: Record<string, unknown> };
type Ent = { id: number; components: Comp[] };
const ENTITY_FIELDS: Record<string, string[]> = {
  Joint: ['connectedEntity'],
  Link: ['a', 'b'],
};

function refsOf(comp: Comp): number[] {
  const fields = ENTITY_FIELDS[comp.type] ?? [];
  const out: number[] = [];
  for (const f of fields) {
    const v = comp.data[f];
    if (typeof v === 'number') out.push(v);
  }
  return out;
}

/** A full rebuild from the final model — the reference the incremental index must match. */
function fullBuild(model: Map<number, Ent>): EntityRefIndex {
  const idx = new EntityRefIndex();
  for (const e of model.values()) for (const c of e.components) idx.setReferrer(e.id, c.type, refsOf(c));
  return idx;
}

// A tiny driver mirroring the reconciler's index hooks on model events.
class Harness {
  readonly model = new Map<number, Ent>();
  readonly idx = new EntityRefIndex();

  spawn(e: Ent): void {
    this.model.set(e.id, e);
    for (const c of e.components) this.idx.setReferrer(e.id, c.type, refsOf(c));
  }
  despawn(id: number): void {
    this.model.delete(id);
    this.idx.removeEntity(id);
  }
  setField(id: number, type: string, field: string, value: number): void {
    const comp = this.model.get(id)?.components.find((c) => c.type === type);
    if (!comp) return;
    comp.data[field] = value;
    this.idx.setReferrer(id, type, refsOf(comp));
  }
  removeComponent(id: number, type: string): void {
    const e = this.model.get(id);
    if (e) e.components = e.components.filter((c) => c.type !== type);
    this.idx.setReferrer(id, type, []);
  }
}

const ent = (id: number, comps: Comp[]): Ent => ({ id, components: comps });
const joint = (connectedEntity: number): Comp => ({ type: 'Joint', data: { connectedEntity } });

describe('EntityRefIndex — basic reverse lookups', () => {
  it('reports the components whose entity-ref field targets a source id', () => {
    const idx = new EntityRefIndex();
    idx.setReferrer(5, 'Joint', [2]);
    idx.setReferrer(6, 'Link', [2, 3]);
    expect(idx.referrersOf(2).sort((a, b) => a.entity - b.entity)).toEqual([
      { entity: 5, comp: 'Joint' },
      { entity: 6, comp: 'Link' },
    ]);
    expect(idx.referrersOf(3)).toEqual([{ entity: 6, comp: 'Link' }]);
    expect(idx.referrersOf(99)).toEqual([]);
  });

  it('treats 0 / negatives (INVALID_ENTITY) as no reference', () => {
    const idx = new EntityRefIndex();
    idx.setReferrer(5, 'Joint', [0]);
    idx.setReferrer(6, 'Joint', [-1]);
    expect(idx.referrersOf(0)).toEqual([]);
    expect(idx.snapshot().incoming).toEqual({});
  });

  it('a re-pointed field moves the edge; the old target loses its referrer', () => {
    const idx = new EntityRefIndex();
    idx.setReferrer(5, 'Joint', [2]);
    idx.setReferrer(5, 'Joint', [3]); // re-point 5's joint from 2 → 3
    expect(idx.referrersOf(2)).toEqual([]);
    expect(idx.referrersOf(3)).toEqual([{ entity: 5, comp: 'Joint' }]);
  });

  it('removeEntity drops the entity as a referrer everywhere', () => {
    const idx = new EntityRefIndex();
    idx.setReferrer(5, 'Link', [2, 3]);
    idx.removeEntity(5);
    expect(idx.referrersOf(2)).toEqual([]);
    expect(idx.referrersOf(3)).toEqual([]);
    expect(idx.snapshot()).toEqual({ out: {}, incoming: {} });
  });
});

describe('EntityRefIndex — incremental == full rebuild', () => {
  it('matches a from-scratch rebuild after a spawn / repoint / despawn sequence', () => {
    const h = new Harness();
    // Paste a subtree where a parent joint points at a child spawned later.
    h.spawn(ent(1, [joint(3)])); // 1's joint targets 3 (not yet spawned)
    h.spawn(ent(2, [joint(1)]));
    h.spawn(ent(3, [{ type: 'Link', data: { a: 1, b: 2 } }]));
    // Edits + structural churn.
    h.setField(2, 'Joint', 'connectedEntity', 3); // 2 re-points 1 → 3
    h.setField(1, 'Joint', 'connectedEntity', 0); // 1 clears its ref
    h.spawn(ent(4, [joint(3), { type: 'Link', data: { a: 3, b: 3 } }]));
    h.removeComponent(4, 'Link');
    h.despawn(3); // 3 leaves; its outgoing Link edges vanish, incoming edges stay
    h.spawn(ent(3, [{ type: 'Link', data: { a: 4, b: 1 } }])); // undo-of-delete: 3 returns, re-pointed

    expect(h.idx.snapshot()).toEqual(fullBuild(h.model).snapshot());
  });

  it('matches a from-scratch rebuild after a heavy batch paste + partial delete', () => {
    const h = new Harness();
    for (let i = 1; i <= 300; i++) h.spawn(ent(i, [joint(i === 1 ? 0 : i - 1)])); // chain 2→1, 3→2, …
    for (let i = 2; i <= 300; i += 2) h.despawn(i); // delete every other node
    for (let i = 301; i <= 320; i++) h.spawn(ent(i, [{ type: 'Link', data: { a: 1, b: 301 } }]));

    expect(h.idx.snapshot()).toEqual(fullBuild(h.model).snapshot());
  });
});
