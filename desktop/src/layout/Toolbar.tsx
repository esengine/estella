// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { useState, useSyncExternalStore } from 'react';
import {
  Save,
  Undo2,
  Redo2,
  Play,
  Pause,
  Square as Stop,
  RotateCcw,
  Hammer,
  Monitor,
  AppWindow,
  ChevronDown,
  type LucideIcon,
} from 'lucide-react';
import { useEditorStore } from '@/store/editorStore';
import { IconButton } from '@/components/IconButton';
import { ContextMenu } from '@/components/Menu';
import { EditorHistory } from '@/engine/EditorHistory';
import { ProjectStore } from '@/project/ProjectStore';
import { commands, formatKeybinding } from '@/commands';
import { t } from '@/i18n';

// The global toolbar is GLOBAL-only: Save · Undo/Redo · Play · Build. Everything
// scoped to the scene view (the transform tools, snap/grid/fx toggles, gizmos)
// lives in the viewport's own chrome — the floating tool palette and the docked
// scene toolbar — so it travels with the viewport when it pops out to its own OS
// window, and no control is duplicated in two bars that can drift out of sync.

/** Shortcut-hint suffix for a command's tooltip, derived from its keybinding. */
function hint(id: string): string {
  const kb = commands.get(id)?.keybinding;
  return kb ? `  ${formatKeybinding(kb)}` : '';
}

function TBtn({
  icon: Icon,
  label,
  active,
  disabled,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <IconButton size="lg" variant="ghost" active={active} disabled={disabled} title={label} onClick={onClick}>
      <Icon size={16} strokeWidth={1.85} />
    </IconButton>
  );
}

