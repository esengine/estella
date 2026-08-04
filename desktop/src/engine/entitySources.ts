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
 *
 * {@link ENTITY_SOURCES} is this module's REGISTRATION input (and what the built-in
 * catalog tests assert over); pickers read {@link entitySources} so a contributed
 * template shows up everywhere an entity can be born.
 */
import { projectPrefabSources, projectDesignSeed } from './projectSeams';
import type { LucideIcon } from 'lucide-react';
import { CircleDot, LayoutPanelTop, ToggleLeft, SlidersHorizontal, List, ChevronDown, SquareMousePointer, RectangleHorizontal, Box, Type, Image as ImageIcon, SquareDashed, ScrollText, AppWindow, TextCursorInput, Grid3x3, MapPin, Scan } from 'lucide-react';
import { BUILTIN_UI_PREFABS, BUILTIN_UI_WIDGET_NAMES, PREFAB_FORMAT_VERSION, applyThemeToWorld, type PrefabData } from 'esengine';
import type { EntityId } from '@/types';
import { ContributionRegistry } from '@/contrib/ContributionRegistry';
import { componentByName, componentDefaults, prettyLabel, componentCategory, userComponentNames } from './schema';
import { componentGlyph } from '@/components/icons';
import { SceneCommands } from './SceneCommands';
import { EngineHost } from './EngineHost';

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
  /** Expand into a prefab to instantiate. Sync today; may be async (E3 asset sources).
   *  Omitted only for an {@link action} source (it opens a dialog instead of building). */
  build?(ctx: CreateContext): PrefabData | Promise<PrefabData>;
  /** An action source runs this on pick INSTEAD of building — e.g. a Tilemap opens the
   *  tileset/orientation picker, since it can't be spawned without an asset choice. Keeps
   *  the Create picker the single entry point for every entity, dialog-driven ones included. */
  action?(): void;
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
 * Build a one-entity prefab from `{ type, data? }` specs, layering each `data` over
 * that component's registered defaults — the door contributed entity templates come
 * through, so a plugin never hand-writes PrefabData (version, prefabEntityId, parent
 * wiring) and cannot produce a malformed one.
 */
export function prefabFromSpecs(
  name: string,
  specs: readonly { type: string; data?: Record<string, unknown> }[],
): PrefabData {
  return preset(name, specs.map((s) => (s.data ? [s.type, s.data] : s.type) as CompSpec));
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
 * A Transform + Sprite + SpriteAnimator prefab referencing a `.esanim` clip.
 * The Sprite is seeded with the clip's static pose (sheet texture + frame-0 UV
 * window + cell size) so the entity reads correctly in edit mode; Play hands the
 * per-frame writes to the SpriteAnimator system.
 */
export function animatedSpritePrefab(
  name: string,
  clipRef: string,
  seed: {
    texture?: string;
    size?: { x: number; y: number };
    uv?: { uvOffset: { x: number; y: number }; uvScale: { x: number; y: number } };
    /** Frame 0's anchor, when the clip authors anchors (else the Sprite default). */
    pivot?: { x: number; y: number };
    loop?: boolean;
  },
): PrefabData {
  const sprite: Record<string, unknown> = {};
  if (seed.texture) sprite.texture = seed.texture;
  if (seed.size) sprite.size = { x: seed.size.x, y: seed.size.y };
  if (seed.uv) {
    sprite.uvOffset = { ...seed.uv.uvOffset };
    sprite.uvScale = { ...seed.uv.uvScale };
  }
  if (seed.pivot) sprite.pivot = { x: seed.pivot.x, y: seed.pivot.y };
  return preset(name, [
    ['Transform', {}],
    ['Sprite', sprite],
    ['SpriteAnimator', { clip: clipRef, loop: seed.loop ?? true }],
  ]);
}

/** Grid layout for a new tilemap (subset of TilemapLayer). Values match the C++
 *  TilemapOrientation / TilemapStaggerAxis / TilemapStaggerIndex enums. Only the
 *  non-default fields are baked into the prefab, so an orthogonal map stays clean. */
export interface TileGridConfig {
  /** 0 orthogonal · 1 isometric · 2 staggered · 3 hexagonal. */
  orientation?: number;
  hexSideLength?: number;
  /** 0 = Y (rows stagger) · 1 = X (columns stagger). */
  staggerAxis?: number;
  /** 0 = odd · 1 = even. */
  staggerIndex?: number;
}

