// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  types.ts — THE public type surface of the editor plugin API.
 *
 * Deliberately SELF-CONTAINED (types only, zero imports): the editor copies this
 * file's text verbatim into a project's `.esengine/plugins/.types/editor-api.d.ts`,
 * so plugin authors get full typings with no package to install and no copy that
 * can go stale. An import here would break that, so keep every shape local — and
 * that constraint is a feature: it forces the surface to stay small and explicit
 * rather than leaking the editor's whole internal vocabulary.
 *
 * What a plugin gets is a CURATED subset, not the editor's internals. `scene` in
 * particular exposes the model write door (undoable, transactional) and omits the
 * verification/headless machinery on the internal control surface, which plugins
 * have no business driving.
 *
 * ---------------------------------------------------------------------------
 * STABILITY: EXPERIMENTAL — this surface is NOT part of Estella's 1.x
 * compatibility contract, and will keep changing after 1.0. See the
 * "Editor Plugin API" section of VERSIONING.md for the whole policy.
 *
 * What you can rely on instead:
 *   - `engines.editor` is honoured. A plugin outside its declared range is
 *     refused with a reason and never half-loaded, so a change here costs you a
 *     version bump — never a user a broken editor.
 *   - Every breaking change is in the CHANGELOG under "Editor plugin API",
 *     with what to change.
 *   - A contribution point is deprecated for one MINOR before it is removed.
 *
 * Why it is not frozen: the contribution registries are still converging onto
 * one ownership mechanism; a plugin runs as TRUSTED code in the editor's
 * renderer, and the isolation a third-party ecosystem needs would make this API
 * asynchronous; and no shipped plugin yet holds any of these shapes up, which is
 * the same evidence the SDK requires before it freezes anything.
 * ---------------------------------------------------------------------------
 */

/** A human string a plugin supplies, per locale (falling back to `en`). */
export type LocalizedString = string | { en: string; [locale: string]: string };

/** Retracts one registration. Push it on `ctx.subscriptions` to tie it to unload. */
export interface Disposable {
  dispose(): void;
}

/** A scene entity's stable id (a source id — survives play/stop rebuilds). */
export type EntityId = number;

/** Values a component field can hold through the plugin write door. */
export type FieldValue = number | boolean | string | number[];

/** A node of the scene tree as plugins read it. */
export interface SceneNode {
  id: EntityId;
  name: string;
  children?: SceneNode[];
}

// =============================================================================
// Contributions
// =============================================================================

/** Keybinding chord, e.g. `mod+alt+b`. `mod` is ⌘ on macOS, Ctrl elsewhere. */
export type Keybinding = string | string[];

export interface CommandContribution {
  /** Namespace with your plugin id, e.g. `acme.bakeOcclusion`. */
  id: string;
  title: LocalizedString;
  /** Grouping shown in the command palette. */
  category?: LocalizedString;
  keybinding?: Keybinding;
  /**
   * Menu to place this command in. `tools` is the default home for plugin
   * commands; the other menu bar ids are available for a command that genuinely
   * belongs beside its built-in siblings.
   */
  menu?: 'tools' | 'file' | 'edit' | 'entity' | 'view' | 'build' | 'window' | 'help';
  run(): void;
  /** Greys the row out when false (default: always enabled). */
  isEnabled?(): boolean;
  /** Drives a checkmark for a toggle command. */
  isChecked?(): boolean;
}

/** Where a contributed panel docks the first time it opens. */
export type PanelPlacement = 'document' | 'side-left' | 'side-right' | 'bottom';

export interface PanelContribution {
  /** Namespace with your plugin id, e.g. `acme.budget`. */
  id: string;
  title: LocalizedString;
  placement?: PanelPlacement;
  /** `side-*` panels: initial column width in CSS px. */
  width?: number;
  /**
   * Build the panel's contents into `host`, and return a teardown function. Called
   * when the panel mounts, torn down when it closes or the plugin unloads.
   *
   * The host element is inside the editor's own dock frame, so the theme CSS
   * variables (`--bg`, `--text`, `--accent`, …) are in scope: style against those
   * and the panel matches the editor in both light and dark.
   */
  mount(host: HTMLElement): () => void;
}

