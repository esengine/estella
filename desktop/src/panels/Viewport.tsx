import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import {
  MousePointer2, Move, RotateCw, Scale3d, Grid3x3, Eye, Magnet, Frame,
  Camera, Loader2, TriangleAlert, type LucideIcon,
} from 'lucide-react';
import { useEditorStore } from '@/store/editorStore';
import { useSelection } from '@/store/selectionStore';
import { commands } from '@/commands';
import { EngineHost } from '@/engine/EngineHost';
import { ViewportController } from '@/engine/ViewportController';
import { SceneCommands } from '@/engine/SceneCommands';
import { SceneQuery } from '@/engine/SceneQuery';
import { SceneModel } from '@/engine/SceneModel';
import { SceneStore } from '@/engine/SceneStore';
import { StatsStore } from '@/engine/StatsStore';
import type { ToolMode } from '@/types';

// Visual manipulation glyph, centered on the selected entity, reflecting the
// active tool. The drag itself (below) now applies move / rotate / scale.
function GizmoGlyph({ tool }: { tool: ToolMode }) {
  if (tool === 'rotate') {
    return (
      <svg width="92" height="92" viewBox="0 0 92 92">
        <circle cx="46" cy="46" r="34" fill="none" stroke="var(--run)" strokeWidth="2" />
        <circle cx="46" cy="12" r="4" fill="var(--run)" />
      </svg>
    );
  }
  if (tool === 'scale') {
    return (
      <svg width="92" height="92" viewBox="0 0 92 92">
        <line x1="46" y1="46" x2="80" y2="46" stroke="var(--error)" strokeWidth="2.5" />
        <rect x="77" y="42" width="8" height="8" fill="var(--error)" />
        <line x1="46" y1="46" x2="46" y2="12" stroke="var(--run)" strokeWidth="2.5" />
        <rect x="42" y="9" width="8" height="8" fill="var(--run)" />
        <rect x="41" y="41" width="10" height="10" fill="var(--star)" />
      </svg>
    );
  }
  if (tool === 'select') {
    return (
      <svg width="92" height="92" viewBox="0 0 92 92">
        <rect x="16" y="16" width="60" height="60" fill="none" stroke="var(--star)" strokeWidth="1.5" strokeDasharray="4 3" />
        {[[16, 16], [76, 16], [16, 76], [76, 76]].map(([x, y]) => (
          <rect key={`${x}-${y}`} x={x - 3} y={y - 3} width="6" height="6" fill="var(--star)" />
        ))}
      </svg>
    );
  }
  return (
    <svg width="92" height="92" viewBox="0 0 92 92">
      <line x1="46" y1="46" x2="82" y2="46" stroke="var(--error)" strokeWidth="2.5" />
      <path d="M82 46 L74 42 L74 50 Z" fill="var(--error)" />
      <line x1="46" y1="46" x2="46" y2="10" stroke="var(--run)" strokeWidth="2.5" />
      <path d="M46 10 L42 18 L50 18 Z" fill="var(--run)" />
      <rect x="41" y="41" width="10" height="10" fill="var(--star)" opacity="0.9" />
    </svg>
  );
}

type Drag =
  | { kind: 'move'; id: number; dx: number; dy: number }
  | { kind: 'rotate'; id: number; cx: number; cy: number; startAngle: number; startRot: number }
  | { kind: 'scale'; id: number; cx: number; cy: number; startDist: number; sx: number; sy: number; sz: number }
  | { kind: 'pan'; px: number; py: number };

const TOOLS: { mode: ToolMode; icon: LucideIcon; label: string; key: string }[] = [
  { mode: 'select', icon: MousePointer2, label: 'Select', key: 'Q' },
  { mode: 'move', icon: Move, label: 'Move', key: 'W' },
  { mode: 'rotate', icon: RotateCw, label: 'Rotate', key: 'E' },
  { mode: 'scale', icon: Scale3d, label: 'Scale', key: 'R' },
];

