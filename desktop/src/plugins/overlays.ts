// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  overlays.ts
 * @brief Contributed viewport overlays, and the projection + primitive collection
 *        behind {@link OverlayGraphics}.
 *
 * Plugins draw in WORLD coordinates; the host projects. That is the whole reason
 * this layer exists: a gizmo then tracks the scene through pan/zoom with no camera
 * math in the plugin, and a radius given in world units scales the way a
 * scene-anchored circle should — while stroke widths and text stay in screen pixels
 * so a hairline stays a hairline when you zoom out.
 *
 * Collecting primitives into a flat list (rather than handing over an SVG element)
 * is what lets the renderer POOL its DOM nodes across frames, and it keeps a plugin
 * from retaining or mutating editor DOM.
 */
import { ViewportController } from '@/engine/ViewportController';
import { EngineHost } from '@/engine/EngineHost';
import { ContributionRegistry, type Disposable, type Owner } from '@/contrib/ContributionRegistry';
import type { GizmoStyle, OverlayContribution, OverlayGraphics, Vec2 } from '@estella/editor-api';

/** A collected primitive, already projected to overlay CSS pixels. */
export type OverlayPrimitive =
  | { kind: 'line'; points: Vec2[]; style?: GizmoStyle }
  | { kind: 'polyline'; points: Vec2[]; style?: GizmoStyle }
  | { kind: 'circle'; center: Vec2; radius: number; style?: GizmoStyle }
  | { kind: 'rect'; x: number; y: number; w: number; h: number; style?: GizmoStyle }
  | { kind: 'text'; at: Vec2; text: string; style?: GizmoStyle };

const contrib = new ContributionRegistry<OverlayContribution>('viewport overlay');

export const overlayRegistry = {
  register: (owner: Owner, overlay: OverlayContribution): Disposable => contrib.register(owner, overlay),
  disposeOwner: (owner: Owner): void => contrib.disposeOwner(owner),
  all: (): readonly OverlayContribution[] => contrib.all(),
  subscribe: (fn: () => void): (() => void) => contrib.subscribe(fn),
  getRevision: (): number => contrib.getRevision(),
};

/**
 * The viewport camera projection, in VIEWPORT space (CSS pixels from the canvas
 * top-left). Shared by overlays and by `ctx.viewport`, so a tool's pointer input and
 * an overlay's drawing agree on one coordinate system.
 *
 * ViewportController's own pair is asymmetric — worldToClient returns
 * canvas-relative pixels while canvasToWorld expects CLIENT pixels — so the client
 * offset is added back here, in one place, rather than at each call site.
 */
export const viewportProjection = {
  worldToViewport: (x: number, y: number): Vec2 | null => ViewportController.worldToClient(x, y),
  viewportToWorld: (x: number, y: number): Vec2 | null => {
    const canvas = EngineHost.canvas;
    if (!canvas) return null;
    const r = canvas.getBoundingClientRect();
    return ViewportController.canvasToWorld(r.left + x, r.top + y);
  },
};

/**
 * Build a graphics surface that collects into `out`. Every projection failure
 * (no camera yet, no canvas) drops the primitive rather than drawing it at a wrong
 * place — a gizmo in the wrong spot is worse than a missing one.
 */
export function createOverlayGraphics(out: OverlayPrimitive[]): OverlayGraphics {
  const project = viewportProjection.worldToViewport;

  return {
    worldToViewport: project,
    viewportToWorld: viewportProjection.viewportToWorld,
    line(a, b, style) {
      const p0 = project(a.x, a.y);
      const p1 = project(b.x, b.y);
      if (p0 && p1) out.push({ kind: 'line', points: [p0, p1], style });
    },
    polyline(points, style) {
      const projected: Vec2[] = [];
      for (const p of points) {
        const q = project(p.x, p.y);
        if (!q) return; // a partially projected polyline would draw a false shape
        projected.push(q);
      }
      if (projected.length >= 2) out.push({ kind: 'polyline', points: projected, style });
    },
    circle(center, radius, style) {
      const c = project(center.x, center.y);
      // Project a point one radius away rather than reading a zoom factor: it stays
      // correct for any projection the camera applies, without assuming uniformity.
      const edge = project(center.x + radius, center.y);
      if (c && edge) out.push({ kind: 'circle', center: c, radius: Math.abs(edge.x - c.x), style });
    },
    rect(a, b, style) {
      const p0 = project(a.x, a.y);
      const p1 = project(b.x, b.y);
      if (!p0 || !p1) return;
      out.push({
        kind: 'rect',
        x: Math.min(p0.x, p1.x),
        y: Math.min(p0.y, p1.y),
        w: Math.abs(p1.x - p0.x),
        h: Math.abs(p1.y - p0.y),
        style,
      });
    },
    text(at, text, style) {
      const p = project(at.x, at.y);
      if (p) out.push({ kind: 'text', at: p, text, style });
    },
  };
}
