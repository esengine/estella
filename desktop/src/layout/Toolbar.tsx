import { useSyncExternalStore } from 'react';
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
  Smartphone,
  Hammer,
  type LucideIcon,
} from 'lucide-react';
import { useEditorStore } from '@/store/editorStore';
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
  tone,
}: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  tone?: 'run';
}) {
  return (
    <button
      type="button"
      className={`tbtn${active ? ' is-active' : ''}${tone ? ` tbtn--${tone}` : ''}`}
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
  const { tool, snapping, showGrid, showGizmos, isPlaying, isPaused, togglePause, stop } =
    useEditorStore();

  // Re-render on history changes to refresh undo/redo enabled state + labels.
  useSyncExternalStore(EditorHistory.subscribe, EditorHistory.getVersion);
  const undoLabel = EditorHistory.undoLabel();
  const redoLabel = EditorHistory.redoLabel();

  return (
    <div className="toolbar">
      <div className="toolbar__group">
        <TBtn
          icon={Save}
          label={`Save Scene${hint('project.save')}`}
          onClick={() => commands.run('project.save')}
        />
      </div>

      <span className="toolbar__div" />

      <div className="toolbar__group">
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

      <span className="toolbar__div" />

      <div className="toolbar__group" role="radiogroup" aria-label="Transform tool">
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

      <span className="toolbar__div" />

      <div className="toolbar__group">
        <TBtn icon={Magnet} label="Snapping" active={snapping} onClick={() => commands.run('view.toggleSnapping')} />
        <TBtn icon={Grid3x3} label="Show Grid" active={showGrid} onClick={() => commands.run('view.toggleGrid')} />
      </div>

      {/* Play controls sit dead-center — the focal action, like UE5. */}
      <div className="toolbar__center">
        <div className="playbar">
          <TBtn
            icon={Play}
            label={isPlaying ? 'Restart' : `Play${hint('play.toggle')}`}
            tone="run"
            active={isPlaying}
            onClick={() => commands.run('play.toggle')}
          />
          <TBtn icon={Pause} label="Pause" active={isPaused} onClick={togglePause} />
          <TBtn icon={Stop} label="Stop" onClick={stop} />
        </div>
      </div>

      <div className="toolbar__group toolbar__right">
        <TBtn icon={Eye} label="Show Gizmos" active={showGizmos} onClick={() => commands.run('view.toggleGizmos')} />
        <button type="button" className="chip" title="Build target">
          <Smartphone size={13} strokeWidth={1.85} />
          <span>Web</span>
        </button>
        <button
          type="button"
          className="chip chip--accent"
          title="Build project scripts"
          onClick={() => commands.run('build.scripts')}
        >
          <Hammer size={13} strokeWidth={1.85} />
          <span>Build</span>
        </button>
      </div>
    </div>
  );
}
