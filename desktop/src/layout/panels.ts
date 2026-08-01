// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  panels.ts
 * @brief THE authority for editor dock panels — one entry per panel carries its
 *        dockview component key, title, where it docks when opened, whether it can
 *        be closed or popped out, and whether the layout ensures it exists. The
 *        dockview component map, the restore-time re-title pass, the bottom utility
 *        tab list, and the closable/poppable rules all derive from it.
 *
 * Adding a panel used to mean four separate tables in DockLayout plus a rule in
 * dockApi, and opening one meant repeating its (id, component, title) triple at
 * every call site. Both are now single-sourced here.
 *
 * Kept free of React imports on purpose — the renderers live in panelComponents.tsx
 * and are imported only by DockLayout. Folding them in here would drag the whole
 * panel tree into every module that just wants to know a panel's title, and cycle
 * back through the command registry (the same split assetTypes/assetOpen use).
 */
import { t } from '@/i18n';
import { ContributionRegistry, type Disposable, type Owner } from '@/contrib/ContributionRegistry';

/**
 * Where a panel lands when opened on demand.
 *  - `document` — a center tab beside the Viewport (the big editing canvases).
 *  - `side-left` / `side-right` — a companion column that stays visible WHILE you
 *    work in the Viewport (palettes).
 *  - `bottom` — a utility tab in the bottom dock (timeline-shaped tools).
 *  - `structural` — placed by the default layout; never opened on demand.
 *  - `viewport-tab` — a tab in the Viewport's own group (the Game view).
 */
export type PanelPlacement = 'document' | 'side-left' | 'side-right' | 'bottom' | 'structural' | 'viewport-tab';

export interface PanelDef {
  /** Dock panel id — also the dockview component key unless `component` differs. */
  id: string;
  /** dockview component key (defaults to `id`). */
  component?: string;
  /** Read lazily: a restored layout re-titles from here, so the saved language
   *  in the layout JSON never pins stale strings onto the tabs. */
  title: () => string;
  placement: PanelPlacement;
  /** `side-*` panels: initial column width. */
  width?: number;
  /** `bottom` panels: dock next to the first of these that exists. */
  refs?: string[];
  /** Ensure the panel exists on fresh builds AND restored layouts, so a layout
   *  predating the panel gains it without resetting the user's arrangement. */
  ensure?: boolean;
  /**
   * Whether the tab offers an X. The essential editing panels have no reopen path
   * and the Viewport is the anchor others dock against, so closing any is a dead
   * end — they stay open (resize or collapse-to-header for space). Default true.
   */
  closable?: boolean;
  /**
   * Whether the panel may move into its own OS window. Default true: a popout is a
   * same-origin window.open, so the panel's React tree and every editor store stay
   * in this window's JS realm. False for iframe hosts — re-parenting an iframe
   * across documents reloads it (its wasm/GL would restart).
   */
  poppable?: boolean;
  /** Skip the Perf wrapper (the profiler must not profile its own render). */
  noPerf?: boolean;
  /**
   * A CONTRIBUTED panel's contents: build into `host`, return a teardown. Built-in
   * panels omit this and are rendered by the component map instead. Plain DOM
   * rather than a React element so a plugin isn't forced into our render tree —
   * it may still use the host's React, which the loader injects.
   */
  mount?(host: HTMLElement): () => void;
  /**
   * Set for a MULTI-INSTANCE panel: `id` is then only a component key, and its live
   * panels are `${instanceIdPrefix}<n>`. Such a panel has no static title/layout
   * entry (it is session-scoped), but its closable/poppable rules still resolve
   * through {@link panelDefForInstance}.
   */
  instanceIdPrefix?: string;
}

// The Viewport is the anchor; the right column stacks Outliner over Details; the
// Content Browser + Output Log share the bottom group. Widths/heights of the
// default ARRANGEMENT stay in DockLayout — that's a layout recipe, not panel data.
const STRUCTURAL: PanelDef[] = [
  { id: 'viewport', title: () => t('layout.panel.viewport'), placement: 'structural', closable: false },
  { id: 'outliner', title: () => t('layout.panel.worldOutliner'), placement: 'structural', closable: false },
  { id: 'details', title: () => t('layout.panel.details'), placement: 'structural', closable: false },
  { id: 'content', title: () => t('layout.panel.contentBrowser'), placement: 'structural', closable: false },
  { id: 'log', title: () => t('layout.panel.outputLog'), placement: 'structural', closable: false },
];

