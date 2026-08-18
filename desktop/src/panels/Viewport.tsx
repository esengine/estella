// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { PointerEvent as ReactPointerEvent, DragEvent as ReactDragEvent } from 'react';
import {
  MousePointer2, Move, RotateCw, Scale3d, Grid3x3, Frame,
  Camera, Loader2, TriangleAlert, Lightbulb, Sparkles, Globe, Crosshair, Monitor, Magnet, Axis3d, Hexagon, MapPin, Box, type LucideIcon,
  AlignStartVertical, AlignCenterVertical, AlignEndVertical,
  AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal,
  AlignHorizontalDistributeCenter, AlignVerticalDistributeCenter, RotateCcw,
} from 'lucide-react';
import { t } from '@/i18n';
import { useEditorStore } from '@/store/editorStore';
import { useSelection } from '@/store/selectionStore';
import { useAgent } from '@/store/AgentStore';
import { useTilemapPaint, type PaintTool } from '@/store/tilemapPaintStore';
import { exitTilePaint, isTilePaintMode, selectedTilemapCellSize } from '@/tools/tileMode';
import { activeMode, activeModeOverlays } from '@/mode/activeMode';
import { useEditorMode } from '@/store/editorModeStore';
import { screenPresetById, DESIGN_RESOLUTION_PRESETS, deviceDims } from '@/mode/resolutionPresets';
import { buildStampGhost } from '@/tools/tileStampGhost';
import { alignSelection, distributeSelection } from '@/tools/alignTools';
import { TilemapAPI, tileIdOf, isNonOrthogonal, isCollisionPaletteRef, buildCollisionPaletteModel, UINode, DimensionUnit, computeEffectiveOrthoSize, type TileCollisionPiece, type TilesetModel, type ScreenAxis } from 'esengine';
import { commands } from '@/commands';
import { MOD_LABEL } from '@/commands/keybinding';
import { EngineHost } from '@/engine/EngineHost';
import { PlayRealm } from '@/engine/PlayRealm';
import { ViewportController, type JointGizmoType, type ColliderPointHandle, type MinimapBounds, type MinimapBox } from '@/engine/ViewportController';
import { minimapFit, minimapBox, minimapCamRect, minimapToWorld } from '@/engine/minimapFit';
import { axisIndicatorEnds, axisEndKey } from '@/engine/viewportMath';
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
import { PluginOverlays } from '@/plugins/PluginOverlays';
import { Perf } from '@/components/Perf';
import { OvDropdown, DdRadio } from '@/components/OverlayMenu';
import { TargetScreenDropdown, playHostAspectStyle } from '@/mode/TargetScreen';
import { PlayOverlay } from './PlayOverlay';
import { usePanelWindow, eventWindow } from '@/components/PanelWindow';
import type { ToolMode, EntityId } from '@/types';
import { resolveActiveTool, type EditorTool, type ToolContext, type PointerInput } from '@/tools';
import { cursorTile } from '@/tools/tileTools';
import { GIZMO, HEAD_ON, axisHandles, colliderHandleClass, pivotDrag, rotateRings, ringPoint, type GizmoAxis, type Quat, type RotateRing } from '@/tools/gizmo';
import { selectionPivot, gizmoFrame } from '@/tools/transformTools';
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
// The shared lifecycle for every on-canvas handle drag (radius / size / collider
// point / UI resize / cone angle / joint anchor+axis). It coalesces the per-move
// field writes into ONE undo step and — like the transform gizmo — suspends the
// SceneStore so the panels don't fully re-render on every pointermove. pointerup
// commits; pointercancel (pen/touch/OS gesture takeover) aborts and snaps back —
// without it the move listener would leak and the field would chase a released
// cursor, then land a stray undo step on the next edit.
function runHandleDrag(win: Window, label: string, onMove: (ev: PointerEvent) => void): void {
  const tx = SceneCommands.transaction(label);
  SceneStore.suspend();
  const finish = (commit: boolean) => {
    win.removeEventListener('pointermove', onMove);
    win.removeEventListener('pointerup', up);
    win.removeEventListener('pointercancel', cancel);
    if (commit) tx.commit(); else tx.abort();
    SceneStore.resume();
  };
  const up = () => finish(true);
  const cancel = () => finish(false);
  win.addEventListener('pointermove', onMove);
  win.addEventListener('pointerup', up);
  win.addEventListener('pointercancel', cancel);
}

function startRadiusHandleDrag(
  rt: number, component: string, field: string, ppu: number, e: ReactPointerEvent,
  centerOverride?: { x: number; y: number } | null,
): void {
  if (e.button !== 0) return;
  const src = SceneModel.sourceFor(rt);
  const center = centerOverride ?? ViewportController.getEntityWorldXY(rt);
  if (src == null || !center) return;
  e.stopPropagation();
  runHandleDrag(eventWindow(e), `${component} radius`, (ev) => {
    const w = ViewportController.canvasToWorld(ev.clientX, ev.clientY);
    if (!w) return;
    const r = Math.max(0, Math.hypot(w.x - center.x, w.y - center.y) / (ppu || 1));
    SceneCommands.setField(src, component, field, 'number', r);
  });
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
  runHandleDrag(eventWindow(e), `${component} size`, (ev) => {
    const w = ViewportController.canvasToWorld(ev.clientX, ev.clientY);
    if (!w) return;
    const dx = w.x - center.x, dy = w.y - center.y;
    const lx = dx * cos + dy * sin;      // un-rotate into the box's local frame
    const ly = -dx * sin + dy * cos;
    const k = (fullSize ? 2 : 1) / (ppu || 1);
    SceneCommands.setField(src, component, field, 'vec2', [Math.abs(lx) * k, Math.abs(ly) * k]);
  });
}

