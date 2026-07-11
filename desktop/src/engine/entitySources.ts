// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  entitySources.ts — the Create-entity registry.
 *
 * One data-driven list of `EntitySource`s the Create popover is generated from.
 * Each source carries its own label / category / icon and a `build` that expands
 * into a PrefabData; creation always routes through the single
 * SceneCommands.create pipeline via `createFromSource`. New items — including the
 * future async / asset-driven sources — slot in here without touching the picker
 * UI. (REARCH_ENTITY_CREATION E2.)
 */
import type { LucideIcon } from 'lucide-react';
import { CircleDot, LayoutPanelTop, ToggleLeft, SlidersHorizontal, List, ChevronDown, SquareMousePointer, RectangleHorizontal, Box } from 'lucide-react';
import { BUILTIN_UI_PREFABS, BUILTIN_UI_WIDGET_NAMES, PREFAB_FORMAT_VERSION, getUserComponents, type PrefabData } from 'esengine';
import type { EntityId } from '@/types';
import { componentByName, componentDefaults, prettyLabel, componentCategory } from './schema';
import { componentGlyph } from '@/components/icons';
import { SceneCommands } from './SceneCommands';

/** Where a source is created: the target parent + (for asset/drop sources) its origin. */
export interface CreateContext {
  parent: EntityId | null;
  position?: { x: number; y: number };
  assetPath?: string;
}

/** How a new entity is parented when the request carries no explicit target. */
export type PlacementRule = 'as-requested' | 'under-canvas';

/** A single, data-driven way to create an entity. */
export interface EntitySource {
  id: string;
  label: string;
  category: string;
  icon: LucideIcon;
  keywords?: string[];
  /** Expand into a prefab to instantiate. Sync today; may be async (E3 asset sources). */
  build(ctx: CreateContext): PrefabData | Promise<PrefabData>;
  placement?: PlacementRule;
  /** A prefab-linked source tags the subtree with this ref (instance = a delta). */
  linkPrefabRef?: (ctx: CreateContext) => string | undefined;
  /** Post-create side effects: out-of-band live-push, editor selection / panels. */
  afterCreate?(ctx: CreateContext, rootId: EntityId): void;
}

/**
 * Category display order in the Create popover. Reuses the Add-Component taxonomy
 * (componentCategory) so the two pickers read as one system, plus create-only buckets:
 * Basic (Empty), Prefabs (project assets), Scripts (user components).
 */
export const CREATE_CATEGORY_ORDER = ['Basic', 'Common', 'Rendering', 'Physics', 'Animation', 'UI', 'Audio', 'Effects', 'Prefabs', 'Scripts', 'Other'];

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

/**
 * A Transform + Sprite prefab referencing `textureRef`, sized to `size` (the model
 * side of "drag an image into the viewport"). Size is a plain vec2, so the preset
 * override replaces it cleanly. Instantiated through SceneCommands.create.
 */
export function spritePrefab(name: string, textureRef: string, size: { x: number; y: number }): PrefabData {
  return preset(name, [['Transform', {}], ['Sprite', { texture: textureRef, size: { x: size.x, y: size.y } }]]);
}

/**
 * A Transform + TilemapLayer prefab whose `cellSize` (a vec2 → `{x, y}` in the model)
 * is seeded from the tileset's tile size. `tilesetRef` bakes the out-of-band
 * `.estileset` link into the prefab, so it rides the single create step into the
 * model; the Reconciler live-pushes it to the plugin on spawn (create AND
 * redo/reload restore it), which is why creation needs no setLayerTilesets step.
 */
export function tilemapPrefab(name: string, cellSize: { x: number; y: number }, tilesetRef?: string): PrefabData {
  const layer: Record<string, unknown> = { cellSize: { x: cellSize.x, y: cellSize.y } };
  if (tilesetRef) {
    layer.tilesetAssets = [tilesetRef];
    layer.tilesetAsset = tilesetRef; // back-compat singular first tileset
  }
  return preset(name, [['Transform', {}], ['TilemapLayer', layer]]);
}

/** A static preset source — its prefab is built once from the registered component defaults. */
function presetSource(id: string, label: string, category: string, icon: LucideIcon, comps: CompSpec[]): EntitySource {
  const prefab = preset(label, comps);
  return { id, label, category, icon, build: () => prefab };
}

const UI_WIDGET_ICON: Record<string, LucideIcon> = {
  Button: SquareMousePointer,
  Toggle: ToggleLeft,
  Slider: SlidersHorizontal,
  Progress: RectangleHorizontal,
  Dropdown: ChevronDown,
  ListView: List,
};

/**
 * The entity-anchor components — each seeds a plain entity of that type. THE authority
 * for "which components can start an entity": add an anchor here and it appears in the
 * Create popover automatically, its category + icon drawn from the component-metadata
 * authority (componentCategory / componentGlyph) so create and Add-Component read as one
 * taxonomy. Attachment components (Collider/Joint/ShadowCaster2D/Velocity/UINode) are
 * deliberately NOT anchors; TilemapLayer is asset-driven (createTilemap's tilesetSource)
 * and Canvas needs a multi-component preset, so both are handled outside this table.
 */
