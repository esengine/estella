// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  PlayOverlay.tsx — the editor's gizmos, over the running game.
 *
 * The game draws into an iframe the editor cannot read, so this draws nothing of
 * the game: it draws where the REALM says the selection is, in points normalized
 * to the realm's own canvas, which this scales into the host box. Every question
 * about the frame — where a thing is, what is at a point, where a drag lands —
 * goes to the side holding the camera.
 *
 * Move needs that camera and is sent as a point for the realm to convert. Turn
 * and resize do not: an angle about the origin and a ratio of two distances mean
 * the same thing under any pan, zoom or roll, so they are computed here and sent
 * as deltas.
 *
 * Pointer events belong to the game by default; a running game you cannot click
 * is not a running game. `interactive` is the editor taking them, for as long as
 * the user asks for it.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { PlayInspect } from '@/engine/PlayInspect';
import { PlayRealm } from '@/engine/PlayRealm';
import { EntityOps } from '@/engine/entityOps';
import { useSelection } from '@/store/selectionStore';
import { useEditorStore } from '@/store/editorStore';
import { snapTo, quatAngleZ } from '@/engine/viewportMath';
import type { CanvasPoint, PlayOverlayBox } from '@/engine/playProtocol';

/** Half-size of the origin handle, in CSS px. */
const HANDLE = 5;
/** Pointer travel before a press becomes a drag rather than a click-to-select. */
const DRAG_SLOP = 3;
/** Axis arm length / ring radius, in CSS px. */
const ARM = 44;

interface Props {
  /** Whether the editor, rather than the game, receives pointer events here. */
  interactive: boolean;
}

/** Normalized canvas point → CSS px within a box of `w`×`h`. */
const toPx = (p: CanvasPoint, w: number, h: number): [number, number] => [p.x * w, p.y * h];

/** Whether a press at `p` landed ON the selection: inside its outline, or within
 *  reach of the origin handle for something that has no outline to speak of. */
