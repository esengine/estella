// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { PointerEvent as ReactPointerEvent, DragEvent as ReactDragEvent, ReactNode } from 'react';
import {
  MousePointer2, Move, RotateCw, Scale3d, Grid3x3, Eye, Frame,
  Camera, Check, ChevronDown, Loader2, TriangleAlert, Lightbulb, Sparkles, Globe, Crosshair, Smartphone, Monitor, type LucideIcon,
} from 'lucide-react';
import { t } from '@/i18n';
import { useEditorStore } from '@/store/editorStore';
import { useSelection } from '@/store/selectionStore';
import { useTilemapPaint, type PaintTool } from '@/store/tilemapPaintStore';
import { exitTilePaint, isTilePaintMode, selectedTilemapCellSize } from '@/tools/tileMode';
import { activeMode, activeModeOverlays } from '@/mode/activeMode';
import { useEditorMode } from '@/store/editorModeStore';
import { RESOLUTION_PRESETS, RESOLUTION_PRESET_BY_ID, DESIGN_RESOLUTION_PRESETS, deviceDims } from '@/mode/resolutionPresets';
import { buildStampGhost } from '@/tools/tileStampGhost';
import { TilemapAPI, tileIdOf, isNonOrthogonal, UINode, DimensionUnit, computeEffectiveOrthoSize, type TileCollisionPiece, type TilesetModel } from 'esengine';
import { commands } from '@/commands';
import { MOD_LABEL } from '@/commands/keybinding';
import { EngineHost } from '@/engine/EngineHost';
import { PlayRealm } from '@/engine/PlayRealm';
import { ViewportController, type JointGizmoType, type ColliderPointHandle } from '@/engine/ViewportController';
import { ProjectStore } from '@/project/ProjectStore';
import { createFromSource, sourceById, SOURCE_DND_MIME } from '@/engine/entitySources';
import { resizeUINodeAxis, type ResizeSide, type AxisResizeWrites } from '@/engine/uiResize';
import { IMAGE_RE } from '@/project/assetMeta';
import { createTilemapFromTileset } from '@/tilemap/createTilemap';
import { layerTilesetRefs, loadLayerTilesetModel } from '@/tilemap/layerTilesetModel';
import { createAnimatedSpriteFromClip } from '@/flipbook/createAnimatedSprite';
import { SceneModel } from '@/engine/SceneModel';
import { SceneCommands } from '@/engine/SceneCommands';
import { SceneStore } from '@/engine/SceneStore';
import { StatsStore } from '@/engine/StatsStore';
import { PerfMonitor } from '@/engine/PerfMonitor';
import { PerfOverlay } from '@/components/PerfOverlay';
import { Perf } from '@/components/Perf';
import { Popover, usePopover } from '@/components/Popover';
import { usePanelWindow, eventWindow } from '@/components/PanelWindow';
import type { ToolMode, EntityId } from '@/types';
import { resolveActiveTool, type EditorTool, type ToolContext, type PointerInput } from '@/tools';
import { cursorTile } from '@/tools/tileTools';
import { GIZMO, type GizmoAxis } from '@/tools/gizmo';
import { selectionPivot, gizmoScreenAngleRad } from '@/tools/transformTools';
import { Marquee } from '@/tools/marquee';
import { TilePaintPreview } from '@/tools/tilePreview';

// Cap on the non-orthogonal grid overlay's drawn cells — beyond this the view is too
// zoomed out for a cell grid to read, so it's skipped rather than churning a huge path.
const TILE_GRID_CELL_CAP = 4000;

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
// the entity's world origin unless the shape has its own center (collider offset) —
// callers pass `centerOverride` so the drag measures from where the shape is drawn.
function startRadiusHandleDrag(
  rt: number, component: string, field: string, ppu: number, e: ReactPointerEvent,
  centerOverride?: { x: number; y: number } | null,
): void {
  if (e.button !== 0) return;
  const src = SceneModel.sourceFor(rt);
  const center = centerOverride ?? ViewportController.getEntityWorldXY(rt);
  if (src == null || !center) return;
  e.stopPropagation();
  const win = eventWindow(e);
  SceneCommands.beginGesture(`${component} radius`);
  const onMove = (ev: PointerEvent) => {
    const w = ViewportController.canvasToWorld(ev.clientX, ev.clientY);
    if (!w) return;
    const r = Math.max(0, Math.hypot(w.x - center.x, w.y - center.y) / (ppu || 1));
    SceneCommands.setField(src, component, field, 'number', r);
  };
  const onUp = () => {
    SceneCommands.endGesture();
    win.removeEventListener('pointermove', onMove);
    win.removeEventListener('pointerup', onUp);
  };
  win.addEventListener('pointermove', onMove);
  win.addEventListener('pointerup', onUp);
}

// Drag a box corner handle → a vec2 size field. Same channel as the radius drag; the
// cursor is un-rotated into the entity's local frame so the corner's |local| gives the
// half-extents. `fullSize` writes the full size (emitter shapeSize = 2× half); else the
// half-extents (collider halfExtents). `ppu` maps world px → the field's units.
// `centerOverride` = the shape's own center when it's offset from the entity origin.
function startSizeHandleDrag(
  rt: number, component: string, field: string, ppu: number, fullSize: boolean, e: ReactPointerEvent,
  centerOverride?: { x: number; y: number } | null,
): void {
  if (e.button !== 0) return;
  const src = SceneModel.sourceFor(rt);
  const center = centerOverride ?? ViewportController.getEntityWorldXY(rt);
  if (src == null || !center) return;
  e.stopPropagation();
  const rot = ViewportController.getEntityWorldAngleRad(rt);
  const cos = Math.cos(rot), sin = Math.sin(rot);
  const win = eventWindow(e);
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
    win.removeEventListener('pointermove', onMove);
    win.removeEventListener('pointerup', onUp);
  };
  win.addEventListener('pointermove', onMove);
  win.addEventListener('pointerup', onUp);
}

// Drag a collider point handle → a Vec2 field (box/circle/capsule offset, segment
// endpoint) or ONE element of a Vec2[] (polygon vertex, chain point). The cursor is
// un-rotated into the entity's local frame and scaled to physics metres (÷ppu), then
// written through the same setField + begin/endGesture channel as every other handle
// (one coalesced undo step). Array targets rewrite the whole Vec2[] with only index i
// changed — snapshotted at grab so a drag can't compound. One channel for all six shapes.
function startColliderPointDrag(
  rt: number,
  target: { comp: string; key: string; index: number | null },
  ppu: number,
  e: { button: number; clientX: number; clientY: number; currentTarget: EventTarget | null; stopPropagation(): void },
): void {
  if (e.button !== 0) return;
  const src = SceneModel.sourceFor(rt);
  const origin = ViewportController.getEntityWorldXY(rt);
  if (src == null || !origin) return;
  e.stopPropagation();
  const rot = ViewportController.getEntityWorldAngleRad(rt);
  const cos = Math.cos(rot), sin = Math.sin(rot);
  const base = target.index == null
    ? null
    : (((SceneModel.entityBySource(src)?.components.find((c) => c.type === target.comp)?.data as Record<string, unknown> | undefined)?.[target.key]) as Array<{ x: number; y: number }> | undefined) ?? null;
  const win = eventWindow(e);
  SceneCommands.beginGesture('Edit Collider');
  const onMove = (ev: PointerEvent) => {
    const w = ViewportController.canvasToWorld(ev.clientX, ev.clientY);
    if (!w) return;
    const dx = w.x - origin.x, dy = w.y - origin.y;
    const lx = (dx * cos + dy * sin) / (ppu || 1);   // un-rotate into local → metres
    const ly = (-dx * sin + dy * cos) / (ppu || 1);
    if (target.index == null) {
      SceneCommands.setField(src, target.comp, target.key, 'vec2', [lx, ly]);
    } else if (base) {
      SceneCommands.setVertexArray(src, target.comp, target.key,
        base.map((p, i) => (i === target.index ? { x: lx, y: ly } : { x: p.x, y: p.y })));
    }
  };
  const onUp = () => {
    SceneCommands.endGesture();
    win.removeEventListener('pointermove', onMove);
    win.removeEventListener('pointerup', onUp);
  };
  win.addEventListener('pointermove', onMove);
  win.addEventListener('pointerup', onUp);
}

// Native pointerdown on a pooled collider point handle → the drag above. The target field
// is read off the circle's data-*; the entity off the owning gizmo SVG's data-src. Native
// (not React) so the imperatively-pooled circles work in a popped-out viewport window too.
function onColliderPointDown(e: PointerEvent): void {
  const el = e.currentTarget as SVGCircleElement;
  const comp = el.getAttribute('data-comp');
  const key = el.getAttribute('data-key');
  const srcAttr = el.closest('.viewport__collider-gizmo')?.getAttribute('data-src');
  if (!comp || !key || srcAttr == null) return;
  const rt = SceneModel.runtimeFor(Number(srcAttr));
  if (rt == null) return;
  const idx = el.getAttribute('data-index');
  startColliderPointDrag(rt, { comp, key, index: idx ? Number(idx) : null }, ViewportController.colliderPixelsPerUnit(), e);
}

// Pool the point-handle circles inside a gizmo's <g> — one per handle, reused across
// frames, created (and bound) lazily, extras hidden. Uses the SVG's OWN document so a
// popped-out viewport gets its handles in the right window.
function syncColliderPoints(g: SVGGElement, points: ColliderPointHandle[]): void {
  const doc = g.ownerDocument;
  let child = g.firstElementChild as SVGCircleElement | null;
  for (const p of points) {
    if (!child) {
      child = doc.createElementNS('http://www.w3.org/2000/svg', 'circle');
      child.setAttribute('r', '4');
      child.addEventListener('pointerdown', onColliderPointDown);
      g.appendChild(child);
    }
    child.setAttribute('cx', String(p.x));
    child.setAttribute('cy', String(p.y));
    child.setAttribute('data-comp', p.comp);
    child.setAttribute('data-key', p.key);
    child.setAttribute('data-index', p.index == null ? '' : String(p.index));
    child.setAttribute('class', p.key === 'offset' ? 'cl-vert cl-offset' : 'cl-vert');
    child.style.display = '';
    child = child.nextElementSibling as SVGCircleElement | null;
  }
  while (child) {
    child.style.display = 'none';
    child = child.nextElementSibling as SVGCircleElement | null;
  }
}