const ANCHOR_SPECS: { comp: string; label: string; comps: CompSpec[] }[] = [
  { comp: 'Sprite', label: 'Sprite', comps: ['Transform', 'Sprite'] },
  { comp: 'Camera', label: 'Camera', comps: [['Transform', { position: { x: 0, y: 0, z: 10 } }], 'Camera'] },
  { comp: 'ShapeRenderer', label: 'Shape', comps: ['Transform', 'ShapeRenderer'] },
  { comp: 'Mesh2D', label: 'Mesh', comps: ['Transform', 'Mesh2D'] },
  { comp: 'SpineAnimation', label: 'Spine', comps: ['Transform', 'SpineAnimation'] },
  { comp: 'BitmapText', label: 'Bitmap Text', comps: ['Transform', 'BitmapText'] },
  { comp: 'Text', label: 'Text', comps: ['Transform', 'Text'] },
  { comp: 'ParticleEmitter', label: 'Particles', comps: ['Transform', 'ParticleEmitter'] },
  { comp: 'TrailRenderer', label: 'Trail', comps: ['Transform', 'TrailRenderer'] },
  { comp: 'Light2D', label: 'Light', comps: ['Transform', 'Light2D'] },
  { comp: 'AudioSource', label: 'Audio', comps: ['Transform', 'AudioSource'] },
];

/** Auto-generate one source per anchor component; category + icon come from the
 *  component-metadata authority so a new anchor needs only a row in ANCHOR_SPECS. */
function anchorSources(): EntitySource[] {
  return ANCHOR_SPECS.map(({ comp, label, comps }) => ({
    id: `anchor:${comp}`,
    label,
    category: componentCategory(comp),
    icon: componentGlyph(comp),
    keywords: [comp],
    build: () => preset(label, comps),
  }));
}

export const ENTITY_SOURCES: EntitySource[] = [
  presetSource('empty', 'Empty', 'Basic', CircleDot, ['Transform']),
  ...anchorSources(),
  presetSource('canvas', 'Canvas', 'UI', LayoutPanelTop, ['Transform', ['Canvas', { designResolution: { x: 800, y: 600 }, scaleMode: 2 }], 'UINode']),
  ...BUILTIN_UI_WIDGET_NAMES.map((name): EntitySource => ({
    id: `ui-${name.toLowerCase()}`,
    label: name,
    category: 'UI',
    icon: UI_WIDGET_ICON[name] ?? Box,
    build: () => BUILTIN_UI_PREFABS[name]!,
    placement: 'under-canvas',
  })),
];

/**
 * Create-entity sources for the user's own components (defineComponent): a plain
 * entity carrying Transform + that component, bucketed under 'Scripts'. A
 * user-defined component thus appears in the Create popover with zero extra wiring
 * — the dynamic half of "cover all cases" (REARCH ENTITY_CREATION E4).
 */
export function userComponentSources(): EntitySource[] {
  return [...getUserComponents().keys()].map((name) => ({
    id: `component:${name}`,
    label: prettyLabel(name),
    category: 'Scripts',
    icon: componentGlyph(name),
    keywords: [name],
    build: () => preset(name, ['Transform', name]),
  }));
}

/** Case-insensitive filter over label + category + keywords, for the Create popover. */
export function matchSources(sources: EntitySource[], query: string): EntitySource[] {
  const q = query.trim().toLowerCase();
  if (!q) return sources;
  return sources.filter(
    (s) =>
      s.label.toLowerCase().includes(q) ||
      s.category.toLowerCase().includes(q) ||
      (s.keywords ?? []).some((k) => k.toLowerCase().includes(q)),
  );
}

function resolvePlacement(rule: PlacementRule | undefined, ctx: CreateContext): EntityId | null {
  if (rule === 'under-canvas') return ctx.parent ?? SceneCommands.findCanvas();
  return ctx.parent;
}

/**
 * Create an entity from a source: expand its prefab (possibly async), resolve where
 * it lands, and route through the single SceneCommands.create pipeline. Returns the
 * new root's source id; the caller handles selection.
 */
export async function createFromSource(source: EntitySource, ctx: CreateContext): Promise<EntityId | null> {
  let prefab: PrefabData;
  try {
    prefab = await source.build(ctx);
  } catch {
    return null; // build aborted (e.g. a prefab asset failed to load; it surfaced its own error)
  }
  const id = SceneCommands.create(prefab, {
    parent: resolvePlacement(source.placement, ctx),
    position: ctx.position,
    linkPrefabRef: source.linkPrefabRef?.(ctx),
  });
  if (id != null) source.afterCreate?.(ctx, id);
  return id;
}