// Bottom-dock utility tabs. The big editing canvases are deliberately NOT here —
// they open as center document tabs on demand; only timeline/monitor-shaped tools
// belong in the bottom utility row.
const BOTTOM: PanelDef[] = [
  { id: 'sequencer', title: () => t('layout.panel.sequencer'), placement: 'bottom', refs: ['content', 'log'], ensure: true },
  { id: 'profiler', title: () => t('layout.panel.profiler'), placement: 'bottom', refs: ['log', 'content'], ensure: true, noPerf: true },
  { id: 'audiomixer', title: () => t('mix.panelTitle'), placement: 'bottom', refs: ['log', 'content'], ensure: true },
  // Opened on demand rather than ensured: most sessions have no plugins, and a
  // permanent tab for an empty list is noise.
  { id: 'plugins', title: () => t('plug.panelTitle'), placement: 'bottom', refs: ['log', 'content'] },
  // The agent docks like everything else — draggable, tabbable beside Details,
  // poppable to a second screen. The drawer over the workspace is the SAME
  // panel summoned, exactly as the Content Browser has both. Not ensured: a
  // permanent tab for a conversation nobody started is noise.
  { id: 'agent', title: () => t('agent.title'), placement: 'side-right', width: 384 },
];

// Full editing canvases — opened on demand as center tabs beside the Viewport.
const DOCUMENTS: PanelDef[] = [
  { id: 'tileset', title: () => t('tile.panelTileset'), placement: 'document' },
  { id: 'flipbook', title: () => t('fb.panelTitle'), placement: 'document' },
  { id: 'materialgraph', title: () => t('mat.panelTitle'), placement: 'document' },
  { id: 'statemachine', title: () => t('fsm.tabTitle'), placement: 'document' },
  { id: 'animatorcontroller', title: () => t('anim.tabTitle'), placement: 'document' },
  { id: 'behaviortree', title: () => t('bt.tabTitle'), placement: 'document' },
];

// Companion palettes — revealed by an editor mode, docked beside the Viewport so
// they stay visible while you paint / lay out in it.
const COMPANIONS: PanelDef[] = [
  { id: 'tilemap', title: () => t('panel.tilemap'), placement: 'side-left', width: 300 },
  { id: 'ui-widgets', component: 'uiWidgets', title: () => t('panel.uiWidgets'), placement: 'side-left', width: 240 },
  { id: 'controllers', title: () => t('panel.controllers'), placement: 'side-left', width: 240 },
];

// The isolated play realm's views. Both host an estella:// iframe, so neither can
// pop out. The multiplayer clients are session-scoped and keyed by realm id.
const PLAY: PanelDef[] = [
  { id: 'game', title: () => t('layout.panel.game'), placement: 'viewport-tab', poppable: false },
  {
    id: 'gameClient',
    title: () => t('layout.panel.gamePlayer', { n: 1 }),
    placement: 'viewport-tab',
    poppable: false,
    instanceIdPrefix: 'game-client-',
  },
];

/** The panels the editor ships, in declaration order. */
export const BUILTIN_PANELS: PanelDef[] = [...STRUCTURAL, ...BOTTOM, ...DOCUMENTS, ...COMPANIONS, ...PLAY];

const panelContrib = new ContributionRegistry<PanelDef>('panel');
panelContrib.registerAll('core', BUILTIN_PANELS);

export const panelRegistry = panelContrib;

export function registerPanel(def: PanelDef, owner: Owner = 'core'): Disposable {
  return panelContrib.register(owner, def);
}

/** Every panel def — built-ins first, then contributed ones. */
export function panelDefs(): readonly PanelDef[] {
  return panelContrib.all();
}

/** The def registered under this id (a panel id, or a multi-instance component key). */
export function panelDef(id: string): PanelDef | undefined {
  return panelContrib.get(id);
}

/** The dockview component key a panel renders through. */
export function panelComponent(def: PanelDef): string {
  return def.component ?? def.id;
}

/**
 * The def behind a LIVE panel id — exact match first, then the multi-instance def
 * whose prefix it carries (`game-client-2` → the `gameClient` def). This is how
 * per-panel rules resolve for dynamically created panels.
 */
export function panelDefForInstance(panelId: string): PanelDef | undefined {
  return (
    panelContrib.get(panelId) ??
    panelDefs().find((d) => d.instanceIdPrefix && panelId.startsWith(d.instanceIdPrefix))
  );
}

/** A panel's current title, or null when nothing is registered under `id`. */
export function panelTitle(id: string): string | null {
  return panelDef(id)?.title() ?? null;
}

/** Panels the layout ensures exist (fresh builds and restored layouts alike). */
export function ensuredPanels(): readonly PanelDef[] {
  return panelDefs().filter((d) => d.ensure);
}

/** Whether a live panel's tab offers an X (unknown ids are closable). */
export function isPanelClosable(panelId: string): boolean {
  return panelDefForInstance(panelId)?.closable ?? true;
}

/** Whether a live panel may be popped out into its own OS window. */
export function isPanelPoppable(panelId: string): boolean {
  return panelDefForInstance(panelId)?.poppable ?? true;
}
