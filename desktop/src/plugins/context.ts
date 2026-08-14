// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  context.ts
 * @brief Builds the {@link PluginContext} handed to one plugin's `activate`.
 *
 * This is where the design's central claim is cashed in: every `register` here
 * forwards to the SAME registry a built-in uses, tagged with this plugin's owner.
 * There is no plugin-specific implementation of commands, panels, menus, or
 * settings to drift from the built-in one — only an attribution.
 *
 * Two things the context adds on top of attribution:
 *  - Localized strings are resolved here, so contributions reach the registries in
 *    the editor's own `string` vocabulary and every consumer stays locale-agnostic.
 *  - Plugin callbacks are wrapped (see PluginHost.guard) so a throw is attributed,
 *    logged, and counted toward quarantine instead of breaking an editor surface.
 */
import { commands } from '@/commands/registry';
import { registerPanel } from '@/layout/panels';
import { registerMenuItem } from '@/layout/menus';
import { dockApi } from '@/layout/dockApi';
import { toolRegistry } from '@/tools/toolRegistry';
import { assetTypeRegistry, CONTRIBUTED_ASSET_ICON } from '@/project/assetTypes';
import { entitySourceRegistry, prefabFromSpecs } from '@/engine/entitySources';
import { overlayRegistry, viewportProjection } from './overlays';
import { inspectorRegistry } from './inspector';
import { activityBarRegistry, railIcon } from './activityBar';
import { contextMenuRegistry } from './contextMenus';
import { importerRegistry, runImporters } from './importers';
import { localizePlugin as localize } from './localize';
import { editorLocale } from '@/i18n';
import { settingsRegistry } from '@/settings/registry';
import { useSettings } from '@/store/settingsStore';
import { useSelection } from '@/store/selectionStore';
import { useEditorStore } from '@/store/editorStore';
import { EditorControlSurface } from '@/engine/EditorSession';
import { EngineHost } from '@/engine/EngineHost';
import { ProjectStore } from '@/project/ProjectStore';
import { AssetRegistry } from '@/project/AssetRegistry';
import { LogStore } from '@/store/LogStore';
import { Toasts } from '@/store/Toasts';
import type { InspectorFieldValue } from '@/types';
import type { Owner, Disposable as CoreDisposable } from '@/contrib/ContributionRegistry';
import type { PointerInput as CorePointerInput } from '@/tools/EditorTool';
import type { PluginManifest, PluginCapability } from './manifest';
import { agentToolProblem, registerAgentTool, publishAgentTools } from './agentTools';
import type {
  ActivityBarContribution, AgentToolContribution, AssetImporterContribution,
  AssetTypeContribution, CommandContribution, ContextMenuContribution, Disposable, EditorEvents,
  EditorPlugin, EditorProjectApi, EditorSceneApi, EntityTemplateContribution, FieldValue,
  InspectorContribution, OverlayContribution, PanelContribution, PluginContext,
  PluginFs, SettingContribution, ToolContribution, PointerInput as PluginPointerInput,
} from './types';

/** Per-plugin persisted state, kept out of the project (it's a user preference). */
const stateKey = (id: string): string => `estella.plugin.state.${id}`;

function pluginState(id: string) {
  const read = (): Record<string, unknown> => {
    try {
      return JSON.parse(localStorage.getItem(stateKey(id)) ?? '{}') as Record<string, unknown>;
    } catch {
      return {};
    }
  };
  return {
    get<T>(key: string, fallback: T): T {
      const v = read()[key];
      return v === undefined ? fallback : (v as T);
    },
    set(key: string, value: unknown): void {
      const next = { ...read(), [key]: value };
      try {
        localStorage.setItem(stateKey(id), JSON.stringify(next));
      } catch {
        /* quota / private mode — state just won't persist */
      }
    },
  };
}

/**
 * The curated scene door. Delegates to the editor's own control surface, which
 * routes writes through SceneCommands — so a plugin's edits are undoable and
 * survive a play→stop rebuild without the plugin knowing either exists.
 */
