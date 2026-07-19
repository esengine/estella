// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Reverse index of entity-reference fields: referenced source id → the
 *        components that point at it. The {@link ReconcilerImpl} consults it on
 *        spawn to re-project only the (few) components whose entity-ref field
 *        targets the just-spawned entity — undo-of-delete can restore a joint's
 *        connected body after the joint itself, and that component's World copy
 *        would otherwise keep a dead runtime id.
 *
 *        This replaces an O(entities × components) full-model scan run on EVERY
 *        spawn (so a paste of K entities was O(K·N)). Maintained incrementally on
 *        the same mutation paths that used to trigger the scan: spawn/despawn and
 *        entity-ref field writes. Pure data (no engine/World coupling) so the
 *        maintenance logic is unit-testable in isolation.
 */

/** A component instance that points at some entity via an entity-ref field. */
export interface Referrer {
  entity: number;
  comp: string;
}

const keyOf = (entity: number, comp: string): string => `${entity}|${comp}`;

export class EntityRefIndex {
  /** referrer entity → (component type → referenced source ids). The forward map
   *  is what lets a despawn drop the entity's edges without re-reading its (now
   *  gone) model components. */
  private readonly out = new Map<number, Map<string, number[]>>();
  /** referenced source id → set of `entity|comp` referrers — the consulted side. */
  private readonly incoming = new Map<number, Set<string>>();

  clear(): void {
    this.out.clear();
    this.incoming.clear();
  }

  /**
   * Replace the entity-ref edges of one component. `refs` are the source ids its
   * entity-ref fields currently point at; 0/negatives are the INVALID_ENTITY
   * sentinel (mirrors the reconciler's `v > 0` projection guard) and carry no
   * edge. An empty result drops the component from the index.
   */
  setReferrer(entity: number, comp: string, refs: readonly number[]): void {
    const key = keyOf(entity, comp);
    const entMap = this.out.get(entity);
    const old = entMap?.get(comp);
    if (old) for (const r of old) this.dropIncoming(r, key);

    const next = refs.length ? [...new Set(refs)].filter((r) => r > 0) : [];
    if (next.length === 0) {
      entMap?.delete(comp);
      if (entMap && entMap.size === 0) this.out.delete(entity);
      return;
    }
    (entMap ?? this.ensureEnt(entity)).set(comp, next);
    for (const r of next) {
      let s = this.incoming.get(r);
      if (!s) this.incoming.set(r, (s = new Set()));
      s.add(key);
    }
  }

  /** Drop every outgoing edge of an entity (its components are gone from the model). */
  removeEntity(entity: number): void {
    const entMap = this.out.get(entity);
    if (!entMap) return;
    for (const [comp, refs] of entMap) {
      const key = keyOf(entity, comp);
      for (const r of refs) this.dropIncoming(r, key);
    }
    this.out.delete(entity);
  }

  /** The components whose entity-ref field currently targets `sourceId`. */
  referrersOf(sourceId: number): Referrer[] {
    const s = this.incoming.get(sourceId);
    if (!s) return [];
    const out: Referrer[] = [];
    for (const key of s) {
      const sep = key.indexOf('|');
      out.push({ entity: Number(key.slice(0, sep)), comp: key.slice(sep + 1) });
    }
    return out;
  }

  /** A normalized, order-independent snapshot (both directions) for equality
   *  checks — the incremental index must equal one rebuilt from scratch. */
  snapshot(): { out: Record<number, Record<string, number[]>>; incoming: Record<number, string[]> } {
    const out: Record<number, Record<string, number[]>> = {};
    for (const [entity, comps] of this.out) {
      const c: Record<string, number[]> = {};
      for (const [comp, refs] of comps) c[comp] = [...refs].sort((a, b) => a - b);
      out[entity] = c;
    }
    const incoming: Record<number, string[]> = {};
    for (const [ref, keys] of this.incoming) incoming[ref] = [...keys].sort();
    return { out, incoming };
  }

  private ensureEnt(entity: number): Map<string, number[]> {
    let m = this.out.get(entity);
    if (!m) this.out.set(entity, (m = new Map()));
    return m;
  }

  private dropIncoming(ref: number, key: string): void {
    const s = this.incoming.get(ref);
    if (!s) return;
    s.delete(key);
    if (s.size === 0) this.incoming.delete(ref);
  }
}
