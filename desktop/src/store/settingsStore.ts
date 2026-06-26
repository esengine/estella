// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  settingsStore.ts — reactive values for the settings registry, with
 *        per-user persistence. Store-owned settings live here (persisted to
 *        localStorage, pushed to runtime via the descriptor's `effect`); bound
 *        settings delegate to their live store, so there's a single source.
 *
 * Read with useSettings((s) => s.getValue(id)) or the snapshot for non-reactive
 * reads. `applySettings()` (called once at boot) replays persisted effects.
 */
import { create } from 'zustand';
import { settingsRegistry } from '@/settings/registry';
import type { SettingValue } from '@/settings/types';

const LS_KEY = 'estella.settings';

function loadPersisted(): Record<string, SettingValue> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, SettingValue>) : {};
  } catch {
    return {};
  }
}

function persist(values: Record<string, SettingValue>): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(values));
  } catch {
    /* quota / private mode — settings just won't persist this session */
  }
}

interface SettingsState {
  // Owned (non-bound) setting values; bumped on every set so consumers re-render.
  values: Record<string, SettingValue>;
  getValue: <T extends SettingValue>(id: string) => T;
  setValue: (id: string, value: SettingValue) => void;
  reset: (id: string) => void;
  isChanged: (id: string) => boolean;
}

export const useSettings = create<SettingsState>((set, get) => ({
  values: loadPersisted(),

  getValue: <T extends SettingValue>(id: string): T => {
    const desc = settingsRegistry.get(id);
    if (desc?.bind) return desc.bind.get() as T;
    const v = get().values[id];
    return (v !== undefined ? v : desc?.default) as T;
  },

  setValue: (id, value) => {
    const desc = settingsRegistry.get(id);
    if (!desc) return;
    if (desc.bind) {
      (desc.bind.set as (v: SettingValue) => void)(value);
      // Bump a new object so dialog rows reading bound values re-render too.
      set((s) => ({ values: { ...s.values } }));
      return;
    }
    set((s) => {
      const values = { ...s.values, [id]: value };
      persist(values);
      return { values };
    });
    (desc.effect as ((v: SettingValue) => void) | undefined)?.(value);
  },

  reset: (id) => {
    const desc = settingsRegistry.get(id);
    if (desc) get().setValue(id, desc.default as SettingValue);
  },

  isChanged: (id) => {
    const desc = settingsRegistry.get(id);
    if (!desc) return false;
    const cur = get().getValue(id);
    // Arrays (e.g. layer names) compare by value, not reference.
    if (Array.isArray(cur) || Array.isArray(desc.default)) return JSON.stringify(cur) !== JSON.stringify(desc.default);
    return cur !== desc.default;
  },
}));

/**
 * Replay persisted store-owned effects once the registry is populated (call from
 * boot, after registering settings). Bound settings already reflect their store.
 */
export function applySettings(): void {
  const { getValue } = useSettings.getState();
  for (const desc of settingsRegistry.all()) {
    if (!desc.bind && desc.effect) {
      (desc.effect as (v: SettingValue) => void)(getValue(desc.id));
    }
  }
}
