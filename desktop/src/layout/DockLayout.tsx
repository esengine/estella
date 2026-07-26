// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { useEffect, useMemo, useState, useSyncExternalStore, type FC, type ReactNode } from 'react';
import {
  DockviewReact,
  type DockviewReadyEvent,
  type DockviewPanelApi,
  type IDockviewPanelProps,
  type IDockviewPanelHeaderProps,
  type IDockviewHeaderActionsProps,
} from 'dockview';
import { ChevronDown, X, SquareArrowOutUpRight } from 'lucide-react';
import { DirtyDot } from '@/components/DirtyDot';
import { panelDirtySource } from '@/layout/panelDirty';
import { confirmDiscardDoc } from '@/project/discardGuard';
import { Perf } from '@/components/Perf';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { PanelWindowProvider } from '@/components/PanelWindow';
import { dockApi, applyPopoutTheme } from '@/layout/dockApi';
import { addEditorWindow, removeEditorWindow } from '@/layout/editorWindows';
import {
  panelDef, panelDefs, panelComponent, isPanelClosable, ensuredPanels,
  panelRegistry, panelTitle,
} from '@/layout/panels';
import { PANEL_RENDERERS } from '@/layout/panelComponents';
import { t } from '@/i18n';

// Each dock panel is a thin wrapper so dockview owns mount/unmount. The
// PanelWindowProvider hands the panel's live window down the tree so floating UI
// (menus, popovers, tooltips) lands in the right OS window once it's popped out.
// The wrapper keys off the LIVE panel id (api.id), which is also what the profiler
// and error boundary label — so a multi-instance panel needs no bespoke wiring.
const panel = (api: DockviewPanelApi, node: ReactNode, noPerf?: boolean) => (
  <PanelWindowProvider api={api}>
    {noPerf ? (
      <ErrorBoundary label={api.id}>{node}</ErrorBoundary>
    ) : (
      <Perf id={api.id}>
        <ErrorBoundary label={api.id}>{node}</ErrorBoundary>
      </Perf>
    )}
  </PanelWindowProvider>
);

/** dockview's component map, derived from the panel registry. */
function buildComponents(): Record<string, FC<IDockviewPanelProps>> {
  const out: Record<string, FC<IDockviewPanelProps>> = {};
  for (const def of panelDefs()) {
    const key = panelComponent(def);
    const render = PANEL_RENDERERS[key];
    if (!render) continue; // registered with no renderer — nothing to mount
    out[key] = (p) =>
      panel(p.api, render({ panelId: p.api.id, params: p.params as Record<string, unknown> | undefined }), def.noPerf);
  }
  return out;
}

// Bumped to v6 (document-area editors): Viewport center, right column Outliner-
// over-Details, Content Browser + Output Log + Sequencer as bottom tabs. The big
// editing canvases (Material Graph / Tilemap / Tileset) are NOT bottom tabs — they
// open on-demand as document tabs beside the Viewport (dockApi.openDocument),
// matching UE/Unity. The Content Drawer (Ctrl+Space) is a separate overlay.
export const LAYOUT_KEY = 'estella.editor.layout.v6';

// The live dockview api, held for the Window ▸ Reset Layout command. Set on ready.
let liveApi: DockviewReadyEvent['api'] | null = null;

/**
 * Rebuild the default dock arrangement in place — the same clear+rebuild the
 * ready handler runs when a saved layout fails to parse, so it's a proven-safe
 * path. Rebuilding beats a `location.reload()`: it resets ONLY the layout,
 * keeping the open scene, engine, and undo history intact (a full reload would
 * discard unsaved work and reboot the engine).
 */
export function resetLayout() {
  const api = liveApi;
  if (!api) return;
  api.clear();
  buildDefaultLayout(api);
  ensureBottomTabs(api);
  api.getPanel('content')?.api.setActive();
}