export function Toolbar() {
  // Reactive display state (play target/players); actions dispatch through the
  // command registry so menu, toolbar, and keyboard share one implementation.
  const playTarget = useEditorStore((s) => s.playTarget);
  const setPlayTarget = useEditorStore((s) => s.setPlayTarget);
  const playPlayers = useEditorStore((s) => s.playPlayers);
  const setPlayPlayers = useEditorStore((s) => s.setPlayPlayers);
  const maximizeOnPlay = useEditorStore((s) => s.maximizeOnPlay);
  const setMaximizeOnPlay = useEditorStore((s) => s.setMaximizeOnPlay);
  const [modeMenu, setModeMenu] = useState<{ x: number; y: number } | null>(null);
  const { isPlaying, isPaused, togglePause } = useEditorStore();

  // Play is unavailable in Prefab Mode — a prefab has no scene to run.
  const inPrefabMode = useSyncExternalStore(
    ProjectStore.subscribe,
    () => !!ProjectStore.getSnapshot()?.prefabEdit,
  );

  // Re-render on history changes to refresh undo/redo enabled state + labels.
  useSyncExternalStore(EditorHistory.subscribe, EditorHistory.getVersion);
  const undoLabel = EditorHistory.undoLabel();
  const redoLabel = EditorHistory.redoLabel();

  return (
    <div className="toolbar">
      <div className="tgroup">
        <TBtn
          icon={Save}
          label={`${t('cmd.project.save')}${hint('project.save')}`}
          onClick={() => commands.run('project.save')}
        />
      </div>

      <span className="tdiv" />

      <div className="tgroup">
        <TBtn
          icon={Undo2}
          label={`${undoLabel ? t('layout.undoWithLabel', { label: undoLabel }) : t('cmd.edit.undo')}${hint('edit.undo')}`}
          disabled={!commands.isEnabled('edit.undo')}
          onClick={() => commands.run('edit.undo')}
        />
        <TBtn
          icon={Redo2}
          label={`${redoLabel ? t('layout.redoWithLabel', { label: redoLabel }) : t('cmd.edit.redo')}${hint('edit.redo')}`}
          disabled={!commands.isEnabled('edit.redo')}
          onClick={() => commands.run('edit.redo')}
        />
      </div>

      <span className="tspacer" />

      {/* Play controls sit dead-center — the focal action. The primary button is a
          Play↔Stop toggle (the muscle-memory action), so hitting it while playing
          stops — never a surprise cold Restart. Restart + Pause are side buttons. */}
      <div className={`play-wrap${isPlaying ? ' playing' : ''}${isPaused ? ' paused' : ''}`}>
        <button
          type="button"
          className="play-main"
          disabled={inPrefabMode}
          title={
            inPrefabMode
              ? t('layout.toast.noPlayInPrefab')
              : isPlaying
                ? `${t('cmd.play.stop')}${hint('play.stop')}`
                : `${t('cmd.play.toggle')}${hint('play.toggle')}`
          }
          onClick={() => commands.run(isPlaying ? 'play.stop' : 'play.toggle')}
        >
          {isPlaying ? <Stop size={13} strokeWidth={1.9} fill="currentColor" /> : <Play size={15} strokeWidth={1.9} fill="currentColor" />}
          {isPlaying ? t('cmd.play.stop') : t('cmd.play.toggle')}
        </button>
        <button
          type="button"
          className="play-side"
          title={isPaused ? `${t('layout.resume')}${hint('play.pause')}` : `${t('layout.pause')}${hint('play.pause')}`}
          disabled={!isPlaying}
          onClick={togglePause}
        >
          {isPaused ? <Play size={13} strokeWidth={1.9} fill="currentColor" /> : <Pause size={14} strokeWidth={1.9} fill="currentColor" />}
        </button>
        <button
          type="button"
          className="play-side"
          title={`${t('layout.restart')}${hint('play.restart')}`}
          disabled={!isPlaying}
          onClick={() => commands.run('play.restart')}
        >
          <RotateCcw size={13} strokeWidth={2} />
        </button>
        <button
          type="button"
          className="play-side play-mode"
          title={playTarget === 'viewport' ? t('layout.playInViewportTooltip') : t('layout.playInWindowTooltip')}
          disabled={isPlaying}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setModeMenu((m) => (m ? null : { x: r.left, y: r.bottom + 4 }));
          }}
        >
          {playTarget === 'viewport' ? <Monitor size={13} strokeWidth={1.9} /> : <AppWindow size={13} strokeWidth={1.9} />}
          <ChevronDown size={11} strokeWidth={2} className="play-mode-cv" />
        </button>
      </div>
      {modeMenu && (
        <ContextMenu
          x={modeMenu.x}
          y={modeMenu.y}
          onClose={() => setModeMenu(null)}
          items={[
            { label: t('layout.playInViewport'), checked: playTarget === 'viewport', onClick: () => setPlayTarget('viewport') },
            { label: t('layout.playInWindow'), checked: playTarget === 'window', onClick: () => setPlayTarget('window') },
            { sep: true },
            // Unity-style "Maximize On Play": hand the whole workspace to the game
            // while it runs, restoring the docks on Stop.
            { label: t('layout.maximizeOnPlay'), checked: maximizeOnPlay, onClick: () => setMaximizeOnPlay(!maximizeOnPlay) },
            { sep: true },
            // Multiplayer preview: 1 = plain play; N>1 boots a listen-server realm
            // (player 1) + N-1 client realms wired by in-editor replication.
            { label: t('layout.singlePlayer'), checked: playPlayers <= 1, onClick: () => setPlayPlayers(1) },
            { label: t('layout.playersListenServer', { n: 2 }), checked: playPlayers === 2, onClick: () => setPlayPlayers(2) },
            { label: t('layout.playersListenServer', { n: 3 }), checked: playPlayers === 3, onClick: () => setPlayPlayers(3) },
            { label: t('layout.playersListenServer', { n: 4 }), checked: playPlayers === 4, onClick: () => setPlayPlayers(4) },
          ]}
        />
      )}

      <span className="tspacer" />

      <div className="tgroup">
        <button type="button" className="tbtn" title={t('layout.buildScriptsTooltip')} onClick={() => commands.run('build.scripts')}>
          <Hammer size={15} strokeWidth={1.85} />
          <span className="lbl">{t('layout.build')}</span>
        </button>
      </div>
    </div>
  );
}
