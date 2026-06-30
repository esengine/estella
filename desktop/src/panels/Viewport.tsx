// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { PointerEvent as ReactPointerEvent, DragEvent as ReactDragEvent, ReactNode } from 'react';
import {
  MousePointer2, Move, RotateCw, Scale3d, Grid3x3, Eye, Frame,
  Camera, Check, ChevronDown, Loader2, TriangleAlert, Lightbulb, type LucideIcon,
} from 'lucide-react';
import { useEditorStore } from '@/store/editorStore';
import { useSelection } from '@/store/selectionStore';
import { useTilemapPaint } from '@/store/tilemapPaintStore';
import { commands } from '@/commands';
import { EngineHost } from '@/engine/EngineHost';
import { PlayRealm } from '@/engine/PlayRealm';
import { ViewportController } from '@/engine/ViewportController';
import { ProjectStore } from '@/project/ProjectStore';
import { IMAGE_RE } from '@/project/assetMeta';
import { SceneModel } from '@/engine/SceneModel';
import { SceneStore } from '@/engine/SceneStore';
import { StatsStore } from '@/engine/StatsStore';
import type { ToolMode } from '@/types';
import { resolveActiveTool, type EditorTool, type ToolContext, type PointerInput } from '@/tools';
import { cursorTile } from '@/tools/tileTools';
import { GIZMO, type GizmoAxis } from '@/tools/gizmo';
import { Marquee } from '@/tools/marquee';

// A React pointer event → the tool-facing PointerInput (no DOM coupling in tools).
const toInput = (e: ReactPointerEvent): PointerInput => ({
  clientX: e.clientX, clientY: e.clientY, pointerId: e.pointerId,
  button: e.button, shift: e.shiftKey, alt: e.altKey,
});

// The interactive transform gizmo, drawn from the origin (= the selection pivot, the
// wrapper is translated there each frame). Its geometry mirrors the hit zones in
// gizmo.ts (GIZMO constants) so the handles a user aims at are the handles the tool
// hit-tests. Screen y is down, so the world +Y handle points up (negative y). Only
// move/rotate/scale render a gizmo; the select tool shows just the selection outline.
function GizmoOverlay({ tool, active }: { tool: ToolMode; active: GizmoAxis | null }) {
  const L = GIZMO.axisLen;
  const B = GIZMO.boxSize;
  const P = GIZMO.planeSize;
  // The grabbed handle reads "hot": a thicker stroke + full-opacity fill, so the
  // drag has the visual confirmation UE/Unity give. Axes light independently; the
  // center plane lights on the 'xy' (uniform) handle.
  const onX = active === 'x';
  const onY = active === 'y';
  const onXY = active === 'xy';
  const axW = (on: boolean) => (on ? 4 : 2.5);
  const planeOp = (on: boolean) => (on ? 1 : 0.85);
  if (tool === 'rotate') {
    return (
      <svg className="gizmo-svg" width="0" height="0" overflow="visible">
        <circle cx="0" cy="0" r={GIZMO.ringRadius} fill="none" stroke="var(--run)" strokeWidth={active ? 3.5 : 2} />
        <circle cx="0" cy="0" r="2.5" fill="var(--star)" />
      </svg>
    );
  }
  if (tool === 'scale') {
    return (
      <svg className="gizmo-svg" width="0" height="0" overflow="visible">
        <line x1="0" y1="0" x2={L} y2="0" stroke="var(--error)" strokeWidth={axW(onX)} />
        <rect x={L - B / 2} y={-B / 2} width={B} height={B} fill="var(--error)" opacity={onX ? 1 : 0.95} />
        <line x1="0" y1="0" x2="0" y2={-L} stroke="var(--run)" strokeWidth={axW(onY)} />
        <rect x={-B / 2} y={-L - B / 2} width={B} height={B} fill="var(--run)" opacity={onY ? 1 : 0.95} />
        <rect x={-P / 2} y={-P / 2} width={P} height={P} fill="var(--star)" opacity={planeOp(onXY)} />
      </svg>
    );
  }
  // move (and any other) → axis arrows + a center plane square
  return (
    <svg className="gizmo-svg" width="0" height="0" overflow="visible">
      <line x1="0" y1="0" x2={L} y2="0" stroke="var(--error)" strokeWidth={axW(onX)} />
      <path d={`M${L} 0 L${L - 9} -4 L${L - 9} 4 Z`} fill="var(--error)" opacity={onX ? 1 : 0.95} />
      <line x1="0" y1="0" x2="0" y2={-L} stroke="var(--run)" strokeWidth={axW(onY)} />
      <path d={`M0 ${-L} L-4 ${-L + 9} L4 ${-L + 9} Z`} fill="var(--run)" opacity={onY ? 1 : 0.95} />
      <rect x={-P / 2} y={-P / 2} width={P} height={P} fill="var(--star)" opacity={planeOp(onXY)} />
    </svg>
  );
}

