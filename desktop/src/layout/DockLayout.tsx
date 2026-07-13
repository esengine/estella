// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { useEffect, useState, useSyncExternalStore, type FC, type ReactNode } from 'react';
import {
  DockviewReact,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
  type IDockviewPanelHeaderProps,
  type IDockviewHeaderActionsProps,
} from 'dockview';
import { ChevronDown, X } from 'lucide-react';
import { DirtyDot } from '@/components/DirtyDot';
import { panelDirtySource } from '@/layout/panelDirty';
import { Outliner } from '@/panels/Outliner';
import { Viewport } from '@/panels/Viewport';
import { Details } from '@/panels/Details';
import { ContentBrowser } from '@/panels/ContentBrowser';
import { OutputLog } from '@/panels/OutputLog';
import { GamePanel, GameClientPanel } from '@/panels/GamePanel';
import { Sequencer } from '@/panels/Sequencer';
import { TilesetEditor } from '@/panels/TilesetEditor';
import { FlipbookEditor } from '@/panels/FlipbookEditor';
import { TilemapPainter } from '@/panels/TilemapPainter';
import { UIWidgetsPanel } from '@/panels/UIWidgetsPanel';
import { MaterialGraphEditor } from '@/panels/MaterialGraphEditor';
import { StateMachineEditor } from '@/panels/StateMachineEditor';
import { BtTreeEditor } from '@/panels/BtTreeEditor';
import { ProfilerPanel } from '@/panels/ProfilerPanel';
import { Perf } from '@/components/Perf';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { dockApi } from '@/layout/dockApi';
import { t } from '@/i18n';

const panel = (id: string, node: ReactNode) => (
  <Perf id={id}>
    <ErrorBoundary label={id}>{node}</ErrorBoundary>
  </Perf>
);

// Each dock panel is a thin wrapper so dockview owns mount/unmount.
const components: Record<string, FC<IDockviewPanelProps>> = {
  outliner: () => panel('outliner', <Outliner />),
  viewport: () => panel('viewport', <Viewport />),
  details: () => panel('details', <Details />),
  content: () => panel('content', <ContentBrowser />),
  log: () => panel('log', <OutputLog />),
  sequencer: () => panel('sequencer', <Sequencer />),
  tileset: () => panel('tileset', <TilesetEditor />),
  flipbook: () => panel('flipbook', <FlipbookEditor />),
  tilemap: () => panel('tilemap', <TilemapPainter />),
  uiWidgets: () => panel('uiWidgets', <UIWidgetsPanel />),
  materialgraph: () => panel('materialgraph', <MaterialGraphEditor />),
  statemachine: () => panel('statemachine', <StateMachineEditor />),
  behaviortree: () => panel('behaviortree', <BtTreeEditor />),
  profiler: () => <ErrorBoundary label="profiler"><ProfilerPanel /></ErrorBoundary>,
  // The "Game" view (isolated play realm) — added on Play, removed on Stop.
  game: () => panel('game', <GamePanel />),
  // Multiplayer client realms ("Game P2..N") — session-scoped, keyed by realmId.
  gameClient: (props) => {
    const realmId = Number((props.params as { realmId?: number } | undefined)?.realmId ?? 0);
    return panel(`game-client-${realmId}`, <GameClientPanel realmId={realmId} />);
  },
};

// Bumped to v6 (document-area editors): Viewport center, right column Outliner-
// over-Details, Content Browser + Output Log + Sequencer as bottom tabs. The big
// editing canvases (Material Graph / Tilemap / Tileset) are NOT bottom tabs — they
// open on-demand as document tabs beside the Viewport (dockApi.openDocument),
// matching UE/Unity. The Content Drawer (Ctrl+Space) is a separate overlay.
export const LAYOUT_KEY = 'estella.editor.layout.v6';

function buildDefaultLayout(api: DockviewReadyEvent['api']) {
  // Viewport is the anchor; the right column stacks Outliner over Details.
  api.addPanel({ id: 'viewport', component: 'viewport', title: t('layout.panel.viewport') });

  api.addPanel({
    id: 'outliner',
    component: 'outliner',
    title: t('layout.panel.worldOutliner'),
    position: { referencePanel: 'viewport', direction: 'right' },
    initialWidth: 366, // --w-rightdock
  });

  api.addPanel({
    id: 'details',
    component: 'details',
    title: t('layout.panel.details'),
    position: { referencePanel: 'outliner', direction: 'below' },
  });

  api.addPanel({
    id: 'content',
    component: 'content',
    title: t('layout.panel.contentBrowser'),
    position: { referencePanel: 'viewport', direction: 'below' },
    initialHeight: 300,
  });

  // Output Log shares the bottom group as a sibling tab of the Content Browser.
  api.addPanel({
    id: 'log',
    component: 'log',
    title: t('layout.panel.outputLog'),
    position: { referencePanel: 'content', direction: 'within' },
  });
}

