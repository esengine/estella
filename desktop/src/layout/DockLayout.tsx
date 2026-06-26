// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { useEffect, useState, type FC } from 'react';
import {
  DockviewReact,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
  type IDockviewHeaderActionsProps,
} from 'dockview';
import { ChevronDown } from 'lucide-react';
import { Outliner } from '@/panels/Outliner';
import { Viewport } from '@/panels/Viewport';
import { Details } from '@/panels/Details';
import { ContentBrowser } from '@/panels/ContentBrowser';
import { OutputLog } from '@/panels/OutputLog';
import { GamePanel } from '@/panels/GamePanel';
import { Sequencer } from '@/panels/Sequencer';
import { TilesetEditor } from '@/panels/TilesetEditor';
import { TilemapPainter } from '@/panels/TilemapPainter';
import { MaterialGraphEditor } from '@/panels/MaterialGraphEditor';
import { dockApi } from '@/layout/dockApi';

// Each dock panel is a thin wrapper so dockview owns mount/unmount.
const components: Record<string, FC<IDockviewPanelProps>> = {
  outliner: () => <Outliner />,
  viewport: () => <Viewport />,
  details: () => <Details />,
  content: () => <ContentBrowser />,
  log: () => <OutputLog />,
  sequencer: () => <Sequencer />,
  tileset: () => <TilesetEditor />,
  tilemap: () => <TilemapPainter />,
  materialgraph: () => <MaterialGraphEditor />,
  // The "Game" view (isolated play realm) — added on Play, removed on Stop.
  game: () => <GamePanel />,
};

// Bumped to v5 (tabbed docking): Viewport center, right column Outliner-over-
// Details, and Content Browser + Output Log as sibling tabs along the bottom
// (resize/close via dockview). The Content Drawer (Ctrl+Space) is a separate
// quick-access overlay on top.
const LAYOUT_KEY = 'estella.editor.layout.v5';

function buildDefaultLayout(api: DockviewReadyEvent['api']) {
  // Viewport is the anchor; the right column stacks Outliner over Details.
  api.addPanel({ id: 'viewport', component: 'viewport', title: 'Viewport' });

  api.addPanel({
    id: 'outliner',
    component: 'outliner',
    title: 'World Outliner',
    position: { referencePanel: 'viewport', direction: 'right' },
    initialWidth: 340,
  });

  api.addPanel({
    id: 'details',
    component: 'details',
    title: 'Details',
    position: { referencePanel: 'outliner', direction: 'below' },
  });

  api.addPanel({
    id: 'content',
    component: 'content',
    title: 'Content Browser',
    position: { referencePanel: 'viewport', direction: 'below' },
    initialHeight: 240,
  });

  // Output Log shares the bottom group as a sibling tab of the Content Browser.
  api.addPanel({
    id: 'log',
    component: 'log',
    title: 'Output Log',
    position: { referencePanel: 'content', direction: 'within' },
  });
}

// Bottom-dock editor tabs added on both fresh builds and restored layouts, so a
// saved layout predating a tab gains it without resetting the user's arrangement.
// Each docks next to the first of `refs` that exists; tabs are added in order, so
// a later tab may reference an earlier one. Adding a bottom-dock tab is one entry.
const BOTTOM_TABS: { id: string; component: string; title: string; refs: string[] }[] = [
  { id: 'sequencer', component: 'sequencer', title: 'Sequencer', refs: ['content', 'log'] },
  { id: 'tileset', component: 'tileset', title: 'Tileset', refs: ['content', 'sequencer'] },
  { id: 'tilemap', component: 'tilemap', title: 'Tilemap', refs: ['content', 'tileset'] },
  { id: 'materialgraph', component: 'materialgraph', title: 'Material Graph', refs: ['content', 'tilemap'] },
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
      title={collapsed ? 'Expand panel' : 'Collapse panel'}
      aria-label={collapsed ? 'Expand panel' : 'Collapse panel'}
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
      rightHeaderActionsComponent={CollapseHeaderAction}
      onReady={onReady}
    />
  );
}
