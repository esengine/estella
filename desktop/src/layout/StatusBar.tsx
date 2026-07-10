// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { useSyncExternalStore } from 'react';
import { Gauge, MousePointer2, Boxes, FolderOpen, MemoryStick, Cpu } from 'lucide-react';
import { useEditorStore } from '@/store/editorStore';
import { useSelection } from '@/store/selectionStore';
import { StatsStore } from '@/engine/StatsStore';
import { EngineHost } from '@/engine/EngineHost';
import { SubsystemIndicator } from './SubsystemIndicator';
import { Perf } from '@/components/Perf';
import { version } from '../../package.json';

const formatMb = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1);

// Only this text node re-renders on mouse move, never the footer.
function CursorReadout() {
  const cursor = useSyncExternalStore(StatsStore.subscribeCursor, StatsStore.getCursor);
  return <>{cursor ? `${cursor.x}, ${cursor.y}` : '—'}</>;
}

// Bottom status strip — live engine telemetry (real FPS / entity count / cursor
// world position) reads in the mono face. Anchors the Content Drawer.
export function StatusBar() {
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const contentDrawer = useEditorStore((s) => s.contentDrawer);
  const toggleContentDrawer = useEditorStore((s) => s.toggleContentDrawer);
  const selectedIds = useSelection((s) => s.selectedIds);
  const stats = useSyncExternalStore(StatsStore.subscribe, StatsStore.getSnapshot);

  return (
    <footer className="status">
      <div className="grp">
        <button
          type="button"
          className={`cb-btn${contentDrawer ? ' active' : ''}`}
          title="Content Drawer  (Ctrl+Space)"
          onClick={toggleContentDrawer}
        >
          <FolderOpen size={12} strokeWidth={1.9} />
          Content Drawer
        </button>
        <span className="sitem">
          <span className={`sdot${isPlaying ? ' live' : ''}`} />
          {isPlaying ? 'Running' : 'Edit Mode'}
        </span>
        <Perf id="statusbar.mods"><SubsystemIndicator /></Perf>
        <span className="sitem">
          {selectedIds.size ? `${selectedIds.size} selected` : 'No selection'}
        </span>
        {stats.selection && (
          <span className="sitem mono" title="Selected transform (X, Y · rotation)">
            {stats.selection.x}, {stats.selection.y}
            <span className="smute"> · {stats.selection.rot}°</span>
          </span>
        )}
      </div>

      <span className="sp" />

      <span className="sitem mono">
        <MousePointer2 size={11} strokeWidth={1.85} />
        <CursorReadout />
      </span>
      <span className="sitem mono">
        <Gauge size={11} strokeWidth={1.85} /> {stats.fps} fps
      </span>
      <span className="sitem mono">
        <Boxes size={11} strokeWidth={1.85} /> {stats.entities} entities
      </span>
      {stats.vram && (
        <span
          className="sitem mono"
          title={`Resident texture memory / budget · ${stats.vram.evictable} cached (evictable) texture(s)`}
        >
          <MemoryStick size={11} strokeWidth={1.85} />
          {formatMb(stats.vram.bytes)}
          <span className="smute">/{formatMb(stats.vram.budget)} MB</span>
        </span>
      )}
      <span
        className="sitem mono"
        title="Active GPU backend — the device actually rendering (reflects any WebGL2 fallback). Change it in Settings → Renderer."
      >
        <Cpu size={11} strokeWidth={1.85} />
        {EngineHost.activeBackend === 'webgpu' ? 'WebGPU' : 'WebGL2'}
      </span>
      <span className="sitem smute">esengine {version}</span>
    </footer>
  );
}
