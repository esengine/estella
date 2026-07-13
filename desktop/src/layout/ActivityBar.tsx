// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
// Far-left icon rail (activity bar). Switches the editing mode, reveals docked
// panels, and toggles the Content Drawer — the summoned quick-access surface.
import { ListTree, SlidersHorizontal, FolderOpen, Terminal, Clapperboard, Gauge, Settings } from 'lucide-react';
import { useEditorStore } from '@/store/editorStore';
import { useEditorMode } from '@/store/editorModeStore';
import { useSelection } from '@/store/selectionStore';
import { EDITOR_MODES } from '@/mode/editorModes';
import { activeMode } from '@/mode/activeMode';
import { dockApi } from '@/layout/dockApi';
import { commands } from '@/commands';
import { t } from '@/i18n';

export function ActivityBar() {
  const contentDrawer = useEditorStore((s) => s.contentDrawer);
  const toggleContentDrawer = useEditorStore((s) => s.toggleContentDrawer);
  // The active mode is derived from the pin + selection; subscribe to both so the
  // highlighted mode button tracks selection-driven changes, not just explicit pins.
  useEditorMode((s) => s.pinned);
  useSelection((s) => s.selectedId);
  const current = activeMode().id;

  return (
    <div className="activity">
      {EDITOR_MODES.map((m) => {
        const Icon = m.icon;
        return (
          <button
            key={m.id}
            type="button"
            className={`act${current === m.id ? ' active' : ''}`}
            title={t(`cmd.mode.${m.id}` as const)}
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
      <button
        type="button"
        className="act"
        title={t('mix.panelTitle')}
        onClick={() => dockApi.revealAndExpand('audiomixer')}
      >
        <SlidersHorizontal size={19} strokeWidth={1.7} />
      </button>

      <span className="act-spacer" />

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