function grabbed(box: PlayOverlayBox, origin: CanvasPoint, p: CanvasPoint, size: { w: number; h: number }): boolean {
  const [ox, oy] = toPx(origin, size.w, size.h);
  const [px, py] = toPx(p, size.w, size.h);
  if (Math.hypot(px - ox, py - oy) <= HANDLE * 2) return true;
  if (box.corners.length < 3) return false;
  const poly = box.corners.map((c) => toPx(c, size.w, size.h));
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function PlayOverlay({ interactive }: Props) {
  const overlay = useSyncExternalStore(PlayInspect.subscribe, PlayInspect.getOverlay);
  const selectedRef = useSelection((s) => s.selectedRef);
  const tool = useEditorStore((s) => s.tool);
  const hostRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  // The grab offset in normalized canvas units, so the thing does not jump its
  // origin to the cursor the moment it is picked up; turn and resize instead
  // remember where the gesture started, because both are relative to that.
  const drag = useRef<{
    dx: number; dy: number; axis?: 'x' | 'y'; moved: boolean;
    /** The press did not land on the selection, so it can only end in a pick. */
    pickOnly: boolean;
    from: { x: number; y: number };
    /** Pointer angle / distance about the origin when the gesture began (px). */
    startAngle: number;
    startDist: number;
    /** The live rotation / scale the gesture started from — what a snap grid is
     *  measured from, since the grid is the RESULT's, not the gesture's. */
    startRot: number;
    startScale: number;
    /** Turn / factor already sent, so each message carries only the step left. */
    sentTurn: number;
    sentScale: number;
  } | null>(null);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pointOf = (e: React.PointerEvent): CanvasPoint => {
    const box = hostRef.current?.getBoundingClientRect();
    if (!box || box.width === 0 || box.height === 0) return { x: 0, y: 0 };
    return { x: (e.clientX - box.left) / box.width, y: (e.clientY - box.top) / box.height };
  };
  /** Pointer angle + distance about the selection's origin, in CSS px. */
  const polarOf = (p: CanvasPoint): { angle: number; dist: number } => {
    if (!overlay?.origin) return { angle: 0, dist: 0 };
    const [ox, oy] = toPx(overlay.origin, size.w, size.h);
    const [px, py] = toPx(p, size.w, size.h);
    // Screen y grows downward and world y upward, so the angle is negated to
    // turn the way the pointer does.
    return { angle: -Math.atan2(py - oy, px - ox), dist: Math.hypot(px - ox, py - oy) };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!interactive || e.button !== 0) return;
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const p = pointOf(e);
    const data = (e.target as HTMLElement).dataset;
    const axis = data?.axis as 'x' | 'y' | undefined;
    // A press grabs the selection only on a HANDLE or inside the outline; a
    // handle says so itself, because a rotate ring sits well outside the thing
    // it turns. Anywhere else selects whatever is under the pointer. A box with
    // no origin has nothing to grab at all — it is where the layout put it.
    const anchor = overlay?.origin;
    const onIt = anchor != null && (data?.grab != null || axis != null || grabbed(overlay!, anchor, p, size));
    const polar = polarOf(p);
    const live = PlayInspect.liveIdOf(selectedRef);
    const t = live == null ? {} : PlayInspect.componentData(live, 'Transform');
    drag.current = {
      dx: anchor ? anchor.x - p.x : 0,
      dy: anchor ? anchor.y - p.y : 0,
      axis,
      moved: false,
      pickOnly: !onIt,
      from: { x: e.clientX, y: e.clientY },
      startAngle: polar.angle,
      startDist: polar.dist,
      startRot: quatAngleZ(t.rotation as { x?: number; y?: number; z?: number; w?: number } | undefined),
      startScale: (t.scale as { x?: number } | undefined)?.x ?? 1,
      sentTurn: 0,
      sentScale: 1,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!interactive || !d || d.pickOnly || selectedRef == null) return;
    if (!d.moved) {
      if (Math.hypot(e.clientX - d.from.x, e.clientY - d.from.y) < DRAG_SLOP) return;
      d.moved = true;
    }
    const p = pointOf(e);
    const ed = useEditorStore.getState();
    if (tool === 'rotate' || tool === 'scale') {
      // Measured from the gesture start and sent as the step still owed, so the
      // realm goes on composing while the total lands where the grid says. A
      // per-event step could not: each one would be snapped away to nothing.
      const { angle, dist } = polarOf(p);
      if (tool === 'rotate') {
        const turned = angle - d.startAngle;
        const want = ed.snapping
          ? snapTo(d.startRot + turned, (ed.snapAngle * Math.PI) / 180) - d.startRot
          : turned;
        EntityOps.turnBy(selectedRef, want - d.sentTurn);
        d.sentTurn = want;
      } else if (d.startDist > 1) {
        const f = dist / d.startDist;
        const want = Math.max(0.01, ed.snapping && d.startScale
          ? snapTo(d.startScale * f, ed.snapScale) / d.startScale
          : f);
        EntityOps.resizeBy(selectedRef, { x: want / d.sentScale, y: want / d.sentScale });
        d.sentScale = want;
      }
      return;
    }
    EntityOps.moveToPoint(
      selectedRef,
      { canvas: { x: p.x + d.dx, y: p.y + d.dy }, snap: ed.snapping ? ed.snapStep : 0 },
      d.axis,
    );
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!interactive || !d) return;
    (e.target as Element).releasePointerCapture?.(e.pointerId);
    // A press that never moved is a selection, and the realm is the one that can
    // say what is under the pointer.
    if (d.moved) return;
    const p = pointOf(e);
    void PlayRealm.pick(p.x, p.y).then((id) => {
      useSelection.getState().selectRef(id == null ? null : PlayInspect.refOf(id));
      PlayInspect.refresh();
    });
  };

  const box = overlay && size.w > 0 ? overlay : null;
  const origin = box?.origin ? toPx(box.origin, size.w, size.h) : null;
  const outline = box && box.corners.length >= 3
    ? box.corners.map((c) => toPx(c, size.w, size.h).join(',')).join(' ')
    : null;

  return (
    <div
      ref={hostRef}
      className={`play-ov${interactive ? ' interactive' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => { drag.current = null; }}
    >
      {(origin || outline) && (
        <svg className="play-ov__svg" width={size.w} height={size.h} aria-hidden="true">
          {outline && <polygon className="play-ov__box" points={outline} />}
          {origin && interactive && tool === 'move' && (
            <>
              <line className="play-ov__axis x" x1={origin[0]} y1={origin[1]} x2={origin[0] + ARM} y2={origin[1]} />
              <line className="play-ov__axis y" x1={origin[0]} y1={origin[1]} x2={origin[0]} y2={origin[1] - ARM} />
              <rect className="play-ov__grab x" data-grab="move" data-axis="x" x={origin[0] + ARM - 14} y={origin[1] - 6} width={16} height={12} />
              <rect className="play-ov__grab y" data-grab="move" data-axis="y" x={origin[0] - 6} y={origin[1] - ARM - 2} width={12} height={16} />
            </>
          )}
          {origin && interactive && tool === 'rotate' && (
            <circle className="play-ov__ring" data-grab="rotate" cx={origin[0]} cy={origin[1]} r={ARM} />
          )}
          {origin && interactive && tool === 'scale' && (
            <>
              <line className="play-ov__axis x" x1={origin[0]} y1={origin[1]} x2={origin[0] + ARM} y2={origin[1]} />
              <line className="play-ov__axis y" x1={origin[0]} y1={origin[1]} x2={origin[0]} y2={origin[1] - ARM} />
              <rect className="play-ov__box-end x" data-grab="scale" x={origin[0] + ARM - 5} y={origin[1] - 5} width={10} height={10} />
              <rect className="play-ov__box-end y" data-grab="scale" x={origin[0] - 5} y={origin[1] - ARM - 5} width={10} height={10} />
            </>
          )}
          {origin && (
            <rect
              className="play-ov__origin"
              data-grab="move"
              x={origin[0] - HANDLE}
              y={origin[1] - HANDLE}
              width={HANDLE * 2}
              height={HANDLE * 2}
            />
          )}
        </svg>
      )}
    </div>
  );
}