export interface SettingContributionBase {
  /** Namespace with your plugin id, e.g. `acme.budget.warnAt`. */
  id: string;
  label: LocalizedString;
  description?: LocalizedString;
}

export interface BooleanSettingContribution extends SettingContributionBase {
  type: 'boolean';
  default: boolean;
}

export interface NumberSettingContribution extends SettingContributionBase {
  type: 'number';
  default: number;
  min?: number;
  max?: number;
  step?: number;
}

export interface StringSettingContribution extends SettingContributionBase {
  type: 'string';
  default: string;
  placeholder?: string;
}

export interface EnumSettingContribution extends SettingContributionBase {
  type: 'enum';
  default: string;
  options: { value: string; label: LocalizedString }[];
}

export type SettingContribution =
  | BooleanSettingContribution
  | NumberSettingContribution
  | StringSettingContribution
  | EnumSettingContribution;

/** A point in scene (world) space. */
export interface Vec2 {
  x: number;
  y: number;
}

// — Viewport tools ————————————————————————————————————————————————————————————

/**
 * A pointer event reduced to what a tool needs (no DOM coupling). `x`/`y` are in
 * VIEWPORT space — CSS pixels from the viewport canvas's top-left — the same space
 * {@link EditorViewportApi} and {@link OverlayGraphics} project to, so a tool can
 * hand its input straight to `viewportToWorld` with no conversion.
 */
export interface PointerInput {
  x: number;
  y: number;
  pointerId: number;
  button: number;
  shift: boolean;
  alt: boolean;
}

/** Host services during a stroke. */
export interface ToolContext {
  /** Keep receiving move/up even when the pointer leaves the viewport. */
  capture(pointerId: number): void;
  release(pointerId: number): void;
}

/**
 * A viewport tool. While ARMED (`ctx.tools.activate(id)`) it gets first refusal on
 * every pointer-down; returning true claims the stroke and its move/up. Return
 * false for a one-shot action or a click that shouldn't take over.
 *
 * Choosing any built-in tool (Select/Move/… or a tile brush) disarms it, so the
 * user is never stuck in a plugin's tool.
 */
export interface ToolContribution {
  /** Namespaced id, e.g. `acme.measure`. */
  id: string;
  title: LocalizedString;
  /** Restrict to these editor modes ('scene' | 'ui' | 'tilemap'); omitted ⇒ all. */
  modes?: readonly string[];
  onPointerDown(p: PointerInput, ctx: ToolContext): boolean;
  onPointerMove(p: PointerInput, ctx: ToolContext): void;
  onPointerUp(p: PointerInput, ctx: ToolContext): void;
  /** Roll back an in-progress stroke (Esc / tool switch). */
  cancel?(ctx: ToolContext): void;
}

// — Viewport overlays —————————————————————————————————————————————————————————

export interface GizmoStyle {
  /** Any CSS color — including a theme token, e.g. `var(--acc)`, which is the way
   *  to stay consistent with the editor's own gizmos in both light and dark. */
  color?: string;
  /** Stroke width in SCREEN pixels, so it stays legible at any zoom. */
  width?: number;
  dashed?: boolean;
  fill?: string;
  opacity?: number;
  /** `text` only: font size in screen pixels. */
  fontSize?: number;
}

/**
 * Drawing surface for a viewport overlay, redrawn every frame.
 *
 * Every primitive takes WORLD coordinates and is projected by the host, so a gizmo
 * tracks the scene through pan and zoom without the plugin doing camera math — and
 * a radius in world units scales the way a scene-anchored circle should. Stroke
 * widths and font sizes are in SCREEN pixels, which is what keeps a hairline a
 * hairline when you zoom out.
 */
