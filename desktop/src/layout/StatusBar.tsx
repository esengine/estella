import { useSyncExternalStore } from 'react';
import { Circle, Gauge, MousePointer2, Boxes } from 'lucide-react';
import { useEditorStore } from '@/store/editorStore';
import { StatsStore } from '@/engine/StatsStore';

// Bottom status strip — live engine telemetry (real FPS / entity count / cursor
// world position) reads in the mono face.
export function StatusBar() {
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const selectedId = useEditorStore((s) => s.selectedId);
  const stats = useSyncExternalStore(StatsStore.subscribe, StatsStore.getSnapshot);

  return (
    <footer className="statusbar">
      <div className="statusbar__left">
        <span className={`statusbar__dot${isPlaying ? ' is-live' : ''}`}>
          <Circle size={8} fill="currentColor" strokeWidth={0} />
          {isPlaying ? 'Running' : 'Edit Mode'}
        </span>
        <span className="statusbar__item">
          {selectedId != null ? '1 selected' : 'No selection'}
        </span>
      </div>

      <div className="statusbar__right mono">
        <span className="statusbar__item">
          <MousePointer2 size={11} strokeWidth={1.85} />
          {stats.cursor ? `${stats.cursor.x}, ${stats.cursor.y}` : '—'}
        </span>
        <span className="statusbar__item">
          <Gauge size={11} strokeWidth={1.85} /> {stats.fps} fps
        </span>
        <span className="statusbar__item">
          <Boxes size={11} strokeWidth={1.85} /> {stats.entities} entities
        </span>
        <span className="statusbar__item statusbar__item--engine">esengine 0.10.0</span>
      </div>
    </footer>
  );
}