// Project a world-space, axis-aligned rect (center + half extents) to a CSS-px
// screen rect. The editor camera is 2D ortho (no rotation), so projecting two
// opposite corners and taking their AABB is exact. Null if off-camera / no view.
function worldRectToScreen(
  cx: number,
  cy: number,
  halfW: number,
  halfH: number,
): { x: number; y: number; w: number; h: number } | null {
  const a = ViewportController.worldToClient(cx - halfW, cy + halfH);
  const b = ViewportController.worldToClient(cx + halfW, cy - halfH);
  if (!a || !b) return null;
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

function setRectAttrs(el: Element | null, r: { x: number; y: number; w: number; h: number }): void {
  if (!el) return;
  el.setAttribute('x', String(r.x));
  el.setAttribute('y', String(r.y));
  el.setAttribute('width', String(Math.max(0, r.w)));
  el.setAttribute('height', String(Math.max(0, r.h)));
}

// A UINode length field ({ value, unit }) from the model, or null.
function uiDim(
  src: number,
  key: 'width' | 'height' | 'insetLeft' | 'insetRight' | 'insetTop' | 'insetBottom',
): { value: number; unit: number } | null {
  const d = SceneModel.entityBySource(src)?.components.find((c) => c.type === 'UINode')?.data as
    | Record<string, unknown>
    | undefined;
  const v = d?.[key];
  return v && typeof v === 'object' && 'value' in v && 'unit' in v ? (v as { value: number; unit: number }) : null;
}

// The eight resize handles, each as which edge it moves per axis (low = left/bottom,
// high = right/top in the y-up world).
type UiEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
const UI_EDGE_SIDES: Record<UiEdge, { x?: ResizeSide; y?: ResizeSide }> = {
  e: { x: 'high' }, w: { x: 'low' }, n: { y: 'high' }, s: { y: 'low' },
  ne: { x: 'high', y: 'high' }, nw: { x: 'low', y: 'high' },
  se: { x: 'high', y: 'low' }, sw: { x: 'low', y: 'low' },
};

// Round a Dimension for a clean inspector value (px → integer, percent → 2dp).
function roundDim(d: { value: number; unit: number }): { value: number; unit: number } {
  return d.unit === DimensionUnit.Px
    ? { value: Math.round(d.value), unit: d.unit }
    : { value: Math.round(d.value * 100) / 100, unit: d.unit };
}
function applyAxisResize(src: EntityId, axis: 'x' | 'y', w: AxisResizeWrites): void {
  const keys = axis === 'x'
    ? { size: 'width', near: 'insetLeft', far: 'insetRight' }
    : { size: 'height', near: 'insetBottom', far: 'insetTop' };
  if (w.size) SceneCommands.setField(src, 'UINode', keys.size, 'dimension', roundDim(w.size));
  if (w.nearInset) SceneCommands.setField(src, 'UINode', keys.near, 'dimension', roundDim(w.nearInset));
  if (w.farInset) SceneCommands.setField(src, 'UINode', keys.far, 'dimension', roundDim(w.farInset));
}

// Drag a UI box edge/corner handle → resize the UINode, unit-aware and anchor-aware
// (see uiResize.ts). Works in world units (the UI-world is design-px-baked, so 1 unit
// = 1 design px, matching setUINodeXY_); the parent box drives percent + stretch.
// Writes go through the SAME setField + begin/endGesture channel the Inspector uses.
function startUiResizeDrag(rt: number, edge: UiEdge, e: ReactPointerEvent): void {
  if (e.button !== 0) return;
  const src = SceneModel.sourceFor(rt);
  const obb = ViewportController.uiEntityWorldOBB(rt);
  if (src == null || !obb) return;
  const parentSrc = SceneModel.entityBySource(src)?.parent;
  const parentRt = parentSrc != null ? SceneModel.runtimeFor(parentSrc) : undefined;
  const pobb = parentRt != null ? ViewportController.uiEntityWorldOBB(parentRt) : null;
  if (!pobb) return; // no parent box → no anchor-correct / percent frame to resize in
  e.stopPropagation();

  const sides = UI_EDGE_SIDES[edge];
  const left = obb.cx - obb.hw, right = obb.cx + obb.hw;
  const bottom = obb.cy - obb.hh, top = obb.cy + obb.hh;
  // Start field values (resize recomputes from these + the total edge delta, so the
  // repeated writes during a drag never accumulate rounding).
  const fx = { size: uiDim(src, 'width'), nearInset: uiDim(src, 'insetLeft'), farInset: uiDim(src, 'insetRight') };
  const fy = { size: uiDim(src, 'height'), nearInset: uiDim(src, 'insetBottom'), farInset: uiDim(src, 'insetTop') };
  const parentW = 2 * pobb.hw, parentH = 2 * pobb.hh;

  const win = eventWindow(e);
  SceneCommands.beginGesture('Resize UI');
  const onMove = (ev: PointerEvent) => {
    const wp = ViewportController.canvasToWorld(ev.clientX, ev.clientY);
    if (!wp) return;
    if (sides.x && fx.size && fx.nearInset && fx.farInset) {
      const edgeDeltaWorld = wp.x - (sides.x === 'high' ? right : left);
      applyAxisResize(src, 'x', resizeUINodeAxis({
        size: fx.size, nearInset: fx.nearInset, farInset: fx.farInset,
        side: sides.x, edgeDeltaWorld, ppu: 1, parentExtentWorld: parentW,
      }));
    }
    if (sides.y && fy.size && fy.nearInset && fy.farInset) {
      const edgeDeltaWorld = wp.y - (sides.y === 'high' ? top : bottom);
      applyAxisResize(src, 'y', resizeUINodeAxis({
        size: fy.size, nearInset: fy.nearInset, farInset: fy.farInset,
        side: sides.y, edgeDeltaWorld, ppu: 1, parentExtentWorld: parentH,
      }));
    }
  };
  const onUp = () => {
    SceneCommands.endGesture();
    win.removeEventListener('pointermove', onMove);
    win.removeEventListener('pointerup', onUp);
  };
  win.addEventListener('pointermove', onMove);
  win.addEventListener('pointerup', onUp);
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
  const win = eventWindow(e);
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
    win.removeEventListener('pointermove', onMove);
    win.removeEventListener('pointerup', onUp);
  };
  win.addEventListener('pointermove', onMove);
  win.addEventListener('pointerup', onUp);
}

// Drag a joint anchor dot → its anchorA/anchorB vec2 (world px in the owning body's
// local frame — the convention PhysicsSystem converts to meters with ×invPpu). 'b'
// edits the joint entity's own anchor, 'a' the connected body's; MotorJoint has no
// anchors so its dots aren't draggable. Same setField + gesture channel as all
// on-canvas edits; px round to integers for clean inspector values.
function startJointAnchorDrag(rt: number, type: JointGizmoType, end: 'a' | 'b', e: ReactPointerEvent): void {
  if (e.button !== 0) return;
  const src = SceneModel.sourceFor(rt);
  const frame = ViewportController.jointAnchorFrame(rt, type, end);
  if (src == null || !frame) return;
  e.stopPropagation();
  const cos = Math.cos(frame.rot), sin = Math.sin(frame.rot);
  const win = eventWindow(e);
  SceneCommands.beginGesture(`${type} anchor`);
  const onMove = (ev: PointerEvent) => {
    const w = ViewportController.canvasToWorld(ev.clientX, ev.clientY);
    if (!w) return;
    const dx = w.x - frame.x, dy = w.y - frame.y;
    SceneCommands.setField(src, type, end === 'a' ? 'anchorA' : 'anchorB', 'vec2',
      [Math.round(dx * cos + dy * sin), Math.round(-dx * sin + dy * cos)]);
  };
  const onUp = () => {
    SceneCommands.endGesture();
    win.removeEventListener('pointermove', onMove);
    win.removeEventListener('pointerup', onUp);
  };
  win.addEventListener('pointermove', onMove);
  win.addEventListener('pointerup', onUp);
}

// Drag the prismatic/wheel axis tip → the slide direction. The axis lives in the
// CONNECTED body's local frame (Box2D localFrameA); written normalized so the
// inspector shows a clean unit direction (C++ normalizes anyway).
function startJointAxisDrag(rt: number, type: JointGizmoType, e: ReactPointerEvent): void {
  if (e.button !== 0) return;
  const src = SceneModel.sourceFor(rt);
  const frame = ViewportController.jointAxisFrame(rt, type);
  if (src == null || !frame) return;
  e.stopPropagation();
  const cos = Math.cos(frame.rot), sin = Math.sin(frame.rot);
  const win = eventWindow(e);
  SceneCommands.beginGesture(`${type} axis`);
  const onMove = (ev: PointerEvent) => {
    const w = ViewportController.canvasToWorld(ev.clientX, ev.clientY);
    if (!w) return;
    const dx = w.x - frame.x, dy = w.y - frame.y;
    const lx = dx * cos + dy * sin;
    const ly = -dx * sin + dy * cos;
    const len = Math.hypot(lx, ly);
    if (len < 1e-3) return; // a degenerate direction at the anchor itself — keep the last one
    const r3 = (v: number) => Math.round((v / len) * 1000) / 1000;
    SceneCommands.setField(src, type, 'axis', 'vec2', [r3(lx), r3(ly)]);
  };
  const onUp = () => {
    SceneCommands.endGesture();
    win.removeEventListener('pointermove', onMove);
    win.removeEventListener('pointerup', onUp);
  };
  win.addEventListener('pointermove', onMove);
  win.addEventListener('pointerup', onUp);
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
  { mode: 'select', icon: MousePointer2, label: t('vp.tool.select'), key: 'Q' },
  { mode: 'move', icon: Move, label: t('vp.tool.move'), key: 'W' },
  { mode: 'rotate', icon: RotateCw, label: t('vp.tool.rotate'), key: 'E' },
  { mode: 'scale', icon: Scale3d, label: t('vp.tool.scale'), key: 'R' },
];

