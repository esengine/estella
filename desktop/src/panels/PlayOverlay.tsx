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
 * Pointer events belong to the game by default; a running game you cannot click
 * is not a running game. `interactive` is the editor taking them, for as long as
 * the user asks for it.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { PlayInspect } from '@/engine/PlayInspect';
import { PlayRealm } from '@/engine/PlayRealm';
import { EntityOps } from '@/engine/entityOps';
import { useSelection } from '@/store/selectionStore';
import type { CanvasPoint, PlayOverlayBox } from '@/engine/playProtocol';

/** Half-size of the origin handle, in CSS px. */
const HANDLE = 5;
/** Pointer travel before a press becomes a drag rather than a click-to-select. */
const DRAG_SLOP = 3;

interface Props {
  /** Whether the editor, rather than the game, receives pointer events here. */
  interactive: boolean;
}

/** Normalized canvas point → CSS px within a box of `w`×`h`. */
const toPx = (p: CanvasPoint, w: number, h: number): [number, number] => [p.x * w, p.y * h];

/** Whether a press at `p` landed ON the selection: inside its outline, or within
 *  reach of the origin handle for something that has no outline to speak of. */
function grabbed(box: PlayOverlayBox, p: CanvasPoint, size: { w: number; h: number }): boolean {
  const [ox, oy] = toPx(box.origin, size.w, size.h);
  const [px, py] = toPx(p, size.w, size.h);
  if (Math.hypot(px - ox, py - oy) <= HANDLE * 2) return true;
  if (box.corners.length !== 4) return false;
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
  const hostRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  // The grab offset in normalized canvas units, so the thing does not jump its
  // origin to the cursor the moment it is picked up.
  const drag = useRef<{
    dx: number; dy: number; axis?: 'x' | 'y'; moved: boolean;
    /** The press did not land on the selection, so it can only end in a pick. */
    pickOnly: boolean;
    from: { x: number; y: number };
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

  const onPointerDown = (e: React.PointerEvent) => {
    if (!interactive || e.button !== 0) return;
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const p = pointOf(e);
    const axis = (e.target as HTMLElement).dataset?.axis as 'x' | 'y' | undefined;
    // A press only picks the selection UP if it landed on it — on a handle, or
    // inside the outline. Anywhere else is a click that selects something new,
    // not an invisible grip on whatever happened to be selected.
    const onIt = axis != null || (overlay != null && grabbed(overlay, p, size));
    if (!onIt) {
      drag.current = { dx: 0, dy: 0, moved: false, pickOnly: true, from: { x: e.clientX, y: e.clientY } };
      return;
    }
    drag.current = {
      dx: overlay ? overlay.origin.x - p.x : 0,
      dy: overlay ? overlay.origin.y - p.y : 0,
      axis,
      moved: false,
      pickOnly: false,
      from: { x: e.clientX, y: e.clientY },
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!interactive || !d || d.pickOnly) return;
    if (!d.moved) {
      if (Math.hypot(e.clientX - d.from.x, e.clientY - d.from.y) < DRAG_SLOP) return;
      d.moved = true;
    }
    if (selectedRef == null) return;
    const p = pointOf(e);
    EntityOps.moveToPoint(selectedRef, { canvas: { x: p.x + d.dx, y: p.y + d.dy } }, d.axis);
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
  const origin = box ? toPx(box.origin, size.w, size.h) : null;
  const outline = box && box.corners.length === 4
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
      {origin && (
        <svg className="play-ov__svg" width={size.w} height={size.h} aria-hidden="true">
          {outline && <polygon className="play-ov__box" points={outline} />}
          {interactive && (
            <>
              <line className="play-ov__axis x" x1={origin[0]} y1={origin[1]} x2={origin[0] + 44} y2={origin[1]} />
              <line className="play-ov__axis y" x1={origin[0]} y1={origin[1]} x2={origin[0]} y2={origin[1] - 44} />
              <rect className="play-ov__grab x" data-axis="x" x={origin[0] + 30} y={origin[1] - 6} width={16} height={12} />
              <rect className="play-ov__grab y" data-axis="y" x={origin[0] - 6} y={origin[1] - 46} width={12} height={16} />
            </>
          )}
          <rect
            className="play-ov__origin"
            x={origin[0] - HANDLE}
            y={origin[1] - HANDLE}
            width={HANDLE * 2}
            height={HANDLE * 2}
          />
        </svg>
      )}
    </div>
  );
}
