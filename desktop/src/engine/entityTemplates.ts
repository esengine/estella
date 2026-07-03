// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  entityTemplates.ts — the Create-menu catalog.
 *
 * One declarative registry of ready-made entities, grouped by category, that the
 * Outliner's "Create" popover is generated from — instead of hand-adding a blank
 * entity and stacking components. Every template is a single PrefabData, so they
 * all instantiate through the same SceneCommands.createFromTemplate path: UI
 * controls are the SDK's generated widget prefabs; the rest are one-entity presets
 * built from the registered component defaults. New categories/items slot in here
 * without touching the menu code.
 */
import { BUILTIN_UI_PREFABS, BUILTIN_UI_WIDGET_NAMES, PREFAB_FORMAT_VERSION, type PrefabData } from 'esengine';
import { componentByName, componentDefaults } from './schema';

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

type CompSpec = string | [string, Record<string, unknown>];

/** A one-entity template prefab from the registered component defaults + overrides. */
function preset(name: string, comps: CompSpec[]): PrefabData {
  const components = comps.map((c) => {
    const [type, over] = Array.isArray(c) ? c : [c, undefined];
    const def = componentByName(type);
    const base = def ? structuredClone(componentDefaults(def)) : {};
    return { type, data: over ? { ...base, ...over } : base };
  });
  return {
    version: PREFAB_FORMAT_VERSION,
    name,
    rootEntityId: '0',
    entities: [{ prefabEntityId: '0', name, parent: null, children: [], components, visible: true }],
  };
}

export const ENTITY_TEMPLATE_CATALOG: TemplateCategory[] = [
  {
    label: 'Basic',
    items: [{ label: 'Empty', prefab: preset('Empty', ['Transform']) }],
  },
  {
    label: '2D',
    items: [
      { label: 'Sprite', prefab: preset('Sprite', ['Transform', 'Sprite']) },
      { label: 'Camera', prefab: preset('Camera', [['Transform', { position: { x: 0, y: 0, z: 10 } }], 'Camera']) },
      { label: 'Particles', prefab: preset('Particles', ['Transform', 'ParticleEmitter']) },
      { label: 'Light', prefab: preset('Light', ['Transform', 'Light2D']) },
    ],
  },
  {
    label: 'UI',
    items: [
      {
        label: 'Canvas',
        prefab: preset('Canvas', ['Transform', ['Canvas', { designResolution: { x: 800, y: 600 }, scaleMode: 2 }], 'UINode']),
      },
      ...BUILTIN_UI_WIDGET_NAMES.map((name) => ({
        label: name,
        prefab: BUILTIN_UI_PREFABS[name]!,
        underCanvas: true,
      })),
    ],
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
