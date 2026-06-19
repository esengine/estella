import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { Video, Maximize, Sun, Layers, Frame, Loader2, TriangleAlert } from 'lucide-react';
import { useEditorStore } from '@/store/editorStore';
import { EngineHost } from '@/engine/EngineHost';
import { ViewportController } from '@/engine/ViewportController';
import { SceneCommands } from '@/engine/SceneCommands';
import { StatsStore } from '@/engine/StatsStore';
import type { ToolMode } from '@/types';

// Visual manipulation glyph, centered on the selected entity. Functionally we
// only translate (drag-to-move) for now; the glyph reflects the active tool.
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

export function Viewport() {
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const tool = useEditorStore((s) => s.tool);
  const stageRef = useRef<HTMLDivElement>(null);
  const gizmoRef = useRef<HTMLDivElement>(null);
  const selectionRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: number; dx: number; dy: number } | null>(null);
  const engine = useSyncExternalStore(EngineHost.subscribe, EngineHost.getSnapshot);

  // Mount the live engine canvas into the stage; it survives panel re-docking.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    EngineHost.attach(stage);
    StatsStore.start();
    return () => EngineHost.detach();
  }, []);

  // Glue the gizmo to the selected entity's screen position, every frame.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const g = gizmoRef.current;
      const sel = selectionRef.current;
      if (!g || !sel) return;
      const id = useEditorStore.getState().selectedId;
      const ready = EngineHost.getSnapshot().status === 'ready';

      const pos = ready && id != null ? ViewportController.getEntityXY(id) : null;
      const sc = pos ? ViewportController.worldToClient(pos.x, pos.y) : null;
      if (sc) {
        g.style.transform = `translate(${sc.x}px, ${sc.y}px)`;
        g.style.opacity = '1';
      } else {
        g.style.opacity = '0';
      }

      const rect = ready && id != null ? ViewportController.getEntityScreenRect(id) : null;
      if (rect) {
        sel.style.transform = `translate(${rect.x}px, ${rect.y}px)`;
        sel.style.width = `${rect.w}px`;
        sel.style.height = `${rect.h}px`;
        sel.style.opacity = '1';
      } else {
        sel.style.opacity = '0';
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const onPointerDown = (e: ReactPointerEvent) => {
    if (engine.status !== 'ready' || e.button !== 0) return;
    const id = ViewportController.pickEntity(e.clientX, e.clientY);
    useEditorStore.getState().select(id);
    if (id != null) {
      const wp = ViewportController.canvasToWorld(e.clientX, e.clientY);
      const ep = ViewportController.getEntityXY(id);
      if (wp && ep) {
        // Open one gesture for the whole drag; SceneCommands records it on end.
        SceneCommands.beginGesture('Move');
        dragRef.current = { id, dx: ep.x - wp.x, dy: ep.y - wp.y };
        stageRef.current?.setPointerCapture(e.pointerId);
      }
    }
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    const wp = ViewportController.canvasToWorld(e.clientX, e.clientY);
    if (wp) StatsStore.setCursor(wp.x, wp.y);
    const drag = dragRef.current;
    if (drag && wp) SceneCommands.setEntityXY(drag.id, wp.x + drag.dx, wp.y + drag.dy);
  };

  const endDrag = (e: ReactPointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    stageRef.current?.releasePointerCapture(e.pointerId);
    dragRef.current = null;
    // Close the gesture: SceneCommands records the whole drag as one undo step
    // (a no-op if the pointer never moved the entity).
    SceneCommands.endGesture();
  };

  return (
    <div className="viewport">
      <div className="viewport__overlay viewport__overlay--tl">
        <button type="button" className="vchip"><Video size={13} strokeWidth={1.85} /> Perspective: 2D</button>
        <button type="button" className="vchip"><Sun size={13} strokeWidth={1.85} /> Lit</button>
        <button type="button" className="vchip"><Layers size={13} strokeWidth={1.85} /> Show</button>
      </div>

      <div className="viewport__overlay viewport__overlay--tr">
        <button type="button" className="vchip vchip--icon" title="Camera bookmarks"><Frame size={14} strokeWidth={1.85} /></button>
        <button type="button" className="vchip vchip--icon" title="Maximize"><Maximize size={14} strokeWidth={1.85} /></button>
      </div>

      {/* The engine canvas mounts here; pointer events drive pick + drag-move. */}
      <div
        ref={stageRef}
        className="viewport__stage"
        data-engine="esengine.wasm"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={() => StatsStore.clearCursor()}
      />

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

      <div className="viewport__overlay viewport__overlay--bl mono">1920 × 1080 · 100%</div>

      {isPlaying && <div className="viewport__playflag">● PLAY</div>}
    </div>
  );
}
