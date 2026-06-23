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
  // The "Game" view (isolated play realm) — added on Play, removed on Stop.
  game: () => <GamePanel />,
};

// Bumped to v5 (tabbed docking): Viewport center, right column Outliner-over-
// Details, and Content Browser + Output Log as sibling tabs along the bottom
// (resize/close via dockview). The Content Drawer (Ctrl+Space) is a separate
// quick-access overlay on top.
const LAYOUT_KEY = 'estella.editor.layout.v6';

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

// Add the Sequencer as a bottom-dock tab if it isn't present yet. Run on both the
// fresh-build and the restored-layout paths so existing saved layouts (pre-v5
// Sequencer) gain the tab without resetting the user's whole arrangement.
function ensureSequencer(api: DockviewReadyEvent['api']) {
  if (api.getPanel('sequencer')) return;
  const ref = api.getPanel('content') ? 'content' : api.getPanel('log') ? 'log' : undefined;
  api.addPanel({
    id: 'sequencer',
    component: 'sequencer',
    title: 'Sequencer',
    position: ref ? { referencePanel: ref, direction: 'within' } : undefined,
  });
}

// Same idea for the Tileset editor — a bottom-dock tab added to fresh + restored layouts.
function ensureTileset(api: DockviewReadyEvent['api']) {
  if (api.getPanel('tileset')) return;
  const ref = api.getPanel('content') ? 'content' : api.getPanel('sequencer') ? 'sequencer' : undefined;
  api.addPanel({
    id: 'tileset',
    component: 'tileset',
    title: 'Tileset',
    position: ref ? { referencePanel: ref, direction: 'within' } : undefined,
  });
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

    // Ensure the Sequencer tab exists, then keep the Content Browser fronted so
    // adding it doesn't steal the bottom dock's active tab on load.
    ensureSequencer(api);
    ensureTileset(api);
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
