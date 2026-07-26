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

  readonly scene: EditorSceneApi;
  readonly project: EditorProjectApi;
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