const TOOLS: { mode: ToolMode; icon: LucideIcon; label: string; key: string }[] = [
  { mode: 'select', icon: MousePointer2, label: 'Select', key: 'Q' },
  { mode: 'move', icon: Move, label: 'Move', key: 'W' },
  { mode: 'rotate', icon: RotateCw, label: 'Rotate', key: 'E' },
  { mode: 'scale', icon: Scale3d, label: 'Scale', key: 'R' },
];

// Increments offered by the viewport Snap dropdown: move (world units), rotate
// (degrees), scale (factor). All gated by the single `snapping` master toggle.
const SNAP_STEPS = [16, 32, 64];
const SNAP_ANGLES = [5, 15, 45, 90];
const SNAP_SCALES = [0.1, 0.25, 0.5];

// One-line hint shown under the coord readout, reflecting the active tool.
const TOOL_HINT: Record<ToolMode, string> = {
  select: 'Click to select · Shift adds · drag empty to box-select',
  move: 'Drag a gizmo axis or the body · Alt-drag duplicates · arrows nudge',
  rotate: 'Drag the ring to rotate the selection',
  scale: 'Drag a handle for per-axis scale · center for uniform',
};

function OvTool({
  icon: Icon,
  label,
  kbd,
  active,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  kbd?: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`ovbtn ov-tool${active ? ' active' : ''}`}
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
    >
      <Icon size={14} strokeWidth={1.9} />
      {kbd && <kbd>{kbd}</kbd>}
    </button>
  );
}

// A viewport overlay dropdown (UE5 "show flags" / "snap" menus): an .ovbtn
// trigger with an icon, a label, and a chevron, plus a floating .dd-menu.
// Closes on outside-click or after an item is chosen (the menu's onClick).
function OvDropdown({
  icon: Icon,
  label,
  align,
  title,
  children,
}: {
  icon: LucideIcon;
  label: ReactNode;
  align?: 'r';
  title?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);
  return (
    <div className={`dd${open ? ' open' : ''}`} ref={ref}>
      <button
        type="button"
        className={`ovbtn${open ? ' open' : ''}`}
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon className="ic" size={13} strokeWidth={1.9} />
        {label}
        <ChevronDown className="cv" size={9} strokeWidth={2.5} />
      </button>
      {/* Item clicks bubble here to dismiss; each item runs its own handler. */}
      <div className={`dd-menu${align === 'r' ? ' r' : ''}`} role="menu" onClick={() => setOpen(false)}>
        {children}
      </div>
    </div>
  );
}

// Multi-toggle menu row (checkbox box) — for the Show Flags menu.
function DdCheck({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <div className={`dd-item${on ? ' on' : ''}`} role="menuitemcheckbox" aria-checked={on} onClick={onClick}>
      <span className="chk">{on && <Check size={8} strokeWidth={3.5} />}</span>
      <span className="l">{label}</span>
    </div>
  );
}

// Single-select menu row (tick mark, shown when active) — for the Snap menu.
function DdRadio({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <div className={`dd-item${on ? ' on' : ''}`} role="menuitemradio" aria-checked={on} onClick={onClick}>
      <span className="tk"><Check size={11} strokeWidth={3} /></span>
      <span className="l">{label}</span>
    </div>
  );
}

