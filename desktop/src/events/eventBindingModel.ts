// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    eventBindingModel.ts
 * @brief   Editor-side readers for EventBinding scene-model data.
 *
 * The Events section reads authored wires from the SceneModel (never from the
 * live World — an entity's rows must be visible before play), and resolves a
 * row's `target` name the way the runtime does. Mirrors controllerModel.ts, and
 * for the same reason: one place decides what an authored wire means, so the
 * inspector and the runtime can't drift.
 */
import { SceneModel } from '@/engine/SceneModel';
import type { EntityId } from '@/types';
import type { EventBindingData, EventBindingRow } from 'esengine';

export function readEventRows(id: EntityId): EventBindingRow[] {
  const d = SceneModel.entityBySource(id)?.components.find((c) => c.type === 'EventBinding')?.data as
    | EventBindingData
    | undefined;
  return d?.rows ?? [];
}

/** Every distinct entity name in the scene, for the target picker. */
export function sceneEntityNames(): string[] {
  const seen = new Set<string>();
  for (const e of SceneModel.current?.entities ?? []) {
    if (e.name) seen.add(e.name);
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

/**
 * The entity a row's `target` names, resolved nearest-first from `from` — the
 * model-side twin of the runtime's `resolveBindingTarget`: self, then self's
 * subtree, then each ancestor's subtree, then any entity of that name. Null when
 * the name matches nothing (the picker renders that as a dangling ref).
 */
export function resolveTargetName(from: EntityId, name: string): EntityId | null {
  if (!name) return from;
  const model = SceneModel.current;
  if (!model) return null;

  const inSubtree = (root: EntityId, skip: EntityId | null): EntityId | null => {
    if (root === skip) return null;
    const e = SceneModel.entityBySource(root);
    if (!e) return null;
    if (e.name === name) return root;
    for (const child of e.children) {
      const hit = inSubtree(child as EntityId, skip);
      if (hit != null) return hit;
    }
    return null;
  };

  let node: EntityId | null = from;
  let skip: EntityId | null = null;
  while (node != null) {
    const hit = inSubtree(node, skip);
    if (hit != null) return hit;
    skip = node;
    node = (SceneModel.entityBySource(node)?.parent ?? null) as EntityId | null;
  }
  return (model.entities.find((e) => e.name === name)?.id as EntityId | undefined) ?? null;
}
