// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    TimelinePreview.ts
 * @brief   Edit-mode live preview of the open timeline document — the document→
 *          World projection that mirrors the scene's Reconciler (model→World),
 *          for animation.
 *
 * Subscribes to {@link TimelineDocument} (asset + preview-root binding) and the
 * sequencer playhead, and on every change samples the timeline at the playhead and
 * writes the result to the bound entity's subtree in the live edit World — so
 * scrubbing/playing the Sequencer animates the viewport. ONE path drives both
 * scrub and the edit-mode play loop (sample-at-T), with no engine round-trip.
 *
 * It owns base-pose capture/restore: on bind it snapshots every component the
 * timeline touches, and on unbind (close / rebind / entering play mode) it writes
 * the snapshot back — so the entity returns to its authored pose. Safe by
 * construction: the scene is saved from the MODEL, never the World, so these
 * transient World writes can never leak into the saved scene.
 *
 * Active only in edit mode; when global Play (PIE) starts, it restores and stands
 * down (the isolated play realm owns playback). Bound to the engine's process-level
 * World via EngineHost, like the Reconciler.
 */

import { getComponent, resolveChildEntity, sampleTimelineInWorld, TrackType, type TimelineAsset } from 'esengine';
import { TimelineDocument } from '@/timeline/TimelineDocument';
import { useSequencerStore } from '@/store/sequencerStore';
import { useEditorStore } from '@/store/editorStore';
import { EngineHost } from './EngineHost';
import { SceneModel } from './SceneModel';

interface Snapshot {
  entity: number;
  // The SDK component definition (opaque here; passed straight back to world.get/set).
  def: any;
  data: unknown;
}

const clone = <T>(v: T): T =>
  typeof structuredClone === 'function' ? structuredClone(v) : (JSON.parse(JSON.stringify(v)) as T);

/** The distinct (entity, component) pairs a timeline's property tracks write to. */
function affectedTargets(world: any, root: number, asset: TimelineAsset): Snapshot[] {
  const seen = new Set<string>();
  const out: Snapshot[] = [];
  for (const track of asset.tracks) {
    if (track.type !== TrackType.Property) continue;
    const def = getComponent(track.component);
    if (!def) continue;
    const entity = resolveChildEntity(world, root, track.childPath);
    if (entity == null || !world.has(entity, def)) continue;
    const key = `${entity}:${track.component}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ entity: entity as number, def, data: undefined });
  }
  return out;
}

export class TimelinePreviewImpl {
  private attached = false;
  private boundRoot: number | null = null; // runtime entity id
  private boundAsset: TimelineAsset | null = null;
  private snapshot: Snapshot[] = [];
  private rafPending = false;

  /** Begin reacting to the document + playhead. Idempotent. */
  attach(): void {
    if (this.attached) return;
    this.attached = true;
    TimelineDocument.subscribe(() => this.sync());
    useEditorStore.subscribe(() => this.sync()); // play-mode toggles bind/unbind
    useSequencerStore.subscribe(() => this.scheduleApply()); // playhead scrubs/plays
    this.sync();
  }

  /** The runtime root the preview should be bound to right now (or null). */
  private desiredRoot(): number | null {
    const sourceId = TimelineDocument.rootEntity;
    if (!TimelineDocument.isOpen || sourceId == null) return null;
    if (useEditorStore.getState().isPlaying) return null; // PIE owns the world
    const world = EngineHost.mutableWorld();
    if (!world) return null;
    const rt = SceneModel.runtimeFor(sourceId);
    return rt != null && world.valid(rt) ? rt : null;
  }

  /** Reconcile the binding (restore old / capture new base pose), then apply. */
  private sync(): void {
    const want = this.desiredRoot();
    const asset = want != null ? TimelineDocument.asset : null;
    if (want !== this.boundRoot || asset !== this.boundAsset) {
      this.restore();
      this.boundRoot = want;
      this.boundAsset = asset;
      this.capture();
    }
    this.apply();
  }

  private capture(): void {
    this.snapshot = [];
    const world = EngineHost.mutableWorld();
    if (!world || this.boundRoot == null || this.boundAsset == null) return;
    for (const t of affectedTargets(world, this.boundRoot, this.boundAsset)) {
      this.snapshot.push({ entity: t.entity, def: t.def, data: clone(world.get(t.entity, t.def)) });
    }
  }

  /** Write the captured base pose back to the affected components (no clear). */
  private writeBase(): void {
    const world = EngineHost.mutableWorld();
    if (!world) return;
    for (const s of this.snapshot) {
      if (world.valid(s.entity) && world.has(s.entity, s.def)) {
        world.set(s.entity, s.def, clone(s.data));
      }
    }
  }

  private restore(): void {
    this.writeBase();
    this.snapshot = [];
  }

  private apply(): void {
    if (this.boundRoot == null || this.boundAsset == null) return;
    const world = EngineHost.mutableWorld();
    if (!world) return;
    // Reset affected components to base, then layer the animation on top — so a
    // muted (skipped) channel reverts to its scene value instead of freezing.
    this.writeBase();
    const muted = useSequencerStore.getState().mutedTracks;
    sampleTimelineInWorld(this.boundAsset, useSequencerStore.getState().time, world, this.boundRoot, {
      skipChannel: muted.size > 0 ? (cp, comp, prop) => muted.has(`${cp}|${comp}|${prop}`) : undefined,
    });
  }

  /** Coalesce rapid playhead changes into one apply per frame. */
  private scheduleApply(): void {
    if (this.rafPending) return;
    this.rafPending = true;
    requestAnimationFrame(() => {
      this.rafPending = false;
      this.apply();
    });
  }
}

/** The app's default-session timeline preview. */
export const TimelinePreview = new TimelinePreviewImpl();
