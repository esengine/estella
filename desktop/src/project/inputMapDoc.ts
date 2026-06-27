// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  inputMapDoc.ts
 * @brief Pure, immutable edits over an InputMapAsset (the `.inputmap` content: named
 *        actions, each a button/axis/axis2d with device-agnostic bindings). The data
 *        model is the SDK's (defineInputMap / loadInputMapAsset ship the same JSON),
 *        so the editor authors exactly what the runtime loads. Engine/DOM-free → the
 *        editing logic unit-tests in isolation; the panel just renders + dispatches.
 */
import type { InputMapAsset, ActionDef, ActionType, Binding } from 'esengine';

export const INPUT_MAP_VERSION = 1;

export const blankInputMap = (): InputMapAsset => ({ version: INPUT_MAP_VERSION, actions: {} });

const withActions = (map: InputMapAsset, actions: Record<string, ActionDef>): InputMapAsset => ({ ...map, actions });

export function addAction(map: InputMapAsset, name: string, type: ActionType = 'button'): InputMapAsset {
  const n = name.trim();
  if (!n || map.actions[n]) return map;
  return withActions(map, { ...map.actions, [n]: { type, bindings: [] } });
}

export function removeAction(map: InputMapAsset, name: string): InputMapAsset {
  if (!map.actions[name]) return map;
  const actions = { ...map.actions };
  delete actions[name];
  return withActions(map, actions);
}

/** Rename an action, preserving its position in the (ordered) action list. */
export function renameAction(map: InputMapAsset, from: string, to: string): InputMapAsset {
  const t = to.trim();
  if (from === t || !map.actions[from] || !t || map.actions[t]) return map;
  const actions: Record<string, ActionDef> = {};
  for (const [k, v] of Object.entries(map.actions)) actions[k === from ? t : k] = v;
  return withActions(map, actions);
}

export function setActionType(map: InputMapAsset, name: string, type: ActionType): InputMapAsset {
  const a = map.actions[name];
  if (!a || a.type === type) return map;
  return withActions(map, { ...map.actions, [name]: { ...a, type, bindings: [...a.bindings] } });
}

export function addBinding(map: InputMapAsset, name: string, binding: Binding): InputMapAsset {
  const a = map.actions[name];
  if (!a) return map;
  return withActions(map, { ...map.actions, [name]: { ...a, bindings: [...a.bindings, binding] } });
}

export function removeBinding(map: InputMapAsset, name: string, index: number): InputMapAsset {
  const a = map.actions[name];
  if (!a || index < 0 || index >= a.bindings.length) return map;
  return withActions(map, { ...map.actions, [name]: { ...a, bindings: a.bindings.filter((_, i) => i !== index) } });
}

export function setBinding(map: InputMapAsset, name: string, index: number, binding: Binding): InputMapAsset {
  const a = map.actions[name];
  if (!a || index < 0 || index >= a.bindings.length) return map;
  return withActions(map, {
    ...map.actions,
    [name]: { ...a, bindings: a.bindings.map((b, i) => (i === index ? binding : b)) },
  });
}
