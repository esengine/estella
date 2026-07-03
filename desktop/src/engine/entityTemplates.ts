// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  entityTemplates.ts — the Create-menu catalog.
 *
 * One declarative registry of ready-made entities, grouped by category, that the
 * Outliner's "Create ▸" menu is generated from — instead of hand-adding a blank
 * entity and stacking components. UI controls come from the SDK's built-in widget
 * prefabs (generated from the factories). New categories (2D, lights, …) slot in
 * here without touching the menu code.
 */
import { BUILTIN_UI_PREFABS, BUILTIN_UI_WIDGET_NAMES, type PrefabData } from 'esengine';

export interface EntityTemplate {
  label: string;
  /** The subtree expanded into plain entities on create (SceneCommands.createFromTemplate). */
  prefab: PrefabData;
  /** UI controls default to the Canvas as parent when created from empty space. */
  underCanvas?: boolean;
}

export interface TemplateCategory {
  label: string;
  items: EntityTemplate[];
}

export const ENTITY_TEMPLATE_CATALOG: TemplateCategory[] = [
  {
    label: 'UI',
    items: BUILTIN_UI_WIDGET_NAMES.map((name) => ({
      label: name,
      prefab: BUILTIN_UI_PREFABS[name]!,
      underCanvas: true,
    })),
  },
];

export interface CatalogEntry {
  category: string;
  template: EntityTemplate;
}

/** Flatten the catalog to a single searchable list (display order preserved). */
export function flattenCatalog(catalog: TemplateCategory[] = ENTITY_TEMPLATE_CATALOG): CatalogEntry[] {
  return catalog.flatMap((c) => c.items.map((template) => ({ category: c.label, template })));
}

/** Case-insensitive filter over item + category labels, for the Create popover. */
export function matchCatalog(entries: CatalogEntry[], query: string): CatalogEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  return entries.filter(
    (e) => e.template.label.toLowerCase().includes(q) || e.category.toLowerCase().includes(q),
  );
}