/**
 * A Transform + TilemapLayer prefab whose `cellSize` (a vec2 → `{x, y}` in the model)
 * is seeded from the tileset's tile size. `tilesetRef` bakes the out-of-band
 * `.estileset` link into the prefab, so it rides the single create step into the
 * model; the Reconciler live-pushes it to the plugin on spawn (create AND
 * redo/reload restore it), which is why creation needs no setLayerTilesets step.
 * `grid` seeds the orientation/stagger fields (omitted when orthogonal-default).
 */
export function tilemapPrefab(
  name: string, cellSize: { x: number; y: number }, tilesetRef?: string, grid?: TileGridConfig,
): PrefabData {
  const layer: Record<string, unknown> = { cellSize: { x: cellSize.x, y: cellSize.y } };
  if (grid?.orientation) layer.orientation = grid.orientation;
  if (grid?.hexSideLength) layer.hexSideLength = grid.hexSideLength;
  if (grid?.staggerAxis) layer.staggerAxis = grid.staggerAxis;
  if (grid?.staggerIndex) layer.staggerIndex = grid.staggerIndex;
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
  Dialog: AppWindow,
  TextInput: TextCursorInput,
  Progress: RectangleHorizontal,
  Dropdown: ChevronDown,
  ListView: List,
  ScrollView: ScrollText,
};

// UI primitives — the raw building blocks the widget prefabs are composed from: a
// UINode (layout) plus, per role, a Text or UIVisual. Placed under the Canvas like
// the widgets. Without these the palette jumped from Canvas straight to composite
// widgets, with no way to drop a plain label, image, or layout container. Each maps
// to one UI render component: Text→Text, Image→UIVisual, Container→bare UINode.
const uiPx = (n: number) => ({ value: n, unit: 0 });
const UI_PRIMITIVE_SPECS: { id: string; label: string; icon: LucideIcon; comps: CompSpec[] }[] = [
  { id: 'ui-text', label: 'Text', icon: Type,
    comps: ['Transform', ['UINode', { width: uiPx(160), height: uiPx(40) }], ['Text', { content: 'Text' }]] },
  { id: 'ui-image', label: 'Image', icon: ImageIcon,
    comps: ['Transform', ['UINode', { width: uiPx(100), height: uiPx(100) }], 'UIVisual'] },
  { id: 'ui-container', label: 'Container', icon: SquareDashed,
    comps: ['Transform', ['UINode', { width: uiPx(200), height: uiPx(120) }]] },
];

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
  { comp: 'DragonBonesAnimation', label: 'DragonBones', comps: ['Transform', 'DragonBonesAnimation'] },
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
  // Tilemap is asset-driven (it needs a tileset + orientation), so it can't build
  // synchronously like an anchor — picking it opens the New-Tilemap dialog. Listed here
  // anyway so the Create picker stays the one place every entity is born.
  {
    id: 'tilemap',
    label: 'Tilemap',
    category: 'Rendering',
    icon: Grid3x3,
    keywords: ['tile', 'map', 'tileset', 'grid', 'level'],
    // Lazy import: the commands registry pulls in a large graph that would cycle back
    // through this module at init; the action only runs on pick, long after load.
    action: () => { void import('@/commands').then((m) => m.commands.run('tilemap.new')); },
  },
  // Object primitives — placed as real entities over any scene/background (the modern
  // "object layer"): a Marker is a named point (spawn / waypoint / location, queried via
  // `Query(Marker)`); a Trigger Area is a static SENSOR region (Transform + RigidBody +
  // BoxCollider{isSensor} + Marker) that reuses the unified collider gizmo for shaping.
  presetSource('marker', 'Marker', 'Common', MapPin,
    ['Transform', ['Marker', { type: '' }]]),
  presetSource('trigger-area', 'Trigger Area', 'Physics', Scan,
    [['Transform', {}], ['RigidBody', { bodyType: 0 }], ['BoxCollider', { isSensor: true }], ['Marker', { type: '' }]]),
  {
    id: 'canvas',
    label: 'Canvas',
    category: 'UI',
    icon: LayoutPanelTop,
    build: () => {
      const d = projectDesignSeed();
      return preset('Canvas', ['Transform', ['Canvas', { designResolution: { x: d.width, y: d.height } }], 'UINode']);
    },
  },
  ...UI_PRIMITIVE_SPECS.map((s): EntitySource => ({
    id: s.id,
    label: s.label,
    category: 'UI',
    icon: s.icon,
    build: () => preset(s.label, s.comps),
    placement: 'under-canvas',
  })),
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
  // From `schemas.json` — the SAME source the Details panel's Add Component reads.
  // The engine's own getUserComponents() registry cannot answer this: the editor
  // never executes project code, so a project's components are never in it and this
  // list was empty for every project.
  //
  // A name the engine registry already answers to is an engine component, and those
  // reach the picker through their own curated preset (with a real icon and
  // category) — take that one rather than a second, generic entry.
  return userComponentNames().filter((name) => !componentByName(name)).map((name) => ({
    id: `component:${name}`,
    label: prettyLabel(name),
    category: 'Scripts',
    icon: componentGlyph(name),
    keywords: [name],
    build: () => preset(name, ['Transform', name]),
  }));
}