// Bottom-dock utility tabs added on both fresh builds and restored layouts, so a
// saved layout predating a tab gains it without resetting the user's arrangement.
// Each docks next to the first of `refs` that exists. The big editing canvases
// (Material Graph / Tilemap / Tileset) are intentionally NOT here — they open as
// center document tabs on demand (dockApi.openDocument); only the timeline-shaped
// Sequencer belongs in the bottom utility row (UE convention).
const BOTTOM_TABS: { id: string; component: string; title: string; refs: string[] }[] = [
  { id: 'sequencer', component: 'sequencer', title: t('layout.panel.sequencer'), refs: ['content', 'log'] },
  { id: 'profiler', component: 'profiler', title: t('layout.panel.profiler'), refs: ['log', 'content'] },
];

function ensureBottomTabs(api: DockviewReadyEvent['api']) {
  for (const tab of BOTTOM_TABS) {
    if (api.getPanel(tab.id)) continue;
    const ref = tab.refs.find((r) => api.getPanel(r));
    api.addPanel({
      id: tab.id,
      component: tab.component,
      title: tab.title,
      position: ref ? { referencePanel: ref, direction: 'within' } : undefined,
    });
  }
}

// dockview persists panel TITLES inside the saved layout JSON, in whatever
// language wrote them — so a restored layout would pin the old language on
// every tab. All our panel ids are stable, so re-title the known ones from
// the live catalog after a restore. Ids not listed (game clients) are
// session-scoped and never usefully restored.
const PANEL_TITLES: Record<string, () => string> = {
  viewport: () => t('layout.panel.viewport'),
  outliner: () => t('layout.panel.worldOutliner'),
  details: () => t('layout.panel.details'),
  content: () => t('layout.panel.contentBrowser'),
  log: () => t('layout.panel.outputLog'),
  sequencer: () => t('layout.panel.sequencer'),
  profiler: () => t('layout.panel.profiler'),
  game: () => t('layout.panel.game'),
  tileset: () => t('tile.panelTileset'),
  flipbook: () => t('fb.panelTitle'),
  tilemap: () => t('panel.tilemap'),
  'ui-widgets': () => t('panel.uiWidgets'),
  materialgraph: () => t('mat.panelTitle'),
  statemachine: () => t('fsm.tabTitle'),
  behaviortree: () => t('bt.tabTitle'),
};

function retitleRestoredPanels(api: DockviewReadyEvent['api']) {
  for (const panel of api.panels) {
    const title = PANEL_TITLES[panel.id];
    if (title) panel.api.setTitle(title());
  }
}

// Custom tab content: title + the shared dirty dot (asset editors) + a close
// button that only shows on hover / on the active tab, so the strip stays calm.
function EstellaTab(props: IDockviewPanelHeaderProps) {
  const source = panelDirtySource(props.api.id);
  const dirty = useSyncExternalStore(source.subscribe, source.isDirty);
  const [title, setTitle] = useState(props.api.title ?? props.api.id);
  useEffect(() => {
    const d = props.api.onDidTitleChange((e) => setTitle(e.title));
    return () => d.dispose();
  }, [props.api]);
  return (
    <div className="dv-estella-tab">
      <span className="tab-title">{title}</span>
      {dirty && <DirtyDot />}
      <button
        type="button"
        className="tab-x"
        title={t('ui.close')}
        aria-label={t('layout.closeTab', { title })}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          props.api.close();
        }}
      >
        <X size={12} strokeWidth={2} />
      </button>
    </div>
  );
}

// A collapse/expand chevron in every dock group's header (the design's `.pcol`).
// Collapses the group to its tab bar by height; hidden on the Viewport/Game group
// (the center stage isn't an accordion). State follows the live group height, so
// it stays correct after splitter drags and layout restores.
function CollapseHeaderAction(props: IDockviewHeaderActionsProps) {
  const collapsible = !props.panels.some((p) => p.id === 'viewport' || p.id === 'game');
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
  const onReady = (event: DockviewReadyEvent) => {
    const { api } = event;
    dockApi.set(api); // expose to the activity bar (reveal/focus panels)

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

    // Persist the dock arrangement so it survives reloads — a real editor habit.
    api.onDidLayoutChange(() => {
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
