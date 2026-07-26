// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  PluginHost.ts
 * @brief The renderer-side plugin lifecycle: discover → compile → trust-gate →
 *        activate → (reload | deactivate). Holds the reactive record list the
 *        Plugins panel renders, and owns the two policies that keep a plugin from
 *        taking the editor down with it.
 *
 * POLICY 1 — attribution. A plugin's contributions all carry `plugin:<id>` as
 * owner, so unloading is one `disposeOwner` per registry plus the context's own
 * disposables. That is what makes hot reload trustworthy: nothing survives a
 * reload except what the plugin re-registers.
 *
 * POLICY 2 — quarantine. Every plugin callback runs inside {@link guard}: a throw
 * is logged with its plugin's name, counted, and swallowed with a safe fallback so
 * the editor surface that called it (a menu, an enablement check, a panel mount)
 * keeps working. Past a threshold the plugin is disabled rather than left to throw
 * on every render — the same posture ErrorBoundary/resilience.ts take.
 *
 * Trust is NOT decided here: main hands back whether the user approved this plugin
 * (id + version, from this folder), and an unapproved one stops at `needs-trust`
 * until they say so.
 */
import { commands } from '@/commands/registry';
import { panelRegistry } from '@/layout/panels';
import { menuRegistry, menuItemRegistry } from '@/layout/menus';
import { settingsRegistry } from '@/settings/registry';
import { dockApi } from '@/layout/dockApi';
import { editorModeRegistry } from '@/mode/editorModes';
import { entitySourceRegistry } from '@/engine/entitySources';
import { toolRegistry } from '@/tools/toolRegistry';
import { assetTypeRegistry } from '@/project/assetTypes';
import { overlayRegistry } from './overlays';
import { inspectorRegistry } from './inspector';
import { contextMenuRegistry } from './contextMenus';
import { LogStore } from '@/store/LogStore';
import { Toasts } from '@/store/Toasts';
import { PerfMonitor } from '@/engine/PerfMonitor';
import { editorLocale } from '@/i18n';
// The editor's own version, the same source the status bar shows — what a
// plugin's `engines.editor` range is checked against.
import { version as EDITOR_VERSION } from '../../package.json';
import type { Owner } from '@/contrib/ContributionRegistry';
import { resolveLocalized, satisfiesEditorRange, type PluginManifest } from './manifest';
import { evaluatePlugin } from './loader';
import { buildPluginContext, type BuiltContext } from './context';
import type { EditorPlugin } from './types';

/** Where a plugin sits in its lifecycle — what the Plugins panel shows. */
export type PluginPhase =
  | 'discovered'
  | 'compiling'
  | 'needs-trust'
  | 'activating'
  | 'active'
  | 'failed'
  | 'disabled'
  | 'incompatible'
  | 'shadowed';

export interface PluginRecord {
  id: string;
  /** Display name, already localized. */
  name: string;
  description: string;
  version: string;
  scope: 'project' | 'user';
  dir: string;
  phase: PluginPhase;
  /** Why it's failed / incompatible / shadowed. */
  detail?: string;
  /** Declared capabilities, shown at the trust prompt. */
  capabilities: string[];
  /** Non-fatal build diagnostics. */
  warnings: string[];
  /** Throws attributed to this plugin this session. */
  errorCount: number;
}

/** Throws tolerated before a plugin is disabled for the session. */
const QUARANTINE_THRESHOLD = 5;

const ownerOf = (id: string): Owner => `plugin:${id}`;

// Every registry a plugin can contribute to. Unloading walks this list, so adding
// a contribution kind means adding it HERE and nowhere else in the teardown path.
const CONTRIBUTION_REGISTRIES = [
  { disposeOwner: (o: Owner) => commands.disposeOwner(o) },
  panelRegistry,
  menuRegistry,
  menuItemRegistry,
  { disposeOwner: (o: Owner) => settingsRegistry.disposeOwner(o) },
  editorModeRegistry,
  entitySourceRegistry,
  toolRegistry,
  overlayRegistry,
  inspectorRegistry,
  assetTypeRegistry,
  contextMenuRegistry,
];

interface LoadedPlugin {
  plugin: EditorPlugin;
  context: BuiltContext;
}

class PluginHostImpl {
  private records = new Map<string, PluginRecord>();
  private loaded = new Map<string, LoadedPlugin>();
  private readonly listeners = new Set<() => void>();
  private snapshot: PluginRecord[] = [];

