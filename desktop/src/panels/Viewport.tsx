// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { PointerEvent as ReactPointerEvent, DragEvent as ReactDragEvent, ReactNode } from 'react';
import {
  MousePointer2, Move, RotateCw, Scale3d, Grid3x3, Eye, Frame,
  Camera, Check, ChevronDown, Loader2, TriangleAlert, Lightbulb, Sparkles, Globe, Crosshair, type LucideIcon,
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
import { SceneCommands } from '@/engine/SceneCommands';
import { SceneStore } from '@/engine/SceneStore';
import { StatsStore } from '@/engine/StatsStore';
import { PerfMonitor } from '@/engine/PerfMonitor';
import { PerfOverlay } from '@/components/PerfOverlay';
import { Perf } from '@/components/Perf';
import type { ToolMode } from '@/types';
import { resolveActiveTool, type EditorTool, type ToolContext, type PointerInput } from '@/tools';
import { cursorTile } from '@/tools/tileTools';
import { GIZMO, type GizmoAxis } from '@/tools/gizmo';
import { selectionPivot, gizmoScreenAngleRad } from '@/tools/transformTools';
import { Marquee } from '@/tools/marquee';
import { TilePaintPreview } from '@/tools/tilePreview';

// A React pointer event → the tool-facing PointerInput (no DOM coupling in tools).
const toInput = (e: ReactPointerEvent): PointerInput => ({
  clientX: e.clientX, clientY: e.clientY, pointerId: e.pointerId,
  button: e.button, shift: e.shiftKey, alt: e.altKey,
});

// Drag a gizmo's radius handle: convert the cursor to world space and write a scalar
// radius field through the SAME setField + begin/endGesture channel the Inspector uses
// (one coalesced undo step, one source of truth). The reusable on-canvas-edit shape —
// emitter shapeRadius, light radius, and circle-collider radius all drive their field
// this way. `ppu` maps world distance to the field's units: 1 for world-space radii
// (emitter/light), the collider's pixelsPerUnit for physics-meter radii. Measures from
// the entity's world origin (exact when the shape has no local offset).
function startRadiusHandleDrag(
  rt: number, component: string, field: string, ppu: number, e: ReactPointerEvent,
): void {
  if (e.button !== 0) return;
  const src = SceneModel.sourceFor(rt);
  const center = ViewportController.getEntityWorldXY(rt);
  if (src == null || !center) return;
  e.stopPropagation();
  SceneCommands.beginGesture(`${component} radius`);
  const onMove = (ev: PointerEvent) => {
    const w = ViewportController.canvasToWorld(ev.clientX, ev.clientY);
    if (!w) return;
    const r = Math.max(0, Math.hypot(w.x - center.x, w.y - center.y) / (ppu || 1));
    SceneCommands.setField(src, component, field, 'number', r);
  };
  const onUp = () => {
    SceneCommands.endGesture();
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

// Drag a box corner handle → a vec2 size field. Same channel as the radius drag; the
// cursor is un-rotated into the entity's local frame so the corner's |local| gives the
// half-extents. `fullSize` writes the full size (emitter shapeSize = 2× half); else the
// half-extents (collider halfExtents). `ppu` maps world px → the field's units.
function startSizeHandleDrag(
  rt: number, component: string, field: string, ppu: number, fullSize: boolean, e: ReactPointerEvent,
): void {
  if (e.button !== 0) return;
  const src = SceneModel.sourceFor(rt);
  const center = ViewportController.getEntityWorldXY(rt);
  if (src == null || !center) return;
  e.stopPropagation();
  const rot = ViewportController.getEntityWorldAngleRad(rt);
  const cos = Math.cos(rot), sin = Math.sin(rot);
  SceneCommands.beginGesture(`${component} size`);
  const onMove = (ev: PointerEvent) => {
    const w = ViewportController.canvasToWorld(ev.clientX, ev.clientY);
    if (!w) return;
    const dx = w.x - center.x, dy = w.y - center.y;
    const lx = dx * cos + dy * sin;      // un-rotate into the box's local frame
    const ly = -dx * sin + dy * cos;
    const k = (fullSize ? 2 : 1) / (ppu || 1);
    SceneCommands.setField(src, component, field, 'vec2', [Math.abs(lx) * k, Math.abs(ly) * k]);
  };
  const onUp = () => {
    SceneCommands.endGesture();
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

// Drag a cone's edge handle → its spread angle (ParticleEmitter.shapeAngle, degrees).
// The cursor's angle off local +Y is the half-angle; shapeAngle is the full spread.
function startAngleHandleDrag(rt: number, e: ReactPointerEvent): void {
  if (e.button !== 0) return;
  const src = SceneModel.sourceFor(rt);
  const center = ViewportController.getEntityWorldXY(rt);
  if (src == null || !center) return;
  e.stopPropagation();
  const rot = ViewportController.getEntityWorldAngleRad(rt);
  const cos = Math.cos(rot), sin = Math.sin(rot);
  SceneCommands.beginGesture('Cone angle');
  const onMove = (ev: PointerEvent) => {
    const w = ViewportController.canvasToWorld(ev.clientX, ev.clientY);
    if (!w) return;
    const dx = w.x - center.x, dy = w.y - center.y;
    const lx = dx * cos + dy * sin;
    const ly = -dx * sin + dy * cos;
    const halfDeg = Math.abs(Math.atan2(lx, ly)) * (180 / Math.PI);
    SceneCommands.setField(src, 'ParticleEmitter', 'shapeAngle', 'number', Math.min(180, halfDeg * 2));
  };
  const onUp = () => {
    SceneCommands.endGesture();
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

// The interactive transform gizmo, drawn from the origin (= the selection pivot, the
// wrapper is translated there each frame). Its geometry mirrors the hit zones in
// gizmo.ts (GIZMO constants) so the handles a user aims at are the handles the tool
// hit-tests. Screen y is down, so the world +Y handle points up (negative y). Only
// move/rotate/scale render a gizmo; the select tool shows just the selection outline.
// The SVG spans a fixed square centered on the pivot (viewBox origin = 0,0 =
// pivot), sized to contain the longest handle. A real coordinate space beats the
// old width/height=0 + overflow:visible trick, which Chromium won't paint outside
// a zero-size SVG viewport (the gizmo was drawn but invisible).
const GIZMO_SVG = 180;
const gizmoViewBox = `${-GIZMO_SVG / 2} ${-GIZMO_SVG / 2} ${GIZMO_SVG} ${GIZMO_SVG}`;

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
      <svg className="gizmo-svg" width={GIZMO_SVG} height={GIZMO_SVG} viewBox={gizmoViewBox}>
        <circle cx="0" cy="0" r={GIZMO.ringRadius} fill="none" stroke="var(--run)" strokeWidth={active ? 3.5 : 2} />
        <circle cx="0" cy="0" r="2.5" fill="var(--star)" />
      </svg>
    );
  }
  if (tool === 'scale') {
    return (
      <svg className="gizmo-svg" width={GIZMO_SVG} height={GIZMO_SVG} viewBox={gizmoViewBox}>
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
    <svg className="gizmo-svg" width={GIZMO_SVG} height={GIZMO_SVG} viewBox={gizmoViewBox}>
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

// Only this node re-renders per mouse move; the HUD follows the slow stats cadence.
function HudCursor() {
  const cursor = useSyncExternalStore(StatsStore.subscribeCursor, StatsStore.getCursor);
  if (!cursor) return null;
  return (
    <>
      <strong>
        {cursor.x}, {cursor.y}
      </strong>{' '}
      ·{' '}
    </>
  );
}

// The corner HUD (perf + coordinates). Owns the StatsStore subscription so the
// slow stats updates re-render ONLY this leaf — not the whole, gizmo-heavy
// Viewport.
function ViewportHud({ ready, selCount, zoomPct, tool }: {
  ready: boolean;
  selCount: number;
  zoomPct: number;
  tool: ToolMode;
}) {
  const stats = useSyncExternalStore(StatsStore.subscribe, StatsStore.getSnapshot);
  return (
    <>
      {ready && (
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
          <HudCursor />
          Sel <strong>{selCount}</strong> · {zoomPct}%
        </div>
        <div className="hint">{TOOL_HINT[tool]}</div>
      </div>
    </>
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
  const coordSpace = useEditorStore((s) => s.coordSpace);
  const pivotMode = useEditorStore((s) => s.pivotMode);
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
  // Gesture-paint preview (rect fill / line cells): a container whose ghost-cell
  // children are pooled + positioned imperatively in the rAF (rect/line defer their
  // commit to release, so this shows the shape mid-drag).
  const tilePaintRef = useRef<HTMLDivElement>(null);
  const paintPoolRef = useRef<HTMLDivElement[]>([]);
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
  // Selector snapshot: re-renders only when the Perf overlay is toggled, not on
  // its twice-a-second stat updates (those re-render only <PerfOverlay>).
  const perfVisible = useSyncExternalStore(PerfMonitor.subscribe, () => PerfMonitor.getSnapshot().visible);

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
  // Particle emitters don't simulate in edit mode — outline each emitter's spawn
  // shape (point / circle / rect / cone) + a clickable icon, positioned by the rAF.
  const particleRefs = useRef(new Map<number, HTMLDivElement | null>());
  const particleShapeRefs = useRef(new Map<number, SVGSVGElement | null>());
  const particleIds = useMemo(
    () => (engine.status === 'ready' ? ViewportController.particleEmitterIds() : []),
    [structRev, engine.status],
  );

  // Mount the live engine canvas into the stage; it survives panel re-docking.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    EngineHost.attach(stage);
    StatsStore.start();
    PerfMonitor.start();
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
      const perfT0 = performance.now();
      const g = gizmoRef.current;
      if (!g) return;
      const ready = EngineHost.getSnapshot().status === 'ready';
      const showG = useEditorStore.getState().showGizmos;
      const toolMode = useEditorStore.getState().tool;

      // Per-entity selection outlines (one div per selected source id).
      const selIds: number[] = [];
      for (const [sid, el] of selRefs.current) {
        selIds.push(sid);
        if (!el) continue;
        const rt = ready ? SceneModel.runtimeFor(sid) : undefined;
        const rect = rt != null ? ViewportController.getEntityScreenRect(rt) : null;
        if (rect) {
          el.style.transform = `translate(${rect.x}px, ${rect.y}px)`;
          el.style.width = `${rect.w}px`;
          el.style.height = `${rect.h}px`;
          el.style.opacity = '1';
        } else {
          el.style.opacity = '0';
        }
      }

      // The transform gizmo sits at the selection pivot (centroid or active-entity
      // pivot per pivotMode), rotated to the active entity's axes in local space.
      // Only for the move/rotate/scale tools — select shows just the outline.
      const pivotWorld = ready && selIds.length ? selectionPivot(selIds) : null;
      const pivot = pivotWorld ? ViewportController.worldToClient(pivotWorld.x, pivotWorld.y) : null;
      if (pivot && showG && toolMode !== 'select') {
        const angDeg = (gizmoScreenAngleRad(selIds) * 180) / Math.PI;
        g.style.transform = `translate(${pivot.x}px, ${pivot.y}px) rotate(${angDeg}deg)`;
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
        const origin = ready && rt != null ? ViewportController.getEntityWorldXY(rt) : null;
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

        // Brush footprint preview: a ghost rect at the hovered tile. brush/erase size it
        // to the active stamp (they lay/erase its w×h); the other tools mark a single
        // cell. Hidden for rect/line while their gesture preview is drawing the shape.
        const dragging = TilePaintPreview.get() != null;
        const pv = tilePreviewRef.current;
        if (pv) {
          const stampSized = paint.tool === 'brush' || paint.tool === 'erase';
          const SINGLE: Record<string, boolean> = { bucket: true, terrain: true, rect: true, line: true };
          const hov = hoverTileRef.current;
          const gesturing = dragging && (paint.tool === 'rect' || paint.tool === 'line');
          const showFoot = paint.tool != null && (stampSized || SINGLE[paint.tool])
            && !gesturing && hov && cs?.cellSize && origin;
          if (showFoot && hov && cs?.cellSize && origin) {
            const fw = stampSized ? paint.stamp.w : 1;
            const fh = stampSized ? paint.stamp.h : 1;
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

        // Gesture-paint preview: rect fill covers the whole region (one ghost cell),
        // line ghosts each tile it crosses. Pooled child divs — grow on demand, hide
        // the unused tail — positioned like the footprint above.
        const pp = tilePaintRef.current;
        if (pp) {
          const shape = TilePaintPreview.get();
          const pool = paintPoolRef.current;
          let used = 0;
          if (shape && cs?.cellSize && origin) {
            const cw = cs.cellSize.x;
            const ch = cs.cellSize.y;
            const place = (tx: number, ty: number, w: number, h: number): void => {
              const tl = ViewportController.worldToClient(origin.x + tx * cw, origin.y - ty * ch);
              const br = ViewportController.worldToClient(origin.x + (tx + w) * cw, origin.y - (ty + h) * ch);
              if (!tl || !br) return;
              let cell = pool[used];
              if (!cell) {
                cell = document.createElement('div');
                cell.className = 'viewport__tilepaint-cell';
                pp.appendChild(cell);
                pool[used] = cell;
              }
              cell.style.transform = `translate(${tl.x}px, ${tl.y}px)`;
              cell.style.width = `${br.x - tl.x}px`;
              cell.style.height = `${br.y - tl.y}px`;
              cell.style.display = 'block';
              used++;
            };
            if (shape.kind === 'rect') {
              const x0 = Math.min(shape.x0, shape.x1);
              const y0 = Math.min(shape.y0, shape.y1);
              place(x0, y0, Math.abs(shape.x1 - shape.x0) + 1, Math.abs(shape.y1 - shape.y0) + 1);
            } else {
              for (const c of shape.cells) place(c.x, c.y, 1, 1);
            }
          }
          for (let i = used; i < pool.length; i++) pool[i].style.display = 'none';
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
        // Collider drag handles: circle radius (cl-handle) / box corner size (cl-size-handle).
        const chnd = svg.querySelector('.cl-handle') as SVGCircleElement | null;
        if (chnd) {
          if (cg && cg.kind === 'circle' && cg.handle) {
            chnd.setAttribute('cx', String(cg.handle.x));
            chnd.setAttribute('cy', String(cg.handle.y));
            chnd.style.display = '';
          } else {
            chnd.style.display = 'none';
          }
        }
        const csz = svg.querySelector('.cl-size-handle') as SVGCircleElement | null;
        if (csz) {
          if (cg && cg.kind === 'box' && cg.sizeHandle) {
            csz.setAttribute('cx', String(cg.sizeHandle.x));
            csz.setAttribute('cy', String(cg.sizeHandle.y));
            csz.style.display = '';
          } else {
            csz.style.display = 'none';
          }
        }
      }

      // Light2D gizmos — icon at the light, dashed reach circle (Point/Spot), direction
      // line (Directional/Spot), all tinted by the light color. Edit mode + gizmos on.
      // An extinguished light (enable off / eye hidden / zero intensity) dims its icon
      // and drops the reach/direction overlays, so on/off is readable in the viewport.
      for (const [lid, wrap] of lightRefs.current) {
        if (!wrap) continue;
        const lg = camsOn ? ViewportController.getLightGizmo(lid) : null;
        if (lg) {
          wrap.style.opacity = lg.on ? '1' : '0.35';
          wrap.style.visibility = 'visible'; // re-enable the click target with the gizmo
          wrap.style.color = lg.color;
          wrap.style.transform = `translate(${lg.cx}px, ${lg.cy}px)`;
          const circle = wrap.querySelector('.lg-radius') as SVGCircleElement | null;
          if (circle) {
            circle.setAttribute('r', String(lg.radiusPx));
            circle.style.opacity = lg.on && lg.radiusPx > 0 ? '0.6' : '0';
          }
          const dir = wrap.querySelector('.lg-dir') as SVGLineElement | null;
          if (dir) {
            const hasDir = lg.sdx !== 0 || lg.sdy !== 0;
            const len = lg.kind === 3 ? Math.max(lg.radiusPx, 28) : 38;
            dir.setAttribute('x2', String(lg.sdx * len));
            dir.setAttribute('y2', String(lg.sdy * len));
            dir.style.opacity = lg.on && hasDir ? '0.9' : '0';
          }
          // Spot (kind 3): two cone-edge lines at ±half-angle around the aim, out to the reach.
          const cone1 = wrap.querySelector('.lg-cone1') as SVGLineElement | null;
          const cone2 = wrap.querySelector('.lg-cone2') as SVGLineElement | null;
          for (const [line, sign] of [[cone1, 1], [cone2, -1]] as const) {
            if (!line) continue;
            if (lg.on && lg.kind === 3 && (lg.sdx !== 0 || lg.sdy !== 0)) {
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
          // Radius drag-handle (Point/Spot). The wrapper is translated to the light,
          // so place the handle at the reach edge in wrapper-local px.
          const lhnd = wrap.querySelector('.lg-handle') as SVGCircleElement | null;
          if (lhnd) {
            if (lg.on && lg.handle) {
              lhnd.setAttribute('cx', String(lg.handle.x - lg.cx));
              lhnd.setAttribute('cy', String(lg.handle.y - lg.cy));
              lhnd.style.display = '';
            } else {
              lhnd.style.display = 'none';
            }
          }
        } else {
          wrap.style.opacity = '0';
          wrap.style.visibility = 'hidden'; // an invisible bulb must not swallow clicks
        }
      }

      // Particle-emitter gizmos — a clickable icon at the emitter + its spawn-shape
      // outline (cone wedge / circle / box / point), so an otherwise-invisible emitter
      // is placeable and aimable in edit mode. Same edit-mode + gizmos-on gate.
      for (const [pid, wrap] of particleRefs.current) {
        if (!wrap) continue;
        const pg = camsOn ? ViewportController.getParticleEmitterGizmo(pid) : null;
        const svg = particleShapeRefs.current.get(pid);
        const poly = svg ? (svg.querySelector('.pe-poly') as SVGPolygonElement | null) : null;
        const circ = svg ? (svg.querySelector('.pe-circle') as SVGCircleElement | null) : null;
        if (pg) {
          wrap.style.opacity = pg.on ? '1' : '0.4';
          wrap.style.visibility = 'visible';
          wrap.style.transform = `translate(${pg.cx}px, ${pg.cy}px)`;
          if (pg.kind === 'poly' && poly) {
            poly.setAttribute('points', pg.pts.map((p) => `${p.x},${p.y}`).join(' '));
            poly.style.opacity = pg.on ? '0.9' : '0.4';
            if (circ) circ.style.opacity = '0';
          } else if (pg.kind === 'circle' && circ) {
            circ.setAttribute('cx', String(pg.cx));
            circ.setAttribute('cy', String(pg.cy));
            circ.setAttribute('r', String(pg.r));
            circ.style.opacity = pg.on ? '0.9' : '0.4';
            if (poly) poly.style.opacity = '0';
          } else {
            if (poly) poly.style.opacity = '0';
            if (circ) circ.style.opacity = '0';
          }
        } else {
          wrap.style.opacity = '0';
          wrap.style.visibility = 'hidden';
          if (poly) poly.style.opacity = '0';
          if (circ) circ.style.opacity = '0';
        }
        // Drag handles (radius Circle/Cone, size Rect, angle Cone): each shown only
        // when the emitter is on and exposes it, else display:none so it can't grab
        // pointers. The shape SVG spans the viewport so handle px are absolute.
        const placePe = (cls: string, pt: { x: number; y: number } | null | undefined) => {
          const el = svg ? (svg.querySelector(cls) as SVGCircleElement | null) : null;
          if (!el) return;
          if (pg && pg.on && pt) {
            el.setAttribute('cx', String(pt.x));
            el.setAttribute('cy', String(pt.y));
            el.style.display = '';
          } else {
            el.style.display = 'none';
          }
        };
        placePe('.pe-handle', pg?.handle);
        placePe('.pe-size-handle', pg?.sizeHandle);
        placePe('.pe-angle-handle', pg?.angleHandle);
      }
      PerfMonitor.mark('gizmo.update', perfT0);
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

  // pointercancel (OS/gesture interruption) aborts the stroke instead of committing —
  // the tool rolls back its live edits, matching Esc.
  const cancelDrag = (e: ReactPointerEvent) => {
    if (panRef.current) {
      stageRef.current?.releasePointerCapture(e.pointerId);
      panRef.current = null;
      return;
    }
    const t = activeToolRef.current;
    if (!t) return;
    activeToolRef.current = null;
    t.cancel?.(toolCtx);
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
            <DdCheck on={perfVisible} label="Perf" onClick={() => PerfMonitor.toggleOverlay()} />
          </OvDropdown>
          <span className="ov-divider" />
          <OvTool icon={Frame} label="Frame Selected  (F)" kbd="F" onClick={() => commands.run('view.frameSelected')} />
          <span className="ov-divider" />
          <button
            type="button"
            className={`ovbtn${coordSpace === 'local' ? ' active' : ''}`}
            title="Gizmo axes: World / Local (the active object's own axes)"
            onClick={() => commands.run('view.toggleCoordSpace')}
          >
            <Globe size={13} strokeWidth={1.9} />
            <span className="val">{coordSpace === 'local' ? 'Local' : 'World'}</span>
          </button>
          <button
            type="button"
            className={`ovbtn${pivotMode === 'pivot' ? ' active' : ''}`}
            title="Gizmo pivot: Center of selection / the active object's Pivot"
            onClick={() => commands.run('view.togglePivotMode')}
          >
            <Crosshair size={13} strokeWidth={1.9} />
            <span className="val">{pivotMode === 'pivot' ? 'Pivot' : 'Center'}</span>
          </button>
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
        onPointerCancel={cancelDrag}
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

      {/* Scene-light gizmos (icon + reach circle + direction); positioned by the rAF.
          The icon is clickable — a glow in the viewport is attributable: click its bulb
          to select the light that casts it (same selection door as a scene pick). */}
      {lightIds.map((id) => {
        const src = SceneModel.sourceFor(id);
        const name = src != null ? SceneModel.entityBySource(src)?.name : undefined;
        return (
          <div
            key={id}
            ref={(el) => {
              if (el) lightRefs.current.set(id, el);
              else lightRefs.current.delete(id);
            }}
            className="viewport__light-gizmo"
          >
            <span
              className="viewport__light-hit"
              role="button"
              title={name}
              onPointerDown={(e) => {
                if (e.button !== 0 || src == null) return;
                e.stopPropagation();
                useSelection.getState().select(src);
              }}
            >
              <Lightbulb className="viewport__light-icon" size={14} strokeWidth={1.9} />
            </span>
            <svg className="viewport__light-svg" width="0" height="0" overflow="visible" aria-hidden="true">
              <circle className="lg-radius" cx="0" cy="0" r="0" />
              <line className="lg-dir" x1="0" y1="0" x2="0" y2="0" />
              <line className="lg-cone1" x1="0" y1="0" x2="0" y2="0" />
              <line className="lg-cone2" x1="0" y1="0" x2="0" y2="0" />
              <circle
                className="lg-handle"
                cx="0"
                cy="0"
                r="5"
                style={{ display: 'none' }}
                onPointerDown={(e) => startRadiusHandleDrag(id, 'Light2D', 'radius', 1, e)}
              />
            </svg>
          </div>
        );
      })}

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
          <circle
            className="cl-handle"
            cx="0"
            cy="0"
            r="5"
            style={{ display: 'none' }}
            onPointerDown={(e) => startRadiusHandleDrag(id, 'CircleCollider', 'radius', ViewportController.colliderPixelsPerUnit(), e)}
          />
          <circle
            className="cl-size-handle"
            cx="0"
            cy="0"
            r="5"
            style={{ display: 'none' }}
            onPointerDown={(e) => startSizeHandleDrag(id, 'BoxCollider', 'halfExtents', ViewportController.colliderPixelsPerUnit(), false, e)}
          />
        </svg>
      ))}

      {/* Particle-emitter gizmos: a clickable icon (select-to-identify, like a light)
          + a spawn-shape overlay SVG (cone wedge / circle / box), positioned by the rAF. */}
      {particleIds.map((id) => {
        const src = SceneModel.sourceFor(id);
        const name = src != null ? SceneModel.entityBySource(src)?.name : undefined;
        return (
          <div
            key={id}
            ref={(el) => {
              if (el) particleRefs.current.set(id, el);
              else particleRefs.current.delete(id);
            }}
            className="viewport__particle-gizmo"
          >
            <span
              className="viewport__particle-hit"
              role="button"
              title={name}
              onPointerDown={(e) => {
                if (e.button !== 0 || src == null) return;
                e.stopPropagation();
                useSelection.getState().select(src);
              }}
            >
              <Sparkles className="viewport__particle-icon" size={14} strokeWidth={1.9} />
            </span>
          </div>
        );
      })}
      {particleIds.map((id) => (
        <svg
          key={id}
          ref={(el) => {
            if (el) particleShapeRefs.current.set(id, el);
            else particleShapeRefs.current.delete(id);
          }}
          className="viewport__particle-shape"
          aria-hidden="true"
        >
          <polygon className="pe-poly" points="" />
          <circle className="pe-circle" cx="0" cy="0" r="0" />
          <circle
            className="pe-handle"
            cx="0"
            cy="0"
            r="5"
            style={{ display: 'none' }}
            onPointerDown={(e) => startRadiusHandleDrag(id, 'ParticleEmitter', 'shapeRadius', 1, e)}
          />
          <circle
            className="pe-size-handle"
            cx="0"
            cy="0"
            r="5"
            style={{ display: 'none' }}
            onPointerDown={(e) => startSizeHandleDrag(id, 'ParticleEmitter', 'shapeSize', 1, true, e)}
          />
          <circle
            className="pe-angle-handle"
            cx="0"
            cy="0"
            r="5"
            style={{ display: 'none' }}
            onPointerDown={(e) => startAngleHandleDrag(id, e)}
          />
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
      <div ref={tilePaintRef} className="viewport__tilepaint" aria-hidden="true" />

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

      <ViewportHud ready={engine.status === 'ready'} selCount={selCount} zoomPct={zoomPct} tool={tool} />
      {perfVisible && <Perf id="viewport.perfhud"><PerfOverlay /></Perf>}

      {isPlaying && <div className="viewport__playflag">● PLAY</div>}
    </div>
  );
}
