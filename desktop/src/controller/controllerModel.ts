// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    controllerModel.ts
 * @brief   Editor-side readers for UIController / UIGear scene-model data.
 *
 * The Controllers panel, the Details gear dot, and the ControllerRecorder all need
 * to read the same authored data (controllers on an entity, gear bindings, the
 * nearest controller's current page). These pure model readers live here so those
 * three surfaces resolve controllers identically — mirroring the runtime's self →
 * ancestor resolution (findControllerOwner in the SDK) over the SceneModel tree.
 */
import { SceneModel } from '@/engine/SceneModel';
import type { EntityId } from '@/types';
import type { ControllerState, GearBinding, UIControllerData, UIGearData } from 'esengine';

export function readControllers(id: EntityId): ControllerState[] {
  const d = SceneModel.entityBySource(id)?.components.find((c) => c.type === 'UIController')?.data as UIControllerData | undefined;
  return d?.controllers ?? [];
}

export interface ResolvedController {
  ctrl: ControllerState;
  /** Entity that declares the controller (page edits target this id). */
  owner: EntityId;
  ownerName: string;
  /** Declared on an ancestor rather than the queried entity itself. */
  inherited: boolean;
}

/**
 * Every controller visible from `id` — its own plus each ancestor's, nearest
 * declaration winning on a name clash (the same rule the runtime resolves gears
 * by). This is what lets the Controllers panel keep showing (and switching) the
 * root's controllers while a geared leaf is selected.
 */
export function resolveControllers(id: EntityId): ResolvedController[] {
  const out: ResolvedController[] = [];
  const seen = new Set<string>();
  let cur: EntityId | null = id;
  while (cur != null) {
    const e = SceneModel.entityBySource(cur);
    if (!e) break;
    for (const ctrl of readControllers(cur)) {
      if (seen.has(ctrl.name)) continue;
      seen.add(ctrl.name);
      out.push({ ctrl, owner: cur, ownerName: e.name, inherited: cur !== id });
    }
    cur = (e.parent as EntityId | null) ?? null;
  }
  return out;
}

export function readGearBindings(id: EntityId): GearBinding[] {
  const d = SceneModel.entityBySource(id)?.components.find((c) => c.type === 'UIGear')?.data as UIGearData | undefined;
  return d?.bindings ?? [];
}

/** The nearest entity (self → ancestors) that owns a controller named `name`. */
export function findControllerOwner(id: EntityId, name: string): EntityId | null {
  let cur: EntityId | null = id;
  while (cur != null) {
    const e = SceneModel.entityBySource(cur);
    if (!e) return null;
    if (readControllers(cur).some((c) => c.name === name)) return cur;
    cur = (e.parent as EntityId | null) ?? null;
  }
  return null;
}

/** Current page of the nearest controller named `name`, or null if none resolves. */
export function controllerCurrentPage(id: EntityId, name: string): string | null {
  const owner = findControllerOwner(id, name);
  if (owner == null) return null;
  return readControllers(owner).find((c) => c.name === name)?.current ?? null;
}

/** The whole model data record of a component on an entity, or undefined. */
export function readComponentData(id: EntityId, component: string): Record<string, unknown> | undefined {
  return SceneModel.entityBySource(id)?.components.find((c) => c.type === component)?.data as Record<string, unknown> | undefined;
}

/** The raw model value of a component field (model shape, e.g. {r,g,b,a} for color). */
export function readModelField(id: EntityId, component: string, property: string): unknown {
  const data = readComponentData(id, component);
  if (!data) return undefined;
  let cur: unknown = data;
  for (const part of property.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/** Whether entity `id` has a gear binding for (controller, component, property). */
export function isGeared(id: EntityId, controller: string, component: string, property: string): boolean {
  return readGearBindings(id).some((b) => b.controller === controller && b.component === component && b.property === property);
}
