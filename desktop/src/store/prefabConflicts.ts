// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  prefabConflicts.ts — stale prefab-instance overrides detected on scene
 *        load (via the SDK `validateOverrides`). An instance override that points
 *        at an entity / component the prefab no longer has can't be applied — the
 *        loader silently drops it, so a customization vanishes with no trace. This
 *        store records what was dropped, keyed by the instance root's source id,
 *        so the Inspector can surface it and offer a one-click clean-up (a save
 *        persists the already-dropped state).
 */
import { create } from 'zustand';
import type { StaleOverride } from 'esengine';

interface PrefabConflictState {
  /** Instance root source id → the stale overrides dropped on load. Empty = none. */
  byInstance: Map<number, StaleOverride[]>;
  /** Total dropped overrides across all instances (toast / summary count). */
  total: number;
  setAll: (byInstance: Map<number, StaleOverride[]>) => void;
  /** Forget one instance's conflicts (after it's repaired / its subtree removed). */
  clearInstance: (rootId: number) => void;
  clear: () => void;
}

const countAll = (m: Map<number, StaleOverride[]>): number => {
  let n = 0;
  for (const v of m.values()) n += v.length;
  return n;
};

export const usePrefabConflicts = create<PrefabConflictState>((set) => ({
  byInstance: new Map(),
  total: 0,
  setAll: (byInstance) => set({ byInstance, total: countAll(byInstance) }),
  clearInstance: (rootId) =>
    set((s) => {
      if (!s.byInstance.has(rootId)) return s;
      const byInstance = new Map(s.byInstance);
      byInstance.delete(rootId);
      return { byInstance, total: countAll(byInstance) };
    }),
  clear: () => set({ byInstance: new Map(), total: 0 }),
}));
