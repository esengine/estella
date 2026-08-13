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
 * disk, the live sink posts to the realm and evaporates on Stop. Callers name
 * an entity by {@link EntityRef} and say what they want.
 */
import type { EntityId, FieldWrite, InspectorFieldType } from '@/types';
import { useEditorStore } from '@/store/editorStore';
import { SceneCommands, toModelValue } from './SceneCommands';
import { PlayInspect } from './PlayInspect';
import { PlayRealm } from './PlayRealm';
import { srcIdOf, type EntityRef } from './entityRef';

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
   * on its canvas. Neither reimplements the other's projection.
   */
  moveToPoint(ref: EntityRef, point: { world?: { x: number; y: number }; canvas?: { x: number; y: number } }, axis?: 'x' | 'y'): OpWorld {
    if (liveNow()) {
      const live = PlayInspect.liveIdOf(ref);
      if (live == null || !point.canvas) return null;
      PlayRealm.dragTo(live, point.canvas.x, point.canvas.y, axis);
      return 'live';
    }
    const src = srcIdOf(ref);
    if (src == null || !point.world) return null;
    SceneCommands.setEntityXY(src, point.world.x, point.world.y);
    return 'document';
  },
} as const;

/** The realm id a ref names right now — for callers that must speak to the realm
 *  directly (a query, not a write). */
export const liveIdOf = (ref: EntityRef | null): EntityId | null => PlayInspect.liveIdOf(ref);