// Increments offered by the viewport Snap dropdown: move (world units), rotate
// (degrees), scale (factor). All gated by the single `snapping` master toggle.
const SNAP_STEPS = [16, 32, 64];
const SNAP_ANGLES = [5, 15, 45, 90];
const SNAP_SCALES = [0.1, 0.25, 0.5];

// One-line hint shown under the coord readout, reflecting the active tool.
const TOOL_HINT: Record<ToolMode, string> = {
  select: t('vp.hint.select'),
  move: t('vp.hint.move'),
  rotate: t('vp.hint.rotate'),
  scale: t('vp.hint.scale'),
};

// Hint shown while painting a tilemap — replaces TOOL_HINT so the viewport speaks the
// paint vocabulary (and always points at Q/Esc as the way back to select/transform).
const TILE_HINT: Record<PaintTool, string> = {
  brush: t('vp.tileHint.brush'),
  erase: t('vp.tileHint.erase'),
  rect: t('vp.tileHint.rect'),
  ellipse: t('vp.tileHint.ellipse'),
  line: t('vp.tileHint.line'),
  bucket: t('vp.tileHint.bucket'),
  select: t('vp.tileHint.select', { mod: MOD_LABEL }),
  eyedropper: t('vp.tileHint.eyedropper'),
  terrain: t('vp.tileHint.terrain'),
};

// Label for the mode badge — the paint tool's short name.
const TILE_TOOL_LABEL: Record<PaintTool, string> = {
  brush: t('vp.tileTool.brush'), erase: t('vp.tileTool.erase'), rect: t('vp.tileTool.rect'), ellipse: t('vp.tileTool.ellipse'), line: t('vp.tileTool.line'),
  bucket: t('vp.tileTool.bucket'), select: t('vp.tileTool.select'), eyedropper: t('vp.tileTool.eyedropper'), terrain: t('vp.tileTool.terrain'),
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

// A viewport overlay dropdown (the "show flags" / "snap" menus): an .ovbtn
// trigger with an icon, a label, and a chevron, over a glass <Popover> holding
// the check/radio rows. Closes on item-click, outside press, scroll, or Escape.
function OvDropdown({
  icon: Icon,
  label,
  title,
  children,
}: {
  icon: LucideIcon;
  label: ReactNode;
  title?: string;
  children: ReactNode;
}) {
  const pop = usePopover();
  const btnRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`ovbtn${pop.isOpen ? ' open' : ''}`}
        title={title}
        aria-haspopup="menu"
        aria-expanded={pop.isOpen}
        onClick={() => (pop.isOpen ? pop.close() : pop.open(btnRef.current))}
      >
        <Icon className="ic" size={13} strokeWidth={1.9} />
        {label}
        <ChevronDown className="cv" size={9} strokeWidth={2.5} />
      </button>
      {/* Item clicks bubble to the menu to dismiss; each runs its own handler. */}
      {pop.isOpen && pop.anchor && (
        <Popover anchor={pop.anchor} width="auto" className="popover--glass" onClose={pop.close}>
          <div role="menu" onClick={pop.close}>
            {children}
          </div>
        </Popover>
      )}
    </>
  );
}

// Multi-toggle menu row (checkbox box) — for the Show Flags menu.
function DdCheck({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <div className={`ovmenu-item${on ? ' on' : ''}`} role="menuitemcheckbox" aria-checked={on} onClick={onClick}>
      <span className="chk">{on && <Check size={8} strokeWidth={3.5} />}</span>
      <span className="l">{label}</span>
    </div>
  );
}

// Single-select menu row (tick mark, shown when active) — for the Snap menu.
function DdRadio({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <div className={`ovmenu-item${on ? ' on' : ''}`} role="menuitemradio" aria-checked={on} onClick={onClick}>
      <span className="tk"><Check size={11} strokeWidth={3} /></span>
      <span className="l">{label}</span>
    </div>
  );
}

// Only this node re-renders per mouse move; the HUD follows the slow stats cadence.
function HudCursor() {
  const cursor = useSyncExternalStore(StatsStore.subscribeCursor, StatsStore.getCursor);
  const tile = useSyncExternalStore(StatsStore.subscribeTile, StatsStore.getTile);
  if (!cursor && !tile) return null;
  return (
    <>
      {cursor && <strong>{cursor.x}, {cursor.y}</strong>}
      {tile && (
        <span className="hud-tile">
          {' '}▦ {tile.tx}, {tile.ty}{tile.id ? ` #${tile.id}` : ''}
        </span>
      )}{' '}
      ·{' '}
    </>
  );
}

// The corner HUD (perf + coordinates). Owns the StatsStore subscription so the
// slow stats updates re-render ONLY this leaf — not the whole, gizmo-heavy
// Viewport.
function ViewportHud({ ready, selCount, zoomPct, tool, paintHint }: {
  ready: boolean;
  selCount: number;
  zoomPct: number;
  tool: ToolMode;
  /** When painting a tilemap, the tile-vocabulary hint replaces the transform hint. */
  paintHint: string | null;
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
            <span className="k">{t('vp.hud.frame')}</span>
            <span className="v">{stats.fps > 0 ? (1000 / stats.fps).toFixed(1) : '—'} ms</span>
          </div>
          <div className="pr">
            <span className="k">{t('vp.hud.entities')}</span>
            <span className="v">{stats.entities}</span>
          </div>
        </div>
      )}
      <div className="vp-coord">
        <div className="ro">
          <HudCursor />
          {t('vp.hud.sel')} <strong>{selCount}</strong> · {zoomPct}%
        </div>
        <div className="hint">{paintHint ?? TOOL_HINT[tool]}</div>
      </div>
    </>
  );
}

