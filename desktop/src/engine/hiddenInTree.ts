// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    hiddenInTree.ts
 * @brief   Editor visibility, resolved down the hierarchy.
 *
 * The eye in the Outliner sets a per-entity `hidden` flag, and five places asked
 * that flag directly: the bulk world projection, entity spawn, component
 * re-projection, viewport picking, and the tree the Outliner draws. Each of them
 * therefore answered for ONE entity — so hiding a parent left every child
 * drawing, and pickable, and shown as visible.
 *
 * Hiding a parent has to hide what it contains, the way it does in every editor
 * anyone comes from. That is one rule, so it is one function, and the five
 * callers ask it instead of reading the flag.
 *
 * Pure — a lookup, not a model — so the same definition serves the SceneModel
 * (which has entities by id) and the raw `SceneData` of a bulk load (which has
 * an array), and so it is testable without a scene.
 */

/** The two fields resolving visibility needs of any entity shape. */
export interface HiddenNode {
  parent?: number | null;
  hidden?: boolean;
}

/**
 * Whether `sourceId` is hidden — by its own flag, or by any ancestor's.
 *
 * A parent chain that loops would hang this; the scene model does not build
 * one, but an `.esscene` on disk is a file a person can edit, and a hang has no
 * error message. Bounded by the number of nodes visited instead.
 */
export function hiddenInTree(
  sourceId: number,
  lookup: (id: number) => HiddenNode | undefined,
): boolean {
  const seen = new Set<number>();
  let at: number | null | undefined = sourceId;
  while (at != null && !seen.has(at)) {
    seen.add(at);
    const node = lookup(at);
    if (!node) return false;
    if (node.hidden) return true;
    at = node.parent;
  }
  return false;
}

/**
 * The same answer for many entities at once, without re-walking shared ancestry.
 *
 * A bulk load resolves every entity in the scene; walking each one's chain
 * separately is quadratic in a deep hierarchy, and a UI package is exactly that.
 * Returns a predicate rather than a set so the memo stays private.
 */
export function hiddenInTreeResolver(
  lookup: (id: number) => HiddenNode | undefined,
): (sourceId: number) => boolean {
  const memo = new Map<number, boolean>();
  return (sourceId: number): boolean => {
    // The chain from `sourceId` up to the first answer we already have.
    const pending: number[] = [];
    const seen = new Set<number>();
    let at: number | null | undefined = sourceId;
    let answer = false;
    while (at != null && !seen.has(at)) {
      const known = memo.get(at);
      if (known !== undefined) { answer = known; break; }
      seen.add(at);
      const node = lookup(at);
      if (!node) break;
      pending.push(at);
      if (node.hidden) { answer = true; break; }
      at = node.parent;
    }
    // Every node on the way up shares the answer: if an ancestor hid them they
    // are all hidden, and if none did, none of them is.
    for (const id of pending) memo.set(id, answer);
    return answer;
  };
}
