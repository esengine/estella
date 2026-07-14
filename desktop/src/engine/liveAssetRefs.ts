// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The realm→inspector vocabulary boundary for asset slots. A running
 *        World stores HANDLES in handle-valued asset fields; the inspector
 *        layer speaks REFS (paths / `@uuid:`). Shipping raw handles up made the
 *        live "Game" Details coerce them to 0 and flag a perfectly-textured
 *        Sprite as "required but empty" (red), while showing "None". Translate
 *        at the snapshot boundary instead: each realm's own Assets knows which
 *        path every handle it minted came from.
 */
import { getComponentAssetFieldDescriptors } from 'esengine';

export interface LiveComponent {
  type: string;
  data: Record<string, unknown>;
}

/**
 * A realm's Assets records the FETCHABLE form of every load path (its ref
 * resolver returns URLs — `estella://project/assets/x.png`); the inspector
 * speaks PROJECT-RELATIVE refs. Strip the origin so the translated value is
 * something the editor registry can name (thumbnail, locate). Pure.
 */
export function projectRelative(path: string, originBase: string): string {
  const prefix = `${originBase.replace(/\/$/, '')}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

/**
 * Rewrite handle-valued asset fields to the load paths behind them, via
 * `pathForHandle` (the realm Assets' reverse map — see Assets.pathForHandle).
 * Handles nobody can name (0, or minted outside the Assets channel) pass
 * through untouched; path-valued slots are already strings and never touched.
 * Pure — returns fresh component objects only where a field actually changed.
 */
export function translateAssetHandles(
  components: readonly LiveComponent[],
  pathForHandle: (kind: string, handle: number) => string | null,
): LiveComponent[] {
  return components.map(({ type, data }) => {
    let out: Record<string, unknown> | null = null;
    for (const d of getComponentAssetFieldDescriptors(type)) {
      const v = data[d.field];
      if (typeof v !== 'number' || v === 0) continue;
      const path = pathForHandle(d.type, v);
      if (path !== null) (out ??= { ...data })[d.field] = path;
    }
    return out ? { type, data: out } : { type, data };
  });
}
