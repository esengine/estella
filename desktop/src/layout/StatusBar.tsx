// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { useSyncExternalStore } from 'react';
import { Gauge, MousePointer2, Boxes, FolderOpen, MemoryStick, Cpu, Square, Scaling } from 'lucide-react';
import { useEditorStore } from '@/store/editorStore';
import { useSettings } from '@/store/settingsStore';
import { AgentMark } from '@/components/AgentMark';
import { UI_SCALE_SETTING, ZOOM_DEFAULT, setUiZoom } from './uiZoom';
import { useSelection } from '@/store/selectionStore';
import { useAgent, stopAgentTurn } from '@/store/AgentStore';
import { StatsStore } from '@/engine/StatsStore';
import { EngineHost } from '@/engine/EngineHost';
import { SubsystemIndicator } from './SubsystemIndicator';
import { Perf } from '@/components/Perf';
import { version } from '../../package.json';
import { t } from '@/i18n';

const formatMb = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1);

// Live readouts each subscribe to just their field of the stats snapshot, so the
// 333ms stats tick — and a dragged entity's constantly-moving selection readout —
// re-render only the affected text node, never the footer shell (its icons + i18n
// labels + buttons). Field references stay stable when unchanged (see StatsStore),
// so an unchanged field's leaf bails out. Mirrors CursorReadout below.
function FpsValue() {
  const fps = useSyncExternalStore(StatsStore.subscribe, () => StatsStore.getSnapshot().fps);
  return <>{fps}</>;
}

function EntitiesValue() {
  const entities = useSyncExternalStore(StatsStore.subscribe, () => StatsStore.getSnapshot().entities);
  return <>{t('layout.status.entities', { count: entities })}</>;
}

function SelectionReadout() {
  const selection = useSyncExternalStore(StatsStore.subscribe, () => StatsStore.getSnapshot().selection);
  if (!selection) return null;
  return (
    <span className="sitem mono" title={t('layout.status.selectionTooltip')}>
      {selection.x}, {selection.y}{selection.z !== null && `, ${selection.z}`}
      <span className="smute">
        {' · '}
        {selection.tilt !== null && `${selection.tilt.x}, ${selection.tilt.y}, `}
        {selection.rot}°
      </span>
    </span>
  );
}

function VramReadout() {
  const vram = useSyncExternalStore(StatsStore.subscribe, () => StatsStore.getSnapshot().vram);
  if (!vram) return null;
  return (
    <span className="sitem mono" title={t('layout.status.vramTooltip', { count: vram.evictable })}>
      <MemoryStick size={11} strokeWidth={1.85} />
      {formatMb(vram.bytes)}
      <span className="smute">/{formatMb(vram.budget)} MB</span>
    </span>
  );
}

// Only this text node re-renders on mouse move, never the footer.
function CursorReadout() {
  const cursor = useSyncExternalStore(StatsStore.subscribeCursor, StatsStore.getCursor);
  return <>{cursor ? `${cursor.x}, ${cursor.y}` : '—'}</>;
}

/**
 * What the agent is doing, where "what is happening right now" already lives.
 *
 * It reports here rather than only in the drawer because the two minutes an
 * agent works are two minutes you spend watching the VIEWPORT — so progress has
 * to be somewhere you can see with the drawer closed, and Stop has to be within
 * reach without reopening it.
 */
function AgentSegment() {
  const phase = useAgent((s) => s.status.phase);
  const setDrawer = useEditorStore((s) => s.setAgentDrawer);
  if (phase === 'idle') return null;
  const waiting = phase === 'awaiting_confirm';
  return (
    <span className={`sitem ag-seg${waiting ? ' waiting' : ''}`}>
      <button type="button" className="ag-seg-open" onClick={() => setDrawer(true)}>
        {/* The same mark the drawer wears, lit while it works — this strip is
            what you can see with the drawer closed. */}
        <AgentMark size={11} live={!waiting} />
        {waiting ? t('agent.status.awaiting') : t('agent.status.running')}
      </button>
      <button type="button" className="ag-seg-stop" title={t('agent.stop')} onClick={stopAgentTurn}>
        <Square size={9} strokeWidth={2.6} />
        {t('agent.stop')}
      </button>
    </span>
  );
}

// A zoom other than 100% silently changes how much fits on screen, so it has to be
// visible somewhere — else a stray Ctrl+= reads as the editor's layout having broken,
// with nothing on screen to attribute it to. Click to return to 100%.
function ZoomReadout() {
  const zoom = useSettings((s) => s.getValue<number>(UI_SCALE_SETTING));
  if (zoom === ZOOM_DEFAULT) return null;
  return (
    <button
      type="button"
      className="sitem click mono"
      title={t('layout.status.zoomTooltip')}
      onClick={() => setUiZoom(ZOOM_DEFAULT)}
    >
      <Scaling size={11} strokeWidth={1.85} />
      {zoom}%
    </button>
  );
}

// Bottom status strip — live engine telemetry (real FPS / entity count / cursor
// world position) reads in the mono face. Anchors the Content Drawer.
export function StatusBar() {
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const isPaused = useEditorStore((s) => s.isPaused);
  const contentDrawer = useEditorStore((s) => s.contentDrawer);
  const toggleContentDrawer = useEditorStore((s) => s.toggleContentDrawer);
  const selectedIds = useSelection((s) => s.selectedIds);

  return (
    <footer className="status">
      <div className="grp">
        <button
          type="button"
          className={`cb-btn${contentDrawer ? ' active' : ''}`}
          title={t('layout.contentDrawerTooltip')}
          onClick={toggleContentDrawer}
        >
          <FolderOpen size={12} strokeWidth={1.9} />
          {t('layout.contentDrawer')}
        </button>
        <span className="sitem">
          <span className={`sdot${isPlaying ? (isPaused ? ' paused' : ' live') : ''}`} />
          {isPlaying ? (isPaused ? t('layout.status.paused') : t('layout.status.running')) : t('layout.status.editMode')}
        </span>
        <Perf id="statusbar.mods"><SubsystemIndicator /></Perf>
        <span className="sitem">
          {selectedIds.size ? t('layout.status.selected', { count: selectedIds.size }) : t('layout.status.noSelection')}
        </span>
        <SelectionReadout />
        <AgentSegment />
      </div>

      <span className="sp" />

      <span className="sitem mono">
        <MousePointer2 size={11} strokeWidth={1.85} />
        <CursorReadout />
      </span>
      <span className="sitem mono">
        <Gauge size={11} strokeWidth={1.85} /> <FpsValue /> fps
      </span>
      <span className="sitem mono">
        <Boxes size={11} strokeWidth={1.85} /> <EntitiesValue />
      </span>
      <VramReadout />
      <ZoomReadout />
      <span
        className="sitem mono"
        title={t('layout.status.backendTooltip')}
      >
        <Cpu size={11} strokeWidth={1.85} />
        {EngineHost.activeBackend === 'webgpu' ? 'WebGPU' : 'WebGL2'}
      </span>
      <span className="sitem smute">esengine {version}</span>
    </footer>
  );
}
