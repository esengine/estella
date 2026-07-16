// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ControllerRecorder.ts
 * @brief   Record mode for UI gears — auto-write a field edit into the active
 *          controller's current page.
 *
 * Mirrors TimelineRecorder: it registers one hook on the single SceneCommands
 * field-edit door. When recording is armed and the edited entity carries a UIGear
 * binding for the active controller + that field, it stores the edited value under
 * the controller's current page. Observe-only (returns false) so the scene edit
 * still lands and the gear-apply system re-projects the same value — a burst (drag)
 * coalesces into one undo step. This is the "select a page → edit geared fields →
 * auto-recorded" half of the authoring flow; the gear dot in Details opts a field in.
 */
import { useControllerStore } from '@/store/controllerStore';
import { SceneCommands, toModelValue } from '@/engine/SceneCommands';
import { EditorHistory } from '@/engine/EditorHistory';
import { controllerCurrentPage, readComponentData, readGearBindings } from './controllerModel';
import type { EntityId, InspectorFieldType, InspectorFieldValue } from '@/types';
import type { GearBinding, GearValue } from 'esengine';

const clone = <T>(v: T): T =>
  typeof structuredClone === 'function' ? structuredClone(v) : (JSON.parse(JSON.stringify(v)) as T);

/**
 * The gear value for a binding, from an edit already folded to MODEL shape by
 * toModelValue (so color = {r,g,b,a}, vec = {x,y,z}, dimension = {value,unit}).
 * A whole-field binding (property === key) stores the whole value; a sub-path
 * binding ("color.a") pulls that one scalar out of the model object.
 */
function gearValueFor(modelValue: unknown, property: string, key: string): GearValue | null {
  if (property === key) return (modelValue ?? null) as GearValue | null;
  if (modelValue != null && typeof modelValue === 'object') {
    const v = (modelValue as Record<string, unknown>)[property.slice(key.length + 1)];
    return typeof v === 'number' ? v : null;
  }
  return null;
}

class ControllerRecorderImpl {
  private attached = false;
  private burst: { entity: EntityId; before: GearBinding[] } | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  attach(): void {
    if (this.attached) return;
    this.attached = true;
    SceneCommands.addEditHook((sourceId, compName, key, type, value) =>
      this.onEdit(sourceId, compName, key, type, value),
    );
    // Flush the pending burst the moment recording is switched off.
    useControllerStore.subscribe(() => {
      if (!useControllerStore.getState().recording && this.timer != null) this.flush();
    });
  }

  private onEdit(
    sourceId: EntityId,
    compName: string,
    key: string,
    type: InspectorFieldType,
    value: InspectorFieldValue,
  ): boolean {
    const { recording, activeController } = useControllerStore.getState();
    if (!recording || !activeController) return false;

    const bindings = readGearBindings(sourceId);
    if (bindings.length === 0) return false;
    const page = controllerCurrentPage(sourceId, activeController);
    if (page == null) return false;
    const cur = readComponentData(sourceId, compName);
    if (!cur) return false;
    const modelValue = toModelValue(cur, type, key, value);

    // A new burst on a different entity flushes the previous one first.
    if (this.burst && this.burst.entity !== sourceId) this.flush();

    const next = clone(bindings);
    let wrote = 0;
    for (const b of next) {
      if (b.controller !== activeController || b.component !== compName) continue;
      if (b.property !== key && !b.property.startsWith(`${key}.`)) continue;
      const gv = gearValueFor(modelValue, b.property, key);
      if (gv == null) continue;
      b.pages[page] = gv;
      wrote++;
    }
    if (wrote === 0) return false;

    if (!this.burst) this.burst = { entity: sourceId, before: clone(bindings) };
    SceneCommands.setGearBindingsLive(sourceId, next); // live: reconciler → gear-apply re-projects
    this.scheduleCommit();
    return false; // observe-only — the scene edit still applies
  }

  private scheduleCommit(): void {
    if (this.timer != null) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.commit(), 200);
  }

  private flush(): void {
    if (this.timer != null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.commit();
  }

  /** Record the whole burst (pre-burst → now) as one undo step. */
  private commit(): void {
    this.timer = null;
    const burst = this.burst;
    this.burst = null;
    if (!burst) return;
    const after = readGearBindings(burst.entity);
    const entity = burst.entity;
    const before = burst.before;
    const now = clone(after);
    EditorHistory.record(
      'Record Gear',
      () => SceneCommands.setGearBindingsLive(entity, now),
      () => SceneCommands.setGearBindingsLive(entity, before),
    );
  }
}

export const ControllerRecorder = new ControllerRecorderImpl();