export function Viewport() {
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const playTarget = useEditorStore((s) => s.playTarget);
  const tool = useEditorStore((s) => s.tool);
  const showGrid = useEditorStore((s) => s.showGrid);
  const showGizmos = useEditorStore((s) => s.showGizmos);
  const showColliders = useEditorStore((s) => s.showColliders);
  const activeGizmoAxis = useEditorStore((s) => s.activeGizmoAxis);
  const snapping = useEditorStore((s) => s.snapping);
  const snapStep = useEditorStore((s) => s.snapStep);
  const snapAngle = useEditorStore((s) => s.snapAngle);
  const snapScale = useEditorStore((s) => s.snapScale);
  const selCount = useSelection((s) => s.selectedIds.size);
  // The set of selected source ids — drives one selection outline per entity. The
  // Set is replaced (not mutated) on every selection change, so this re-renders.
  const selectedIds = useSelection((s) => s.selectedIds);
  const primaryId = useSelection((s) => s.selectedId);
  const selList = useMemo(() => [...selectedIds], [selectedIds]);

  const stageRef = useRef<HTMLDivElement>(null);
  const playHostRef = useRef<HTMLDivElement>(null);
  const gizmoRef = useRef<HTMLDivElement>(null);
  // One outline div per selected entity, keyed by source id and positioned by the rAF.
  const selRefs = useRef(new Map<number, HTMLDivElement | null>());
  const marqueeRef = useRef<HTMLDivElement>(null);
  const tileSelRef = useRef<HTMLDivElement>(null);
  const tilePreviewRef = useRef<HTMLDivElement>(null);
  const hoverTileRef = useRef<{ x: number; y: number } | null>(null);
  // Camera pan (middle/right drag) is built-in navigation, separate from tools.
  const panRef = useRef<{ px: number; py: number } | null>(null);
  // The tool that owns the in-progress left-button stroke (move/up route to it).
  const activeToolRef = useRef<EditorTool | null>(null);
  // Host services handed to tools during a stroke; stable across renders.
  const toolCtx = useMemo<ToolContext>(() => ({
    capture: (id) => stageRef.current?.setPointerCapture(id),
    release: (id) => stageRef.current?.releasePointerCapture(id),
  }), []);
  const [zoomPct, setZoomPct] = useState(100);
  const engine = useSyncExternalStore(EngineHost.subscribe, EngineHost.getSnapshot);
  const realm = useSyncExternalStore(PlayRealm.subscribe, PlayRealm.getSnapshot);
  // Sampled a few times a second (not per frame) — drives the corner HUD.
  const stats = useSyncExternalStore(StatsStore.subscribe, StatsStore.getSnapshot);

  // Scene cameras don't render in edit mode (the viewport is the editor camera),
  // so draw each as a gizmo (icon + authored view rect). The id set updates on
  // structural change; the rAF below positions them every frame.
  const structRev = useSyncExternalStore(SceneStore.subscribe, SceneStore.getStructureRevision);
  const camRefs = useRef(new Map<number, HTMLDivElement | null>());
  const camIds = useMemo(
    () => (engine.status === 'ready' ? ViewportController.cameraIds() : []),
    [structRev, engine.status],
  );
  // Light2D entities don't render in edit mode — draw each as a gizmo (icon + reach
  // circle + direction), positioned by the same per-frame rAF as the camera gizmos.
  const lightRefs = useRef(new Map<number, HTMLDivElement | null>());
  const lightIds = useMemo(
    () => (engine.status === 'ready' ? ViewportController.light2DIds() : []),
    [structRev, engine.status],
  );
  // Physics colliders aren't drawn by the renderer — outline each (box polygon /
  // circle) as a gizmo so you can see/tune collider shapes without entering Play.
  const colliderRefs = useRef(new Map<number, SVGSVGElement | null>());
  const colliderIds = useMemo(
    () => (engine.status === 'ready' && showColliders ? ViewportController.colliderIds() : []),
    [structRev, engine.status, showColliders],
  );

  // Mount the live engine canvas into the stage; it survives panel re-docking.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    EngineHost.attach(stage);
    StatsStore.start();
    return () => EngineHost.detach();
  }, []);

  // Drive the engine's world-space editor grid from Show-Flags (Grid) + Snap
  // step. Re-applied when the engine becomes ready, since the grid resource
  // exists only after boot. Play/edit gating lives in the renderer (EditorView).
  useEffect(() => {
    if (engine.status !== 'ready') return;
    EngineHost.setGrid(showGrid, snapStep);
  }, [showGrid, snapStep, engine.status]);

  // Play In Viewport (UE5 PIE): host the realm iframe over the stage while playing
  // here; App.start() already booted the realm — we just re-parent its iframe.
  const playInViewport = isPlaying && playTarget === 'viewport';
  useEffect(() => {
    if (!playInViewport) return;
    const host = playHostRef.current;
    if (host) PlayRealm.attach(host);
    return () => PlayRealm.detach();
  }, [playInViewport]);

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

  // Glue the gizmo (at the selection pivot), the per-entity outlines, and the
  // marquee box to the World, every frame.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const g = gizmoRef.current;
      if (!g) return;
      const ready = EngineHost.getSnapshot().status === 'ready';
      const showG = useEditorStore.getState().showGizmos;
      const toolMode = useEditorStore.getState().tool;

      // Per-entity selection outlines (one div per selected source id).
      let sumX = 0;
      let sumY = 0;
      let nPos = 0;
      for (const [sid, el] of selRefs.current) {
        if (!el) continue;
        const rt = ready ? SceneModel.runtimeFor(sid) : undefined;
        const rect = rt != null ? ViewportController.getEntityScreenRect(rt) : null;
        if (rect) {
          el.style.transform = `translate(${rect.x}px, ${rect.y}px)`;
          el.style.width = `${rect.w}px`;
          el.style.height = `${rect.h}px`;
          el.style.opacity = '1';
          const pos = ViewportController.getEntityXY(rt!);
          if (pos) {
            sumX += pos.x;
            sumY += pos.y;
            nPos += 1;
          }
        } else {
          el.style.opacity = '0';
        }
      }

      // The transform gizmo sits at the selection pivot (centroid), and only for the
      // move/rotate/scale tools — the select tool shows just the outline.
      const pivot = nPos > 0 ? ViewportController.worldToClient(sumX / nPos, sumY / nPos) : null;
      if (pivot && showG && toolMode !== 'select') {
        g.style.transform = `translate(${pivot.x}px, ${pivot.y}px)`;
        g.style.opacity = '1';
      } else {
        g.style.opacity = '0';
      }

      // Marquee box (set by the transform tool's box-select drag).
      const mq = marqueeRef.current;
      if (mq) {
        const r = Marquee.get();
        if (r) {
          mq.style.transform = `translate(${r.x}px, ${r.y}px)`;
          mq.style.width = `${r.w}px`;
          mq.style.height = `${r.h}px`;
          mq.style.opacity = '1';
        } else {
          mq.style.opacity = '0';
        }
      }

      // Tile-select marquee: an axis-aligned rect over the selected TilemapLayer's
      // chosen tile range, in screen space (its world corners projected each frame).
      // Tilemap paint targets the primary entity, so resolve just that one here.
      const ts = tileSelRef.current;
      if (ts) {
        const sid = useSelection.getState().selectedId;
        const rt = ready && sid != null ? SceneModel.runtimeFor(sid) : undefined;
        const paint = useTilemapPaint.getState();
        const tsel = paint.tool === 'select' ? paint.selection : null;
        const layer = ready && sid != null
          ? SceneModel.entityBySource(sid)?.components.find((c) => c.type === 'TilemapLayer')
          : undefined;
        const cs = layer?.data as { cellSize?: { x: number; y: number } } | undefined;
        const origin = ready && rt != null ? ViewportController.getEntityXY(rt) : null;
        if (tsel && cs?.cellSize && origin) {
          const x0 = Math.min(tsel.x0, tsel.x1);
          const y0 = Math.min(tsel.y0, tsel.y1);
          const x1 = Math.max(tsel.x0, tsel.x1);
          const y1 = Math.max(tsel.y0, tsel.y1);
          const tl = ViewportController.worldToClient(origin.x + x0 * cs.cellSize.x, origin.y - y0 * cs.cellSize.y);
          const br = ViewportController.worldToClient(origin.x + (x1 + 1) * cs.cellSize.x, origin.y - (y1 + 1) * cs.cellSize.y);
          if (tl && br) {
            ts.style.transform = `translate(${tl.x}px, ${tl.y}px)`;
            ts.style.width = `${br.x - tl.x}px`;
            ts.style.height = `${br.y - tl.y}px`;
            ts.style.opacity = '1';
          } else {
            ts.style.opacity = '0';
          }
        } else {
          ts.style.opacity = '0';
        }

        // Brush footprint preview: a ghost rect at the hovered tile sized to the active
        // stamp (1×1 for erase/bucket/terrain), so painting isn't blind.
        const pv = tilePreviewRef.current;
        if (pv) {
          const FOOT: Record<string, boolean> = { brush: true, erase: true, bucket: true, terrain: true };
          const hov = hoverTileRef.current;
          const showFoot = paint.tool != null && FOOT[paint.tool] && hov && cs?.cellSize && origin;
          if (showFoot && hov && cs?.cellSize && origin) {
            const fw = paint.tool === 'brush' ? paint.stamp.w : 1;
            const fh = paint.tool === 'brush' ? paint.stamp.h : 1;
            const tl = ViewportController.worldToClient(origin.x + hov.x * cs.cellSize.x, origin.y - hov.y * cs.cellSize.y);
            const br = ViewportController.worldToClient(origin.x + (hov.x + fw) * cs.cellSize.x, origin.y - (hov.y + fh) * cs.cellSize.y);
            if (tl && br) {
              pv.style.transform = `translate(${tl.x}px, ${tl.y}px)`;
              pv.style.width = `${br.x - tl.x}px`;
              pv.style.height = `${br.y - tl.y}px`;
              pv.style.opacity = '1';
            } else {
              pv.style.opacity = '0';
            }
          } else {
            pv.style.opacity = '0';
          }
        }
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

      // Collider gizmos — box polygon / circle outline at the collider's shape.
      for (const [cid, svg] of colliderRefs.current) {
        if (!svg) continue;
        const cg = camsOn ? ViewportController.getColliderGizmo(cid) : null;
        const poly = svg.querySelector('.cl-box') as SVGPolygonElement | null;
        const circ = svg.querySelector('.cl-circle') as SVGCircleElement | null;
        if (cg && cg.kind === 'box' && poly) {
          poly.setAttribute('points', cg.pts.map((p) => `${p.x},${p.y}`).join(' '));
          poly.style.opacity = '1';
          if (circ) circ.style.opacity = '0';
        } else if (cg && cg.kind === 'circle' && circ) {
          circ.setAttribute('cx', String(cg.cx));
          circ.setAttribute('cy', String(cg.cy));
          circ.setAttribute('r', String(cg.r));
          circ.style.opacity = '1';
          if (poly) poly.style.opacity = '0';
        } else {
          if (poly) poly.style.opacity = '0';
          if (circ) circ.style.opacity = '0';
        }
      }

      // Light2D gizmos — icon at the light, dashed reach circle (Point/Spot), direction
      // line (Directional/Spot), all tinted by the light color. Edit mode + gizmos on.
      for (const [lid, wrap] of lightRefs.current) {
        if (!wrap) continue;
        const lg = camsOn ? ViewportController.getLightGizmo(lid) : null;
        if (lg) {
          wrap.style.opacity = '1';
          wrap.style.color = lg.color;
          wrap.style.transform = `translate(${lg.cx}px, ${lg.cy}px)`;
          const circle = wrap.querySelector('.lg-radius') as SVGCircleElement | null;
          if (circle) {
            circle.setAttribute('r', String(lg.radiusPx));
            circle.style.opacity = lg.radiusPx > 0 ? '0.6' : '0';
          }
          const dir = wrap.querySelector('.lg-dir') as SVGLineElement | null;
          if (dir) {
            const hasDir = lg.sdx !== 0 || lg.sdy !== 0;
            const len = lg.kind === 3 ? Math.max(lg.radiusPx, 28) : 38;
            dir.setAttribute('x2', String(lg.sdx * len));
            dir.setAttribute('y2', String(lg.sdy * len));
            dir.style.opacity = hasDir ? '0.9' : '0';
          }
          // Spot (kind 3): two cone-edge lines at ±half-angle around the aim, out to the reach.
          const cone1 = wrap.querySelector('.lg-cone1') as SVGLineElement | null;
          const cone2 = wrap.querySelector('.lg-cone2') as SVGLineElement | null;
          for (const [line, sign] of [[cone1, 1], [cone2, -1]] as const) {
            if (!line) continue;
            if (lg.kind === 3 && (lg.sdx !== 0 || lg.sdy !== 0)) {
              const a = sign * lg.coneHalf;
              const ca = Math.cos(a);
              const sa = Math.sin(a);
              const ex = (lg.sdx * ca - lg.sdy * sa) * lg.radiusPx;
              const ey = (lg.sdx * sa + lg.sdy * ca) * lg.radiusPx;
              line.setAttribute('x2', String(ex));
              line.setAttribute('y2', String(ey));
              line.style.opacity = '0.55';
            } else {
              line.style.opacity = '0';
            }
          }
        } else {
          wrap.style.opacity = '0';
        }
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Esc cancels an in-progress stroke (revert the live drag via the tool's
  // transaction) instead of deselecting. Capture phase so it pre-empts the global
  // Esc→deselect command; a no-op when no stroke is active (deselect then runs).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (activeToolRef.current) {
        activeToolRef.current.cancel?.(toolCtx);
        activeToolRef.current = null;
        e.stopImmediatePropagation();
      } else if (panRef.current) {
        panRef.current = null;
        e.stopImmediatePropagation();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [toolCtx]);

  const onPointerDown = (e: ReactPointerEvent) => {
    if (engine.status !== 'ready') return;

    // Middle / right drag = pan the view (camera navigation, always available
    // regardless of the active tool).
    if (e.button === 1 || e.button === 2) {
      e.preventDefault();
      panRef.current = { px: e.clientX, py: e.clientY };
      stageRef.current?.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0) return;

    // Left button → the active tool owns the stroke (resolveActiveTool picks the
    // tilemap paint tool over a selected layer, else the transform tool).
    const t = resolveActiveTool();
    if (t.onPointerDown(toInput(e), toolCtx)) {
      e.preventDefault();
      activeToolRef.current = t;
    } else {
      activeToolRef.current = null;
    }
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    const wp = ViewportController.canvasToWorld(e.clientX, e.clientY);
    if (wp) StatsStore.setCursor(wp.x, wp.y);

    if (panRef.current) {
      ViewportController.panByClient(panRef.current.px, panRef.current.py, e.clientX, e.clientY);
      panRef.current.px = e.clientX;
      panRef.current.py = e.clientY;
      return;
    }
    // Track the hovered tile for the brush preview (only over the selected TilemapLayer
    // with a paint tool active; the rAF draws the footprint).
    const sid = useTilemapPaint.getState().tool ? useSelection.getState().selectedId : null;
    const isTm = sid != null
      && !!SceneModel.entityBySource(sid)?.components.some((c) => c.type === 'TilemapLayer');
    hoverTileRef.current = sid != null && isTm ? cursorTile(e.clientX, e.clientY, sid) : null;

    activeToolRef.current?.onPointerMove(toInput(e), toolCtx);
  };

  const endDrag = (e: ReactPointerEvent) => {
    if (panRef.current) {
      stageRef.current?.releasePointerCapture(e.pointerId);
      panRef.current = null;
      return;
    }
    const t = activeToolRef.current;
    if (!t) return;
    activeToolRef.current = null;
    t.onPointerUp(toInput(e), toolCtx);
  };

  // Drag an asset from the Content Browser into the scene → place it at the drop
  // point (one undoable step): a `.esprefab` instantiates the prefab; an image
  // spawns a Sprite entity sized to the texture.
  const isAssetDrag = (e: ReactDragEvent) =>
    e.dataTransfer.types.includes('application/x-estella-asset');

  const onDragOver = (e: ReactDragEvent) => {
    if (!isAssetDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const onDrop = (e: ReactDragEvent) => {
    const path = e.dataTransfer.getData('application/x-estella-asset');
    if (!path) return;
    const wp = ViewportController.canvasToWorld(e.clientX, e.clientY);
    if (path.toLowerCase().endsWith('.esprefab')) {
      e.preventDefault();
      // Place at the drop point; fall back to the prefab's authored origin if it
      // can't be resolved (position omitted).
      void ProjectStore.instantiatePrefabFromPath(path, null, wp ?? undefined);
    } else if (IMAGE_RE.test(path)) {
      e.preventDefault();
      void ProjectStore.instantiateSpriteFromPath(path, wp ?? { x: 0, y: 0 });
    }
  };

  return (
    <div className="viewport">
      {/* Top-left: view menus (UE5 layout) — Show Flags dropdown + Frame. */}
      <div className="ov ov-tl">
        <div className="ov-cluster">
          <OvDropdown icon={Eye} label="Show" title="Show Flags">
            <div className="dd-lbl">Show Flags</div>
            <DdCheck on={showGrid} label="Grid" onClick={() => commands.run('view.toggleGrid')} />
            <DdCheck on={showGizmos} label="Gizmos" onClick={() => commands.run('view.toggleGizmos')} />
            <DdCheck on={showColliders} label="Colliders" onClick={() => commands.run('view.toggleColliders')} />
          </OvDropdown>
          <span className="ov-divider" />
          <OvTool icon={Frame} label="Frame Selected  (F)" kbd="F" onClick={() => commands.run('view.frameSelected')} />
        </div>
      </div>

      {/* Top-right: transform tools (UE5 moved gizmo tools here) + Snap. */}
      <div className="ov ov-tr">
        <div className="ov-cluster">
          {TOOLS.map((t) => (
            <OvTool
              key={t.mode}
              icon={t.icon}
              label={`${t.label}  (${t.key})`}
              kbd={t.key}
              active={tool === t.mode}
              onClick={() => commands.run(`tool.${t.mode}`)}
            />
          ))}
          <span className="ov-divider" />
          <OvDropdown
            icon={Grid3x3}
            label={<span className="val">{snapping ? snapStep : 'Off'}</span>}
            align="r"
            title="Grid Snap"
          >
            <DdRadio on={!snapping} label="Off" onClick={() => useEditorStore.setState({ snapping: false })} />
            <div className="dd-lbl">Move (units)</div>
            {SNAP_STEPS.map((s) => (
              <DdRadio
                key={s}
                on={snapping && snapStep === s}
                label={String(s)}
                onClick={() => useEditorStore.getState().setSnapStep(s)}
              />
            ))}
            <div className="dd-lbl">Rotate (°)</div>
            {SNAP_ANGLES.map((a) => (
              <DdRadio
                key={a}
                on={snapping && snapAngle === a}
                label={String(a)}
                onClick={() => useEditorStore.setState({ snapping: true, snapAngle: a })}
              />
            ))}
            <div className="dd-lbl">Scale (×)</div>
            {SNAP_SCALES.map((s) => (
              <DdRadio
                key={s}
                on={snapping && snapScale === s}
                label={String(s)}
                onClick={() => useEditorStore.setState({ snapping: true, snapScale: s })}
              />
            ))}
          </OvDropdown>
        </div>
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
        onPointerLeave={() => { StatsStore.clearCursor(); hoverTileRef.current = null; }}
        onContextMenu={(e) => e.preventDefault()}
        onDragOver={onDragOver}
        onDrop={onDrop}
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

      {/* Scene-light gizmos (icon + reach circle + direction); positioned by the rAF. */}
      {lightIds.map((id) => (
        <div
          key={id}
          ref={(el) => {
            if (el) lightRefs.current.set(id, el);
            else lightRefs.current.delete(id);
          }}
          className="viewport__light-gizmo"
          aria-hidden="true"
        >
          <Lightbulb className="viewport__light-icon" size={14} strokeWidth={1.9} />
          <svg className="viewport__light-svg" width="0" height="0" overflow="visible" aria-hidden="true">
            <circle className="lg-radius" cx="0" cy="0" r="0" />
            <line className="lg-dir" x1="0" y1="0" x2="0" y2="0" />
            <line className="lg-cone1" x1="0" y1="0" x2="0" y2="0" />
            <line className="lg-cone2" x1="0" y1="0" x2="0" y2="0" />
          </svg>
        </div>
      ))}

      {/* Collider gizmos: a full-viewport SVG per collider (box polygon / circle),
          positioned in absolute canvas-relative CSS px by the rAF. */}
      {colliderIds.map((id) => (
        <svg
          key={id}
          ref={(el) => {
            if (el) colliderRefs.current.set(id, el);
            else colliderRefs.current.delete(id);
          }}
          className="viewport__collider-gizmo"
          aria-hidden="true"
        >
          <polygon className="cl-box" points="" />
          <circle className="cl-circle" cx="0" cy="0" r="0" />
        </svg>
      ))}

      {/* Play In Viewport: the realm iframe fills the stage; a thin badge marks PIE. */}
      {playInViewport && (
        <div className="viewport__play">
          <div className="viewport__play-host" ref={playHostRef} />
          {(!realm.ready || realm.error) && (
            <div className={`viewport__play-status${realm.error ? ' error' : ''}`}>
              {realm.error ? `Play failed: ${realm.error}` : 'Starting game…'}
            </div>
          )}
          <button
            type="button"
            className="viewport__play-stop"
            title="Stop (Esc)"
            onClick={() => useEditorStore.getState().stop()}
          >
            ● Playing · Stop
          </button>
        </div>
      )}

      {/* One outline per selected entity (rAF-positioned); primary gets the accent. */}
      {selList.map((id) => (
        <div
          key={id}
          ref={(el) => {
            if (el) selRefs.current.set(id, el);
            else selRefs.current.delete(id);
          }}
          className={`viewport__selection${id === primaryId ? ' primary' : ''}`}
          aria-hidden="true"
        />
      ))}
      <div ref={marqueeRef} className="viewport__marquee" aria-hidden="true" />
      <div ref={tileSelRef} className="viewport__tilesel" aria-hidden="true" />
      <div ref={tilePreviewRef} className="viewport__tilepreview" aria-hidden="true" />

      <div ref={gizmoRef} className="viewport__gizmo" aria-hidden="true">
        <GizmoOverlay tool={tool} active={activeGizmoAxis} />
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

      {engine.status === 'ready' && (
        <div className="vp-perf" aria-hidden="true">
          <div className="pr h">
            <span className="k">FPS</span>
            <span className="v">{stats.fps}</span>
          </div>
          <div className="ps" />
          <div className="pr">
            <span className="k">Frame</span>
            <span className="v">{stats.fps > 0 ? (1000 / stats.fps).toFixed(1) : '—'} ms</span>
          </div>
          <div className="pr">
            <span className="k">Entities</span>
            <span className="v">{stats.entities}</span>
          </div>
        </div>
      )}

      <div className="vp-coord">
        <div className="ro">
          {stats.cursor && (
            <>
              <strong>
                {stats.cursor.x}, {stats.cursor.y}
              </strong>{' '}
              ·{' '}
            </>
          )}
          Sel <strong>{selCount}</strong> · {zoomPct}%
        </div>
        <div className="hint">{TOOL_HINT[tool]}</div>
      </div>

      {isPlaying && <div className="viewport__playflag">● PLAY</div>}
    </div>
  );
}