  // — Reactive surface for the Plugins panel —

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): PluginRecord[] => this.snapshot;

  private changed(): void {
    this.snapshot = [...this.records.values()];
    for (const fn of this.listeners) fn();
  }

  private set(id: string, patch: Partial<PluginRecord>): void {
    const prev = this.records.get(id);
    if (prev) this.records.set(id, { ...prev, ...patch });
    this.changed();
  }

  /**
   * Wrap a plugin callback. Returns `fallback` if it throws, so the caller — a
   * menu building its rows, a panel mounting — is never broken by a plugin bug.
   * Timed through PerfMonitor so a slow plugin shows up in the profiler beside the
   * editor's own work, under `plugin.<id>.<what>`.
   */
  /**
   * Run one overlay's per-frame draw. Exposed because the overlay renderer's rAF
   * calls plugin code directly, and a throw there must be attributed and counted
   * like any other — not swallowed anonymously inside a render loop.
   */
  guardOverlay(id: string, draw: () => void): void {
    this.guard(id, 'overlay render', draw, undefined);
  }

  private guard<T>(id: string, what: string, fn: () => T, fallback: T): T {
    try {
      return PerfMonitor.measure(`plugin.${id}.${what}`, fn);
    } catch (e) {
      this.recordError(id, what, e);
      return fallback;
    }
  }

  private recordError(id: string, what: string, e: unknown): void {
    const record = this.records.get(id);
    const count = (record?.errorCount ?? 0) + 1;
    LogStore.push('error', `plugin:${id}`, `${what} failed: ${e instanceof Error ? e.message : String(e)}`);
    if (e instanceof Error && e.stack) LogStore.push('error', `plugin:${id}`, e.stack);
    this.set(id, { errorCount: count });
    if (count >= QUARANTINE_THRESHOLD && record?.phase === 'active') {
      Toasts.push(`Plugin "${record.name}" kept failing and was disabled.`, 'error');
      void this.disable(id, `disabled after ${count} errors this session`);
    }
  }

  // — Discovery + activation —

  /**
   * Re-read the plugin folders and bring the set in line: newly present plugins
   * load, ones that vanished unload, and ones already running are left alone so
   * this is safe to call repeatedly (project open, the panel's Refresh).
   *
   * `forceDirs` names plugin FOLDERS whose source changed on disk — those reload
   * even though they're active. Folders, not ids, because the watcher reports
   * paths and a folder name need not match the id inside its manifest.
   */
  async refresh(opts?: { forceDirs?: readonly string[] }): Promise<void> {
    const found = await window.estella.plugins.list();
    const seen = new Set<string>();
    const force = new Set(opts?.forceDirs ?? []);
    const dirName = (dir: string): string => dir.replace(/[/\\]+$/, '').split(/[/\\]/).pop() ?? '';

    for (const p of found) {
      seen.add(p.id);
      const manifest = p.manifest;
      const name = manifest ? resolveLocalized(manifest.name, editorLocale) : p.id;
      const base: PluginRecord = {
        id: p.id,
        name,
        description: manifest ? resolveLocalized(manifest.description, editorLocale) : '',
        version: manifest?.version ?? '',
        scope: p.scope,
        dir: p.dir,
        phase: 'discovered',
        capabilities: manifest?.capabilities ?? [],
        warnings: [],
        errorCount: this.records.get(p.id)?.errorCount ?? 0,
      };

      if (p.error) {
        this.records.set(p.id, { ...base, phase: 'failed', detail: p.error });
        continue;
      }
      if (p.shadowedBy) {
        this.records.set(p.id, {
          ...base,
          phase: 'shadowed',
          detail: `a ${p.shadowedBy}-scoped plugin claims the same id`,
        });
        continue;
      }
      if (p.disabled) {
        this.records.set(p.id, { ...base, phase: 'disabled' });
        continue;
      }
      const range = manifest?.engines?.editor;
      if (range) {
        const compat = satisfiesEditorRange(EDITOR_VERSION, range);
        if (!compat.ok) {
          this.records.set(p.id, { ...base, phase: 'incompatible', detail: compat.reason });
          continue;
        }
      }
      const changed = force.has(dirName(p.dir));
      // Already running and unchanged — leave it alone (refresh is idempotent).
      if (!changed && this.loaded.has(p.id) && this.records.get(p.id)?.phase === 'active') continue;
      // Changed on disk: retract the old build's contributions before the new one
      // registers, or both would be live at once.
      let reopen: string[] = [];
      if (changed) {
        reopen = this.openPanelIds(ownerOf(p.id));
        await this.unload(p.id);
      }

      this.records.set(p.id, base);
      await this.activate(p.id, manifest!);
      this.restorePanels(reopen);
    }

    // Plugins whose folder went away must not keep their contributions.
    for (const id of [...this.records.keys()]) {
      if (seen.has(id)) continue;
      await this.unload(id);
      this.records.delete(id);
    }
    this.changed();
  }

  private async activate(id: string, manifest: PluginManifest): Promise<void> {
    this.set(id, { phase: 'compiling' });
    const built = await window.estella.plugins.load(id);
    if (!built.ok || !built.code) {
      this.set(id, { phase: 'failed', detail: built.errors.join('; ') || 'compilation failed' });
      return;
    }
    this.set(id, { warnings: built.warnings });
    if (!built.trusted) {
      // Stop here. A renderer plugin runs in the editor's own realm, so nothing
      // runs until the user has approved this exact build.
      this.set(id, { phase: 'needs-trust' });
      return;
    }

    this.set(id, { phase: 'activating' });
    const owner = ownerOf(id);
    const record = this.records.get(id)!;
    let context: BuiltContext | undefined;
    try {
      const plugin = evaluatePlugin(id, built.code);
      context = buildPluginContext(
        manifest,
        record.dir,
        owner,
        <T>(what: string, fn: () => T, fallback: T) => this.guard(id, what, fn, fallback),
      );
      this.loaded.set(id, { plugin, context });
      await plugin.activate(context.ctx);
      this.set(id, { phase: 'active', detail: undefined });
      LogStore.push('info', `plugin:${id}`, `activated (${record.version})`);
    } catch (e) {
      // A plugin that throws mid-activate may have registered some of its
      // contributions already — retract them, or it leaves a half-loaded surface.
      this.disposeContributions(owner, () => context?.dispose());
      this.loaded.delete(id);
      const message = e instanceof Error ? e.message : String(e);
      LogStore.push('error', `plugin:${id}`, `activation failed: ${message}`);
      this.set(id, { phase: 'failed', detail: message });
    }
  }

  /**
   * Retract every contribution of one owner and close the panel TABS it opened.
   *
   * Order matters: the tab ids have to be read BEFORE anything retracts the panel
   * registrations, because that's the only record of which tabs belonged to this
   * plugin. Closing after the registry is emptied would silently leave a stale tab
   * mounted, still rendering the previous build.
   */
  private disposeContributions(owner: Owner, disposeContext?: () => void): void {
    const panelIds = panelRegistry.byOwner(owner).map((d) => d.id);
    disposeContext?.();
    for (const registry of CONTRIBUTION_REGISTRIES) registry.disposeOwner(owner);
    for (const id of panelIds) dockApi.closePanel(id);
  }

  /** Ids of the plugin's panels the user currently has OPEN — so a reload can put
   *  them back. Without this, editing a plugin makes its panel vanish mid-edit. */
  private openPanelIds(owner: Owner): string[] {
    return panelRegistry.byOwner(owner).filter((d) => dockApi.isPanelOpen(d.id)).map((d) => d.id);
  }

  /** Re-open panels that were open before a reload, if the new build still has them. */
  private restorePanels(ids: readonly string[]): void {
    for (const id of ids) if (panelRegistry.get(id)) dockApi.openPanel(id);
  }

  private async unload(id: string): Promise<void> {
    const entry = this.loaded.get(id);
    if (entry) {
      try {
        await entry.plugin.deactivate?.();
      } catch (e) {
        LogStore.push('warn', `plugin:${id}`, `deactivate failed: ${String(e)}`);
      }
      this.loaded.delete(id);
    }
    this.disposeContributions(ownerOf(id), () => entry?.context.dispose());
  }

  // — Actions the Plugins panel drives —

  /** Approve this plugin and activate it. */
  async trust(id: string): Promise<void> {
    await window.estella.plugins.trust(id);
    await this.reload(id);
  }

  /** Withdraw approval; the plugin unloads and waits to be approved again. */
  async revokeTrust(id: string): Promise<void> {
    await window.estella.plugins.revokeTrust(id);
    await this.unload(id);
    this.set(id, { phase: 'needs-trust', detail: undefined });
  }

  async disable(id: string, detail?: string): Promise<void> {
    await window.estella.plugins.setEnabled(id, false);
    await this.unload(id);
    this.set(id, { phase: 'disabled', detail });
  }

  async enable(id: string): Promise<void> {
    await window.estella.plugins.setEnabled(id, true);
    await this.reload(id);
  }

  /**
   * Unload and re-activate one plugin, recompiling from source. This is the hot
   * path for plugin development, and it is only correct because contributions are
   * owner-scoped: everything the old build registered goes away first.
   */
  async reload(id: string): Promise<void> {
    const found = await window.estella.plugins.list();
    const p = found.find((x) => x.id === id);
    const reopen = this.openPanelIds(ownerOf(id));
    await this.unload(id);
    if (!p?.manifest) {
      this.set(id, { phase: 'failed', detail: p?.error ?? 'plugin no longer on disk' });
      return;
    }
    this.set(id, { errorCount: 0, warnings: [], detail: undefined });
    await this.activate(id, p.manifest);
    this.restorePanels(reopen);
  }

  /** Unload everything (project close). Records are dropped with the project. */
  async unloadAll(): Promise<void> {
    for (const id of [...this.loaded.keys()]) await this.unload(id);
    this.records.clear();
    this.changed();
  }
}

export const PluginHost = new PluginHostImpl();
