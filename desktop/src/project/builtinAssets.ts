// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  builtinAssets.ts — what an asset slot can be bound to that is not a file.
 *        The AssetRegistry answers for files; a `builtin:` ref has none, so it
 *        answers here, and an asset control asks both without knowing either list.
 */
import { BUILTIN_MESH_TEMPLATES } from 'esengine';
import type { LucideIcon } from 'lucide-react';
import { primitiveGlyph } from '@/components/icons';

/** One pickable built-in, shaped like the picker's project-asset entries. */
export interface BuiltinAssetOption {
  ref: string;
  label: string;
  description: string;
  icon: LucideIcon;
}

const OPTIONS_BY_SLOT: Record<string, readonly BuiltinAssetOption[]> = {
  mesh: BUILTIN_MESH_TEMPLATES.map((tpl) => ({
    ref: tpl.ref, label: tpl.label, description: tpl.description, icon: primitiveGlyph(tpl.id),
  })),
};

/** Everything built in that an `assetType` slot accepts, in menu order. */
export function builtinAssetOptions(slot: string | undefined): readonly BuiltinAssetOption[] {
  return (slot && OPTIONS_BY_SLOT[slot]) || [];
}

/** The option a bound value names, or null when it names a file (or nothing). */
export function builtinAssetOption(slot: string | undefined, value: unknown): BuiltinAssetOption | null {
  if (typeof value !== 'string' || !value) return null;
  return builtinAssetOptions(slot).find((o) => o.ref === value) ?? null;
}