/** DnD payload type carrying an {@link EntitySource} id — a widget dragged from
 *  the UI palette onto the viewport. Kept beside the registry so the palette and
 *  the viewport drop handler agree on one string. */
export const SOURCE_DND_MIME = 'application/x-estella-source';

const sourceContrib = new ContributionRegistry<EntitySource>('entity template');
sourceContrib.registerAll('core', ENTITY_SOURCES);

export const entitySourceRegistry = sourceContrib;

/** Every static entity template — built-ins first, then contributed ones. The
 *  DYNAMIC sources (user components, project prefabs) are separate generators the
 *  Create popover concatenates, since they change with the project, not the session. */
export function entitySources(): readonly EntitySource[] {
  return sourceContrib.all();
}

/**
 * Everything an entity can be born from RIGHT NOW: the static catalog plus the
 * sources that come and go with the open project. Recomputed per call — the
 * project's components and prefabs change while the editor runs.
 *
 * Every surface that offers "create an entity" reads this one list, so the Create
 * popover, the menus, and the automation/MCP catalog cannot drift apart into
 * offering different things.
 */
export function allEntitySources(): EntitySource[] {
  return [...entitySources(), ...userComponentSources(), ...projectPrefabSources()];
}

/** The source with this id, or null — over the SAME list the pickers offer, so an
 *  id that appears in a catalog can always be spawned. */
export function sourceById(id: string): EntitySource | null {
  return sourceContrib.get(id) ?? allEntitySources().find((s) => s.id === id) ?? null;
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
  // An action source (e.g. Tilemap) opens its own dialog instead of building a prefab;
  // creation happens there, so there is no id to return here.
  if (source.action) { source.action(); return null; }
  let prefab: PrefabData;
  try {
    prefab = await source.build!(ctx);
  } catch {
    return null; // build aborted (e.g. a prefab asset failed to load; it surfaced its own error)
  }
  let parent = resolvePlacement(source.placement, ctx);
  // A UI widget must live under a Canvas (the UI layout root) — a UINode with no
  // Canvas can't lay out or be positioned. If the scene has none, spin one up first
  // so the widget is hosted, not orphaned. (Canvas itself has no such placement.)
  if (source.placement === 'under-canvas' && parent == null) {
    const canvasSrc = sourceById('canvas');
    if (canvasSrc) parent = await createFromSource(canvasSrc, { parent: null });
  }
  const id = SceneCommands.create(prefab, {
    parent,
    position: ctx.position,
    linkPrefabRef: source.linkPrefabRef?.(ctx),
  });
  // A UI widget's on-screen spot is layout-owned (a flow node collapses to the Canvas
  // corner, tiny and easy to miss), so `create`'s Transform.position is a no-op for it.
  // Lift it out of flow through ONE placement path shared by the palette click and the
  // viewport drop: dropped at a point → land there; clicked with no point → centre it.
  if (id != null && source.placement === 'under-canvas') {
    if (ctx.position) SceneCommands.placeUINodeAtWorld(id, ctx.position.x, ctx.position.y);
    else SceneCommands.centerUINodeInCanvas(id);
  }
  if (id != null) source.afterCreate?.(ctx, id);
  // Built-in widget prefabs bake the default dark palette; re-resolve the fresh
  // ThemeStyle tags against the ACTIVE tokens so a themed project's palette drops
  // don't flash dark (the active tokens were set by applyWidgetTheme at scene open).
  if (id != null && source.placement === 'under-canvas') {
    const world = EngineHost.mutableWorld();
    if (world) applyThemeToWorld(world);
  }
  return id;
}
