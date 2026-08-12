// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  panelComponents.tsx
 * @brief The render half of the panel registry: dockview component key → React
 *        subtree. Split from the pure `panels.ts` registry because these imports
 *        pull in the entire panel tree (and cycle back through the command
 *        registry), while most consumers only need a panel's title or dock rules —
 *        the same separation assetTypes/assetOpen use.
 *
 * A CONTRIBUTED panel supplies `mount(host)` on its def instead of a renderer here,
 * and {@link MountedPanel} adapts it — so the dock frames, profiles, and error-traps
 * built-in and contributed panels identically.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { Outliner } from '@/panels/Outliner';
import { Viewport } from '@/panels/Viewport';
import { Details } from '@/panels/Details';
import { ContentBrowser } from '@/panels/ContentBrowser';
import { OutputLog } from '@/panels/OutputLog';
import { GamePanel, GameClientPanel } from '@/panels/GamePanel';
import { Sequencer } from '@/panels/Sequencer';
import { TilesetEditor } from '@/panels/TilesetEditor';
import { FlipbookEditor } from '@/panels/FlipbookEditor';
import { AudioMixerPanel } from '@/panels/AudioMixerPanel';
import { TilemapPainter } from '@/panels/TilemapPainter';
import { UIWidgetsPanel } from '@/panels/UIWidgetsPanel';
import { ControllersPanel } from '@/panels/ControllersPanel';
import { MaterialGraphEditor } from '@/panels/MaterialGraphEditor';
import { StateMachineEditor } from '@/panels/StateMachineEditor';
import { AnimatorEditor } from '@/panels/AnimatorEditor';
import { BtTreeEditor } from '@/panels/BtTreeEditor';
import { ProfilerPanel } from '@/panels/ProfilerPanel';
import { PluginsPanel } from '@/panels/PluginsPanel';
import { HistoryPanel } from '@/panels/HistoryPanel';
import { AgentPanel } from '@/components/AgentDrawer';

/** What a panel renderer is handed: its live panel id and dockview params. */
export interface PanelRenderContext {
  panelId: string;
  params?: Record<string, unknown>;
}

export type PanelRenderer = (ctx: PanelRenderContext) => ReactNode;

/**
 * Adapts a contributed panel's imperative `mount(host)`: the plugin owns the DOM
 * inside, the dock owns the frame around it. The teardown runs on unmount, so
 * closing the tab — or unloading the plugin, which retracts the panel — disposes
 * whatever the plugin built.
 */
export function MountedPanel({ mount }: { mount: (host: HTMLElement) => () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    const teardown = mount(host);
    return () => {
      teardown?.();
      // The plugin may have left nodes behind; the frame must come back clean.
      host.replaceChildren();
    };
  }, [mount]);
  return <div className="plugin-panel" ref={ref} />;
}

/** Renderer per dockview component key. Keys match `panelComponent(def)`. */
export const PANEL_RENDERERS: Record<string, PanelRenderer> = {
  outliner: () => <Outliner />,
  viewport: () => <Viewport />,
  details: () => <Details />,
  content: () => <ContentBrowser />,
  log: () => <OutputLog />,
  sequencer: () => <Sequencer />,
  tileset: () => <TilesetEditor />,
  flipbook: () => <FlipbookEditor />,
  audiomixer: () => <AudioMixerPanel />,
  tilemap: () => <TilemapPainter />,
  uiWidgets: () => <UIWidgetsPanel />,
  controllers: () => <ControllersPanel />,
  materialgraph: () => <MaterialGraphEditor />,
  statemachine: () => <StateMachineEditor />,
  animatorcontroller: () => <AnimatorEditor />,
  behaviortree: () => <BtTreeEditor />,
  profiler: () => <ProfilerPanel />,
  plugins: () => <PluginsPanel />,
  history: () => <HistoryPanel />,
  agent: () => <AgentPanel docked />,
  game: () => <GamePanel />,
  gameClient: ({ params }) => <GameClientPanel realmId={Number(params?.realmId ?? 0)} />,
};