export interface OverlayGraphics {
  /** World → viewport CSS pixels, for plugins that need screen-space math. */
  worldToViewport(x: number, y: number): Vec2 | null;
  /** Viewport CSS pixels → world (the exact inverse). */
  viewportToWorld(x: number, y: number): Vec2 | null;
  line(a: Vec2, b: Vec2, style?: GizmoStyle): void;
  polyline(points: readonly Vec2[], style?: GizmoStyle): void;
  /** `radius` is in world units. */
  circle(center: Vec2, radius: number, style?: GizmoStyle): void;
  /** Axis-aligned world rect (corners in any order). */
  rect(a: Vec2, b: Vec2, style?: GizmoStyle): void;
  /** Label anchored at a world point, drawn at a fixed screen size. */
  text(at: Vec2, text: string, style?: GizmoStyle): void;
}

export interface OverlayContribution {
  /** Namespaced id, e.g. `acme.spawn-radius`. */
  id: string;
  /** Restrict to these editor modes; omitted ⇒ drawn in all of them. */
  modes?: readonly string[];
  /** Draw this frame. Called on every viewport frame — keep it cheap. */
  render(g: OverlayGraphics): void;
}

// — Inspector sections ————————————————————————————————————————————————————————

/**
 * Builds inspector rows. The host turns these calls into the same property UI the
 * editor renders for its own components, so a contributed section is visually
 * native and needs no styling — and the plugin never handles the editor's internal
 * field vocabulary.
 *
 * A row's `key` identifies it in the contribution's `write` callback.
 */
export interface InspectorSectionBuilder {
  /** A read-only labelled value. */
  info(label: LocalizedString, value: string): void;
  number(key: string, label: LocalizedString, value: number, opts?: { min?: number; max?: number; step?: number; unit?: string }): void;
  bool(key: string, label: LocalizedString, value: boolean): void;
  text(key: string, label: LocalizedString, value: string): void;
  vec2(key: string, label: LocalizedString, value: Vec2): void;
  /** `#rrggbb` / `#rrggbbaa`. */
  color(key: string, label: LocalizedString, value: string): void;
  select(key: string, label: LocalizedString, value: string, options: readonly string[]): void;
}

/** Extra section shown under a component, for entities that carry it. */
export interface ComponentInspectorContribution {
  kind: 'component';
  /** Namespaced id, e.g. `acme.sprite-audit`. */
  id: string;
  /** The component type this attaches to, e.g. `Sprite`. */
  component: string;
  title: LocalizedString;
  build(entity: EntityId, ui: InspectorSectionBuilder): void;
  /** A button in the section header. */
  action?: { label: LocalizedString; run(entity: EntityId): void };
  /** An edit to one of the rows `build` produced. Wrap scene writes in
   *  `ctx.scene.transact` if one edit should be one undo step. */
  write?(entity: EntityId, key: string, value: FieldValue): void;
}

/** Section shown when an asset of `assetType` is selected in the Content Browser. */
export interface AssetInspectorContribution {
  kind: 'asset';
  id: string;
  /** Asset type id — a built-in one (`texture`, `scene`, …) or a contributed one. */
  assetType: string;
  title: LocalizedString;
  build(path: string, ui: InspectorSectionBuilder): void;
  action?: { label: LocalizedString; run(path: string): void };
  write?(path: string, key: string, value: FieldValue): void;
}

export type InspectorContribution = ComponentInspectorContribution | AssetInspectorContribution;

// — Asset types ———————————————————————————————————————————————————————————————

export interface AssetTypeContribution {
  /** Namespaced type id, e.g. `acme.dialogue`. */
  id: string;
  /** Extensions (lower-case, no dot) that resolve to this type. */
  extensions: readonly string[];
  /** Short uppercase badge on the Content Browser tile (e.g. `DLG`). */
  badge?: string;
  /** Tile tint — any CSS color. */
  tint?: string;
  /** Double-click action. */
  open?(path: string): void;
  /** A "New ▸ …" entry in the Content Browser's create menu. Returning the new
   *  path makes the browser reveal it and drop into rename. */
  create?: { label: LocalizedString; run(dir: string): Promise<string | void> | string | void };
}