function sceneApi(): EditorSceneApi {
  const s = EditorControlSurface;
  return {
    getSelection: () => s.getSelection(),
    getSelectionIds: () => s.getSelectionIds(),
    select: (id) => s.select(id),
    selectMany: (ids, primary) => s.selectMany(ids, primary),
    getSceneTree: () => s.getSceneTree(),
    getEntity: (id) => {
      const e = s.getEntity(id);
      return e ? { name: e.name, components: e.components } : null;
    },
    getFieldValue: (entity, component, key) => s.getFieldValue(entity, component, key) as FieldValue | null,
    addEntity: () => s.addEntity(),
    deleteEntity: (id) => s.deleteEntity(id),
    duplicateEntity: (id) => s.duplicateEntity(id),
    renameEntity: (id, name) => s.renameEntity(id, name),
    setParent: (id, parent) => s.setParent(id, parent),
    // The surface resolves the field's DECLARED inspector type and coerces against
    // it (rejecting a wrong shape or arity loudly), so a plugin never has to know
    // or state a field's type — the type argument here is advisory and ignored, and
    // the cast is safe because that runtime check is stricter than this signature.
    setField: (entity, component, key, value) =>
      s.setField(entity, component, key, 'string', value as InspectorFieldValue),
    addComponent: (entity, component) => s.addComponent(entity, component),
    removeComponent: (entity, component) => s.removeComponent(entity, component),
    setEntityXY: (id, x, y) => s.setEntityXY(id, x, y),
    transact: (label, fn) => s.transact(label, fn),
    undo: () => s.undo(),
    redo: () => s.redo(),
  };
}

/** Client-space pointer input → the viewport-space shape plugins are handed. */
function toPluginPointer(p: CorePointerInput): PluginPointerInput {
  const canvas = EngineHost.canvas;
  const r = canvas?.getBoundingClientRect();
  return {
    x: p.clientX - (r?.left ?? 0),
    y: p.clientY - (r?.top ?? 0),
    pointerId: p.pointerId,
    button: p.button,
    shift: p.shift,
    alt: p.alt,
  };
}

function projectApi(id: string, capabilities: PluginCapability[]): EditorProjectApi {
  return {
    root: () => ProjectStore.getSnapshot()?.root ?? null,
    currentScene: () => ProjectStore.getSnapshot()?.currentScene ?? null,
    save: () => ProjectStore.save(),
    listAssets: () => AssetRegistry.listAssets().map((a) => a.path),
    refreshAssets: () => ProjectStore.refreshAssets(),
    feature: <T,>(name: string) => ProjectStore.feature(name) as T | undefined,
    // Writing a settings block writes the project, so it answers to the same
    // capability reaching its files does.
    setFeature: (name, value) => {
      if (!capabilities.includes('fs:project')) {
        throw new Error(`plugin "${id}" needs the "fs:project" capability in plugin.json to write project settings`);
      }
      return ProjectStore.setFeature(name, value);
    },
  };
}

/**
 * Filesystem access, gated on declared capabilities. The plugin's own folder is
 * always readable/writable; the project needs `fs:project`. Note this is a gate on
 * the CONVENIENCE API, not a sandbox — a renderer plugin shares the editor's realm
 * and could reach the bridge directly. The real boundary is the trust prompt; this
 * keeps honest plugins honest and makes their intent visible to the user.
 */