// The default ARRANGEMENT — a layout recipe (who anchors whom, at what size),
// which is why it stays here rather than in the panel registry. Titles and
// component keys still come from the registry, so they can't drift from it.
function buildDefaultLayout(api: DockviewReadyEvent['api']) {
  const add = (id: string, position?: Parameters<typeof api.addPanel>[0]['position'], size?: { initialWidth?: number; initialHeight?: number }) => {
    const def = panelDef(id);
    if (!def) return;
    api.addPanel({ id, component: panelComponent(def), title: def.title(), position, ...size });
  };

  // Viewport is the anchor; the right column stacks Outliner over Details.
  add('viewport');
  add('outliner', { referencePanel: 'viewport', direction: 'right' }, { initialWidth: 366 }); // --w-rightdock
  add('details', { referencePanel: 'outliner', direction: 'below' });
  add('content', { referencePanel: 'viewport', direction: 'below' }, { initialHeight: 300 });
  // Output Log shares the bottom group as a sibling tab of the Content Browser.
  add('log', { referencePanel: 'content', direction: 'within' });
}

// Bottom-dock utility tabs added on both fresh builds and restored layouts, so a
// saved layout predating a tab gains it without resetting the user's arrangement.
// Each docks next to the first of its `refs` that exists.
function ensureBottomTabs(api: DockviewReadyEvent['api']) {
  for (const def of ensuredPanels()) {
    if (api.getPanel(def.id)) continue;
    const ref = def.refs?.find((r) => api.getPanel(r));
    api.addPanel({
      id: def.id,
      component: panelComponent(def),
      title: def.title(),
      position: ref ? { referencePanel: ref, direction: 'within' } : undefined,
    });
  }
}

// dockview persists panel TITLES inside the saved layout JSON, in whatever
// language wrote them — so a restored layout would pin the old language on every
// tab. Panel ids are stable, so re-title from the registry after a restore. A
// panel with no registered def (a session-scoped game client) is skipped.
function retitleRestoredPanels(api: DockviewReadyEvent['api']) {
  for (const panel of api.panels) {
    const title = panelTitle(panel.id);
    if (title) panel.api.setTitle(title);
  }
}

// Custom tab content: title + the shared dirty dot (asset editors) + a close
// button that only shows on hover / on the active tab, so the strip stays calm.
function EstellaTab(props: IDockviewPanelHeaderProps) {
  const source = panelDirtySource(props.api.id);
  const dirty = useSyncExternalStore(source.subscribe, source.isDirty);
  const [title, setTitle] = useState(props.api.title ?? props.api.id);
  // The pop-out affordance shows only for a poppable panel that's still in the main
  // grid — once it's in its own window the way back is to close that window.
  const [docked, setDocked] = useState(() => props.api.location.type === 'grid');
  useEffect(() => {
    const dt = props.api.onDidTitleChange((e) => setTitle(e.title));
    const dl = props.api.onDidLocationChange(() => setDocked(props.api.location.type === 'grid'));
    return () => { dt.dispose(); dl.dispose(); };
  }, [props.api]);
  const poppable = docked && dockApi.canPopout(props.api.id);
  return (
    <div className="dv-estella-tab">
      <span className="tab-title">{title}</span>
      {dirty && <DirtyDot />}
      {poppable && (
        <button
          type="button"
          className="tab-popout"
          title={t('layout.popOut')}
          aria-label={t('layout.popOut')}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            dockApi.popout(props.api.id);
          }}
        >
          <SquareArrowOutUpRight size={11} strokeWidth={2} />
        </button>
      )}
      {isPanelClosable(props.api.id) && (
        <button
          type="button"
          className="tab-x"
          title={t('ui.close')}
          aria-label={t('layout.closeTab', { title })}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            void (async () => {
              if (source.isDirty()) {
                if (!(await confirmDiscardDoc(true, t('discard.closeTab', { title })))) return;
                source.discard?.();
              }
              props.api.close();
            })();
          }}
        >
          <X size={12} strokeWidth={2} />
        </button>
      )}
    </div>
  );
}

