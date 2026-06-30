// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { useSyncExternalStore } from 'react';
import { Gauge, MousePointer2, Boxes, FolderOpen } from 'lucide-react';
import { useEditorStore } from '@/store/editorStore';
import { useSelection } from '@/store/selectionStore';
import { StatsStore } from '@/engine/StatsStore';
import { SubsystemIndicator } from './SubsystemIndicator';

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
        <SubsystemIndicator />
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
        {stats.cursor ? `${stats.cursor.x}, ${stats.cursor.y}` : '—'}
      </span>
      <span className="sitem mono">
        <Gauge size={11} strokeWidth={1.85} /> {stats.fps} fps
      </span>
      <span className="sitem mono">
        <Boxes size={11} strokeWidth={1.85} /> {stats.entities} entities
      </span>
      <span className="sitem smute">esengine 0.10.0</span>
    </footer>
  );
}
