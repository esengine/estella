// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  fieldUnits.ts — which unit a `normalizedOf` field is shown in, keyed by
 *        `Component.field`, persisted like the inspector's collapse state.
 *
 * The unit is a VIEW, never data: the scene always stores the fraction, and this
 * store only decides whether the row renders it as a fraction or multiplied out
 * into pixels. Persisting it is what makes the choice worth offering — a creator
 * who thinks in pixels sets it once instead of on every reselect.
 */
import { create } from 'zustand';

/** How a normalized field renders: as the stored fraction, or multiplied into pixels. */
export type FieldUnit = 'norm' | 'px';

const LS_KEY = 'estella.fieldUnits';

function load(): Record<string, FieldUnit> {
  if (typeof localStorage === 'undefined') return {};
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? '{}') as Record<string, FieldUnit>;
  } catch {
    return {}; // corrupt blob → start clean
  }
}
function save(units: Record<string, FieldUnit>): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(units));
  } catch {
    /* quota / private mode — persistence is best-effort */
  }
}

/** The store key for one field: the component it belongs to plus its name. */
export const fieldUnitKey = (comp: string, key: string): string => `${comp}.${key}`;

interface FieldUnitState {
  units: Record<string, FieldUnit>;
  set: (key: string, unit: FieldUnit) => void;
}

export const useFieldUnits = create<FieldUnitState>((set, get) => ({
  units: load(),
  set: (key, unit) =>
    set(() => {
      const units = { ...get().units, [key]: unit };
      save(units);
      return { units };
    }),
}));

/** The unit a field renders in — the user's choice, else the stored fraction. */
export function fieldUnitOf(units: Record<string, FieldUnit>, key: string): FieldUnit {
  return units[key] ?? 'norm';
}