// — Asset importers ————————————————————————————————————————————————————————————

/**
 * Turns a file the engine cannot read into assets it can.
 *
 * The editor calls `import` when a claimed file appears or changes, and on a
 * reimport. Write the result with `ctx.fs.writeProject` (so declare `fs:project`):
 * it is then an ordinary asset, and nothing downstream learns your format.
 */
export interface AssetImporterContribution {
  /** Namespaced id, e.g. `acme.ldtk`. */
  id: string;
  /** Source extensions (lower-case, no dot) this converts. */
  extensions: readonly string[];
  /** Convert one source file, project-relative. Throwing (or rejecting) reports
   *  the failure against your plugin; the other importers still run. */
  import(path: string): void | Promise<void>;
}

// — Entity templates ——————————————————————————————————————————————————————————

/** One component of a template: its type, and any non-default field values. */
export interface ComponentSpec {
  type: string;
  data?: Record<string, unknown>;
}

/** A ready-made entity offered by the Create picker (and drag-drop, and the menu). */
export interface EntityTemplateContribution {
  /** Namespaced id, e.g. `acme.turret`. */
  id: string;
  label: LocalizedString;
  /** Create-picker bucket; unknown categories fall under `Other`. */
  category?: string;
  /** Extra search terms for the picker. */
  keywords?: readonly string[];
  /** The entity's components, applied over their registered defaults. */
  components: readonly ComponentSpec[];
}

// — Context menus ——————————————————————————————————————————————————————————————

/**
 * Where a contributed row can appear. Deliberately only the menus that EXIST — the
 * viewport has no context menu to host rows, and declaring a location the editor
 * never opens would be a seam that silently does nothing.
 */
export type ContextMenuLocation =
  | 'outliner/item'
  | 'outliner/background'
  | 'content/item'
  | 'content/background';

/** What was right-clicked. Which fields are set depends on the location. */
export interface ContextMenuTarget {
  /** `outliner/item` — the entity whose row was clicked. */
  entity?: EntityId | null;
  /** `content/item` — the asset path; `content/background` — the current folder. */
  path?: string | null;
}

/**
 * A tool the built-in agent may call.
 *
 * The agent's entire vocabulary is the tool catalog, so a plugin that adds a
 * capability without adding a tool has added it for the person and not for the
 * agent. Namespace `name` with your plugin id — an un-namespaced tool can
 * shadow a built-in one, and the model would call it believing it knows what it
 * does.
 *
 * `description` is not documentation; it is the ONLY thing the model reads when
 * deciding whether this is the right tool. Say what it does and when to reach
 * for it, in a sentence.
 */
export interface AgentToolContribution {
    /** Namespaced with your plugin id, e.g. `acme.bake-occlusion`. */
    name: string;
    /** What it does and when to use it — written for the model, not for a menu. */
    description: string;
    /**
     * JSON Schema for `input`. Defaults to "an object with no properties".
     * The kernel validates against this before your handler runs, so a
     * malformed call is refused rather than handed to you half-parsed.
     */
    schema?: unknown;
    /**
     * What calling it costs, which decides whether the person is asked first.
     * The turn's checkpoint covers `read`, `undoable` and `journaled`, so all
     * three run unasked; `journaled` is for writes through `ctx.fs.writeProject`,
     * which are captured before they land. `irreversible` stops to ask.
     *
     * Declare it honestly — nothing verifies it. A tool calling itself
     * `journaled` while writing outside `ctx.fs` claims a net not holding it.
     */
    effect?: 'read' | 'ephemeral' | 'undoable' | 'journaled' | 'irreversible';
    /** Do the work. Whatever it returns is JSON-encoded for the model; throwing
     *  reports the message as a failed call, which the model can act on. */
    run(input: unknown): unknown | Promise<unknown>;
}