function pluginFs(id: string, dir: string, capabilities: PluginCapability[]): PluginFs {
  const denied = (what: string) => (): never => {
    throw new Error(`plugin "${id}" needs the "fs:project" capability in plugin.json to ${what}`);
  };
  // The plugin dir is absolute; the bridge is project-relative, so plugin-local
  // paths only resolve for a project-scoped plugin. A user-scoped plugin lives
  // outside the project root the bridge sandboxes to, and says so.
  const root = ProjectStore.getSnapshot()?.root;
  const local = (relPath: string): string => {
    if (!root || !dir.startsWith(root)) {
      throw new Error(`plugin "${id}" is outside the open project, so its own files aren't reachable yet`);
    }
    return `${dir.slice(root.length).replace(/^[/\\]/, '')}/${relPath}`.replace(/\\/g, '/');
  };
  const canProject = capabilities.includes('fs:project');
  return {
    read: (relPath) => window.estella.fs.read(local(relPath)),
    write: (relPath, contents) => window.estella.fs.write(local(relPath), contents),
    readProject: canProject ? (relPath) => window.estella.fs.read(relPath) : denied('read project files'),
    writeProject: canProject ? (relPath, contents) => window.estella.fs.write(relPath, contents) : denied('write project files'),
  };
}

function editorEvents(track: (d: Disposable) => Disposable): EditorEvents {
  return {
    on: (event, handler) => {
      switch (event) {
        case 'selectionChanged':
          return track({ dispose: useSelection.subscribe(handler) });
        case 'sceneChanged':
        case 'projectChanged':
          return track({ dispose: ProjectStore.subscribe(handler) });
        case 'playStateChanged':
          // Fires only on an actual edit↔play transition, not on every store touch.
          return track({
            dispose: useEditorStore.subscribe((s, prev) => {
              if (s.isPlaying !== prev.isPlaying || s.isPaused !== prev.isPaused) handler();
            }),
          });
      }
    },
  };
}

/** The contribution kinds a plugin can be listed as having made. */
export type ContributionKind =
  | 'command'
  | 'panel'
  | 'setting'
  | 'tool'
  | 'overlay'
  | 'inspector'
  | 'assetType'
  | 'importer'
  | 'entityTemplate'
  | 'contextMenu'
  | 'activityBar'
  | 'agentTool';

/** One thing a plugin added, as the Plugins panel shows it. */
export interface PluginContribution {
  kind: ContributionKind;
  /** The id it registered under — what appears in the command palette, the dock, … */
  id: string;
  /** Already localized, because the registries were handed a localized label too. */
  label: string;
}

/** What PluginHost needs back to tear a plugin down. */
export interface BuiltContext {
  ctx: PluginContext;
  /**
   * What this plugin has contributed, RIGHT NOW. Read live rather than snapshotted
   * because a plugin may register from a command or a timer long after `activate`
   * returned, and a list that quietly stopped tracking would be worse than none —
   * this panel's whole job is answering "why isn't my panel showing up?".
   */
  contributions(): PluginContribution[];
  /** Retract everything this plugin registered, in reverse order. */
  dispose(): void;
}

/**
 * Build the context for one plugin. `guard` wraps every callback the plugin hands
 * us; PluginHost supplies it so the throw-attribution and quarantine policy live in
 * one place rather than being re-implemented per contribution kind.
 */
