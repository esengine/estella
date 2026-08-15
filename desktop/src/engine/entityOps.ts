// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  entityOps.ts — writing to an entity without knowing which world it is in.
 *
 * The same three gestures — set a field, hide a row, move a thing — mean one
 * write to the scene document and a different one to the running realm. Leaving
 * that choice to each caller is how a panel ends up branching on the play state,
 * and how one of the two paths quietly stops being maintained.
 *
 * So the choice is made once, here: the document sink records undo and reaches
 * disk, the live sink posts to the realm and — unless Stop is told to keep it —
 * evaporates. Being the one door is also what lets {@link PlayEdits} know what a
 * person changed, as opposed to what the game did.
 */
import type { EntityId, FieldWrite, InspectorFieldType } from '@/types';
import { useEditorStore } from '@/store/editorStore';
import { SceneCommands, toModelValue } from './SceneCommands';
import { PlayInspect } from './PlayInspect';
import { PlayRealm } from './PlayRealm';
import { srcIdOf, type EntityRef } from './entityRef';
import { SceneQuery } from './SceneQuery';
import { scaleVecBy } from './viewportMath';
import { eulerToQuat } from './schema';
import { PlayEdits } from './playEdits';

/** The value vocabulary every inspector control commits in. */
type FieldValue = Parameters<FieldWrite>[2];

/** Which world a write went to; `null` = nowhere, the ref named nothing writable. */
export type OpWorld = 'document' | 'live' | null;

/** True while the running game owns the entities on screen. */
const liveNow = (): boolean => useEditorStore.getState().isPlaying;

export const EntityOps = {
  /** The world a write for `ref` would land in — what a panel asks to label an
   *  edit as temporary, never to pick a code path. */
  worldFor(ref: EntityRef | null): OpWorld {
    if (ref == null) return null;
    if (liveNow()) return PlayInspect.liveIdOf(ref) != null ? 'live' : null;
    return srcIdOf(ref) != null ? 'document' : null;
  },

  setField(ref: EntityRef, comp: string, key: string, type: InspectorFieldType, value: FieldValue): OpWorld {
    if (liveNow()) {
      const live = PlayInspect.liveIdOf(ref);
      if (live == null) return null;
      // The document sink is handed an inspector value and merges it into the
      // model itself; the realm takes a whole component value, so the same merge
      // happens here against what the realm last reported.
      PlayInspect.setField(live, comp, key, toModelValue(PlayInspect.componentData(live, comp), type, key, value as never));
      PlayEdits.record(ref, comp, key);
      return 'live';
    }
    const src = srcIdOf(ref);
    if (src == null) return null;
    SceneCommands.setField(src, comp, key, type, value as never);
    return 'document';
  },

  setVisible(ref: EntityRef, visible: boolean): OpWorld {
    if (liveNow()) {
      const live = PlayInspect.liveIdOf(ref);
      if (live == null) return null;
      PlayInspect.setVisible(live, visible);
      PlayEdits.recordVisibility(ref);
      return 'live';
    }
    const src = srcIdOf(ref);
    if (src == null) return null;
    SceneCommands.setEntityVisible(src, visible);
    return 'document';
  },

  /**
   * Put an entity's origin at a point on the surface it is drawn on.
   *
   * Each world is given the point in the space it can answer in: the editor
   * projects its own viewport and writes world x/y, the realm is handed a point
   * on its canvas. Neither reimplements the other's projection. `snap` travels
   * with a canvas point for the same reason the axis lock does: both resolve in
   * world units, which only the side holding the camera has.
   */
  moveToPoint(
    ref: EntityRef,
    point: { world?: { x: number; y: number }; canvas?: { x: number; y: number }; snap?: number },
    axis?: 'x' | 'y',
  ): OpWorld {
    if (liveNow()) {
      const live = PlayInspect.liveIdOf(ref);
      if (live == null || !point.canvas) return null;
      PlayRealm.dragTo(live, point.canvas.x, point.canvas.y, axis, point.snap);
      PlayEdits.record(ref, 'Transform', 'position');
      return 'live';
    }
    const src = srcIdOf(ref);
    if (src == null || !point.world) return null;
    SceneCommands.setEntityXY(src, point.world.x, point.world.y);
    return 'document';
  },

  /**
   * Turn `ref` by an angle, or resize it by a factor — relative, because both
   * mean the same thing under any camera and so need no projection at all.
   *
   * Document-side they are ordinary field writes on the transform the editor's
   * own gizmos already drive; live they are one message the realm composes.
   */
  turnBy(ref: EntityRef, radians: number): OpWorld {
    if (radians === 0) return EntityOps.worldFor(ref);
    if (liveNow()) {
      const live = PlayInspect.liveIdOf(ref);
      if (live == null) return null;
      PlayRealm.transformBy(live, { rotateBy: radians });
      PlayEdits.record(ref, 'Transform', 'rotation');
      return 'live';
    }
    const src = srcIdOf(ref);
    if (src == null) return null;
    // The field reads as three degrees; this op turns about Z, so it adds to that
    // one and leaves the other two — a 3D pose must survive an agent's nudge.
    const e = (SceneQuery.getFieldValue(src, 'Transform', 'rotation') as number[] | null) ?? [0, 0, 0];
    const turned = [e[0] ?? 0, e[1] ?? 0, (e[2] ?? 0) + radians * (180 / Math.PI)];
    SceneCommands.setFieldValue(src, 'Transform', 'rotation', eulerToQuat(turned));
    return 'document';
  },

  resizeBy(ref: EntityRef, factor: { x: number; y: number }): OpWorld {
    if (factor.x === 1 && factor.y === 1) return EntityOps.worldFor(ref);
    if (liveNow()) {
      const live = PlayInspect.liveIdOf(ref);
      if (live == null) return null;
      PlayRealm.transformBy(live, { scaleBy: factor });
      PlayEdits.record(ref, 'Transform', 'scale');
      return 'live';
    }
    const src = srcIdOf(ref);
    if (src == null) return null;
    const sc = SceneQuery.getFieldValue(src, 'Transform', 'scale') as { x?: number; y?: number; z?: number } | null;
    SceneCommands.setFieldValue(src, 'Transform', 'scale', scaleVecBy(sc ?? undefined, factor));
    return 'document';
  },
} as const;

/** The realm id a ref names right now — for callers that must speak to the realm
 *  directly (a query, not a write). */
export const liveIdOf = (ref: EntityRef | null): EntityId | null => PlayInspect.liveIdOf(ref);