export interface ContextMenuContribution {
  /** Namespaced id, e.g. `acme.reveal-refs`. */
  id: string;
  location: ContextMenuLocation;
  label: LocalizedString;
  /** Hide the row entirely for this target (distinct from disabling it). */
  when?(target: ContextMenuTarget): boolean;
  run(target: ContextMenuTarget): void;
}

// =============================================================================
// Editor APIs
// =============================================================================

/**
 * The scene write/read door. Every mutation here routes through the editor's
 * command layer, so it lands in the undo history and survives a play→stop rebuild.
 * Never reach around this to the live engine World: edits made there are dropped
 * the moment the scene is rebuilt from the model.
 */
export interface EditorSceneApi {
  /** The primary selected entity, or null. */
  getSelection(): EntityId | null;
  /** The full multi-selection. */
  getSelectionIds(): EntityId[];
  select(id: EntityId | null): void;
  selectMany(ids: EntityId[], primary: EntityId): void;

  /** The scene tree (roots, each with children). */
  getSceneTree(): SceneNode[];
  /** An entity's name + the component types on it, or null if it's gone. */
  getEntity(id: EntityId): { name: string; components: string[] } | null;
  /** A single component field's current value, or null if absent. */
  getFieldValue(entity: EntityId, component: string, key: string): FieldValue | null;

  addEntity(): EntityId | null;
  deleteEntity(id: EntityId): void;
  duplicateEntity(id: EntityId): EntityId | null;
  renameEntity(id: EntityId, name: string): void;
  setParent(id: EntityId, parent: EntityId | null): void;
  /** Write a component field. Throws if the component or key doesn't exist. */
  setField(entity: EntityId, component: string, key: string, value: FieldValue): void;
  addComponent(entity: EntityId, component: string): void;
  removeComponent(entity: EntityId, component: string): void;
  setEntityXY(id: EntityId, x: number, y: number): void;

  /** Run `fn` as ONE undo step (committed on return, rolled back if it throws). */
  transact(label: string, fn: () => void): void;

  undo(): void;
  redo(): void;
}

export interface EditorProjectApi {
  /** Absolute path of the open project root, or null when none is open. */
  root(): string | null;
  /** Project-relative path of the open scene, or null. */
  currentScene(): string | null;
  /** Save the open scene. */
  save(): Promise<void>;
  /** Project-relative paths of every asset the editor knows about. */
  listAssets(): string[];
  /** Re-scan the asset registry; resolves when a new ref is resolvable. */
  refreshAssets(): Promise<void>;
}

/** Files a plugin may read/write. Paths are relative to the plugin's own folder
 *  unless the plugin declared the `fs:project` capability and uses `project*`. */
export interface PluginFs {
  read(relPath: string): Promise<string>;
  write(relPath: string, contents: string): Promise<void>;
  /** Requires the `fs:project` capability; paths are project-relative. */
  readProject(relPath: string): Promise<string>;
  /** Requires the `fs:project` capability; paths are project-relative. */
  writeProject(relPath: string, contents: string): Promise<void>;
}

/**
 * The viewport's camera projection. A tool needs this to turn its pointer input into
 * scene coordinates, so it lives on the context rather than only inside an overlay's
 * draw call — both use the same VIEWPORT space (CSS pixels from the canvas top-left).
 * Returns null before the viewport has a camera (no scene open yet).
 */
export interface EditorViewportApi {
  viewportToWorld(x: number, y: number): Vec2 | null;
  worldToViewport(x: number, y: number): Vec2 | null;
}

/** Editor events a plugin can observe. Handlers are dropped on unload. */
export interface EditorEvents {
  on(event: 'selectionChanged' | 'sceneChanged' | 'playStateChanged', handler: () => void): Disposable;
}