// Drag a sprite's pivot handle → Sprite.pivot with the artwork held still (the maths,
// and why the transform moves too, are in `pivotDrag`). Both writes are absolute in ONE
// grab-time frame, so a long drag cannot compound; one transaction, one undo step.
function startPivotHandleDrag(rt: number, e: ReactPointerEvent): void {
  if (e.button !== 0) return;
  const src = SceneModel.sourceFor(rt);
  const f = ViewportController.spritePivotFrame(rt);
  if (src == null || !f) return;
  e.stopPropagation();
  runHandleDrag(eventWindow(e), 'Sprite pivot', (ev) => {
    const p = ViewportController.canvasToWorld(ev.clientX, ev.clientY);
    if (!p) return;
    const next = pivotDrag(f, p);
    SceneCommands.setField(src, 'Sprite', 'pivot', 'vec2', [next.pivot.x, next.pivot.y]);
    SceneCommands.setEntityXY(src, next.pos.x, next.pos.y);
  });
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
  runHandleDrag(eventWindow(e), 'Edit Collider', (ev) => {
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
  });
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

  runHandleDrag(eventWindow(e), 'Resize UI', (ev) => {
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
  });
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
  runHandleDrag(eventWindow(e), 'Cone angle', (ev) => {
    const w = ViewportController.canvasToWorld(ev.clientX, ev.clientY);
    if (!w) return;
    const dx = w.x - center.x, dy = w.y - center.y;
    const lx = dx * cos + dy * sin;
    const ly = -dx * sin + dy * cos;
    const halfDeg = Math.abs(Math.atan2(lx, ly)) * (180 / Math.PI);
    SceneCommands.setField(src, 'ParticleEmitter', 'shapeAngle', 'number', Math.min(180, halfDeg * 2));
  });
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
  runHandleDrag(eventWindow(e), `${type} anchor`, (ev) => {
    const w = ViewportController.canvasToWorld(ev.clientX, ev.clientY);
    if (!w) return;
    const dx = w.x - frame.x, dy = w.y - frame.y;
    SceneCommands.setField(src, type, end === 'a' ? 'anchorA' : 'anchorB', 'vec2',
      [Math.round(dx * cos + dy * sin), Math.round(-dx * sin + dy * cos)]);
  });
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
  runHandleDrag(eventWindow(e), `${type} axis`, (ev) => {
    const w = ViewportController.canvasToWorld(ev.clientX, ev.clientY);
    if (!w) return;
    const dx = w.x - frame.x, dy = w.y - frame.y;
    const lx = dx * cos + dy * sin;
    const ly = -dx * sin + dy * cos;
    const len = Math.hypot(lx, ly);
    if (len < 1e-3) return; // a degenerate direction at the anchor itself — keep the last one
    const r3 = (v: number) => Math.round((v / len) * 1000) / 1000;
    SceneCommands.setField(src, type, 'axis', 'vec2', [r3(lx), r3(ly)]);
  });
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

// Above this many selected entities the per-entity outline (one wasm rect query +
// one styled DOM div each, every rAF tick) collapses to a single merged bounding
// box — a marquee over a large tilemap or particle scene used to select thousands
// and thrash layout at N divs/frame. Below it the per-entity path is untouched.
const SELECTION_OUTLINE_MERGE_THRESHOLD = 200;

/** A ring as an SVG path, sampled around its own parameter. */
function ringPath(ring: RotateRing, radius: number): string {
  const steps = 48;
  let d = '';
  for (let i = 0; i < steps; i++) {
    const p = ringPoint(ring, (i / steps) * Math.PI * 2, radius);
    d += `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
  }
  return `${d}Z`;
}

function GizmoOverlay({ tool, active, axes, rotation }: {
  tool: ToolMode;
  active: GizmoAxis | null;
  axes: { x: ScreenAxis; y: ScreenAxis; z: ScreenAxis } | null;
  rotation: Quat | undefined;
}) {
  const L = GIZMO.axisLen;
  const B = GIZMO.boxSize;
  const P = GIZMO.planeSize;
  // Drawn from the SAME basis the tool aims through (gizmo.ts), so the arrow you
  // grab is the axis that moves. Edge-on handles are dropped there, which is what
  // leaves a head-on gizmo the two arrows and the single ring it always had.
  const basis = axes ?? HEAD_ON;
  // The grabbed handle reads "hot": a thicker stroke + full-opacity fill, so the
  // drag has the visual confirmation UE/Unity give.
  const axW = (on: boolean) => (on ? 4 : 2.5);
  const planeOp = (on: boolean) => (on ? 1 : 0.85);
  if (tool === 'rotate') {
    // One ring per world axis, drawn where that axis's plane actually projects —
    // an ellipse once the eye is off-axis.
    return (
      <svg className="gizmo-svg" width={GIZMO_SVG} height={GIZMO_SVG} viewBox={gizmoViewBox}>
        {rotateRings(basis, rotation).map((ring) => (
          <path
            key={ring.axis}
            className={`gz-ring gz-${ring.axis}`}
            d={ringPath(ring, GIZMO.ringRadius)}
            fill="none"
            strokeWidth={active === ring.axis ? 3.5 : 2}
          />
        ))}
        <circle cx="0" cy="0" r="2.5" fill="var(--star)" />
      </svg>
    );
  }
  const handles = axisHandles(basis, rotation);
  return (
    <svg className="gizmo-svg" width={GIZMO_SVG} height={GIZMO_SVG} viewBox={gizmoViewBox}>
      {handles.map((h) => {
        const on = active === h.axis;
        const ex = h.dir.x * L;
        const ey = h.dir.y * L;
        return (
          <g key={h.axis} className={`gz-${h.axis}`}>
            <line x1="0" y1="0" x2={ex} y2={ey} stroke="currentColor" strokeWidth={axW(on)} />
            {tool === 'scale'
              ? <rect x={ex - B / 2} y={ey - B / 2} width={B} height={B} fill="currentColor" opacity={on ? 1 : 0.95} />
              : <path d={arrowHead(h.dir, L)} fill="currentColor" opacity={on ? 1 : 0.95} />}
          </g>
        );
      })}
      <rect x={-P / 2} y={-P / 2} width={P} height={P} fill="var(--star)"
            opacity={planeOp(active !== null && active.length === 2)} />
    </svg>
  );
}

/** The triangle at an axis arrow's tip, pointing the way the axis projects. */
function arrowHead(dir: { x: number; y: number }, len: number): string {
  const tx = dir.x * len;
  const ty = dir.y * len;
  const bx = dir.x * (len - 9);
  const by = dir.y * (len - 9);
  const nx = -dir.y * 4;
  const ny = dir.x * 4;
  return `M${tx.toFixed(2)} ${ty.toFixed(2)} L${(bx - nx).toFixed(2)} ${(by - ny).toFixed(2)} `
       + `L${(bx + nx).toFixed(2)} ${(by + ny).toFixed(2)} Z`;
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
  toggle,
}: {
  icon: LucideIcon;
  label: string;
  kbd?: string;
  active?: boolean;
  onClick: () => void;
  /** A display-flag toggle (soft accent "on") rather than a tool selection (strong fill). */
  toggle?: boolean;
}) {
  return (
    <button
      type="button"
      className={`ovbtn ov-tool${toggle ? ' ov-toggle' : ''}${active ? ' active' : ''}`}
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
function ViewportHud({ ready, showStats, showCoords, showHints, selCount, zoomPct, tool, paintHint }: {
  ready: boolean;
  /** Corner FPS/frame/entity HUD — opt-in (off by default). */
  showStats: boolean;
  /** Bottom-left cursor/selection/hint readout — opt-in (off by default). */
  showCoords: boolean;
  showHints: boolean;
  selCount: number;
  zoomPct: number;
  tool: ToolMode;
  /** When painting a tilemap, the tile-vocabulary hint replaces the transform hint. */
  paintHint: string | null;
}) {
  const stats = useSyncExternalStore(StatsStore.subscribe, StatsStore.getSnapshot);
  return (
    <>
      {ready && showStats && (
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
      {(showCoords || showHints) && (
        <div className="vp-coord">
          {showCoords && (
            <div className="ro">
              <HudCursor />
              {t('vp.hud.sel')} <strong>{selCount}</strong> · {zoomPct}%
            </div>
          )}
          {showHints && <div className="hint">{paintHint ?? TOOL_HINT[tool]}</div>}
        </div>
      )}
    </>
  );
}

// Bottom-right scene minimap: a schematic overview (one rect per entity) the whole
// scene fits into, with the editor camera's world rect overlaid each frame. Click /
// drag recenters the camera — fast navigation of large levels. React.memo'd so it only
// rebuilds its rects when the (memoized) box set changes, not on every Viewport render.
const MINIMAP_W = 200;
const MINIMAP_H = 128;
const MINIMAP_PAD = 8;

/**
 * A counter that bumps two frames after any of `deps` changes — the point at which
 * the engine has ticked and composed world transforms are readable. Anything derived
 * from world-space geometry has to wait for it; reading on the change itself sees the
 * pre-tick identity pose.
 */
function useComposedRev(...deps: unknown[]): number {
  const [rev, setRev] = useState(0);
  useEffect(() => {
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setRev((r) => r + 1));
    });
    return () => { cancelAnimationFrame(outer); cancelAnimationFrame(inner); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return rev;
}

const ViewportMinimap = memo(function ViewportMinimap(
  { data, selected }: { data: { bounds: MinimapBounds | null; boxes: MinimapBox[] }; selected: ReadonlySet<EntityId> },
) {
  const win = usePanelWindow();
  const camRef = useRef<SVGRectElement>(null);
  // Fit the world bounds into the panel (preserve aspect, letterbox). Recomputed only
  // when the bounds change; the projection below closes over it.
  const fit = useMemo(() => minimapFit(data.bounds, MINIMAP_W, MINIMAP_H, MINIMAP_PAD), [data.bounds]);

  // Overlay the editor camera's world rect on the minimap every frame (it tracks
  // pan/zoom). Its own tiny rAF keeps this off the gizmo-heavy main viewport tick.
  useEffect(() => {
    if (!fit) return;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const rect = camRef.current;
      if (!rect) return;
      const v = ViewportController.editorViewRect();
      if (!v) { rect.style.opacity = '0'; return; }
      const r = minimapCamRect(fit, v, MINIMAP_W, MINIMAP_H);
      rect.setAttribute('x', String(r.x));
      rect.setAttribute('y', String(r.y));
      rect.setAttribute('width', String(r.w));
      rect.setAttribute('height', String(r.h));
      rect.style.opacity = '1';
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [fit, win]);

  // Minimap px → world, then recenter the camera there (click + drag, zoom untouched).
  // The SVG is sized by CSS over a fixed viewBox, so client px scale by the rendered
  // width — aiming at raw client offsets would land short on a shrunk map.
  const navTo = (e: ReactPointerEvent) => {
    if (!fit) return;
    const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const k = r.width > 0 ? MINIMAP_W / r.width : 1;
    const p = minimapToWorld(fit, (e.clientX - r.left) * k, (e.clientY - r.top) * k);
    ViewportController.centerViewOn(p.x, p.y);
  };

  // One box is not a map — a UI-only scene leaves just the camera icon, and a
  // panel-sized overlay of it only hides the scene behind it.
  if (!fit || data.boxes.length < 2) return null;
  return (
    <div className="viewport__minimap" title={t('vp.minimap')}>
      <svg
        viewBox={`0 0 ${MINIMAP_W} ${MINIMAP_H}`}
        preserveAspectRatio="none"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
          navTo(e);
        }}
        onPointerMove={(e) => { if (e.buttons & 1) navTo(e); }}
      >
        {data.boxes.map((bx, i) => {
          const r = minimapBox(fit, bx.x0, bx.y0, bx.x1, bx.y1);
          return (
            <rect
              key={i}
              className={`mm-box mm-${bx.kind}${bx.src != null && selected.has(bx.src) ? ' mm-sel' : ''}`}
              x={r.x}
              y={r.y}
              width={r.w}
              height={r.h}
            />
          );
        })}
        <rect ref={camRef} className="mm-cam" />
      </svg>
    </div>
  );
});

// The navigation gizmo a DCC puts in a viewport corner: it answers the two questions
// a turned eye raises and a reset button cannot — which way am I facing, and how do I
// get square-on. Clicking an end stands the eye on that axis.
const AXIS_BOX = 46;
const AXIS_LEN = 30;
const AXIS_ENDS = [
  { axis: 'x', sign: 1, label: 'X' }, { axis: 'x', sign: -1, label: '' },
  { axis: 'y', sign: 1, label: 'Y' }, { axis: 'y', sign: -1, label: '' },
  { axis: 'z', sign: 1, label: 'Z' }, { axis: 'z', sign: -1, label: '' },
] as const;

const ViewAxisGizmo = memo(function ViewAxisGizmo() {
  const win = usePanelWindow();
  const svgRef = useRef<SVGSVGElement>(null);

  // Its own rAF, like the minimap's camera rect: the axes track an Alt-drag live,
  // and re-rendering the gizmo-heavy viewport for it would be the wrong cost.
  useEffect(() => {
    let raf = 0;
    let order = '';
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const svg = svgRef.current;
      if (!svg) return;
      const axes = ViewportController.viewAxes();
      if (!axes) return;
      const ends = axisIndicatorEnds(axes, AXIS_LEN);
      for (const end of ends) {
        const g = svg.querySelector<SVGGElement>(`[data-end="${end.key}"]`);
        if (!g) continue;
        g.querySelector('line')?.setAttribute('x2', String(end.x));
        g.querySelector('line')?.setAttribute('y2', String(end.y));
        const knob = g.querySelector('circle');
        knob?.setAttribute('cx', String(end.x));
        knob?.setAttribute('cy', String(end.y));
        const text = g.querySelector('text');
        text?.setAttribute('x', String(end.x));
        text?.setAttribute('y', String(end.y));
        // An end pointing away is dimmed: a solid knob reads nearer than a faint
        // one, the only depth cue a flat overlay has.
        g.style.opacity = String(0.45 + 0.55 * (end.depth + 1) / 2);
      }
      // The ends come back in painter order; reinsert only when it actually changed.
      const key = ends.map((e) => e.key).join('');
      if (key !== order) {
        order = key;
        for (const end of ends) {
          const g = svg.querySelector<SVGGElement>(`[data-end="${end.key}"]`);
          if (g) svg.appendChild(g);
        }
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [win]);

  return (
    <div className="vp-axes">
      <svg ref={svgRef} viewBox={`${-AXIS_BOX} ${-AXIS_BOX} ${AXIS_BOX * 2} ${AXIS_BOX * 2}`}>
        {AXIS_ENDS.map((end) => (
          <g
            key={axisEndKey(end.axis, end.sign)}
            data-end={axisEndKey(end.axis, end.sign)}
            className={`va-end va-${end.axis}${end.sign > 0 ? ' va-pos' : ''}`}
            onPointerDown={(e) => {
              e.stopPropagation();
              ViewportController.lookAlongAxis(end.axis, end.sign);
            }}
          >
            <title>{t('vp.axisLook', { axis: `${end.sign > 0 ? '+' : '-'}${end.axis.toUpperCase()}` })}</title>
            {end.sign > 0 && <line x1="0" y1="0" x2="0" y2="0" />}
            <circle cx="0" cy="0" r={end.sign > 0 ? 9 : 7} />
            {end.label && <text x="0" y="0">{end.label}</text>}
          </g>
        ))}
      </svg>
    </div>
  );
});

export function Viewport() {
  // The window this viewport currently lives in — main, or its own OS window once
  // popped out. Drives resize re-binding and any window-scoped listeners below.
  const win = usePanelWindow();
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const isPaused = useEditorStore((s) => s.isPaused);
  const playTarget = useEditorStore((s) => s.playTarget);
  const tool = useEditorStore((s) => s.tool);
  const showGrid = useEditorStore((s) => s.showGrid);
  const showGizmos = useEditorStore((s) => s.showGizmos);
  const showColliders = useEditorStore((s) => s.showColliders);
  const showTileCollision = useEditorStore((s) => s.showTileCollision);
  const previewFx = useEditorStore((s) => s.previewFx);
  const showStats = useEditorStore((s) => s.showStats);
  const showCoords = useEditorStore((s) => s.showCoords);
  const showHints = useEditorStore((s) => s.showHints);
  const showMinimap = useEditorStore((s) => s.showMinimap);
  const activeGizmoAxis = useEditorStore((s) => s.activeGizmoAxis);
  const coordSpace = useEditorStore((s) => s.coordSpace);
  const pivotMode = useEditorStore((s) => s.pivotMode);
  const viewPerspective = useEditorStore((s) => s.viewPerspective);
  const viewOrbited = useEditorStore((s) => s.viewOrbited);
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
  // The per-frame overlay draw reads these through getState(); subscribing keeps
  // the component re-rendering when they change, and the play host below sizes
  // itself from the same values.
  const device = useEditorMode((s) => s.device);
  const orientation = useEditorMode((s) => s.orientation);
  useEditorMode((s) => s.showSafeArea);
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
  const pivotHandleRef = useRef<HTMLDivElement>(null);
  const designSvgRef = useRef<SVGSVGElement>(null);
  const designLabelRef = useRef<HTMLDivElement>(null);
  // One outline div per selected entity, keyed by source id and positioned by the rAF.
  const selRefs = useRef(new Map<number, HTMLDivElement | null>());
  // Entities under the pointer in the agent's transcript. A tool row naming
  // `id: 7` means nothing until 7 lights up where the work actually is.
  const agentPeeked = useAgent((s) => s.peeked);
  const peekRefs = useRef(new Map<number, HTMLDivElement | null>());
  // The single merged-selection box shown instead, above the merge threshold.
  const mergedSelRef = useRef<HTMLDivElement>(null);
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
  // Camera pan (middle/right drag, or Space+left drag for trackpad users) is
  // built-in navigation, separate from tools.
  const panRef = useRef<{ px: number; py: number } | null>(null);
  const orbitRef = useRef<{ px: number; py: number } | null>(null);
  const spaceHeld = useRef(false);
  const [spacePan, setSpacePan] = useState(false); // drives the grab cursor
  // The tool that owns the in-progress left-button stroke (move/up route to it).
  const activeToolRef = useRef<EditorTool | null>(null);
  // Host services handed to tools during a stroke; stable across renders.
  const toolCtx = useMemo<ToolContext>(() => ({
    capture: (id) => stageRef.current?.setPointerCapture(id),
    release: (id) => stageRef.current?.releasePointerCapture(id),
  }), []);
  const [zoomPct, setZoomPct] = useState(100);
  // Where the world axes project — the basis EVERY handle is drawn from. Polled
  // rather than mirrored, and only while a transform tool is up: re-rendering the
  // viewport once per orbit frame is not free.
  const [viewAxes, setViewAxes] = useState<{ x: ScreenAxis; y: ScreenAxis; z: ScreenAxis } | null>(null);
  const viewAxesKey = useRef('');
  // The frame the handles stand in (local space = the active entity's rotation),
  // polled with the axes so one key drives both halves of the gizmo's basis.
  const [gizmoRotation, setGizmoRotation] = useState<Quat | undefined>(undefined);
  // Last-published zoom %, so the rAF only re-renders the HUD when it actually changes.
  const zoomPctRef = useRef(100);
  const engine = useSyncExternalStore(EngineHost.subscribe, EngineHost.getSnapshot);
  const realm = useSyncExternalStore(PlayRealm.subscribe, PlayRealm.getSnapshot);
  // Selector snapshot: re-renders only when the Perf overlay is toggled, not on
  // its twice-a-second stat updates (those re-render only <PerfOverlay>).
  const perfVisible = useSyncExternalStore(PerfMonitor.subscribe, () => PerfMonitor.getSnapshot().visible);

  // Scene cameras don't render in edit mode (the viewport is the editor camera),
  // so draw each as a gizmo (icon + authored view rect). The id set updates on
  // structural change; the rAF below positions them every frame.
  const structRev = useSyncExternalStore(SceneStore.subscribe, SceneStore.getStructureRevision);
  // Derived (RuntimeOnly) entities — the marker / trigger-area / sprite children a `.tmj`
  // source projects — never bump the model's structure/data revision (they're not in the
  // scene model). `worldRev` bumps whenever the live world's entity count changes (polled
  // in the rAF), so the per-entity gizmo id lists (markers, colliders) re-enumerate to pick
  // up or drop those derived entities as a source loads / tears down.
  const [worldRev, setWorldRev] = useState(0);
  const worldCountRef = useRef(-1);
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
  // Marker (point-object) entities render nothing — draw each as an always-on pin at its
  // position (click to select), so spawn points / waypoints / triggers are visible without
  // being selected. Same per-frame rAF + structural id set as the camera/light gizmos.
  const markerRefs = useRef(new Map<number, HTMLDivElement | null>());
  // Markers can be MODEL entities (hand-placed → structRev) OR RuntimeOnly children a
  // Tilemap source derives from a `.tmj` point object (world-only → no structRev bump).
  // markerIds() rescans the live world, so also re-run on dataRev to catch the derived
  // set once the async source load + derive lands.
  const markerIds = useMemo(
    () => (engine.status === 'ready' ? ViewportController.markerIds() : []),
    [structRev, dataRev, worldRev, engine.status],
  );
  // Physics colliders aren't drawn by the renderer — outline each (box polygon /
  // circle) as a gizmo so you can see/tune collider shapes without entering Play.
  const colliderRefs = useRef(new Map<number, SVGSVGElement | null>());
  const colliderIds = useMemo(
    () => (engine.status === 'ready' && showColliders ? ViewportController.colliderIds() : []),
    [structRev, worldRev, engine.status, showColliders],
  );
  // The 3D world's shapes, on the same switch: they are even less visible than the
  // 2D ones (a box around a model is nothing the renderer draws), and they project
  // as wireframes through three axes rather than outlines on a plane.
  const collider3DRefs = useRef(new Map<number, SVGSVGElement | null>());
  const collider3DIds = useMemo(
    () => (engine.status === 'ready' && showColliders ? ViewportController.collider3DIds() : []),
    [structRev, worldRev, engine.status, showColliders],
  );
  // 3D joints: which body is held to which, and about what axis — the half of a
  // joint no position can show. On the physics switch, like the 2D joint gizmos.
  const joint3DRefs = useRef(new Map<number, SVGSVGElement | null>());
  const joint3DIds = useMemo(
    () => (engine.status === 'ready' && showColliders ? ViewportController.joint3DIds() : []),
    [structRev, worldRev, engine.status, showColliders],
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
    if (engine.status !== 'ready' || !showTileCollision) {
      clear();
      tileColModelRef.current = { key: '', model: null };
      return;
    }
    // Collision (obstacle) layers ALWAYS contribute their outlines — the overlay IS their
    // content (they render nothing), so they stay visible unselected. They all share the
    // single built-in palette model (no per-layer disk load). A selected NON-collision
    // tilemap additionally shows its per-tile collision as a debug aid (selected-only).
    const collisionIds: number[] = [];
    for (const id of SceneModel.entityOrder()) {
      const e = SceneModel.entityBySource(id);
      if (e?.components.some((c) => c.type === 'TilemapLayer') && isCollisionPaletteRef(layerTilesetRefs(id))) {
        collisionIds.push(id);
      }
    }
    const paletteModel = collisionIds.length > 0 ? buildCollisionPaletteModel() : null;
    const selId = tilemapSelected && primaryId != null && !collisionIds.includes(primaryId) ? primaryId : null;

    const rebuild = () => {
      const pieces: TileCollisionPiece[] = [];
      if (paletteModel) {
        for (const id of collisionIds) pieces.push(...ViewportController.tilemapColliderOutlines(id, paletteModel));
      }
      if (selId != null && tileColModelRef.current.model) {
        pieces.push(...ViewportController.tilemapColliderOutlines(selId, tileColModelRef.current.model));
      }
      tileColPiecesRef.current = pieces;
    };

    // Collision layers render immediately (sync). A selected .estileset tilemap may need an
    // async model load; show the collision layers now and fold it in once its model lands.
    if (selId == null) {
      tileColModelRef.current = { key: '', model: null };
      rebuild();
      return;
    }
    const refs = layerTilesetRefs(selId);
    const key = refs.join('|');
    if (tileColModelRef.current.key === key && tileColModelRef.current.model) { rebuild(); return; }
    let alive = true;
    rebuild(); // collision layers appear at once; the selected layer joins on model load
    void loadLayerTilesetModel(refs).then((model) => {
      if (!alive) return;
      tileColModelRef.current = { key, model };
      rebuild();
    });
    return () => { alive = false; };
  }, [engine.status, showTileCollision, tilemapSelected, primaryId, dataRev, structRev]);

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
  // Minimap overview boxes + scene bounds — recomputed on structural / data change (the
  // camera rect updates live inside the minimap). dataRev catches entity moves on commit.
  // `composedRev` is the third input because the boxes are COMPOSED world AABBs,
  // which read (0,0) until the engine has ticked — and a scene adopt bumps structRev
  // before that tick, with no further structural change coming to correct it.
  const composedRev = useComposedRev(structRev, dataRev, engine.status);
  const minimap = useMemo(
    () => (engine.status === 'ready' ? ViewportController.minimapBoxes() : { bounds: null, boxes: [] }),
    [structRev, dataRev, composedRev, engine.status],
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
  // Whether the editor or the game gets the pointer over the running frame. Off
  // by default: a game you cannot click is not a game. Cleared on Stop so the
  // next session starts playable.
  const [inspectPlay, setInspectPlay] = useState(false);
  useEffect(() => {
    if (!playInViewport) setInspectPlay(false);
  }, [playInViewport]);
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
      ViewportController.zoomAtClient(e.clientX, e.clientY, orthoFactor); // zoom toward the cursor
      // The zoom % readout is reconciled from the real view scale in the rAF below —
      // no manual counter to drift out of sync with Frame Selected / minimap / presets.
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

      // Poll the world's entity count so gizmos for RuntimeOnly derived entities (a `.tmj`
      // source's markers / trigger areas) appear once the async source load derives them —
      // those never bump the model revisions the id lists otherwise key on.
      if (ready) {
        const wc = EngineHost.world?.entityCount() ?? 0;
        if (wc !== worldCountRef.current) { worldCountRef.current = wc; setWorldRev((v) => v + 1); }
      }

      // Keep the zoom % readout honest: derive it from the ACTUAL world→screen scale
      // (pixels per world unit ×100). Frame Selected, the minimap, and device presets
      // all change orthoSize without any wheel event, so a tracked counter drifts.
      if (ready) {
        const scale = ViewportController.zoomScale();
        if (scale != null) {
          const pct = Math.max(1, Math.round(scale * 100));
          if (pct !== zoomPctRef.current) {
            zoomPctRef.current = pct;
            setZoomPct(pct);
          }
        }
        // Same reason for the turned eye: an Alt-drag, a command and the automation
        // door all move it, so a flag each of them must remember to set is a mirror
        // that drifts. The setter no-ops on an unchanged value, so this costs a call.
        useEditorStore.getState().setViewOrbited(ViewportController.isOrbited());

        if (toolMode !== 'select') {
          const a = ViewportController.viewAxes();
          const f = gizmoFrame([...useSelection.getState().selectedIds]);
          const k = (a ? [a.x, a.y, a.z].map((v) => `${v.dx.toFixed(3)},${v.dy.toFixed(3)}`).join('|') : '')
            + (f ? `|${f.x.toFixed(3)},${f.y.toFixed(3)},${f.z.toFixed(3)},${f.w.toFixed(3)}` : '');
          if (k !== viewAxesKey.current) { viewAxesKey.current = k; setViewAxes(a); setGizmoRotation(f); }
        }
      }

      // Selection outlines. Below the merge threshold: one div per selected source
      // id (crisp per-entity boxes). Above it: a single merged bounding box in one
      // query pass + one div (the per-entity divs aren't rendered). `selIds` reads
      // the selection store directly so the gizmo/pivot code below stays correct in
      // both branches (above the threshold selRefs is empty).
      const selIds = [...useSelection.getState().selectedIds];
      const merged = mergedSelRef.current;
      if (selIds.length > SELECTION_OUTLINE_MERGE_THRESHOLD) {
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        if (ready) {
          for (const sid of selIds) {
            const rt = SceneModel.runtimeFor(sid);
            const rect = rt != null ? ViewportController.getEntityScreenRect(rt) : null;
            if (!rect) continue;
            minX = Math.min(minX, rect.x);
            minY = Math.min(minY, rect.y);
            maxX = Math.max(maxX, rect.x + rect.w);
            maxY = Math.max(maxY, rect.y + rect.h);
          }
        }
        if (merged) {
          if (Number.isFinite(minX)) {
            merged.style.transform = `translate(${minX}px, ${minY}px)`;
            merged.style.width = `${maxX - minX}px`;
            merged.style.height = `${maxY - minY}px`;
            merged.style.opacity = '1';
          } else {
            merged.style.opacity = '0';
          }
        }
      } else {
        if (merged) merged.style.opacity = '0';
        for (const [sid, el] of selRefs.current) {
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
      }

      // Agent peek outlines, positioned the same way selection is — they follow
      // pan and zoom because they are projected from world every frame, not
      // placed once.
      for (const [sid, el] of peekRefs.current) {
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
        // A locked node gets no resize handles either — same gate as the transform
        // gizmo, so one lock silences every viewport handle the selection has.
        const editable = pid != null && SceneModel.isEditable(pid);
        const prt = ready && pid != null && editable && selIds.length === 1
          ? SceneModel.runtimeFor(pid)
          : undefined;
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

      // Sprite pivot handle: the dot a single selected sprite turns about. It sits at
      // the entity origin, where Move and Scale keep their centre grab — so, like the
      // collider offset handle, it yields, appearing only under the pointer tool.
      const pvh = pivotHandleRef.current;
      if (pvh) {
        const pid = useSelection.getState().selectedId;
        const prt = ready && showG && pid != null && SceneModel.isEditable(pid) && selIds.length === 1
          && useEditorStore.getState().tool === 'select'
          ? SceneModel.runtimeFor(pid)
          : undefined;
        const f = prt != null ? ViewportController.spritePivotFrame(prt) : null;
        if (f) {
          pvh.style.transform = `translate(${f.client.x}px, ${f.client.y}px)`;
          pvh.style.opacity = '1';
          pvh.style.pointerEvents = 'auto';
          pvh.dataset.rt = String(prt);
        } else {
          pvh.style.opacity = '0';
          pvh.style.pointerEvents = 'none';
          delete pvh.dataset.rt;
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
          const preset = screenPresetById(ms.device, ProjectStore.getSnapshot()?.screenPresets);
          // Device visible frame: the design resolution fit into the simulated device's
          // aspect per the Canvas scaleMode. `dd` is the oriented device size (null for the
          // 'design' sentinel) — the SAME source App.tsx feeds to uiLayoutRect, so this
          // frame and the actual UI layout share one aspect and can't drift.
          const dd = deviceDims(ms.device, ms.orientation, ProjectStore.getSnapshot()?.screenPresets);
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
            // Top clamp (48) clears the docked scene toolbar (38px) at the viewport top.
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
      // Only for the move/rotate/scale tools — select shows just the outline. Gate
      // the compute on the same condition as the draw so a big marquee selection
      // under the (default) Select tool doesn't run O(selection) wasm queries/frame
      // for a pivot that's never drawn.
      const drawPivot = ready && showG && toolMode !== 'select' && selIds.length > 0;
      const pivotWorld = drawPivot ? selectionPivot(selIds) : null;
      const pivot = pivotWorld ? ViewportController.worldToClient(pivotWorld.x, pivotWorld.y) : null;
      if (pivot) {
        // No screen rotation: local space is baked into each handle's own
        // direction (gizmo.ts), which a CSS rotate could only ever express in 2D.
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
        // `showFrustum` is an editor-only field, so it is read from the document
        // rather than the projected World, which has no member for it.
        const csrc = SceneModel.sourceFor(cid);
        const cdata = csrc != null
          ? SceneModel.entityBySource(csrc)?.components.find((c) => c.type === 'Camera')?.data
          : undefined;
        const cg = camsOn
          ? ViewportController.getCameraGizmo(cid, (cdata as { showFrustum?: boolean } | undefined)?.showFrustum === true)
          : null;
        if (cg) {
          wrap.style.opacity = '1';
          const icon = wrap.firstElementChild as HTMLElement | null;
          if (icon) icon.style.transform = `translate(${cg.cx}px, ${cg.cy}px)`;
          for (const [sel, d] of [['.viewport__cam-frame', cg.frame],
                                  ['.viewport__cam-volume', cg.volume]] as const) {
            (wrap.querySelector(sel) as SVGPathElement | null)?.setAttribute('d', d);
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

      // 3D collider wireframes — solid / sensor / inactive, the three the projection
      // splits every shape on the entity into.
      for (const [cid, svg] of collider3DRefs.current) {
        if (!svg) continue;
        const cg = camsOn ? ViewportController.getCollider3DGizmo(cid) : null;
        for (const [sel, d] of [['.c3-outline', cg?.outline],
                                ['.c3-outline-sensor', cg?.outlineSensor],
                                ['.c3-outline-inactive', cg?.outlineInactive]] as const) {
          (svg.querySelector(sel) as SVGPathElement | null)?.setAttribute('d', d ?? '');
        }
      }

      // 3D joints: anchor → connected body, plus the hinge/slider axis.
      for (const [jid, svg] of joint3DRefs.current) {
        if (!svg) continue;
        const jg = camsOn ? ViewportController.getJoint3DGizmo(jid) : null;
        svg.style.opacity = jg ? (jg.on ? '1' : '0.4') : '0';
        if (!jg) continue;
        const link = svg.querySelector('.j3-link') as SVGLineElement | null;
        if (link) {
          link.setAttribute('x1', String(jg.ax));
          link.setAttribute('y1', String(jg.ay));
          link.setAttribute('x2', String(jg.bx));
          link.setAttribute('y2', String(jg.by));
        }
        const anchor = svg.querySelector('.j3-anchor') as SVGCircleElement | null;
        if (anchor) {
          anchor.setAttribute('cx', String(jg.ax));
          anchor.setAttribute('cy', String(jg.ay));
        }
        (svg.querySelector('.j3-axis') as SVGPathElement | null)?.setAttribute('d', jg.axis);
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

      // Marker pins — position each at its entity's world point (or hide it when the
      // marker is off-camera/removed). Same edit-mode + gizmos-on gate as the other icons.
      for (const [mid, wrap] of markerRefs.current) {
        if (!wrap) continue;
        const mg = camsOn ? ViewportController.getMarkerGizmo(mid) : null;
        if (mg) {
          wrap.style.visibility = 'visible';
          wrap.style.transform = `translate(${mg.cx}px, ${mg.cy}px)`;
        } else {
          wrap.style.visibility = 'hidden'; // an invisible pin must not swallow clicks
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
      } else if (orbitRef.current || panRef.current) {
        orbitRef.current = null;
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

  // Space-held = pan-drag mode (the trackpad/laptop pan gesture; no middle button
  // needed). Ignored while typing so a Space in a field doesn't arm it.
  useEffect(() => {
    const typing = (el: EventTarget | null): boolean => {
      const n = el as HTMLElement | null;
      return !!n && (n.tagName === 'INPUT' || n.tagName === 'TEXTAREA' || n.isContentEditable);
    };
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || typing(e.target)) return;
      spaceHeld.current = true;
      setSpacePan(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      spaceHeld.current = false;
      setSpacePan(false);
    };
    win.addEventListener('keydown', down);
    win.addEventListener('keyup', up);
    return () => {
      win.removeEventListener('keydown', down);
      win.removeEventListener('keyup', up);
    };
  }, [win]);

  const onPointerDown = (e: ReactPointerEvent) => {
    if (engine.status !== 'ready') return;

    // Alt + left drag = orbit the eye (the DCC convention). Checked before pan so
    // it wins over the tools, and available in both projections: an orthographic
    // view turned off-axis is the isometric one.
    if (e.button === 0 && e.altKey) {
      e.preventDefault();
      orbitRef.current = { px: e.clientX, py: e.clientY };
      stageRef.current?.setPointerCapture(e.pointerId);
      return;
    }

    // Middle / right drag, or Space + left drag = pan the view (camera navigation,
    // always available regardless of the active tool; Space-drag is the trackpad path).
    if (e.button === 1 || e.button === 2 || (e.button === 0 && spaceHeld.current)) {
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

    if (orbitRef.current) {
      ViewportController.orbitByClient(orbitRef.current.px, orbitRef.current.py, e.clientX, e.clientY);
      orbitRef.current = { px: e.clientX, py: e.clientY };
      return;
    }

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
    if (orbitRef.current) {
      stageRef.current?.releasePointerCapture(e.pointerId);
      orbitRef.current = null;
      return;
    }
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
    if (orbitRef.current) {
      stageRef.current?.releasePointerCapture(e.pointerId);
      orbitRef.current = null;
      return;
    }
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
    } else if (path.toLowerCase().endsWith('.esmesh')) {
      e.preventDefault();
      void ProjectStore.instantiateMeshFromPath(path, wp ?? { x: 0, y: 0 });
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
    <div className={`viewport${playInViewport ? ' viewport--play' : ''}${playInViewport && isPaused ? ' viewport--paused' : ''}${inspectPlay ? ' viewport--inspect' : ''}`}>
      {/* Docked scene toolbar under the panel tabs — view menus + display controls
          on the left, quick display toggles pinned right. Tool selection lives in the
          floating palette over the canvas (.ov-left). */}
      <div className="viewport__toolbar">
        <div className="viewport__tb-group">
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
          {/* The editor's own eye. Orthographic is the 2D default; perspective is
              what makes depth visible while authoring 2.5D. It changes only this
              view — the Game view always shows the scene's own camera. */}
          <button
            type="button"
            className={`ovbtn${viewPerspective ? ' active' : ''}`}
            title={t('vp.projectionTitle')}
            onClick={() => commands.run('view.toggleViewPerspective')}
          >
            <Box size={13} strokeWidth={1.9} />
            <span className="val">{viewPerspective ? t('vp.proj.perspective') : t('vp.proj.ortho')}</span>
          </button>
          {/* Only while the eye is turned: a 2D project never sees it, and a user
              who turned the view by accident has the way back in front of them. */}
          {viewOrbited && (
            <button
              type="button"
              className="ovbtn"
              title={t('vp.resetOrbitTitle')}
              onClick={() => commands.run('view.resetOrbit')}
            >
              <RotateCcw size={13} strokeWidth={1.9} />
            </button>
          )}
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
          <TargetScreenDropdown
            designAspect={sceneCanvas ? { w: sceneCanvas.x, h: sceneCanvas.y } : { w: projectDesign.width, h: projectDesign.height }}
            showSafeAreaToggle
          />
          <span className="ov-divider" />
          <OvDropdown
            icon={Magnet}
            label={<span className="val">{snapping ? snapStep : t('vp.snapOff')}</span>}
            title={t('vp.gridSnap')}
          >
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

        {/* Align + distribute — contextual, appears once 2+ entities are selected.
            Every button lands through SceneCommands.setEntityXY (one undo step). */}
        {selCount >= 2 && (
          <div className="viewport__tb-group">
            <OvTool icon={AlignStartVertical} label={t('vp.align.left')} onClick={() => alignSelection('left')} />
            <OvTool icon={AlignCenterVertical} label={t('vp.align.hcenter')} onClick={() => alignSelection('hcenter')} />
            <OvTool icon={AlignEndVertical} label={t('vp.align.right')} onClick={() => alignSelection('right')} />
            <span className="ov-divider" />
            <OvTool icon={AlignStartHorizontal} label={t('vp.align.top')} onClick={() => alignSelection('top')} />
            <OvTool icon={AlignCenterHorizontal} label={t('vp.align.vmiddle')} onClick={() => alignSelection('vmiddle')} />
            <OvTool icon={AlignEndHorizontal} label={t('vp.align.bottom')} onClick={() => alignSelection('bottom')} />
            {selCount >= 3 && (
              <>
                <span className="ov-divider" />
                <OvTool icon={AlignHorizontalDistributeCenter} label={t('vp.align.distributeH')} onClick={() => distributeSelection('h')} />
                <OvTool icon={AlignVerticalDistributeCenter} label={t('vp.align.distributeV')} onClick={() => distributeSelection('v')} />
              </>
            )}
          </div>
        )}

        <div className="viewport__tb-group viewport__tb-group--right">
          <span className="vp-mode-chip">2D</span>
          <div className="ov-seg">
            <OvTool toggle icon={Grid3x3} label={t('vp.flag.grid')} active={showGrid} onClick={() => commands.run('view.toggleGrid')} />
            <OvTool toggle icon={Axis3d} label={t('vp.flag.gizmos')} active={showGizmos} onClick={() => commands.run('view.toggleGizmos')} />
            <OvTool toggle icon={Hexagon} label={t('vp.flag.colliders')} active={showColliders} onClick={() => commands.run('view.toggleColliders')} />
            <OvTool toggle icon={Sparkles} label={t('vp.flag.previewFx')} active={previewFx} onClick={() => commands.run('view.togglePreviewFx')} />
          </div>
        </div>
      </div>

      {/* Floating tool palette over the canvas — selection + transform (Q/W/E/R). */}
      <div className="ov ov-left">
        <div className="ov-cluster ov-cluster--v">
          {TOOLS.map((tl) => (
            <OvTool
              key={tl.mode}
              icon={tl.icon}
              label={`${tl.label}  (${tl.key})`}
              kbd={tl.key}
              active={tool === tl.mode}
              onClick={() => commands.run(`tool.${tl.mode}`)}
            />
          ))}
        </div>
        {/* The grid switch, where the docked toolbar's snap menu cannot reach: the
            gizmos work on the running game, so what they snap to has to be sayable
            there. The increments stay in that menu. */}
        {playInViewport && inspectPlay && (
          <div className="ov-cluster ov-cluster--v">
            <OvTool
              icon={Magnet}
              toggle
              label={`${t('vp.gridSnap')}  (${snapping ? snapStep : t('vp.snapOff')})`}
              active={snapping}
              onClick={() => useEditorStore.setState({ snapping: !snapping })}
            />
          </div>
        )}
      </div>

      {/* The engine canvas mounts here; pointer events drive pick + transform + pan. */}
      <div
        ref={stageRef}
        className="viewport__stage"
        data-engine="esengine.wasm"
        style={spacePan ? { cursor: 'grab' } : inTilePaint ? { cursor: 'crosshair' } : undefined}
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

      {/* Scene-camera gizmos (icon + what the camera frames, + its volume when the
          camera asks for it); projected by the rAF. */}
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
          <svg className="viewport__cam-shape">
            <path className="viewport__cam-frame" />
            <path className="viewport__cam-volume" />
          </svg>
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

      {markerIds.map((id) => {
        const src = SceneModel.sourceFor(id);
        const name = src != null ? SceneModel.entityBySource(src)?.name : undefined;
        return (
          <div
            key={id}
            ref={(el) => {
              if (el) markerRefs.current.set(id, el);
              else markerRefs.current.delete(id);
            }}
            className="viewport__marker-gizmo"
          >
            <span
              className="viewport__marker-hit"
              role="button"
              title={name}
              onPointerDown={(e) => {
                if (e.button !== 0 || src == null) return;
                e.stopPropagation();
                useSelection.getState().select(src);
              }}
            >
              <MapPin className="viewport__marker-icon" size={16} strokeWidth={2} />
            </span>
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
          className={
            'viewport__collider-gizmo'
            + colliderHandleClass(selectedIds.has(SceneModel.sourceFor(id) ?? -1), tool)
          }
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

      {/* 3D collider wireframes: one SVG per entity, three paths — the shape the
          solver builds, the one it builds as a trigger, and the authored-but-absent
          one (disabled / shadowed / bodyless). */}
      {collider3DIds.map((id) => (
        <svg
          key={id}
          ref={(el) => {
            if (el) collider3DRefs.current.set(id, el);
            else collider3DRefs.current.delete(id);
          }}
          className={
            'viewport__collider3d-gizmo'
            + (selectedIds.has(SceneModel.sourceFor(id) ?? -1) ? ' is-live' : '')
          }
          data-src={SceneModel.sourceFor(id)}
          aria-hidden="true"
        >
          <path className="c3-outline-inactive" d="" />
          <path className="c3-outline-sensor" d="" />
          <path className="c3-outline" d="" />
        </svg>
      ))}

      {/* 3D joint gizmos: the link to the body it holds, the anchor it holds at,
          and the axis a hinge or slider is free along. */}
      {joint3DIds.map((id) => (
        <svg
          key={id}
          ref={(el) => {
            if (el) joint3DRefs.current.set(id, el);
            else joint3DRefs.current.delete(id);
          }}
          className="viewport__joint3d-gizmo"
          data-src={SceneModel.sourceFor(id)}
          aria-hidden="true"
        >
          <line className="j3-link" x1="0" y1="0" x2="0" y2="0" />
          <path className="j3-axis" d="" />
          <circle className="j3-anchor" cx="0" cy="0" r="4" />
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
          {/* Same target screen the edit overlay previews: playing in the viewport
              letterboxes to the picked device instead of filling the dock. */}
          <div className="viewport__play-stage">
            <div
              className="viewport__play-host"
              style={playHostAspectStyle(device, orientation, projectState?.screenPresets) ?? undefined}
              ref={playHostRef}
            >
              {/* Inside the host box, so it is exactly the rect the realm's canvas
                  fills — the overlay's coordinates are normalized to that canvas. */}
              {playInViewport && realm.ready && <PlayOverlay interactive={inspectPlay} />}
            </div>
          </div>
          {playInViewport && realm.ready && (
            <button
              type="button"
              className={`viewport__inspect${inspectPlay ? ' on' : ''}`}
              title={t('vp.inspectPlayTip')}
              onClick={() => setInspectPlay((v) => !v)}
            >
              <MousePointer2 size={13} strokeWidth={2} />
              {t('vp.inspectPlay')}
            </button>
          )}
          {playInViewport && (!realm.ready || realm.error) && (
            <div className={`viewport__play-status${realm.error ? ' error' : ''}`}>
              {realm.error ? t('vp.playFailed', { error: realm.error }) : t('vp.startingGame')}
            </div>
          )}
        </div>
      )}

      {/* One outline per selected entity (rAF-positioned); primary gets the accent.
          Above the merge threshold these collapse to the single merged box below. */}
      {selList.length <= SELECTION_OUTLINE_MERGE_THRESHOLD &&
        selList.map((id) => (
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
      {agentPeeked.map((id) => (
        <div
          key={`peek-${id}`}
          ref={(el) => {
            if (el) peekRefs.current.set(id, el);
            else peekRefs.current.delete(id);
          }}
          className="viewport__agentpeek"
          aria-hidden="true"
        />
      ))}
      {/* The merged selection box (shown only above the threshold; rAF-positioned). */}
      <div ref={mergedSelRef} className="viewport__selection" style={{ opacity: 0 }} aria-hidden="true" />
      {/* The selected sprite's pivot dot. One element for the whole viewport (only a
          single selection ever gets it); the rAF parks it and stamps the runtime id the
          drag reads, so no per-entity element is minted for a handle that shows once. */}
      <div
        ref={pivotHandleRef}
        className="viewport__pivot-handle"
        style={{ opacity: 0, pointerEvents: 'none' }}
        title={t('vp.pivotHandle')}
        onPointerDown={(e) => {
          const rt = e.currentTarget.dataset.rt;
          if (rt != null) startPivotHandleDrag(Number(rt), e);
        }}
      />
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
        <GizmoOverlay tool={tool} active={activeGizmoAxis} axes={viewAxes} rotation={gizmoRotation} />
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
        showStats={showStats}
        showCoords={showCoords}
        showHints={showHints}
        selCount={selCount}
        zoomPct={zoomPct}
        tool={tool}
        paintHint={inTilePaint && paintTool ? TILE_HINT[paintTool] : null}
      />
      {/* Only once the eye can see depth: a square-on orthographic view IS the 2D
          editor, and an axis ball over it would be decoration for an X and a Y that
          never move. Alt-drag or the projection toggle brings it in. */}
      {engine.status === 'ready' && (viewPerspective || viewOrbited) && <ViewAxisGizmo />}
      {engine.status === 'ready' && showMinimap && <ViewportMinimap data={minimap} selected={selectedIds} />}
      {/* Contributed gizmos. Gated on `showGizmos` with the built-in ones — a plugin
          overlay is a gizmo, so the same toggle has to silence it. */}
      {engine.status === 'ready' && showGizmos && !isPlaying && <PluginOverlays />}
      {perfVisible && <Perf id="viewport.perfhud"><PerfOverlay /></Perf>}

      {mode.id !== 'scene' && !isPlaying && (
        <button
          type="button"
          className="viewport__tileflag"
          title={t('vp.openModePanels', { mode: mode.label })}
          onClick={() => commands.run(`mode.${mode.id}`)}
        >
          ◧ {mode.label}
          {inTilePaint && paintTool ? ` · ${TILE_TOOL_LABEL[paintTool]}` : ''}
        </button>
      )}
      {/* Playing-in-viewport is shown by the accent ring around the frame (see
          .viewport--play in CSS) — no pill over the game. A PAUSED game is the one
          state that needs a label: a frozen frame must not read as a hang. */}
      {playInViewport && isPaused && (
        <div className="viewport__playflag paused">{t('vp.pausedFlag')}</div>
      )}
    </div>
  );
}
