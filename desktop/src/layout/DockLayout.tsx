import type { FC } from 'react';
import { DockviewReact, type DockviewReadyEvent, type IDockviewPanelProps } from 'dockview';
import { Outliner } from '@/panels/Outliner';
import { Viewport } from '@/panels/Viewport';
import { Details } from '@/panels/Details';
import { ContentBrowser } from '@/panels/ContentBrowser';
import { OutputLog } from '@/panels/OutputLog';

// Each dock panel is a thin wrapper so dockview owns mount/unmount.
const components: Record<string, FC<IDockviewPanelProps>> = {
  outliner: () => <Outliner />,
  viewport: () => <Viewport />,
  details: () => <Details />,
  content: () => <ContentBrowser />,
  log: () => <OutputLog />,
};

const LAYOUT_KEY = 'estella.editor.layout.v1';

function buildDefaultLayout(api: DockviewReadyEvent['api']) {
  // Viewport is the anchor; everything docks around it — the UE5 arrangement.
  api.addPanel({ id: 'viewport', component: 'viewport', title: 'Viewport' });

  api.addPanel({
    id: 'outliner',
    component: 'outliner',
    title: 'World Outliner',
    position: { referencePanel: 'viewport', direction: 'left' },
    initialWidth: 264,
  });

  api.addPanel({
    id: 'details',
    component: 'details',
    title: 'Details',
    position: { referencePanel: 'viewport', direction: 'right' },
    initialWidth: 332,
  });

  api.addPanel({
    id: 'content',
    component: 'content',
    title: 'Content Browser',
    position: { referencePanel: 'viewport', direction: 'below' },
    initialHeight: 248,
  });

  // Output Log shares the bottom group as a sibling tab of Content Browser.
  api.addPanel({
    id: 'log',
    component: 'log',
    title: 'Output Log',
    position: { referencePanel: 'content', direction: 'within' },
  });
}

export function DockLayout() {
  const onReady = (event: DockviewReadyEvent) => {
    const { api } = event;

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

    // Persist the dock arrangement so it survives reloads — a real editor habit.
    api.onDidLayoutChange(() => {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(api.toJSON()));
    });
  };

  return (
    <DockviewReact
      className="dockview-theme-abyss dockview-theme-estella"
      components={components}
      onReady={onReady}
    />
  );
}