// Grid/angle/scale increments applied while the Snapping toggle is on. Fixed for
// now — a future Preferences panel will make these user-configurable.
const SNAP_MOVE = 10; // world units per grid step
const SNAP_ROTATE = 15; // degrees
const SNAP_SCALE = 0.1; // uniform scale step
const snap = (v: number, step: number) => Math.round(v / step) * step;

// Entity's screen-center in viewport (client) coordinates.
function entityClientCenter(id: number): { cx: number; cy: number } | null {
  const pos = ViewportController.getEntityXY(id);
  const canvas = EngineHost.canvas;
  if (!pos || !canvas) return null;
  const cv = ViewportController.worldToClient(pos.x, pos.y);
  if (!cv) return null;
  const rect = canvas.getBoundingClientRect();
  return { cx: rect.left + cv.x, cy: rect.top + cv.y };
}

function VBtn({ icon: Icon, label, active, onClick }: { icon: LucideIcon; label: string; active?: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`vbtn${active ? ' is-active' : ''}`} title={label} aria-label={label} aria-pressed={active} onClick={onClick}>
      <Icon size={14} strokeWidth={1.9} />
    </button>
  );
}

export function Viewport() {
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const tool = useEditorStore((s) => s.tool);
  const showGrid = useEditorStore((s) => s.showGrid);
  const showGizmos = useEditorStore((s) => s.showGizmos);
  const snapping = useEditorStore((s) => s.snapping);

  const stageRef = useRef<HTMLDivElement>(null);
  const gizmoRef = useRef<HTMLDivElement>(null);
  const selectionRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const [zoomPct, setZoomPct] = useState(100);
  const engine = useSyncExternalStore(EngineHost.subscribe, EngineHost.getSnapshot);

  // Scene cameras don't render in edit mode (the viewport is the editor camera),
  // so draw each as a gizmo (icon + authored view rect). The id set updates on
  // structural change; the rAF below positions them every frame.
  const structRev = useSyncExternalStore(SceneStore.subscribe, SceneStore.getStructureRevision);
  const camRefs = useRef(new Map<number, HTMLDivElement | null>());
  const camIds = useMemo(
    () => (engine.status === 'ready' ? ViewportController.cameraIds() : []),
    [structRev, engine.status],
  );

  // Mount the live engine canvas into the stage; it survives panel re-docking.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    EngineHost.attach(stage);
    StatsStore.start();
    return () => EngineHost.detach();
  }, []);

  // Wheel = zoom about the view (native non-passive listener so we can preventDefault).
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const orthoFactor = e.deltaY > 0 ? 1.1 : 1 / 1.1; // larger orthoSize = zoom out
      ViewportController.zoomBy(orthoFactor);
      setZoomPct((z) => Math.max(10, Math.min(800, Math.round(z / orthoFactor))));
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, []);

  // Glue the gizmo + selection outline to the selected entity, every frame.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const g = gizmoRef.current;
      const sel = selectionRef.current;
      if (!g || !sel) return;
      // Selection is a source id; the gizmo/outline reads World geometry, so
      // resolve it to the runtime entity (absent if not currently spawned).
      const sid = useSelection.getState().selectedId;
      const rt = sid != null ? SceneModel.runtimeFor(sid) : undefined;
      const ready = EngineHost.getSnapshot().status === 'ready';
      const showG = useEditorStore.getState().showGizmos;

      const pos = ready && rt != null ? ViewportController.getEntityXY(rt) : null;
      const sc = pos ? ViewportController.worldToClient(pos.x, pos.y) : null;
      if (sc && showG) {
        g.style.transform = `translate(${sc.x}px, ${sc.y}px)`;
        g.style.opacity = '1';
      } else {
        g.style.opacity = '0';
      }

      const rect = ready && rt != null ? ViewportController.getEntityScreenRect(rt) : null;
      if (rect) {
        sel.style.transform = `translate(${rect.x}px, ${rect.y}px)`;
        sel.style.width = `${rect.w}px`;
        sel.style.height = `${rect.h}px`;
        sel.style.opacity = '1';
      } else {
        sel.style.opacity = '0';
      }

      // Scene-camera gizmos — only in edit mode (in play the viewport IS the
      // game camera), and only when gizmos are on.
      const camsOn = ready && showG && !useEditorStore.getState().isPlaying;
      for (const [cid, wrap] of camRefs.current) {
        if (!wrap) continue;
        const cg = camsOn ? ViewportController.getCameraGizmo(cid) : null;
        if (cg) {
          wrap.style.opacity = '1';
          const icon = wrap.firstElementChild as HTMLElement | null;
          const rectEl = wrap.lastElementChild as HTMLElement | null;
          if (icon) icon.style.transform = `translate(${cg.cx}px, ${cg.cy}px)`;
          if (rectEl) {
            rectEl.style.transform = `translate(${cg.rect.x}px, ${cg.rect.y}px)`;
            rectEl.style.width = `${cg.rect.w}px`;
            rectEl.style.height = `${cg.rect.h}px`;
          }
        } else {
          wrap.style.opacity = '0';
        }
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const onPointerDown = (e: ReactPointerEvent) => {
    if (engine.status !== 'ready') return;

    // Middle / right drag = pan the view.
    if (e.button === 1 || e.button === 2) {
      e.preventDefault();
      dragRef.current = { kind: 'pan', px: e.clientX, py: e.clientY };
      stageRef.current?.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0) return;

    // Pick returns a runtime World entity (rendering domain); the editor selects
    // and commands by stable source id. Resolve once: source id drives selection
    // + SceneCommands; the runtime id drives ViewportController screen geometry.
    const rtId = ViewportController.pickEntity(e.clientX, e.clientY);
    const sourceId = rtId != null ? SceneModel.sourceFor(rtId) ?? null : null;
    useSelection.getState().select(sourceId);
    if (rtId == null || sourceId == null) return;

    if (tool === 'rotate') {
      const c = entityClientCenter(rtId);
      const startRot = (SceneQuery.getFieldValue(sourceId, 'Transform', 'rotation') as number) ?? 0;
      if (!c) return;
      SceneCommands.beginGesture('Rotate');
      dragRef.current = {
        kind: 'rotate', id: sourceId, cx: c.cx, cy: c.cy,
        startAngle: Math.atan2(e.clientY - c.cy, e.clientX - c.cx), startRot,
      };
      stageRef.current?.setPointerCapture(e.pointerId);
    } else if (tool === 'scale') {
      const c = entityClientCenter(rtId);
      const s = (SceneQuery.getFieldValue(sourceId, 'Transform', 'scale') as number[]) ?? [1, 1, 1];
      if (!c) return;
      SceneCommands.beginGesture('Scale');
      dragRef.current = {
        kind: 'scale', id: sourceId, cx: c.cx, cy: c.cy,
        startDist: Math.max(1, Math.hypot(e.clientX - c.cx, e.clientY - c.cy)),
        sx: s[0] ?? 1, sy: s[1] ?? 1, sz: s[2] ?? 1,
      };
      stageRef.current?.setPointerCapture(e.pointerId);
    } else {
      const wp = ViewportController.canvasToWorld(e.clientX, e.clientY);
      const ep = ViewportController.getEntityXY(rtId);
      if (wp && ep) {
        SceneCommands.beginGesture('Move');
        dragRef.current = { kind: 'move', id: sourceId, dx: ep.x - wp.x, dy: ep.y - wp.y };
        stageRef.current?.setPointerCapture(e.pointerId);
      }
    }
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    const wp = ViewportController.canvasToWorld(e.clientX, e.clientY);
    if (wp) StatsStore.setCursor(wp.x, wp.y);
    const drag = dragRef.current;
    if (!drag) return;
    const snapOn = useEditorStore.getState().snapping;

    if (drag.kind === 'pan') {
      ViewportController.panByClient(drag.px, drag.py, e.clientX, e.clientY);
      drag.px = e.clientX;
      drag.py = e.clientY;
    } else if (drag.kind === 'move') {
      if (wp) {
        let x = wp.x + drag.dx;
        let y = wp.y + drag.dy;
        if (snapOn) { x = snap(x, SNAP_MOVE); y = snap(y, SNAP_MOVE); }
        SceneCommands.setEntityXY(drag.id, x, y);
      }
    } else if (drag.kind === 'rotate') {
      const angle = Math.atan2(e.clientY - drag.cy, e.clientX - drag.cx);
      const deltaDeg = ((angle - drag.startAngle) * 180) / Math.PI;
      // Screen y is down, so a clockwise screen drag is a negative world rotation.
      let rot = drag.startRot - deltaDeg;
      if (snapOn) rot = snap(rot, SNAP_ROTATE);
      SceneCommands.setField(drag.id, 'Transform', 'rotation', 'angle', rot);
    } else if (drag.kind === 'scale') {
      const dist = Math.hypot(e.clientX - drag.cx, e.clientY - drag.cy);
      const f = dist / drag.startDist;
      let sx = drag.sx * f;
      let sy = drag.sy * f;
      if (snapOn) { sx = snap(sx, SNAP_SCALE); sy = snap(sy, SNAP_SCALE); }
      SceneCommands.setField(drag.id, 'Transform', 'scale', 'vec3', [sx, sy, drag.sz]);
    }
  };

  const endDrag = (e: ReactPointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    stageRef.current?.releasePointerCapture(e.pointerId);
    dragRef.current = null;
    // Camera pan is a direct view write (no undo); edits close their gesture.
    if (drag.kind !== 'pan') SceneCommands.endGesture();
  };

  return (
    <div className="viewport">
      <div className="viewport__toolbar">
        {TOOLS.map((t) => (
          <VBtn key={t.mode} icon={t.icon} label={`${t.label}  (${t.key})`} active={tool === t.mode} onClick={() => commands.run(`tool.${t.mode}`)} />
        ))}
        <span className="viewport__toolbar-div" />
        <VBtn icon={Grid3x3} label="Show Grid" active={showGrid} onClick={() => commands.run('view.toggleGrid')} />
        <VBtn icon={Eye} label="Show Gizmos" active={showGizmos} onClick={() => commands.run('view.toggleGizmos')} />
        <VBtn icon={Magnet} label="Snapping" active={snapping} onClick={() => commands.run('view.toggleSnapping')} />
        <span className="viewport__toolbar-div" />
        <VBtn icon={Frame} label="Frame Selected  (F)" onClick={() => commands.run('view.frameSelected')} />
      </div>

      {/* The engine canvas mounts here; pointer events drive pick + transform + pan. */}
      <div
        ref={stageRef}
        className="viewport__stage"
        data-engine="esengine.wasm"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={() => StatsStore.clearCursor()}
        onContextMenu={(e) => e.preventDefault()}
      />

      {/* Scene-camera gizmos (icon + authored view rect); positioned by the rAF. */}
      {camIds.map((id) => (
        <div
          key={id}
          ref={(el) => {
            if (el) camRefs.current.set(id, el);
            else camRefs.current.delete(id);
          }}
          className="viewport__cam-gizmo"
          aria-hidden="true"
        >
          <Camera className="viewport__cam-icon" size={15} strokeWidth={1.75} />
          <div className="viewport__cam-rect" />
        </div>
      ))}

      <div ref={selectionRef} className="viewport__selection" aria-hidden="true" />

      <div ref={gizmoRef} className="viewport__gizmo" aria-hidden="true">
        <GizmoGlyph tool={tool} />
      </div>

      {engine.status !== 'ready' && (
        <div className="viewport__status">
          {engine.status === 'error' ? (
            <div className="viewport__status-card viewport__status-card--error">
              <TriangleAlert size={22} strokeWidth={1.6} />
              <div>
                <strong>Engine failed to start</strong>
                <p className="mono">{engine.error}</p>
              </div>
            </div>
          ) : (
            <div className="viewport__status-card">
              <Loader2 size={20} strokeWidth={2} className="spin" />
              <span>Booting esengine…</span>
            </div>
          )}
        </div>
      )}

      <div className="viewport__overlay viewport__overlay--bl mono">{zoomPct}%</div>

      {isPlaying && <div className="viewport__playflag">● PLAY</div>}
    </div>
  );
}
