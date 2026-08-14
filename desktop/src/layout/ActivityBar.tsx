// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
// Far-left icon rail (activity bar). Switches the editing mode, reveals docked
// panels, and toggles the Content Drawer — the summoned quick-access surface.
import { useSyncExternalStore } from 'react';
import { ListTree, SlidersHorizontal, FolderOpen, Terminal, Clapperboard, Gauge, Settings, Sparkles, Plug } from 'lucide-react';
import { activityBarRegistry } from '@/plugins/activityBar';
import { useEditorStore } from '@/store/editorStore';
import { useEditorMode } from '@/store/editorModeStore';
import { useSelection } from '@/store/selectionStore';
import { useAgent } from '@/store/AgentStore';
import { editorModes, editorModeRegistry } from '@/mode/editorModes';
import { activeMode } from '@/mode/activeMode';
import { dockApi } from '@/layout/dockApi';
import { commands } from '@/commands';
import { t } from '@/i18n';

export function ActivityBar() {
  const contentDrawer = useEditorStore((s) => s.contentDrawer);
  const toggleContentDrawer = useEditorStore((s) => s.toggleContentDrawer);
  const agentDrawer = useEditorStore((s) => s.agentDrawer);
  const toggleAgentDrawer = useEditorStore((s) => s.toggleAgentDrawer);
  // Working, or waiting on you — the rail is visible with the drawer closed, so
  // it is where "it still needs something from me" has to be legible.
  const agentPhase = useAgent((s) => s.status.phase);
  // The active mode is derived from the pin + selection; subscribe to both so the
  // highlighted mode button tracks selection-driven changes, not just explicit pins.
  useEditorMode((s) => s.pinned);
  useSelection((s) => s.selectedId);
  const current = activeMode().id;
  // The mode rail is derived from the registry, so a contributed mode appears
  // (and a retracted one disappears) without a reload.
  const modes = useSyncExternalStore(editorModeRegistry.subscribe.bind(editorModeRegistry), editorModes);
  // Plugin buttons join the panel group rather than the modes: what a plugin
  // reveals is a surface of its own, and the modes are what the editor edits.
  const contributed = useSyncExternalStore(activityBarRegistry.subscribe, activityBarRegistry.all);

  return (
    <div className="activity">
      {modes.map((m) => {
        const Icon = m.icon;
        return (
          <button
            key={m.id}
            type="button"
            className={`act${current === m.id ? ' active' : ''}`}
            title={m.commandLabel}
            onClick={() => commands.run(`mode.${m.id}`)}
          >
            <Icon size={19} strokeWidth={1.7} />
          </button>
        );
      })}
      <span className="act-sep" />
      <button
        type="button"
        className="act"
        title={t('layout.toggleOutliner')}
        onClick={() => dockApi.togglePanelCollapse('outliner')}
      >
        <ListTree size={19} strokeWidth={1.7} />
      </button>
      <button
        type="button"
        className="act"
        title={t('layout.toggleDetails')}
        onClick={() => dockApi.togglePanelCollapse('details')}
      >
        <SlidersHorizontal size={19} strokeWidth={1.7} />
      </button>
      <button
        type="button"
        className={`act${contentDrawer ? ' active' : ''}`}
        title={t('layout.contentDrawerTooltip')}
        onClick={toggleContentDrawer}
      >
        <FolderOpen size={19} strokeWidth={1.7} />
      </button>
      <button
        type="button"
        className="act"
        title={t('layout.panel.outputLog')}
        onClick={() => dockApi.revealAndExpand('log')}
      >
        <Terminal size={19} strokeWidth={1.7} />
      </button>
      <button
        type="button"
        className="act"
        title={t('layout.panel.sequencer')}
        onClick={() => dockApi.revealAndExpand('sequencer')}
      >
        <Clapperboard size={19} strokeWidth={1.7} />
      </button>
      <button
        type="button"
        className="act"
        title={t('layout.panel.profiler')}
        onClick={() => dockApi.revealAndExpand('profiler')}
      >
        <Gauge size={19} strokeWidth={1.7} />
      </button>
      {contributed.map((item) => (
        <button key={item.id} type="button" className="act" title={item.title} onClick={item.run}>
          {item.icon
            ? <span className="act-glyph" dangerouslySetInnerHTML={{ __html: item.icon }} />
            : <Plug size={19} strokeWidth={1.7} />}
        </button>
      ))}

      <span className="act-spacer" />

      {/* Above Settings, below the panels: the agent is a thing you summon, not
          a panel you dock. The palette also takes a sentence — this is the entry
          for people who have not learned that yet, which is everyone at first. */}
      <button
        type="button"
        className={`act act-agent${agentDrawer ? ' active' : ''}${agentPhase !== 'idle' ? ' busy' : ''}${agentPhase === 'awaiting_confirm' ? ' asking' : ''}`}
        title={t('agent.open')}
        onClick={toggleAgentDrawer}
      >
        <Sparkles size={19} strokeWidth={1.7} />
      </button>
      <button
        type="button"
        className="act"
        title={t('layout.settingsTooltip')}
        onClick={() => commands.run('settings.open')}
      >
        <Settings size={19} strokeWidth={1.7} />
      </button>
    </div>
  );
}