// =============================================================================
// Context
// =============================================================================

/**
 * Everything a plugin is handed. Every `register` here is attributed to THIS
 * plugin, which is what makes unload, disable, and hot reload possible: the editor
 * retracts the whole set in one operation rather than trusting cleanup code.
 */
export interface PluginContext {
  readonly id: string;
  readonly version: string;
  /** Disposables retracted on unload — the simplest correct cleanup. */
  readonly subscriptions: Disposable[];

  /** Log lines, attributed to this plugin in the Output Log. */
  readonly log: {
    info(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
  };
  /** Transient user-facing notices. */
  readonly ui: {
    toast(message: string, level?: 'info' | 'success' | 'warn' | 'error'): void;
  };
  /** Persisted per-plugin key/value state (per user, not in the project). */
  readonly state: {
    get<T>(key: string, fallback: T): T;
    set(key: string, value: unknown): void;
  };

  readonly commands: {
    register(command: CommandContribution): Disposable;
    /** Run any editor command by id — including built-ins. */
    run(id: string): void;
  };
  readonly panels: {
    register(panel: PanelContribution): Disposable;
    /** Open (or bring forward) a panel by id. */
    open(id: string): void;
  };
  readonly settings: {
    register(setting: SettingContribution): Disposable;
    /** Current value of one of YOUR settings. */
    get<T extends boolean | number | string>(id: string): T | undefined;
  };
  readonly tools: {
    register(tool: ToolContribution): Disposable;
    /** Arm one of your tools (null disarms). It then gets first refusal on strokes. */
    activate(id: string | null): void;
    /** The currently armed contributed tool, or null. */
    activeId(): string | null;
  };
  readonly overlays: {
    register(overlay: OverlayContribution): Disposable;
  };
  readonly inspector: {
    register(section: InspectorContribution): Disposable;
  };
  readonly assets: {
    registerType(type: AssetTypeContribution): Disposable;
    /** Convert a foreign file into engine assets. See {@link AssetImporterContribution}. */
    registerImporter(importer: AssetImporterContribution): Disposable;
    /** Re-run the importers claiming `path` (project-relative), as the Content
     *  Browser's Reimport does. Resolves when they have finished. */
    reimport(path: string): Promise<void>;
  };
  readonly entities: {
    registerTemplate(template: EntityTemplateContribution): Disposable;
  };
  readonly contextMenus: {
    register(item: ContextMenuContribution): Disposable;
  };
  /** Lend the built-in agent a tool. See {@link AgentToolContribution}. */
  readonly agentTools: {
    register(tool: AgentToolContribution): Disposable;
  };

  readonly scene: EditorSceneApi;
  readonly project: EditorProjectApi;
  readonly viewport: EditorViewportApi;
  readonly fs: PluginFs;
  readonly events: EditorEvents;
}

/** What a plugin's entry module default-exports. */
export interface EditorPlugin {
  /** Called once when the plugin loads. May be async. */
  activate(ctx: PluginContext): void | Promise<void>;
  /** Optional extra teardown; registrations and `subscriptions` are retracted
   *  automatically, so most plugins don't need this. */
  deactivate?(): void | Promise<void>;
}

// =============================================================================
// Runtime exports of `@estella/editor-api`
//
// Declared (not defined) here so this file remains the WHOLE public surface — the
// copy shipped to plugin authors has to describe the functions they can import,
// not just the shapes. api.ts implements these and is type-checked against these
// declarations, so the two cannot drift.
// =============================================================================

/**
 * Declare a plugin. An identity function whose only job is to type-check the object
 * literal at the definition site, so a typo in `activate` is a compile error in your
 * editor rather than a load failure in ours.
 */
export declare function definePlugin(plugin: EditorPlugin): EditorPlugin;

/** Resolve a {@link LocalizedString} for a locale, falling back to `en`. */
export declare function localize(value: LocalizedString | undefined, locale: string): string;
