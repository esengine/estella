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
import type { ToolMode } from '@/types';

interface ToolDef {
  mode: ToolMode;
  icon: LucideIcon;
  label: string;
  key: string;
}

const TOOLS: ToolDef[] = [
  { mode: 'select', icon: MousePointer2, label: 'Select', key: 'Q' },
  { mode: 'move', icon: Move, label: 'Move', key: 'W' },
  { mode: 'rotate', icon: RotateCw, label: 'Rotate', key: 'E' },
  { mode: 'scale', icon: Scale3d, label: 'Scale', key: 'R' },
];

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
  const {
    tool,
    setTool,
    snapping,
    toggleSnapping,
    showGrid,
    toggleGrid,
    isPlaying,
    isPaused,
    togglePlay,
    togglePause,
    stop,
  } = useEditorStore();

  // Re-render on history changes to refresh undo/redo enabled state + labels.
  useSyncExternalStore(EditorHistory.subscribe, EditorHistory.getVersion);
  const undoLabel = EditorHistory.undoLabel();
  const redoLabel = EditorHistory.redoLabel();

  return (
    <div className="toolbar">
      <div className="toolbar__group">
        <TBtn icon={Save} label="Save Scene  ⌘S" />
      </div>

      <span className="toolbar__div" />

      <div className="toolbar__group">
        <TBtn
          icon={Undo2}
          label={undoLabel ? `Undo ${undoLabel}  ⌘Z` : 'Undo  ⌘Z'}
          disabled={!EditorHistory.canUndo()}
          onClick={() => EditorHistory.undo()}
        />
        <TBtn
          icon={Redo2}
          label={redoLabel ? `Redo ${redoLabel}  ⇧⌘Z` : 'Redo  ⇧⌘Z'}
          disabled={!EditorHistory.canRedo()}
          onClick={() => EditorHistory.redo()}
        />
      </div>

      <span className="toolbar__div" />

      <div className="toolbar__group" role="radiogroup" aria-label="Transform tool">
        {TOOLS.map((t) => (
          <TBtn
            key={t.mode}
            icon={t.icon}
            label={`${t.label}  (${t.key})`}
            active={tool === t.mode}
            onClick={() => setTool(t.mode)}
          />
        ))}
      </div>

      <span className="toolbar__div" />

      <div className="toolbar__group">
        <TBtn icon={Magnet} label="Snapping" active={snapping} onClick={toggleSnapping} />
        <TBtn icon={Grid3x3} label="Show Grid" active={showGrid} onClick={toggleGrid} />
      </div>

      {/* Play controls sit dead-center — the focal action, like UE5. */}
      <div className="toolbar__center">
        <div className="playbar">
          <TBtn
            icon={Play}
            label={isPlaying ? 'Restart' : 'Play  (F5)'}
            tone="run"
            active={isPlaying}
            onClick={togglePlay}
          />
          <TBtn icon={Pause} label="Pause" active={isPaused} onClick={togglePause} />
          <TBtn icon={Stop} label="Stop" onClick={stop} />
        </div>
      </div>

      <div className="toolbar__group toolbar__right">
        <TBtn icon={Eye} label="View Options" />
        <button type="button" className="chip" title="Build target">
          <Smartphone size={13} strokeWidth={1.85} />
          <span>Web</span>
        </button>
        <button type="button" className="chip chip--accent" title="Build project">
          <Hammer size={13} strokeWidth={1.85} />
          <span>Build</span>
        </button>
      </div>
    </div>
  );
}