export function buildPluginContext(
  manifest: PluginManifest,
  dir: string,
  owner: Owner,
  guard: <T>(what: string, fn: () => T, fallback: T) => T,
): BuiltContext {
  const id = manifest.id;
  const capabilities = manifest.capabilities ?? [];
  const disposables: Disposable[] = [];
  const track = <T extends Disposable>(d: T): T => {
    disposables.push(d);
    return d;
  };
  const adopt = (d: CoreDisposable): Disposable => track({ dispose: () => d.dispose() });

  // Every register() below goes through `noted`, which is what makes the panel's
  // "Contributes" list complete by construction: there is no way to register
  // something here without listing it, because listing IS the tracking.
  // Takes an already-made registration, exactly as `adopt` does — so a call site
  // reads the same and cannot accidentally defer the registration itself.
  const contributions: PluginContribution[] = [];
  const noted = (kind: ContributionKind, cid: string, label: string, d: CoreDisposable): Disposable => {
    const entry: PluginContribution = { kind, id: cid, label };
    contributions.push(entry);
    return track({
      dispose: () => {
        const i = contributions.indexOf(entry);
        if (i >= 0) contributions.splice(i, 1);
        d.dispose();
      },
    });
  };

  const log = {
    info: (...args: unknown[]) => LogStore.push('info', `plugin:${id}`, args.map(String).join(' ')),
    warn: (...args: unknown[]) => LogStore.push('warn', `plugin:${id}`, args.map(String).join(' ')),
    error: (...args: unknown[]) => LogStore.push('error', `plugin:${id}`, args.map(String).join(' ')),
  };

  /**
   * A contribution id, under its plugin. Idempotent, so the convention the docs
   * ask for and the guarantee the host gives are the same string — and a plugin
   * that forgets cannot claim `details` or `viewport` out from under a built-in.
   */
  const scoped = (contributionId: string): string =>
    contributionId === id || contributionId.startsWith(`${id}.`) ? contributionId : `${id}.${contributionId}`;

  const registerCommand = (c: CommandContribution): Disposable => {
    const disposals: CoreDisposable[] = [
      commands.register(
        {
          id: scoped(c.id),
          label: localize(c.title),
          category: localize(c.category) || localize(manifest.name),
          keybinding: c.keybinding,
          run: () => guard(`command ${c.id}`, () => c.run(), undefined),
          isEnabled: c.isEnabled ? () => guard(`command ${c.id} isEnabled`, () => !!c.isEnabled!(), false) : undefined,
          isChecked: c.isChecked ? () => guard(`command ${c.id} isChecked`, () => !!c.isChecked!(), false) : undefined,
        },
        owner,
      ),
    ];
    // A menu row is a separate contribution pointing at the command, exactly as the
    // built-in menus are — so a contributed row can't restate label or enablement.
    if (c.menu) {
      disposals.push(
        registerMenuItem({ id: `${c.menu}/${scoped(c.id)}`, location: c.menu, group: c.menu === 'tools' ? 'tools' : 'plugins', command: scoped(c.id) }, owner),
      );
    }
    return noted('command', scoped(c.id), localize(c.title), { dispose: () => disposals.forEach((d) => d.dispose()) });
  };

  const registerPluginPanel = (p: PanelContribution): Disposable =>
    noted(
      'panel',
      scoped(p.id),
      localize(p.title),
      registerPanel(
        {
          id: scoped(p.id),
          title: () => localize(p.title),
          placement: p.placement ?? 'bottom',
          width: p.width,
          refs: ['log', 'content'],
          mount: (host) => guard(`panel ${scoped(p.id)} mount`, () => p.mount(host), () => {}),
        },
        owner,
      ),
    );

  const registerSetting = (s: SettingContribution): Disposable => {
    const section = `plugin:${id}`;
    // One section per plugin, created on its first setting so a plugin with none
    // doesn't leave an empty page in the dialog's nav.
    if (!settingsRegistry.getSection(section)) {
      adopt(settingsRegistry.registerSection({ id: section, label: localize(manifest.name), category: 'plugin' }, owner));
    }
    const base = { id: scoped(s.id), scope: 'editor' as const, section, label: localize(s.label), description: localize(s.description) || undefined };
    const descriptor =
      s.type === 'enum'
        ? { ...base, type: 'enum' as const, default: s.default, options: s.options.map((o) => ({ value: o.value, label: localize(o.label) })) }
        : s.type === 'number'
          ? { ...base, type: 'number' as const, default: s.default, min: s.min, max: s.max, step: s.step }
          : s.type === 'string'
            ? { ...base, type: 'string' as const, default: s.default, placeholder: s.placeholder }
            : { ...base, type: 'boolean' as const, default: s.default };
    return noted('setting', scoped(s.id), localize(s.label), settingsRegistry.register(descriptor, owner));
  };

  const registerTool = (tool: ToolContribution): Disposable =>
    noted(
      'tool',
      scoped(tool.id),
      localize(tool.title),
      toolRegistry.register(owner, {
        id: scoped(tool.id),
        title: localize(tool.title),
        modes: tool.modes,
        // Every stroke callback is guarded: a throw mid-drag must not wedge the
        // viewport's pointer routing. onPointerDown's fallback is `false` — "I did
        // not take the stroke" — so a broken tool degrades to no-op, not to a
        // captured pointer nothing releases.
        //
        // Pointer coordinates are converted from CLIENT space (what the DOM and the
        // built-in tools use) to VIEWPORT space here, so a plugin's input arrives in
        // the same space `ctx.viewport` and overlays project to — one conversion, at
        // the boundary, instead of every plugin repeating it.
        onPointerDown: (p, c) => guard(`tool ${tool.id} down`, () => tool.onPointerDown(toPluginPointer(p), c), false),
        onPointerMove: (p, c) => guard(`tool ${tool.id} move`, () => tool.onPointerMove(toPluginPointer(p), c), undefined),
        onPointerUp: (p, c) => guard(`tool ${tool.id} up`, () => tool.onPointerUp(toPluginPointer(p), c), undefined),
        cancel: tool.cancel ? (c) => guard(`tool ${tool.id} cancel`, () => tool.cancel!(c), undefined) : undefined,
      }),
    );

  const registerOverlay = (overlay: OverlayContribution): Disposable =>
    // Not guarded here: the overlay renderer's rAF calls PluginHost.guardOverlay
    // itself, so a per-frame throw is attributed once, at the frame boundary.
    // No label: an overlay has no title of its own, and repeating the id in the
    // label column would just print it twice on the same row.
    noted('overlay', scoped(overlay.id), '', overlayRegistry.register(owner, { ...overlay, id: scoped(overlay.id) }));

  const registerInspector = (section: InspectorContribution): Disposable =>
    noted(
      'inspector',
      `${id}.${section.id}`,
      localize(section.title),
      inspectorRegistry.register(owner, { ...section, id: `${id}.${section.id}` }),
    );

  // A plugin callback that may be async: `guard` catches a throw, and a rejection
  // is routed back through it so both failure modes reach the same reporting.
  const guardAsync = async (what: string, fn: () => void | Promise<void>): Promise<void> => {
    try {
      await fn();
    } catch (e) {
      guard(what, () => { throw e; }, undefined);
    }
  };

  const registerImporter = (importer: AssetImporterContribution): Disposable =>
    noted(
      'importer',
      scoped(importer.id),
      importer.extensions.map((e) => `.${e}`).join(' '),
      importerRegistry.register(owner, {
        id: scoped(importer.id),
        extensions: importer.extensions,
        run: (path) => guardAsync(`import ${path}`, () => importer.import(path)),
      }),
    );

  const registerAssetType = (type: AssetTypeContribution): Disposable =>
    noted(
      'assetType',
      scoped(type.id),
      type.extensions.map((e) => `.${e}`).join(' '),
      assetTypeRegistry.register(owner, {
        id: scoped(type.id),
        extensions: type.extensions,
        badge: type.badge ?? '',
        icon: CONTRIBUTED_ASSET_ICON,
        tint: type.tint ?? 'var(--text-dim)',
        open: type.open ? (path) => guard(`asset open ${type.id}`, () => type.open!(path), undefined) : undefined,
        create: type.create
          ? {
              label: localize(type.create.label),
              run: (dir) => guard(`asset create ${type.id}`, () => type.create!.run(dir), undefined),
            }
          : undefined,
      }),
    );

  const registerTemplate = (template: EntityTemplateContribution): Disposable =>
    noted(
      'entityTemplate',
      scoped(template.id),
      localize(template.label),
      entitySourceRegistry.register(owner, {
        id: scoped(template.id),
        label: localize(template.label),
        category: template.category ?? 'Scripts',
        icon: CONTRIBUTED_ASSET_ICON,
        keywords: template.keywords ? [...template.keywords] : undefined,
        // The host builds the prefab from the component specs, so a plugin never
        // hand-writes PrefabData (version, prefabEntityId, parent wiring).
        build: () => prefabFromSpecs(localize(template.label), template.components),
      }),
    );

  /**
   * A tool the agent may call. Registered like any other contribution, and then
   * ANNOUNCED: main reads the list when it builds a session, and it cannot ask
   * for it at that moment — session creation is synchronous.
   */
  const registerAgentToolContribution = (tool: AgentToolContribution): Disposable => {
    const problem = agentToolProblem(id, tool);
    // Named and refused, never silently dropped: the plugin's own docs will say
    // the tool exists, and an agent that never sees it looks broken from here.
    if (problem) {
      log.warn(`agent tool "${tool.name}": ${problem}`);
      return { dispose: () => {} };
    }
    const handle = noted('agentTool', tool.name, tool.name, registerAgentTool({
      ...tool,
      run: (input: unknown) => guard(`agent tool ${tool.name}`, () => tool.run(input), undefined),
    }, owner));
    publishAgentTools();
    return { dispose: () => { handle.dispose(); publishAgentTools(); } };
  };

  const registerActivityBarItem = (item: ActivityBarContribution): Disposable =>
    noted(
      'activityBar',
      scoped(item.id),
      localize(item.title),
      activityBarRegistry.register(owner, {
        id: scoped(item.id),
        title: localize(item.title),
        icon: railIcon(item.icon),
        run: () => guard(`activity bar ${item.id}`, () => item.run(), undefined),
      }),
    );

  const registerContextMenuItem = (item: ContextMenuContribution): Disposable =>
    noted(
      'contextMenu',
      scoped(item.id),
      localize(item.label),
      contextMenuRegistry.register(owner, {
        ...item,
        id: scoped(item.id),
        // A plain string is itself a LocalizedString, so resolving it here means
        // every consumer reads one already-localized label.
        label: localize(item.label),
        when: item.when ? (target) => guard(`context ${item.id} when`, () => !!item.when!(target), false) : undefined,
        run: (target) => guard(`context ${item.id}`, () => item.run(target), undefined),
      }),
    );

  const ctx: PluginContext = {
    id,
    version: manifest.version,
    locale: editorLocale,
    subscriptions: [],
    log,
    ui: { toast: (message, level = 'info') => Toasts.push(message, level) },
    state: pluginState(id),
    commands: { register: registerCommand, run: (cid) => commands.run(cid) },
    panels: {
      register: registerPluginPanel,
      open: (pid) => dockApi.openPanel(pid),
    },
    activityBar: { register: registerActivityBarItem },
    settings: {
      register: registerSetting,
      get: <T extends boolean | number | string>(sid: string) => useSettings.getState().getValue(scoped(sid)) as T | undefined,
    },
    tools: {
      register: registerTool,
      activate: (toolId) => toolRegistry.activate(toolId),
      activeId: () => toolRegistry.activeId(),
    },
    overlays: { register: registerOverlay },
    inspector: { register: registerInspector },
    assets: {
      registerType: registerAssetType,
      registerImporter,
      reimport: (path: string) => runImporters([path]),
    },
    entities: { registerTemplate },
    contextMenus: { register: registerContextMenuItem },
    agentTools: { register: registerAgentToolContribution },
    scene: sceneApi(),
    project: projectApi(id, capabilities),
    viewport: viewportProjection,
    fs: pluginFs(id, dir, capabilities),
    events: editorEvents(track),
  };

  return {
    ctx,
    contributions: () => [...contributions],
    dispose() {
      // The plugin's own subscriptions first (they may reference contributions),
      // then ours in reverse registration order.
      for (const d of [...ctx.subscriptions].reverse()) {
        try {
          d.dispose();
        } catch (e) {
          log.error(`subscription cleanup failed: ${String(e)}`);
        }
      }
      ctx.subscriptions.length = 0;
      for (const d of [...disposables].reverse()) d.dispose();
      disposables.length = 0;
    },
  };
}

export type { EditorPlugin };
