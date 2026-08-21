// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  PluginOverlays — draws every contributed viewport overlay into one SVG.
 *
 * Runs its OWN rAF rather than joining the Viewport's main tick (the same choice
 * ViewportMinimap makes): the main tick already positions every built-in gizmo, and
 * a plugin's draw cost must not be paid inside it or attributed to it.
 *
 * SVG children are POOLED across frames and reused by index. Rebuilding the subtree
 * each frame is the obvious implementation and the wrong one at 60fps — it churns
 * the DOM for a gizmo whose geometry barely changed.
 *
 * A throwing overlay is disarmed for the frame by the host's guard (which returns a
 * safe fallback), so one bad plugin cannot stop the others from drawing.
 */
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { activeMode } from '@/mode/activeMode';
import { PluginHost } from './PluginHost';
import { overlayRegistry, createOverlayGraphics, type OverlayPrimitive } from './overlays';
import type { GizmoStyle } from '@estella/editor-api';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Defaults chosen to read as an editor gizmo unless the plugin says otherwise. */
const applyStyle = (el: SVGElement, style: GizmoStyle | undefined, filled: boolean): void => {
  el.setAttribute('stroke', style?.color ?? 'var(--acc)');
  el.setAttribute('stroke-width', String(style?.width ?? 1.5));
  el.setAttribute('fill', style?.fill ?? (filled ? 'none' : 'none'));
  el.setAttribute('opacity', String(style?.opacity ?? 1));
  if (style?.dashed) el.setAttribute('stroke-dasharray', '4 3');
  else el.removeAttribute('stroke-dasharray');
};

export function PluginOverlays() {
  const svgRef = useRef<SVGSVGElement>(null);
  // Re-arm the tick when the overlay SET changes (a plugin loaded or unloaded).
  const revision = useSyncExternalStore(overlayRegistry.subscribe, overlayRegistry.getRevision);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    // One pool per element kind: reused by index, hidden past the live count.
    const pools = new Map<string, SVGElement[]>();
    const primitives: OverlayPrimitive[] = [];
    let raf = 0;

    const take = (kind: string, index: number, tag: string): SVGElement => {
      let pool = pools.get(kind);
      if (!pool) pools.set(kind, (pool = []));
      let el = pool[index];
      if (!el) {
        el = document.createElementNS(SVG_NS, tag);
        pool[index] = el;
        svg.append(el);
      }
      el.style.display = '';
      return el;
    };

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const overlays = overlayRegistry.all();
      if (overlays.length === 0 && primitives.length === 0) return;

      primitives.length = 0;
      const g = createOverlayGraphics(primitives);
      const mode = activeMode().id;
      for (const overlay of overlays) {
        if (overlay.modes && !overlay.modes.includes(mode)) continue;
        PluginHost.guardOverlay(overlay.id, () => overlay.render(g));
      }

      // Per-kind running index, so each kind draws from its own pool.
      const counts: Record<string, number> = {};
      const next = (kind: string): number => (counts[kind] = (counts[kind] ?? 0) + 1) - 1;

      for (const p of primitives) {
        switch (p.kind) {
          case 'line': {
            const el = take('line', next('line'), 'line');
            el.setAttribute('x1', String(p.points[0].x));
            el.setAttribute('y1', String(p.points[0].y));
            el.setAttribute('x2', String(p.points[1].x));
            el.setAttribute('y2', String(p.points[1].y));
            applyStyle(el, p.style, false);
            break;
          }
          case 'polyline': {
            const el = take('polyline', next('polyline'), 'polyline');
            el.setAttribute('points', p.points.map((q) => `${q.x},${q.y}`).join(' '));
            applyStyle(el, p.style, false);
            break;
          }
          case 'circle': {
            const el = take('circle', next('circle'), 'circle');
            el.setAttribute('cx', String(p.center.x));
            el.setAttribute('cy', String(p.center.y));
            el.setAttribute('r', String(p.radius));
            applyStyle(el, p.style, false);
            break;
          }
          case 'rect': {
            const el = take('rect', next('rect'), 'rect');
            el.setAttribute('x', String(p.x));
            el.setAttribute('y', String(p.y));
            el.setAttribute('width', String(p.w));
            el.setAttribute('height', String(p.h));
            applyStyle(el, p.style, true);
            break;
          }
          case 'text': {
            const el = take('text', next('text'), 'text');
            el.setAttribute('x', String(p.at.x));
            el.setAttribute('y', String(p.at.y));
            el.setAttribute('font-size', String(p.style?.fontSize ?? 11));
            el.setAttribute('fill', p.style?.color ?? 'var(--text-hi)');
            el.setAttribute('stroke', 'none');
            el.setAttribute('opacity', String(p.style?.opacity ?? 1));
            el.textContent = p.text;
            break;
          }
        }
      }

      // Hide the tail of every pool rather than removing it — the next frame very
      // likely wants those nodes back.
      for (const [kind, pool] of pools) {
        for (let i = counts[kind] ?? 0; i < pool.length; i++) pool[i].style.display = 'none';
      }
    };

    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      svg.replaceChildren();
    };
  }, [revision]);

  return <svg className="viewport__plugin-overlay" ref={svgRef} />;
}
