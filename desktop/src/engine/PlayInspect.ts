// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  PlayInspect.ts — the editor's "Game" inspection source.
 *        While playing, it samples the running realm for a live SceneData snapshot
 *        (via PlayRealm.snapshot → serializeScene of the realm's World) and holds
 *        the user's live selection. The Outliner/Details build their view-models
 *        from this snapshot (reusing buildSceneTree/buildInspector) when in Game
 *        mode; field edits route to PlayRealm.setField (live, reverts on Stop).
 *
 *        Sampling is a COALESCED loop, not a fixed-interval poll: one request is in
 *        flight at a time and the next is armed only after the reply, with a small
 *        floor between starts. So the Details tracks live values smoothly on a
 *        small scene (request returns fast → ~floor rate) and a large one self-
 *        throttles to its serialize cost instead of backing up requests.
 *
 *        Selection here is a REALM runtime id — distinct from the editor's
 *        source-id selection (selectionStore), never mixed.
 */
import { createStore } from 'zustand/vanilla';
import type { SceneData } from 'esengine';
import type { EntityId } from '@/types';
import { PlayRealm } from './PlayRealm';

interface PlayInspectState {
  /** Shallow entity tree of the running World (Outliner). */
  snapshot: SceneData | null;
  /** Full data of the selected entity (Details), fetched alongside the tree. */
  selectedEntity: SceneData['entities'][number] | null;
  selection: EntityId | null;
}

/** Minimum gap between sample starts (ms) — a ~60fps cap (no point sampling faster
 *  than the realm renders). The realm sample is cheap (it decodes data only for the
 *  selected entity), and coalescing still self-throttles if a sample ever runs long. */
const MIN_GAP_MS = 16;

/** A cheap structural signature of the shallow tree (ids / parent / name / component
 *  types) — drives keeping the tree reference stable when only values changed. */
function treeSig(t: SceneData): string {
  return t.entities.map((e) => `${e.id},${e.parent ?? ''},${e.name},${e.components.map((c) => c.type).join('+')}`).join('|');
}

class PlayInspectImpl {
  private readonly store = createStore<PlayInspectState>(() => ({ snapshot: null, selectedEntity: null, selection: null }));
  private active = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  subscribe = (fn: () => void): (() => void) => this.store.subscribe(fn);
  getSnapshot = (): PlayInspectState => this.store.getState();

  select(selection: EntityId | null): void {
    this.store.setState({ ...this.store.getState(), selection });
    void this.poll(); // fetch the newly-selected entity's full data immediately
  }

  /** Begin the coalesced sampling loop (call on Play). Idempotent. */
  start(): void {
    if (this.active) return;
    this.active = true;
    void this.tick();
  }

  /** Stop sampling + clear (call on Stop) — live state is discarded with the realm. */
  stop(): void {
    this.active = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.store.setState({ snapshot: null, selectedEntity: null, selection: null });
  }

  /** Live-edit a field of the running game; refresh immediately for snappy feedback. */
  setField(id: EntityId, comp: string, key: string, value: unknown): void {
    PlayRealm.setField(id, comp, key, value);
    void this.poll();
  }

  // Sample, then re-arm after the reply with at least MIN_GAP_MS between starts.
  private async tick(): Promise<void> {
    if (!this.active) return;
    const t0 = performance.now();
    await this.poll();
    if (!this.active) return;
    const wait = Math.max(0, MIN_GAP_MS - (performance.now() - t0));
    this.timer = setTimeout(() => void this.tick(), wait);
  }

  private async poll(): Promise<void> {
    const sel = this.store.getState().selection;
    const res = await PlayRealm.snapshot(sel);
    if (!res) return;
    const cur = this.store.getState();
    // Keep the tree reference stable unless the structure changed, so the Outliner's
    // memoized tree build is skipped between samples; only the selected entity (the
    // Details payload) refreshes each tick.
    const sameTree = cur.snapshot != null && treeSig(cur.snapshot) === treeSig(res.tree);
    this.store.setState({ snapshot: sameTree ? cur.snapshot : res.tree, selectedEntity: res.selected, selection: cur.selection });
  }
}

export const PlayInspect = new PlayInspectImpl();