export function Viewport() {
  // The window this viewport currently lives in — main, or its own OS window once
  // popped out. Drives resize re-binding and any window-scoped listeners below.
  const win = usePanelWindow();
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const playTarget = useEditorStore((s) => s.playTarget);
  const tool = useEditorStore((s) => s.tool);
  const showGrid = useEditorStore((s) => s.showGrid);
  const showGizmos = useEditorStore((s) => s.showGizmos);
  const showColliders = useEditorStore((s) => s.showColliders);
  const showTileCollision = useEditorStore((s) => s.showTileCollision);
  const previewFx = useEditorStore((s) => s.previewFx);
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
  // Tile-editing context: a paint tool active over a selected TilemapLayer. Drives the
  // viewport mode badge, the HUD hint, and the tile-sized reference grid.
  const paintTool = useTilemapPaint((s) => s.tool);
  const tilemapSelected = primaryId != null
    && !!SceneModel.entityBySource(primaryId)?.components.some((c) => c.type === 'TilemapLayer');
  const inTilePaint = paintTool != null && tilemapSelected;
  // Active editing mode drives the viewport badge and the design-resolution overlay.
  // Derived from the pin + selection, so subscribe to the pin here.
  useEditorMode((s) => s.pinned);
  const mode = activeMode();
  // Device-preview controls for the design-resolution overlay (the rAF reads these via
  // getState(); the subscriptions keep the device dropdown label current). Available in
  // any editor mode — a device preview is a screen concern, not a UI-layer one.
  const device = useEditorMode((s) => s.device);
  const orientation = useEditorMode((s) => s.orientation);
  const showSafeArea = useEditorMode((s) => s.showSafeArea);
  // Project design resolution — the reference the preview falls back to when the scene
  // has no Canvas (so gameplay-only scenes preview on devices too). Reactive for the label.
  const projectState = useSyncExternalStore(ProjectStore.subscribe, ProjectStore.getSnapshot);
  const projectDesign = projectState?.designResolution ?? { width: 1920, height: 1080 };
  // The scene's Canvas + its authored design resolution — the value the Design control
  // edits (the single source of truth). Re-read on any model change so the label tracks.
  const dataRev = useSyncExternalStore(SceneStore.subscribe, SceneStore.getRevision);
  const sceneCanvas = useMemo(() => {
    void dataRev;
    const id = SceneCommands.findCanvas();
    if (id == null) return null;
    const d = SceneModel.entityBySource(id)?.components.find((c) => c.type === 'Canvas')?.data as
      | { designResolution?: { x: number; y: number } }
      | undefined;
    return { id, x: d?.designResolution?.x ?? 0, y: d?.designResolution?.y ?? 0 };
  }, [dataRev]);
  // WYSIWYG brush ghost: the actual stamp tiles, built once per stamp/atlas change and
  // laid out at natural tile pixels; the rAF scales the container to the hovered
  // footprint each frame (see the tile-preview block). Empty (null) → the plain box shows.
  const stamp = useTilemapPaint((s) => s.stamp);
  const activeAtlas = useTilemapPaint((s) => s.activeAtlas);
  // Random mode lays an unpredictable sample per cell — a WYSIWYG pattern ghost
  // would promise the wrong tiles, so fall back to the plain outline box.
  const randomBrush = useTilemapPaint((s) => s.randomBrush);
  const ghostCells = useMemo(
    () => (randomBrush ? null : buildStampGhost(stamp, activeAtlas)),
    [stamp, activeAtlas, randomBrush],
  );
  const ghostNat = ghostCells && activeAtlas
    ? { w: stamp.w * activeAtlas.tileW, h: stamp.h * activeAtlas.tileH }
    : null;

  const stageRef = useRef<HTMLDivElement>(null);
  const playHostRef = useRef<HTMLDivElement>(null);
  const gizmoRef = useRef<HTMLDivElement>(null);
  const uiGizmoRef = useRef<HTMLDivElement>(null);
  const designSvgRef = useRef<SVGSVGElement>(null);
  const designLabelRef = useRef<HTMLDivElement>(null);
  // One outline div per selected entity, keyed by source id and positioned by the rAF.
  const selRefs = useRef(new Map<number, HTMLDivElement | null>());
  const marqueeRef = useRef<HTMLDivElement>(null);
  const tileSelRef = useRef<HTMLDivElement>(null);
  const tilePreviewRef = useRef<HTMLDivElement>(null);
  const tileGhostRef = useRef<HTMLDivElement>(null);
  // Gesture-paint preview (rect fill / line cells): a container whose ghost-cell
  // children are pooled + positioned imperatively in the rAF (rect/line defer their
  // commit to release, so this shows the shape mid-drag).
  const tilePaintRef = useRef<HTMLDivElement>(null);
  const paintPoolRef = useRef<HTMLDivElement[]>([]);
  const hoverTileRef = useRef<{ x: number; y: number } | null>(null);
  // Orientation-aware overlay for non-orthogonal maps (iso/staggered/hex): one SVG
  // whose shaped-cell paths (grid + selection + gesture + hover) replace the square
  // engine grid and the axis-aligned div ghost, which only fit an orthogonal grid.
  const tileGridRef = useRef<SVGSVGElement | null>(null);
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
  // Tile-collision overlay: the selected TilemapLayer's per-tile collision, drawn into
  // ONE SVG (not one per tile). Its world-space outlines are (re)built into a ref by the
  // effect below whenever the layer / its content changes; the rAF projects them each
  // frame. The tileset model is cached (keyed by the layer's tileset refs) so a paint
  // stroke rebuilds outlines without re-reading the .estileset(s) from disk.
  const tileColRef = useRef<SVGSVGElement | null>(null);
  const tileColPiecesRef = useRef<TileCollisionPiece[]>([]);
  const tileColModelRef = useRef<{ key: string; model: TilesetModel | null }>({ key: '', model: null });
  useEffect(() => {
    const clear = () => { tileColPiecesRef.current = []; };
    if (engine.status !== 'ready' || !showTileCollision || !tilemapSelected || primaryId == null) {
      clear();
      tileColModelRef.current = { key: '', model: null };
      return;
    }
    const refs = layerTilesetRefs(primaryId);
    const key = refs.join('|');
    const build = () => {
      const model = tileColModelRef.current.model;
      tileColPiecesRef.current = model ? ViewportController.tilemapColliderOutlines(primaryId, model) : [];
    };
    // Same tileset list as last time → reuse the cached model, just re-read the tiles.
    if (tileColModelRef.current.key === key && tileColModelRef.current.model) { build(); return; }
    // Tileset refs changed (or first show): reload the model, then build once it lands.
    let alive = true;
    clear();
    void loadLayerTilesetModel(refs).then((model) => {
      if (!alive) return;
      tileColModelRef.current = { key, model };
      build();
    });
    return () => { alive = false; };
  }, [engine.status, showTileCollision, tilemapSelected, primaryId, dataRev]);

  // Scene-authored joints are equally invisible — draw each as an anchor link (plus
  // axis/velocity direction). Keyed by entity + joint type; same physics show flag.
  const jointRefs = useRef(new Map<string, SVGSVGElement | null>());
  const jointKeys = useMemo(
    () => (engine.status === 'ready' && showColliders ? ViewportController.jointGizmoKeys() : []),
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

  // When the viewport is popped out into (or docked back from) its own OS window, the
  // engine canvas rides the DOM move — a same-origin move keeps its live GL context —
  // but its resize observer must re-bind to the new window so the canvas keeps sizing
  // to the panel. (No re-attach: re-parenting/re-booting the engine would be wasteful.)
  useEffect(() => {
    const stage = stageRef.current;
    if (stage) EngineHost.rebindResize(stage);
  }, [win]);

  // Drive the engine's world-space editor grid from Show-Flags (Grid) + Snap
  // step. Re-applied when the engine becomes ready, since the grid resource
  // exists only after boot. Play/edit gating lives in the renderer (EditorView).
  // While a tilemap is selected the grid matches its cell size (not the transform
  // snap step) so the lines read as the tile grid you're painting on. (The grid is
  // world-origin-anchored; a non-origin tilemap won't perfectly register until the
  // origin-offset support lands.)
  useEffect(() => {
    if (engine.status !== 'ready') return;
    // Non-orthogonal maps draw their own shaped grid (viewport__tilegrid), so turn the
    // engine's square grid off for them — a square grid over an iso/hex map misleads.
    const nonOrtho = primaryId != null && ViewportController.tileLayerIsNonOrthogonal(primaryId);
    const cell = selectedTilemapCellSize();
    EngineHost.setGrid(showGrid && !nonOrtho, cell ? cell.x : snapStep);
  }, [showGrid, snapStep, primaryId, engine.status, dataRev]);

  // Play In Viewport (UE5 PIE): host the realm iframe over the stage while playing
  // here. The host div is PERSISTENT (mounted whenever the viewport is the play
  // target, parked off-screen when not playing) so the realm's wasm + GL survive
  // Stop and a re-Play is a warm scene swap — moving an iframe between parents
  // reloads it, so it must never leave this host. Re-attach on a target switch AND
  // when the viewport is popped out / docked back (`win`): the iframe rides the DOM
  // to the new window, so PlayRealm must re-bind its message listener to that window
  // (attach does), or the realm→editor handshake is stranded on the old one.
  const playInViewport = isPlaying && playTarget === 'viewport';
  useEffect(() => {
    if (playTarget !== 'viewport') return;
    const host = playHostRef.current;
    if (host) PlayRealm.attach(host);
    return () => PlayRealm.detach();
  }, [playTarget, win]);

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

      // UI resize gizmo: a single selected UINode gets edge/corner handles on its
      // screen rect (getEntityScreenRect — the same rect the selection outline uses).
      const uig = uiGizmoRef.current;
      if (uig) {
        const pid = useSelection.getState().selectedId;
        const prt = ready && pid != null && selIds.length === 1 ? SceneModel.runtimeFor(pid) : undefined;
        const uir = prt != null && EngineHost.world?.has(prt, UINode) ? ViewportController.getEntityScreenRect(prt) : null;
        if (uir && showG) {
          uig.style.transform = `translate(${uir.x}px, ${uir.y}px)`;
          uig.style.width = `${uir.w}px`;
          uig.style.height = `${uir.h}px`;
          uig.style.opacity = '1';
        } else {
          uig.style.opacity = '0';
        }
      }

      // Design-resolution overlay (UI mode): the Canvas' authored design frame, the
      // simulated device's visible frame, its letterbox bars, and the safe-area inset,
      // all projected from world each frame so they lock to pan/zoom.
      const dsvg = designSvgRef.current;
      if (dsvg) {
        // Show the design/device overlay in UI mode (design frame always) OR in any mode
        // once a real device is picked — reading the project design resolution when the
        // scene has no Canvas, so a gameplay scene previews on devices without a UI layer.
        const ms0 = useEditorMode.getState();
        const ci = ready && showG && (activeModeOverlays().designFrame || ms0.device !== 'design')
          ? ViewportController.screenInfo()
          : null;
        // The design frame lives in the UI world scale: 1 unit = 1 design px (the invariant
        // CameraPlugin's uiLayoutRect / buildCameraInfo use). pixelsPerUnit is physics-only
        // and must NOT scale it, or the frame renders 100× off from where UI lays out.
        const des = ci
          ? worldRectToScreen(ci.cx, ci.cy, ci.designResolution.x / 2, ci.designResolution.y / 2)
          : null;
        if (ci && des) {
          dsvg.style.opacity = '1';
          const ms = useEditorMode.getState();
          const preset = RESOLUTION_PRESET_BY_ID[ms.device];
          // Device visible frame: the design resolution fit into the simulated device's
          // aspect per the Canvas scaleMode. `dd` is the oriented device size (null for the
          // 'design' sentinel) — the SAME source App.tsx feeds to uiLayoutRect, so this
          // frame and the actual UI layout share one aspect and can't drift.
          const dd = deviceDims(ms.device, ms.orientation);
          let dev = des;
          if (dd) {
            const deviceAspect = dd.w / dd.h;
            const designAspect = ci.designResolution.x / ci.designResolution.y;
            const halfH = computeEffectiveOrthoSize(
              ci.designResolution.y / 2, designAspect, deviceAspect, ci.scaleMode, ci.matchWidthOrHeight,
            );
            dev = worldRectToScreen(ci.cx, ci.cy, halfH * deviceAspect, halfH) ?? des;
          }
          setRectAttrs(dsvg.querySelector('.df-design'), des);
          setRectAttrs(dsvg.querySelector('.df-device'), dev);
          // Everything-outside-the-screen shading, drawn as one even-odd path (an outer
          // rect with the design rect punched out). Two cases share the geometry:
          //  • a simulated device that CONTAINS the design → the device's letterbox bars,
          //    tinted the canvas background (how the game bars would look on that screen);
          //  • the 'design' device (no simulation) → the design frame IS the screen, so
          //    dim the rest of the free scene view with a neutral scrim. Without this the
          //    authored resolution is only a thin outline and reads as "still landscape".
          // A device that CROPS the design (dev smaller) shows no bars.
          const lb = dsvg.querySelector('.df-letterbox') as SVGPathElement | null;
          if (lb) {
            const punch = (o: { x: number; y: number; w: number; h: number }): string =>
              `M${o.x},${o.y}h${o.w}v${o.h}h${-o.w}Z M${des.x},${des.y}h${des.w}v${des.h}h${-des.w}Z`;
            const hasDevice = dd != null;
            const deviceContains =
              dev.w >= des.w - 0.5 && dev.h >= des.h - 0.5 && (dev.w > des.w + 0.5 || dev.h > des.h + 0.5);
            if (hasDevice && deviceContains) {
              lb.setAttribute('d', punch(dev));
              const bg = ci.backgroundColor;
              lb.style.fill = `rgba(${Math.round(bg.r * 255)},${Math.round(bg.g * 255)},${Math.round(bg.b * 255)},0.55)`;
              lb.style.opacity = '1';
            } else if (!hasDevice) {
              lb.setAttribute('d', punch({ x: 0, y: 0, w: dsvg.clientWidth, h: dsvg.clientHeight }));
              lb.style.fill = 'rgba(0,0,0,0.32)';
              lb.style.opacity = '1';
            } else {
              lb.style.opacity = '0';
            }
          }
          // Safe-area inset within the device frame (device px → screen px by the frame ratio).
          const safe = dsvg.querySelector('.df-safe') as SVGRectElement | null;
          if (safe) {
            if (ms.showSafeArea && preset.safe && dd) {
              const sx = dev.w / dd.w;
              const sy = dev.h / dd.h;
              setRectAttrs(safe, {
                x: dev.x + preset.safe.left * sx,
                y: dev.y + preset.safe.top * sy,
                w: dev.w - (preset.safe.left + preset.safe.right) * sx,
                h: dev.h - (preset.safe.top + preset.safe.bottom) * sy,
              });
              safe.style.opacity = '1';
            } else {
              safe.style.opacity = '0';
            }
          }
          // The authored resolution, pinned to the frame's top-left corner but clamped
          // into the viewport — when the frame corner pans off-screen the label sticks
          // to the nearest edge instead of getting clipped away.
          const dlabel = designLabelRef.current;
          if (dlabel) {
            dlabel.textContent = `${ci.designResolution.x} × ${ci.designResolution.y}`;
            // Top clamp clears the .ov-tl floating toolbar (top:10 + ~34px tall).
            const lx = Math.min(Math.max(des.x + 4, 4), Math.max(dsvg.clientWidth - dlabel.offsetWidth - 4, 4));
            const ly = Math.min(Math.max(des.y + 4, 48), Math.max(dsvg.clientHeight - dlabel.offsetHeight - 4, 48));
            dlabel.style.transform = `translate(${lx}px, ${ly}px)`;
            dlabel.style.opacity = '1';
          }
        } else {
          dsvg.style.opacity = '0';
          const dlabel = designLabelRef.current;
          if (dlabel) dlabel.style.opacity = '0';
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
        // Non-orthogonal maps route ALL tile overlays through the shaped SVG below, so the
        // axis-aligned div marquee/ghost/preview stay hidden (their corner math is square).
        const nonOrtho = ready && sid != null && ViewportController.tileLayerIsNonOrthogonal(sid);
        const tsel = paint.tool === 'select' ? paint.selection : null;
        const layer = ready && sid != null
          ? SceneModel.entityBySource(sid)?.components.find((c) => c.type === 'TilemapLayer')
          : undefined;
        const cs = layer?.data as { cellSize?: { x: number; y: number } } | undefined;
        const origin = ready && rt != null ? ViewportController.getEntityWorldXY(rt) : null;
        if (tsel && cs?.cellSize && origin && !nonOrtho) {
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

        // Hover preview at the cursor cell. The BRUSH shows a WYSIWYG ghost of the actual
        // stamp tiles (viewport__tileghost — built in React, scaled to the footprint here);
        // erase sizes the plain box to the stamp; the other tools mark a single cell.
        // Hidden for rect/line while their gesture preview draws the shape.
        const dragging = TilePaintPreview.get() != null;
        const hov = hoverTileRef.current;
        const gesturing = dragging && (paint.tool === 'rect' || paint.tool === 'line' || paint.tool === 'ellipse');
        // Random brush lays ONE sampled tile per cell, so its footprint is 1×1 — only a
        // pattern brush (or erase, which clears the whole w×h) previews at the stamp size.
        const stampSized = paint.tool === 'erase' || (paint.tool === 'brush' && !paint.randomBrush);
        const canFoot = !!(paint.tool && !gesturing && hov && cs?.cellSize && origin && !nonOrtho);
        // Footprint corners in client px (fw×fh cells at the hovered cell).
        let ftl: { x: number; y: number } | null = null;
        let fbr: { x: number; y: number } | null = null;
        if (canFoot && hov && cs?.cellSize && origin) {
          const fw = stampSized ? paint.stamp.w : 1;
          const fh = stampSized ? paint.stamp.h : 1;
          ftl = ViewportController.worldToClient(origin.x + hov.x * cs.cellSize.x, origin.y - hov.y * cs.cellSize.y);
          fbr = ViewportController.worldToClient(origin.x + (hov.x + fw) * cs.cellSize.x, origin.y - (hov.y + fh) * cs.cellSize.y);
        }

        const gh = tileGhostRef.current;
        // Brush + a resolved ghost → the WYSIWYG tile preview owns the hover; else the box.
        const useGhost = paint.tool === 'brush' && !!paint.activeAtlas
          && !!gh && gh.childElementCount > 0;
        if (gh) {
          if (useGhost && ftl && fbr && paint.activeAtlas) {
            const natW = paint.stamp.w * paint.activeAtlas.tileW;
            const natH = paint.stamp.h * paint.activeAtlas.tileH;
            gh.style.transform =
              `translate(${ftl.x}px, ${ftl.y}px) scale(${(fbr.x - ftl.x) / natW}, ${(fbr.y - ftl.y) / natH})`;
            gh.style.opacity = '1';
          } else {
            gh.style.opacity = '0';
          }
        }
        const pv = tilePreviewRef.current;
        if (pv) {
          if (!useGhost && canFoot && ftl && fbr) {
            pv.style.transform = `translate(${ftl.x}px, ${ftl.y}px)`;
            pv.style.width = `${fbr.x - ftl.x}px`;
            pv.style.height = `${fbr.y - ftl.y}px`;
            pv.style.opacity = '1';
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
          if (shape && cs?.cellSize && origin && !nonOrtho) {
            const cw = cs.cellSize.x;
            const ch = cs.cellSize.y;
            const place = (tx: number, ty: number, w: number, h: number): void => {
              const tl = ViewportController.worldToClient(origin.x + tx * cw, origin.y - ty * ch);
              const br = ViewportController.worldToClient(origin.x + (tx + w) * cw, origin.y - (ty + h) * ch);
              if (!tl || !br) return;
              let cell = pool[used];
              if (!cell) {
                // Create in the stage's own document so pooled cells belong to the
                // popped-out window rather than being adopted across documents.
                cell = pp.ownerDocument.createElement('div');
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

      // Orientation-aware tile overlay (iso / staggered / hex): the shaped grid + the
      // selection / gesture-preview / hover cells, all built from the SAME cell geometry
      // the runtime places tiles with, so the outlines sit exactly on the drawn tiles.
      const tgSvg = tileGridRef.current;
      if (tgSvg) {
        const sid = useSelection.getState().selectedId;
        const gp = ready && sid != null && !useEditorStore.getState().isPlaying
          ? ViewportController.tileGridParams(sid) : null;
        const setD = (sel: string, d: string) => {
          const el = tgSvg.querySelector(sel) as SVGPathElement | null;
          if (el) el.setAttribute('d', d);
        };
        if (gp && sid != null && isNonOrthogonal(gp.params.orientation)) {
          const { params, origin } = gp;
          const paint = useTilemapPaint.getState();
          const rangeCells = (x0: number, y0: number, x1: number, y1: number): { x: number; y: number }[] => {
            const cells: { x: number; y: number }[] = [];
            for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) cells.push({ x: tx, y: ty });
            return cells;
          };
          // Grid: visible cells, faint. Off when the grid flag is off or too zoomed out.
          let gridD = '';
          if (useEditorStore.getState().showGrid) {
            const range = ViewportController.visibleTileRange(sid, origin, TILE_GRID_CELL_CAP);
            if (range) {
              gridD = ViewportController.projectTileCellPaths(
                params, origin, rangeCells(range.x0, range.y0, range.x1, range.y1), 96,
              );
            }
          }
          setD('.tg-grid', gridD);
          // Selection marquee cells.
          const sel = paint.tool === 'select' ? paint.selection : null;
          setD('.tg-select', sel
            ? ViewportController.projectTileCellPaths(params, origin, rangeCells(
                Math.min(sel.x0, sel.x1), Math.min(sel.y0, sel.y1), Math.max(sel.x0, sel.x1), Math.max(sel.y0, sel.y1),
              ))
            : '');
          // Gesture preview (rect fill box / line / ellipse cells).
          const shape = TilePaintPreview.get();
          let prevD = '';
          if (shape) {
            const cells = shape.kind === 'rect'
              ? rangeCells(Math.min(shape.x0, shape.x1), Math.min(shape.y0, shape.y1), Math.max(shape.x0, shape.x1), Math.max(shape.y0, shape.y1))
              : shape.cells;
            prevD = ViewportController.projectTileCellPaths(params, origin, cells);
          }
          setD('.tg-preview', prevD);
          // Hover footprint (the cells the brush will lay), unless a gesture is drawing.
          const hov = hoverTileRef.current;
          let hovD = '';
          if (hov && paint.tool && paint.tool !== 'select' && !shape) {
            const stampSized = paint.tool === 'erase' || (paint.tool === 'brush' && !paint.randomBrush);
            const cells: { x: number; y: number }[] = stampSized
              ? rangeCells(hov.x, hov.y, hov.x + paint.stamp.w - 1, hov.y + paint.stamp.h - 1)
              : [{ x: hov.x, y: hov.y }];
            hovD = ViewportController.projectTileCellPaths(params, origin, cells);
          }
          setD('.tg-hover', hovD);
          tgSvg.style.display = '';
        } else {
          tgSvg.style.display = 'none';
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

      // Collider gizmos — the merged outline of EVERY collider shape (box/circle/capsule/
      // segment/polygon/chain), one <svg> per entity, all via the shared shape-outline
      // projection. Resolve the scene-wide pixelsPerUnit once, not once per collider.
      const colliderPpu = camsOn ? ViewportController.colliderPixelsPerUnit() : 0;
      for (const [cid, svg] of colliderRefs.current) {
        if (!svg) continue;
        const cg = camsOn ? ViewportController.getColliderGizmo(cid, colliderPpu) : null;
        const outline = svg.querySelector('.cl-outline') as SVGPathElement | null;
        const outlineS = svg.querySelector('.cl-outline-sensor') as SVGPathElement | null;
        if (outline) outline.setAttribute('d', cg?.outline ?? '');
        if (outlineS) outlineS.setAttribute('d', cg?.outlineSensor ?? '');
        // Scalar handles: box corner size (cl-size-handle) / circle radius (cl-handle).
        const csz = svg.querySelector('.cl-size-handle') as SVGCircleElement | null;
        if (csz) {
          if (cg?.sizeHandle) { csz.setAttribute('cx', String(cg.sizeHandle.x)); csz.setAttribute('cy', String(cg.sizeHandle.y)); csz.style.display = ''; }
          else csz.style.display = 'none';
        }
        const chnd = svg.querySelector('.cl-handle') as SVGCircleElement | null;
        if (chnd) {
          if (cg?.radiusHandle) { chnd.setAttribute('cx', String(cg.radiusHandle.x)); chnd.setAttribute('cy', String(cg.radiusHandle.y)); chnd.style.display = ''; }
          else chnd.style.display = 'none';
        }
        // Point handles: polygon vertices / chain points / segment endpoints / offsets,
        // pooled in the <g> (their count varies with the shape).
        const g = svg.querySelector('.cl-points') as SVGGElement | null;
        if (g) syncColliderPoints(g, cg?.points ?? []);
        // One-way platform: an arrow out of the collider center along the solid-side
        // normal (screen-fixed length, so it reads at any zoom) — the side a body can
        // land on; it passes through from the other.
        const owLine = svg.querySelector('.cl-oneway') as SVGLineElement | null;
        const owHead = svg.querySelector('.cl-oneway-head') as SVGPolygonElement | null;
        if (cg?.oneWay) {
          const L = 30;
          const { cx, cy, dx, dy } = cg.oneWay;
          const bx = cx + dx * L;
          const by = cy + dy * L;
          if (owLine) {
            owLine.setAttribute('x1', String(cx));
            owLine.setAttribute('y1', String(cy));
            owLine.setAttribute('x2', String(bx));
            owLine.setAttribute('y2', String(by));
            owLine.style.opacity = '1';
          }
          if (owHead) {
            const px = -dy;
            const py = dx;
            owHead.setAttribute('points', [
              `${bx + dx * 9},${by + dy * 9}`,
              `${bx + px * 4.5},${by + py * 4.5}`,
              `${bx - px * 4.5},${by - py * 4.5}`,
            ].join(' '));
            owHead.style.opacity = '1';
          }
        } else {
          if (owLine) owLine.style.opacity = '0';
          if (owHead) owHead.style.opacity = '0';
        }
      }

      // Tile-collision overlay — the selected layer's per-tile collision, all in one SVG.
      // Pieces are prebuilt in world space (the effect above); here we only project them
      // to screen paths, culled to the visible world rect. Empty (flag off / no layer /
      // still loading) clears the paths cheaply.
      const tcSvg = tileColRef.current;
      if (tcSvg) {
        const pieces = tileColPiecesRef.current;
        const paths = ready && !useEditorStore.getState().isPlaying && pieces.length > 0
          ? ViewportController.projectTileCollision(pieces)
          : null;
        const setD = (sel: string, d: string) => {
          const el = tcSvg.querySelector(sel) as SVGPathElement | null;
          if (el) el.setAttribute('d', d);
        };
        setD('.tc-solid', paths?.solid ?? '');
        setD('.tc-sensor', paths?.sensor ?? '');
        setD('.tc-oneway', paths?.onewayLine ?? '');
        setD('.tc-oneway-head', paths?.onewayHead ?? '');
      }

      // Joint gizmos — the anchor-to-anchor link (own body ↔ connected body), the
      // prismatic/wheel slide axis, and the motor joint's target-velocity arrow.
      // Unlinked joints (no connectedEntity yet) show just their own anchor dot.
      for (const [key, svg] of jointRefs.current) {
        if (!svg) continue;
        const sep = key.indexOf(':');
        const jg = camsOn
          ? ViewportController.getJointGizmo(Number(key.slice(0, sep)), key.slice(sep + 1) as JointGizmoType)
          : null;
        const line = svg.querySelector('.jt-line') as SVGLineElement | null;
        const dotA = svg.querySelector('.jt-a') as SVGCircleElement | null;
        const dotB = svg.querySelector('.jt-b') as SVGCircleElement | null;
        const axis = svg.querySelector('.jt-axis') as SVGLineElement | null;
        const vel = svg.querySelector('.jt-vel') as SVGLineElement | null;
        const velHead = svg.querySelector('.jt-vel-head') as SVGPolygonElement | null;
        if (!jg) {
          svg.style.opacity = '0';
          continue;
        }
        svg.style.opacity = jg.on ? '1' : '0.35';
        if (dotB) {
          dotB.setAttribute('cx', String(jg.b.x));
          dotB.setAttribute('cy', String(jg.b.y));
        }
        if (line) {
          if (jg.a) {
            line.setAttribute('x1', String(jg.b.x));
            line.setAttribute('y1', String(jg.b.y));
            line.setAttribute('x2', String(jg.a.x));
            line.setAttribute('y2', String(jg.a.y));
            line.style.opacity = '1';
          } else {
            line.style.opacity = '0';
          }
        }
        if (dotA) {
          if (jg.a) {
            dotA.setAttribute('cx', String(jg.a.x));
            dotA.setAttribute('cy', String(jg.a.y));
            dotA.style.opacity = '1';
          } else {
            dotA.style.opacity = '0';
          }
        }
        if (axis) {
          if (jg.a && jg.axis) {
            axis.setAttribute('x1', String(jg.a.x - jg.axis.dx * 26));
            axis.setAttribute('y1', String(jg.a.y - jg.axis.dy * 26));
            axis.setAttribute('x2', String(jg.a.x + jg.axis.dx * 26));
            axis.setAttribute('y2', String(jg.a.y + jg.axis.dy * 26));
            axis.style.opacity = '1';
          } else {
            axis.style.opacity = '0';
          }
        }
        // Axis drag handle (prismatic/wheel only — the element exists just there)
        // at the +axis tip of the visual line.
        const axisHandle = svg.querySelector('.jt-axis-handle') as SVGCircleElement | null;
        if (axisHandle) {
          if (jg.a && jg.axis) {
            axisHandle.setAttribute('cx', String(jg.a.x + jg.axis.dx * 26));
            axisHandle.setAttribute('cy', String(jg.a.y + jg.axis.dy * 26));
            axisHandle.style.display = '';
          } else {
            axisHandle.style.display = 'none';
          }
        }
        // Motor target velocity: arrow out of the driven body's anchor.
        if (jg.vel) {
          const L = 30;
          const tx = jg.b.x + jg.vel.dx * L;
          const ty = jg.b.y + jg.vel.dy * L;
          if (vel) {
            vel.setAttribute('x1', String(jg.b.x));
            vel.setAttribute('y1', String(jg.b.y));
            vel.setAttribute('x2', String(tx));
            vel.setAttribute('y2', String(ty));
            vel.style.opacity = '1';
          }
          if (velHead) {
            const px = -jg.vel.dy;
            const py = jg.vel.dx;
            velHead.setAttribute('points', [
              `${tx + jg.vel.dx * 9},${ty + jg.vel.dy * 9}`,
              `${tx + px * 4.5},${ty + py * 4.5}`,
              `${tx - px * 4.5},${ty - py * 4.5}`,
            ].join(' '));
            velHead.style.opacity = '1';
          }
        } else {
          if (vel) vel.style.opacity = '0';
          if (velHead) velHead.style.opacity = '0';
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
        // Aim wedge (Point/Rect): the angleSpread arc particles will fly into. The
        // full-circle default draws nothing, so it only appears once aimed.
        const spread = svg ? (svg.querySelector('.pe-spread') as SVGPolygonElement | null) : null;
        if (spread) {
          if (pg && pg.spread) {
            spread.setAttribute('points', pg.spread.map((p) => `${p.x},${p.y}`).join(' '));
            spread.style.opacity = pg.on ? '0.7' : '0.3';
          } else {
            spread.style.opacity = '0';
          }
        }
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

  // Esc, capture phase (pre-empts the global keymap's Esc→stop-play), in priority
  // order: cancel an in-progress stroke → cancel a pan → leave paint mode. There is
  // deliberately no global Esc→deselect: transient UI (menus, popovers, dialogs)
  // closes on Esc without stopping propagation, so a global binding would drop the
  // selection every time one of them is dismissed.
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
      } else if (isTilePaintMode()) {
        exitTilePaint();
        e.stopImmediatePropagation();
      }
    };
    win.addEventListener('keydown', onKey, true);
    return () => win.removeEventListener('keydown', onKey, true);
  }, [toolCtx, win]);

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
    const tile = sid != null && isTm ? cursorTile(e.clientX, e.clientY, sid) : null;
    hoverTileRef.current = tile;
    // HUD tile readout: the hovered cell + its current id (0 = empty), so you always know
    // exactly which cell you're about to paint.
    if (tile && sid != null) {
      const rt = SceneModel.runtimeFor(sid);
      StatsStore.setTile(tile.x, tile.y, rt != null ? tileIdOf(TilemapAPI.getTile(rt, tile.x, tile.y)) : 0);
    } else {
      StatsStore.clearTile();
    }

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
  // spawns a Sprite entity sized to the texture; a `.estileset` spawns a paintable
  // TilemapLayer.
  const isAssetDrag = (e: ReactDragEvent) =>
    e.dataTransfer.types.includes('application/x-estella-asset') ||
    e.dataTransfer.types.includes(SOURCE_DND_MIME);

  const dropHintRef = useRef<HTMLDivElement>(null);
  const hideDropHint = () => { if (dropHintRef.current) dropHintRef.current.style.opacity = '0'; };

  const onDragOver = (e: ReactDragEvent) => {
    if (!isAssetDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    // Live nest-target feedback for palette drags: outline the container the widget
    // would nest into. The Canvas root gets no outline — an empty-area drop reads
    // as before. (Drag data VALUES are sealed during dragover; types are readable.)
    const hint = dropHintRef.current;
    if (!hint) return;
    let r: { x: number; y: number; w: number; h: number } | null = null;
    if (e.dataTransfer.types.includes(SOURCE_DND_MIME)) {
      const src = uiDropParent(e.clientX, e.clientY);
      const comps = src != null ? SceneModel.entityBySource(src)?.components : undefined;
      if (src != null && comps && !comps.some((c) => c.type === 'Canvas')) {
        const rt = SceneModel.runtimeFor(src);
        const obb = rt != null ? ViewportController.uiEntityWorldOBB(rt) : null;
        if (obb) r = worldRectToScreen(obb.cx, obb.cy, obb.hw, obb.hh);
      }
    }
    if (r) {
      hint.style.opacity = '1';
      hint.style.transform = `translate(${r.x}px, ${r.y}px)`;
      hint.style.width = `${r.w}px`;
      hint.style.height = `${r.h}px`;
    } else {
      hint.style.opacity = '0';
    }
  };

  // The deepest plain layout container under the pointer — the drop parent for a
  // UI widget, so dropping onto a panel nests inside it (Figma-style) instead of
  // always landing at the Canvas root. "Plain container" = a UINode that is not a
  // widget behavior root, an interactive hit-area, a text leaf, or widget-internal
  // chrome (builtin widget internals all carry ThemeStyle; user containers don't).
  const uiDropParent = (clientX: number, clientY: number): EntityId | null => {
    const NOT_CONTAINER = ['Text', 'Interactable', 'Focusable', 'ThemeStyle',
      'UIToggle', 'UISlider', 'UIDropdown', 'UIDialog', 'TextInput'];
    for (const rt of ViewportController.pickUIEntities(clientX, clientY)) {
      const src = SceneModel.sourceFor(rt);
      const comps = src != null ? SceneModel.entityBySource(src)?.components : undefined;
      if (!comps) continue;
      if (comps.some((c) => c.type === 'UINode') && !comps.some((c) => NOT_CONTAINER.includes(c.type))) return src!;
    }
    return null;
  };

  const onDrop = (e: ReactDragEvent) => {
    hideDropHint();
    // A widget dragged from the UI palette: create it at the drop point — nested
    // in the container under the pointer when there is one, else under the Canvas
    // via its placement rule — and select it.
    const sourceId = e.dataTransfer.getData(SOURCE_DND_MIME);
    if (sourceId) {
      const source = sourceById(sourceId);
      if (!source) return;
      e.preventDefault();
      const drop = ViewportController.canvasToWorld(e.clientX, e.clientY);
      const parent = source.placement === 'under-canvas' ? uiDropParent(e.clientX, e.clientY) : null;
      void createFromSource(source, { parent, position: drop ?? undefined }).then((id) => {
        if (id != null) useSelection.getState().select(id);
      });
      return;
    }
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
    } else if (path.toLowerCase().endsWith('.estileset')) {
      e.preventDefault();
      // A tileset spawns a paintable TilemapLayer, which wires its own placement + painter.
      void createTilemapFromTileset(path);
    } else if (path.toLowerCase().endsWith('.esanim')) {
      e.preventDefault();
      // A flipbook spawns a Sprite + SpriteAnimator posed at frame 0.
      void createAnimatedSpriteFromClip(path, wp ?? undefined);
    }
  };

  return (
    <div className={`viewport${isPlaying ? ' viewport--play' : ''}`}>
      {/* Top-left: view menus (UE5 layout) — Show Flags dropdown + Frame. */}
      <div className="ov ov-tl">
        <div className="ov-cluster">
          <OvDropdown icon={Eye} label={t('vp.show')} title={t('vp.showFlags')}>
            <div className="ovmenu-lbl">{t('vp.showFlags')}</div>
            <DdCheck on={showGrid} label={t('vp.flag.grid')} onClick={() => commands.run('view.toggleGrid')} />
            <DdCheck on={showGizmos} label={t('vp.flag.gizmos')} onClick={() => commands.run('view.toggleGizmos')} />
            <DdCheck on={showColliders} label={t('vp.flag.colliders')} onClick={() => commands.run('view.toggleColliders')} />
            <DdCheck on={showTileCollision} label={t('vp.flag.tileCollision')} onClick={() => commands.run('view.toggleTileCollision')} />
            <DdCheck on={previewFx} label={t('vp.flag.previewFx')} onClick={() => commands.run('view.togglePreviewFx')} />
            <DdCheck on={perfVisible} label={t('vp.flag.perf')} onClick={() => PerfMonitor.toggleOverlay()} />
          </OvDropdown>
          <span className="ov-divider" />
          <OvTool icon={Frame} label={`${t('vp.frameSelected')}  (F)`} kbd="F" onClick={() => commands.run('view.frameSelected')} />
          <span className="ov-divider" />
          <button
            type="button"
            className={`ovbtn${coordSpace === 'local' ? ' active' : ''}`}
            title={t('vp.coordSpaceTitle')}
            onClick={() => commands.run('view.toggleCoordSpace')}
          >
            <Globe size={13} strokeWidth={1.9} />
            <span className="val">{coordSpace === 'local' ? t('vp.coord.local') : t('vp.coord.world')}</span>
          </button>
          <button
            type="button"
            className={`ovbtn${pivotMode === 'pivot' ? ' active' : ''}`}
            title={t('vp.pivotTitle')}
            onClick={() => commands.run('view.togglePivotMode')}
          >
            <Crosshair size={13} strokeWidth={1.9} />
            <span className="val">{pivotMode === 'pivot' ? t('vp.pivot.pivot') : t('vp.pivot.center')}</span>
          </button>
          {/* Screen controls — available in EVERY editor mode. Design resolution edits
              the scene Canvas when present, else the project reference resolution; the
              device dropdown simulates a real screen regardless of any UI layer. */}
          <span className="ov-divider" />
          <OvDropdown
            icon={Monitor}
            label={<span className="val">{sceneCanvas ? `${sceneCanvas.x}×${sceneCanvas.y}` : `${projectDesign.width}×${projectDesign.height}`}</span>}
            title={t('vp.designResTitle')}
          >
            <div className="ovmenu-lbl">{t('vp.designRes')}</div>
            {DESIGN_RESOLUTION_PRESETS.map((p) => (
              <DdRadio
                key={p.label}
                on={sceneCanvas ? (sceneCanvas.x === p.x && sceneCanvas.y === p.y) : (projectDesign.width === p.x && projectDesign.height === p.y)}
                label={p.label}
                onClick={() => {
                  // With a Canvas, edit its authored resolution; without one, edit the
                  // project reference resolution (the source screenInfo/seeding read).
                  if (sceneCanvas) SceneCommands.setField(sceneCanvas.id, 'Canvas', 'designResolution', 'vec2', [p.x, p.y]);
                  else void ProjectStore.setDisplay({ width: p.x, height: p.y });
                  ViewportController.frameCanvas();
                }}
              />
            ))}
            <div className="ovmenu-lbl">{t('vp.designResExact')}</div>
          </OvDropdown>
          <OvDropdown
            icon={Smartphone}
            label={<span className="val">{RESOLUTION_PRESET_BY_ID[device].label}</span>}
            title={t('vp.deviceTitle')}
          >
            <div className="ovmenu-lbl">{t('vp.device')}</div>
            {RESOLUTION_PRESETS.map((p) => (
              <DdRadio
                key={p.id}
                on={device === p.id}
                label={p.label}
                onClick={() => {
                  const ms = useEditorMode.getState();
                  ms.setDevice(p.id);
                  // Picking a real device snaps the orientation to the design's own
                  // (a landscape design previews on a landscape phone); the explicit
                  // orientation radios below still override.
                  if (p.w > 0) {
                    const dw = sceneCanvas ? sceneCanvas.x : projectDesign.width;
                    const dh = sceneCanvas ? sceneCanvas.y : projectDesign.height;
                    const want = dw >= dh ? 'landscape' : 'portrait';
                    if (ms.orientation !== want) ms.toggleOrientation();
                  }
                }}
              />
            ))}
            <div className="ovmenu-lbl">{t('vp.orientation')}</div>
            <DdRadio
              on={orientation === 'landscape'}
              label={t('vp.landscape')}
              onClick={() => orientation !== 'landscape' && useEditorMode.getState().toggleOrientation()}
            />
            <DdRadio
              on={orientation === 'portrait'}
              label={t('vp.portrait')}
              onClick={() => orientation !== 'portrait' && useEditorMode.getState().toggleOrientation()}
            />
            <div className="ovmenu-lbl">{t('vp.overlay')}</div>
            <DdCheck on={showSafeArea} label={t('vp.safeArea')} onClick={() => useEditorMode.getState().toggleSafeArea()} />
          </OvDropdown>
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
            label={<span className="val">{snapping ? snapStep : t('vp.snapOff')}</span>}
            title={t('vp.gridSnap')}
          >
            <div className="ovmenu-lbl">{t('vp.gridDisplay')}</div>
            <DdCheck on={showGrid} label={t('vp.flag.grid')} onClick={() => commands.run('view.toggleGrid')} />
            <div className="ovmenu-lbl">{t('vp.gridSnapSection')}</div>
            <DdRadio on={!snapping} label={t('vp.snapOff')} onClick={() => useEditorStore.setState({ snapping: false })} />
            <div className="ovmenu-lbl">{t('vp.snapMove')}</div>
            {SNAP_STEPS.map((s) => (
              <DdRadio
                key={s}
                on={snapping && snapStep === s}
                label={String(s)}
                onClick={() => useEditorStore.getState().setSnapStep(s)}
              />
            ))}
            <div className="ovmenu-lbl">{t('vp.snapRotate')}</div>
            {SNAP_ANGLES.map((a) => (
              <DdRadio
                key={a}
                on={snapping && snapAngle === a}
                label={String(a)}
                onClick={() => useEditorStore.setState({ snapping: true, snapAngle: a })}
              />
            ))}
            <div className="ovmenu-lbl">{t('vp.snapScale')}</div>
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
        onPointerLeave={() => { StatsStore.clearCursor(); StatsStore.clearTile(); hoverTileRef.current = null; }}
        onContextMenu={(e) => e.preventDefault()}
        onDragOver={onDragOver}
        onDragLeave={hideDropHint}
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

      {/* Tile-collision overlay: ONE viewport-spanning SVG for the selected layer's whole
          collision (solid outlines + dashed sensors + one-way arrows). The rAF writes the
          combined path data each frame; empty when the flag's off or no tilemap is picked. */}
      <svg className="viewport__tilecol-gizmo" ref={tileColRef} aria-hidden="true">
        <path className="tc-solid" d="" />
        <path className="tc-sensor" d="" />
        <path className="tc-oneway" d="" />
        <path className="tc-oneway-head" d="" />
      </svg>

      {/* Orientation-aware tile overlay for iso/staggered/hex maps: shaped grid + selection
          + gesture preview + hover cells (the square engine grid + div ghost can't draw a
          diamond/hex). The rAF writes each path's data; hidden for orthogonal maps. */}
      <svg className="viewport__tilegrid" ref={tileGridRef} aria-hidden="true" style={{ display: 'none' }}>
        <path className="tg-grid" d="" />
        <path className="tg-select" d="" />
        <path className="tg-preview" d="" />
        <path className="tg-hover" d="" />
      </svg>

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
          data-src={SceneModel.sourceFor(id)}
          aria-hidden="true"
        >
          {/* Merged outline of every collider shape on the entity (solid + dashed sensor). */}
          <path className="cl-outline" d="" />
          <path className="cl-outline-sensor" d="" />
          <line className="cl-oneway" x1="0" y1="0" x2="0" y2="0" />
          <polygon className="cl-oneway-head" points="" />
          <circle
            className="cl-handle"
            cx="0"
            cy="0"
            r="5"
            style={{ display: 'none' }}
            onPointerDown={(e) => startRadiusHandleDrag(id, 'CircleCollider', 'radius', ViewportController.colliderPixelsPerUnit(), e, ViewportController.colliderWorldCenter(id))}
          />
          <circle
            className="cl-size-handle"
            cx="0"
            cy="0"
            r="5"
            style={{ display: 'none' }}
            onPointerDown={(e) => startSizeHandleDrag(id, 'BoxCollider', 'halfExtents', ViewportController.colliderPixelsPerUnit(), false, e, ViewportController.colliderWorldCenter(id))}
          />
          {/* Point handles (vertices / endpoints / offsets) — pooled imperatively by the
              rAF since their count varies with the shape; each binds its own native
              pointerdown (see syncColliderPoints). */}
          <g className="cl-points" />
        </svg>
      ))}

      {/* Joint gizmos: one link line per scene-authored joint (anchor on the joint's
          body ↔ anchor on the connected body), plus the prismatic/wheel slide axis
          and the motor joint's target-velocity arrow. rAF-positioned, physics flag. */}
      {jointKeys.map(({ id, type }) => (
        <svg
          key={`${id}:${type}`}
          ref={(el) => {
            if (el) jointRefs.current.set(`${id}:${type}`, el);
            else jointRefs.current.delete(`${id}:${type}`);
          }}
          className="viewport__joint-gizmo"
          data-src={SceneModel.sourceFor(id)}
          data-joint={type}
          aria-hidden="true"
        >
          <line className="jt-line" x1="0" y1="0" x2="0" y2="0" />
          <line className="jt-axis" x1="0" y1="0" x2="0" y2="0" />
          <line className="jt-vel" x1="0" y1="0" x2="0" y2="0" />
          <polygon className="jt-vel-head" points="" />
          {/* Anchor dots double as drag handles (write anchorB/anchorA in the owning
              body's local frame) — except for MotorJoint, which has no anchors. */}
          <circle
            className={type === 'MotorJoint' ? 'jt-b' : 'jt-b jt-drag'}
            cx="0"
            cy="0"
            r={type === 'MotorJoint' ? 3 : 4}
            onPointerDown={type === 'MotorJoint' ? undefined : (e) => startJointAnchorDrag(id, type, 'b', e)}
          />
          <circle
            className={type === 'MotorJoint' ? 'jt-a' : 'jt-a jt-drag'}
            cx="0"
            cy="0"
            r={type === 'MotorJoint' ? 3 : 4}
            onPointerDown={type === 'MotorJoint' ? undefined : (e) => startJointAnchorDrag(id, type, 'a', e)}
          />
          {(type === 'PrismaticJoint' || type === 'WheelJoint') && (
            <circle
              className="jt-axis-handle"
              cx="0"
              cy="0"
              r="5"
              style={{ display: 'none' }}
              onPointerDown={(e) => startJointAxisDrag(id, type, e)}
            />
          )}
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
          <polygon className="pe-spread" points="" />
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

      {/* Play In Viewport: the realm iframe fills the stage. The host stays mounted
          whenever the viewport is the play target (parked when not playing) so the
          engine survives Stop for a warm re-Play; the status overlay is play-only.
          Stop lives solely on the toolbar's play controls — no duplicate in-canvas
          button obscuring the running game. */}
      {playTarget === 'viewport' && (
        <div className={`viewport__play${playInViewport ? '' : ' viewport__play--parked'}`}>
          <div className="viewport__play-host" ref={playHostRef} />
          {playInViewport && (!realm.ready || realm.error) && (
            <div className={`viewport__play-status${realm.error ? ' error' : ''}`}>
              {realm.error ? t('vp.playFailed', { error: realm.error }) : t('vp.startingGame')}
            </div>
          )}
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
      <div
        ref={tileGhostRef}
        className="viewport__tileghost"
        aria-hidden="true"
        style={ghostNat ? { width: ghostNat.w, height: ghostNat.h } : undefined}
      >
        {ghostCells?.map((c, i) => (
          <div key={i} className="viewport__tileghost-cell" style={c.style} />
        ))}
      </div>
      <div ref={tilePaintRef} className="viewport__tilepaint" aria-hidden="true" />
      <div ref={dropHintRef} className="viewport__drophint" style={{ opacity: 0 }} aria-hidden="true" />

      <svg ref={designSvgRef} className="viewport__design-svg" style={{ opacity: 0 }} aria-hidden="true">
        <path className="df-letterbox" fillRule="evenodd" />
        <rect className="df-device" />
        <rect className="df-safe" />
        <rect className="df-design" />
      </svg>
      <div ref={designLabelRef} className="viewport__design-label" style={{ opacity: 0 }} aria-hidden="true" />

      <div ref={uiGizmoRef} className="viewport__ui-gizmo" style={{ opacity: 0 }}>
        {(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const).map((edge) => (
          <span
            key={edge}
            className={`uig-h uig-${edge}`}
            onPointerDown={(e) => {
              const p = useSelection.getState().selectedId;
              const rt = p != null ? SceneModel.runtimeFor(p) : undefined;
              if (rt != null) startUiResizeDrag(rt, edge, e);
            }}
          />
        ))}
      </div>
      <div ref={gizmoRef} className="viewport__gizmo" aria-hidden="true">
        <GizmoOverlay tool={tool} active={activeGizmoAxis} />
      </div>

      {engine.status !== 'ready' && (
        <div className="viewport__status">
          {engine.status === 'error' ? (
            <div className="viewport__status-card viewport__status-card--error">
              <TriangleAlert size={22} strokeWidth={1.6} />
              <div>
                <strong>{t('vp.engineFailed')}</strong>
                <p className="mono">{engine.error}</p>
              </div>
            </div>
          ) : (
            <div className="viewport__status-card">
              <Loader2 size={20} strokeWidth={2} className="spin" />
              <span>{t('vp.booting')}</span>
            </div>
          )}
        </div>
      )}

      <ViewportHud
        ready={engine.status === 'ready'}
        selCount={selCount}
        zoomPct={zoomPct}
        tool={tool}
        paintHint={inTilePaint && paintTool ? TILE_HINT[paintTool] : null}
      />
      {perfVisible && <Perf id="viewport.perfhud"><PerfOverlay /></Perf>}

      {mode.id !== 'scene' && (
        <div className="viewport__tileflag">
          ◧ {mode.label}
          {inTilePaint && paintTool ? ` · ${TILE_TOOL_LABEL[paintTool]}` : ''}
        </div>
      )}
      {isPlaying && <div className="viewport__playflag">{t('vp.playFlag')}</div>}
    </div>
  );
}
