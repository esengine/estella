// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { useState, useSyncExternalStore } from 'react';
import {
  Save,
  Undo2,
  Redo2,
  MousePointer2,
  Move,
  RotateCw,
  Scale3d,
  Magnet,
  Grid3x3,
  Sparkles,
  Play,
  Pause,
  Square as Stop,
  Eye,
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
import { commands, formatKeybinding } from '@/commands';
import type { ToolMode } from '@/types';
import { t } from '@/i18n';

const TOOLS: { mode: ToolMode; icon: LucideIcon; label: string }[] = [
  { mode: 'select', icon: MousePointer2, label: t('layout.tool.select') },
  { mode: 'move', icon: Move, label: t('layout.tool.move') },
  { mode: 'rotate', icon: RotateCw, label: t('layout.tool.rotate') },
  { mode: 'scale', icon: Scale3d, label: t('layout.tool.scale') },
];

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
  // Reactive display state (tool / toggles / play); actions dispatch through the
  // command registry so menu, toolbar, and keyboard share one implementation.
  const playTarget = useEditorStore((s) => s.playTarget);
  const setPlayTarget = useEditorStore((s) => s.setPlayTarget);
  const playPlayers = useEditorStore((s) => s.playPlayers);
  const setPlayPlayers = useEditorStore((s) => s.setPlayPlayers);
  const [modeMenu, setModeMenu] = useState<{ x: number; y: number } | null>(null);
  const { tool, snapping, showGrid, showGizmos, previewFx, isPlaying, isPaused, togglePause, stop } =
    useEditorStore();

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

      <span className="tdiv" />

      <div className="tgroup" role="radiogroup" aria-label={t('layout.transformTool')}>
        {TOOLS.map((tb) => (
          <TBtn
            key={tb.mode}
            icon={tb.icon}
            label={`${tb.label}${hint(`tool.${tb.mode}`)}`}
            active={tool === tb.mode}
            onClick={() => commands.run(`tool.${tb.mode}`)}
          />
        ))}
      </div>

      <span className="tdiv" />

      <div className="tgroup">
        <TBtn icon={Magnet} label={t('cmd.view.toggleSnapping')} active={snapping} onClick={() => commands.run('view.toggleSnapping')} />
        <TBtn icon={Grid3x3} label={t('cmd.view.toggleGrid')} active={showGrid} onClick={() => commands.run('view.toggleGrid')} />
        <TBtn icon={Sparkles} label={t('cmd.view.togglePreviewFx')} active={previewFx} onClick={() => commands.run('view.togglePreviewFx')} />
      </div>

      <span className="tspacer" />

      {/* Play controls sit dead-center — the focal action. */}
      <div className={`play-wrap${isPlaying ? ' playing' : ''}${isPaused ? ' paused' : ''}`}>
        <button
          type="button"
          className="play-main"
          title={isPlaying ? t('layout.restart') : `${t('cmd.play.toggle')}${hint('play.toggle')}`}
          onClick={() => commands.run('play.toggle')}
        >
          <Play size={15} strokeWidth={1.9} fill="currentColor" />
          {isPlaying ? t('layout.restart') : t('cmd.play.toggle')}
        </button>
        <button type="button" className="play-side" title={t('layout.pause')} disabled={!isPlaying} onClick={togglePause}>
          <Pause size={14} strokeWidth={1.9} fill="currentColor" />
        </button>
        <button type="button" className="play-side" title={t('cmd.play.stop')} disabled={!isPlaying} onClick={stop}>
          <Stop size={12} strokeWidth={1.9} fill="currentColor" />
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
        <TBtn icon={Eye} label={t('cmd.view.toggleGizmos')} active={showGizmos} onClick={() => commands.run('view.toggleGizmos')} />
        <button type="button" className="tbtn" title={t('layout.buildScriptsTooltip')} onClick={() => commands.run('build.scripts')}>
          <Hammer size={15} strokeWidth={1.85} />
          <span className="lbl">{t('layout.build')}</span>
        </button>
      </div>
    </div>
  );
}