// A collapse/expand chevron in every dock group's header (the design's `.pcol`).
// Collapses the group to its tab bar by height; hidden on the Viewport/Game group
// (the center stage isn't an accordion). State follows the live group height, so
// it stays correct after splitter drags and layout restores.
function CollapseHeaderAction(props: IDockviewHeaderActionsProps) {
  // Only grid groups collapse-to-header; a popped-out group owns its whole window,
  // where a height accordion makes no sense (resize the OS window instead).
  const collapsible =
    props.api.location.type === 'grid' &&
    !props.panels.some((p) => p.id === 'viewport' || p.id === 'game');
  const [collapsed, setCollapsed] = useState(() => dockApi.groupCollapsed(props.api));
  useEffect(() => {
    const d = props.api.onDidDimensionsChange(() => setCollapsed(dockApi.groupCollapsed(props.api)));
    return () => d.dispose();
  }, [props.api]);
  if (!collapsible) return null;
  return (
    <button
      type="button"
      className="dv-collapse"
      title={collapsed ? t('layout.expandPanel') : t('layout.collapsePanel')}
      aria-label={collapsed ? t('layout.expandPanel') : t('layout.collapsePanel')}
      aria-expanded={!collapsed}
      onClick={() => dockApi.setGroupCollapsed(props.api, props.group.id, !collapsed)}
    >
      <ChevronDown size={14} strokeWidth={2} className={collapsed ? 'is-collapsed' : ''} />
    </button>
  );
}

export function DockLayout() {
  // Rebuilt when the panel set changes, so a contributed panel's component key
  // exists by the time something opens it.
  const revision = useSyncExternalStore(
    panelRegistry.subscribe.bind(panelRegistry),
    panelRegistry.getRevision.bind(panelRegistry),
  );
  const components = useMemo(() => buildComponents(), [revision]);

  const onReady = (event: DockviewReadyEvent) => {
    const { api } = event;
    dockApi.set(api); // expose to the activity bar (reveal/focus panels)
    liveApi = api; // expose to Window ▸ Reset Layout

    // Every popout group (a manual pop-out AND one dockview reopens while restoring a
    // saved layout) is registered here: re-theme its window (dockview copies only the
    // first `dockview-theme-*` class over, so re-add our estella override), and add it
    // to the editor-window set so window-global features (the keymap) attach to it.
    // Its own pagehide unregisters it when the popout closes or docks back.
    api.onDidAddGroup((group) => {
      const loc = group.api.location;
      if (loc.type !== 'popout') return;
      const w = loc.getWindow();
      applyPopoutTheme(w);
      addEditorWindow(w);
      w.addEventListener('pagehide', () => removeEditorWindow(w), { once: true });
    });

    const saved = localStorage.getItem(LAYOUT_KEY);
    if (saved) {
      try {
        api.fromJSON(JSON.parse(saved));
        retitleRestoredPanels(api);
      } catch {
        api.clear();
        buildDefaultLayout(api);
      }
    } else {
      buildDefaultLayout(api);
    }

    // Ensure the bottom-dock editor tabs exist, then keep the Content Browser
    // fronted so adding them doesn't steal the bottom dock's active tab on load.
    ensureBottomTabs(api);
    api.getPanel('content')?.api.setActive();

    // Never restore into a maximized state — "Maximize On Play" / F11 focus is a
    // transient view, so a reload always lands on the real editing layout.
    if (api.hasMaximizedGroup()) api.exitMaximizedGroup();

    // Persist the dock arrangement so it survives reloads — a real editor habit.
    // Skip while maximized (play/focus): that view is transient and must not
    // overwrite the user's real dock arrangement.
    api.onDidLayoutChange(() => {
      if (api.hasMaximizedGroup()) return;
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(api.toJSON()));
    });
  };

  return (
    <DockviewReact
      className="dockview-theme-abyss dockview-theme-estella"
      components={components}
      defaultTabComponent={EstellaTab}
      rightHeaderActionsComponent={CollapseHeaderAction}
      onReady={onReady}
    />
  );
}
