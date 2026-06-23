// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
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
import { ContextMenu } from '@/components/Menu';
import { EditorHistory } from '@/engine/EditorHistory';
import { commands, formatKeybinding } from '@/commands';
import type { ToolMode } from '@/types';

const TOOLS: { mode: ToolMode; icon: LucideIcon; label: string }[] = [
  { mode: 'select', icon: MousePointer2, label: 'Select' },
  { mode: 'move', icon: Move, label: 'Move' },
  { mode: 'rotate', icon: RotateCw, label: 'Rotate' },
  { mode: 'scale', icon: Scale3d, label: 'Scale' },
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
    <button
      type="button"
      className={`tbtn${active ? ' on' : ''}`}
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon size={16} strokeWidth={1.85} />
    </button>
  );
}

export function Toolbar() {
  // Reactive display state (tool / toggles / play); actions dispatch through the
  // command registry so menu, toolbar, and keyboard share one implementation.
  const playTarget = useEditorStore((s) => s.playTarget);
  const setPlayTarget = useEditorStore((s) => s.setPlayTarget);
  const [modeMenu, setModeMenu] = useState<{ x: number; y: number } | null>(null);
  const { tool, snapping, showGrid, showGizmos, isPlaying, isPaused, togglePause, stop } =
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
          label={`Save Scene${hint('project.save')}`}
          onClick={() => commands.run('project.save')}
        />
      </div>

      <span className="tdiv" />

      <div className="tgroup">
        <TBtn
          icon={Undo2}
          label={`${undoLabel ? `Undo ${undoLabel}` : 'Undo'}${hint('edit.undo')}`}
          disabled={!commands.isEnabled('edit.undo')}
          onClick={() => commands.run('edit.undo')}
        />
        <TBtn
          icon={Redo2}
          label={`${redoLabel ? `Redo ${redoLabel}` : 'Redo'}${hint('edit.redo')}`}
          disabled={!commands.isEnabled('edit.redo')}
          onClick={() => commands.run('edit.redo')}
        />
      </div>

      <span className="tdiv" />

      <div className="tgroup" role="radiogroup" aria-label="Transform tool">
        {TOOLS.map((t) => (
          <TBtn
            key={t.mode}
            icon={t.icon}
            label={`${t.label}${hint(`tool.${t.mode}`)}`}
            active={tool === t.mode}
            onClick={() => commands.run(`tool.${t.mode}`)}
          />
        ))}
      </div>

      <span className="tdiv" />

      <div className="tgroup">
        <TBtn icon={Magnet} label="Snapping" active={snapping} onClick={() => commands.run('view.toggleSnapping')} />
        <TBtn icon={Grid3x3} label="Show Grid" active={showGrid} onClick={() => commands.run('view.toggleGrid')} />
      </div>

      <span className="tspacer" />

      {/* Play controls sit dead-center — the focal action. */}
      <div className={`play-wrap${isPlaying ? ' playing' : ''}${isPaused ? ' paused' : ''}`}>
        <button
          type="button"
          className="play-main"
          title={isPlaying ? 'Restart' : `Play${hint('play.toggle')}`}
          onClick={() => commands.run('play.toggle')}
        >
          <Play size={15} strokeWidth={1.9} fill="currentColor" />
          {isPlaying ? 'Restart' : 'Play'}
        </button>
        <button type="button" className="play-side" title="Pause" disabled={!isPlaying} onClick={togglePause}>
          <Pause size={14} strokeWidth={1.9} fill="currentColor" />
        </button>
        <button type="button" className="play-side" title="Stop" disabled={!isPlaying} onClick={stop}>
          <Stop size={12} strokeWidth={1.9} fill="currentColor" />
        </button>
        <button
          type="button"
          className="play-side play-mode"
          title={`Play in ${playTarget === 'viewport' ? 'Viewport' : 'New Window'}`}
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
            { label: 'Play In Viewport', checked: playTarget === 'viewport', onClick: () => setPlayTarget('viewport') },
            { label: 'Play In New Window', checked: playTarget === 'window', onClick: () => setPlayTarget('window') },
          ]}
        />
      )}

      <span className="tspacer" />

      <div className="tgroup">
        <TBtn icon={Eye} label="Show Gizmos" active={showGizmos} onClick={() => commands.run('view.toggleGizmos')} />
        <button type="button" className="tbtn" title="Build project scripts" onClick={() => commands.run('build.scripts')}>
          <Hammer size={15} strokeWidth={1.85} />
          <span className="lbl">Build</span>
        </button>
      </div>
    </div>
  );
}
