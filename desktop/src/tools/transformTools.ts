// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  transformTools.ts
 * @brief The select / move / rotate / scale viewport tools. Each picks + selects
 *        the entity under the cursor, then drives a transform drag as one undo
 *        transaction (T5). Select and Move share the move drag (clicking selects,
 *        dragging moves) — Select is just the same stroke with the box gizmo.
 */
import { ViewportController } from '@/engine/ViewportController';
import { SceneCommands, type EditorTransaction } from '@/engine/SceneCommands';
import { SceneQuery } from '@/engine/SceneQuery';
import { SceneModel } from '@/engine/SceneModel';
import { EngineHost } from '@/engine/EngineHost';
import { useSelection } from '@/store/selectionStore';
import { useEditorStore } from '@/store/editorStore';
import type { EditorTool, PointerInput } from './EditorTool';

// Snap increments while Snapping is on. Move uses the user-chosen `snapStep`
// (viewport Snap dropdown); rotate/scale are fixed until a Preferences panel.
const SNAP_ROTATE = 15; // degrees
const SNAP_SCALE = 0.1; // uniform scale step
const snap = (v: number, step: number) => Math.round(v / step) * step;

// Entity's screen-center in viewport (client) coordinates.
function entityClientCenter(rtId: number): { cx: number; cy: number } | null {
  const pos = ViewportController.getEntityXY(rtId);
  const canvas = EngineHost.canvas;
  if (!pos || !canvas) return null;
  const cv = ViewportController.worldToClient(pos.x, pos.y);
  if (!cv) return null;
  const rect = canvas.getBoundingClientRect();
  return { cx: rect.left + cv.x, cy: rect.top + cv.y };
}

/** Pick the entity under the cursor and select it; returns {sourceId, rtId} or null. */
function pickSelect(p: PointerInput): { sourceId: number; rtId: number } | null {
  const rtId = ViewportController.pickEntity(p.clientX, p.clientY);
  const sourceId = rtId != null ? SceneModel.sourceFor(rtId) ?? null : null;
  useSelection.getState().select(sourceId);
  if (rtId == null || sourceId == null) return null;
  return { sourceId, rtId };
}

/** Select + Move: click to select, drag to move (the editor's default tool). */
function makeMoveTool(id: string): EditorTool {
  let stroke: { id: number; dx: number; dy: number; tx: EditorTransaction } | null = null;
  return {
    id,
    onPointerDown(p, ctx) {
      const hit = pickSelect(p);
      if (!hit) return false;
      const wp = ViewportController.canvasToWorld(p.clientX, p.clientY);
      const ep = ViewportController.getEntityXY(hit.rtId);
      if (!wp || !ep) return false;
      stroke = { id: hit.sourceId, dx: ep.x - wp.x, dy: ep.y - wp.y, tx: SceneCommands.transaction('Move') };
      ctx.capture(p.pointerId);
      return true;
    },
    onPointerMove(p) {
      if (!stroke) return;
      const wp = ViewportController.canvasToWorld(p.clientX, p.clientY);
      if (!wp) return;
      let x = wp.x + stroke.dx;
      let y = wp.y + stroke.dy;
      if (useEditorStore.getState().snapping) {
        const step = useEditorStore.getState().snapStep;
        x = snap(x, step);
        y = snap(y, step);
      }
      SceneCommands.setEntityXY(stroke.id, x, y);
    },
    onPointerUp(p, ctx) {
      if (!stroke) return;
      ctx.release(p.pointerId);
      stroke.tx.commit();
      stroke = null;
    },
    cancel() {
      if (!stroke) return;
      stroke.tx.abort();
      stroke = null;
    },
  };
}

function makeRotateTool(): EditorTool {
  let stroke: { id: number; cx: number; cy: number; startAngle: number; startRot: number; tx: EditorTransaction } | null = null;
  return {
    id: 'transform.rotate',
    onPointerDown(p, ctx) {
      const hit = pickSelect(p);
      if (!hit) return false;
      const c = entityClientCenter(hit.rtId);
      if (!c) return false;
      const startRot = (SceneQuery.getFieldValue(hit.sourceId, 'Transform', 'rotation') as number) ?? 0;
      stroke = {
        id: hit.sourceId, cx: c.cx, cy: c.cy,
        startAngle: Math.atan2(p.clientY - c.cy, p.clientX - c.cx), startRot,
        tx: SceneCommands.transaction('Rotate'),
      };
      ctx.capture(p.pointerId);
      return true;
    },
    onPointerMove(p) {
      if (!stroke) return;
      const angle = Math.atan2(p.clientY - stroke.cy, p.clientX - stroke.cx);
      const deltaDeg = ((angle - stroke.startAngle) * 180) / Math.PI;
      // Screen y is down, so a clockwise screen drag is a negative world rotation.
      let rot = stroke.startRot - deltaDeg;
      if (useEditorStore.getState().snapping) rot = snap(rot, SNAP_ROTATE);
      SceneCommands.setField(stroke.id, 'Transform', 'rotation', 'angle', rot);
    },
    onPointerUp(p, ctx) {
      if (!stroke) return;
      ctx.release(p.pointerId);
      stroke.tx.commit();
      stroke = null;
    },
    cancel() {
      if (!stroke) return;
      stroke.tx.abort();
      stroke = null;
    },
  };
}

function makeScaleTool(): EditorTool {
  let stroke: { id: number; cx: number; cy: number; startDist: number; sx: number; sy: number; sz: number; tx: EditorTransaction } | null = null;
  return {
    id: 'transform.scale',
    onPointerDown(p, ctx) {
      const hit = pickSelect(p);
      if (!hit) return false;
      const c = entityClientCenter(hit.rtId);
      if (!c) return false;
      const s = (SceneQuery.getFieldValue(hit.sourceId, 'Transform', 'scale') as number[]) ?? [1, 1, 1];
      stroke = {
        id: hit.sourceId, cx: c.cx, cy: c.cy,
        startDist: Math.max(1, Math.hypot(p.clientX - c.cx, p.clientY - c.cy)),
        sx: s[0] ?? 1, sy: s[1] ?? 1, sz: s[2] ?? 1,
        tx: SceneCommands.transaction('Scale'),
      };
      ctx.capture(p.pointerId);
      return true;
    },
    onPointerMove(p) {
      if (!stroke) return;
      const dist = Math.hypot(p.clientX - stroke.cx, p.clientY - stroke.cy);
      const f = dist / stroke.startDist;
      let sx = stroke.sx * f;
      let sy = stroke.sy * f;
      if (useEditorStore.getState().snapping) {
        sx = snap(sx, SNAP_SCALE);
        sy = snap(sy, SNAP_SCALE);
      }
      SceneCommands.setField(stroke.id, 'Transform', 'scale', 'vec3', [sx, sy, stroke.sz]);
    },
    onPointerUp(p, ctx) {
      if (!stroke) return;
      ctx.release(p.pointerId);
      stroke.tx.commit();
      stroke = null;
    },
    cancel() {
      if (!stroke) return;
      stroke.tx.abort();
      stroke = null;
    },
  };
}

/** Transform tools keyed by editor ToolMode (select/move/rotate/scale). */
export const TRANSFORM_TOOLS: Record<string, EditorTool> = {
  select: makeMoveTool('transform.select'),
  move: makeMoveTool('transform.move'),
  rotate: makeRotateTool(),
  scale: makeScaleTool(),
};
