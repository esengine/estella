// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  PlayInspect.ts — the editor's "Game" inspection source.
 *        While playing, it samples the running realm for a live SceneData snapshot
 *        (via PlayRealm.snapshot → serializeScene of the realm's World) and holds
 *        the user's live selection. The Outliner/Details build their view-models
 *        from this snapshot (reusing buildSceneTree/buildInspector) when in Game
 *        mode; field edits route to PlayRealm.setField (live, reverts on Stop).
 *
 *        Sampling is a COALESCED loop, not a fixed-interval poll: one request is
 *        in flight at a time and the next is armed only after the reply. It runs
 *        ONLY while a game-mode panel is actually subscribed (the GameTree /
 *        GameDetails views mount only in Game mode), and at split rates: the
 *        O(entities) tree at ~7Hz, the selected entity's full data at ~30Hz
 *        (detail-only samples skip the realm's tree walk entirely).
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

/** Minimum gap between STRUCTURAL tree samples (ms) — the Outliner doesn't need
 *  more than ~7Hz, and the tree serialize is the O(entities) part. */
const TREE_GAP_MS = 150;
/** Minimum gap between selected-entity samples (ms, ~30Hz) — the Details tracks
 *  live values smoothly; the realm decodes data only for that one entity. */
const DETAIL_GAP_MS = 33;

/** A cheap structural signature of the shallow tree (ids / parent / name / component
 *  types) — drives keeping the tree reference stable when only values changed. */
function treeSig(t: SceneData): string {
  return t.entities.map((e) => `${e.id},${e.parent ?? ''},${e.name},${e.components.map((c) => c.type).join('+')}`).join('|');
}

class PlayInspectImpl {
  private readonly store = createStore<PlayInspectState>(() => ({ snapshot: null, selectedEntity: null, selection: null }));
  private active = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  // Consumers of the live snapshot (the game-mode Outliner/Details views). Zero
  // subscribers = nobody is looking = don't sample the realm at all.
  private subscribers = 0;
  // One loop at a time: `scheduled` covers a queued-or-in-flight tick; `epoch`
  // invalidates an in-flight tick across stop()/start() so it can't double-arm.
  private scheduled = false;
  private loopEpoch = 0;
  private lastTreeAt = 0;
  // Signature of the CURRENT tree snapshot — computed once when a tree arrives,
  // cached so a new sample hashes only itself (not the old tree again).
  private curTreeSig = '';

  subscribe = (fn: () => void): (() => void) => {
    const unsub = this.store.subscribe(fn);
    this.subscribers++;
    this.arm();
    return () => {
      this.subscribers--;
      unsub();
    };
  };
  getSnapshot = (): PlayInspectState => this.store.getState();
  /** Identity-stable slices so Details-only ticks don't re-render the Outliner. */
  getTree = (): SceneData | null => this.store.getState().snapshot;
  getSelection = (): EntityId | null => this.store.getState().selection;

  select(selection: EntityId | null): void {
    this.store.setState({ ...this.store.getState(), selection });
    void this.poll(false); // fetch the newly-selected entity's full data immediately
  }

  /** Begin sampling (call on Play). Idempotent; idles until a consumer subscribes. */
  start(): void {
    if (this.active) return;
    this.active = true;
    this.arm();
  }

  /** Stop sampling + clear (call on Stop) — live state is discarded with the realm. */
  stop(): void {
    this.active = false;
    this.loopEpoch++;
    this.scheduled = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.lastTreeAt = 0;
    this.curTreeSig = '';
    this.store.setState({ snapshot: null, selectedEntity: null, selection: null });
  }

  /** Live-edit a field of the running game; refresh immediately for snappy feedback. */
  setField(id: EntityId, comp: string, key: string, value: unknown): void {
    PlayRealm.setField(id, comp, key, value);
    void this.poll(false);
  }

  // Start the loop if it should run and isn't already (called on start + on the
  // first subscriber appearing while playing).
  private arm(): void {
    if (!this.active || this.subscribers === 0 || this.scheduled) return;
    this.scheduled = true;
    void this.tick(this.loopEpoch);
  }

  // Sample, then re-arm after the reply — the detail rate when an entity is
  // selected, the tree rate otherwise; each tick includes the tree only when the
  // tree interval elapsed.
  private async tick(epoch: number): Promise<void> {
    if (epoch !== this.loopEpoch || !this.active || this.subscribers === 0) {
      this.scheduled = false;
      return;
    }
    const t0 = performance.now();
    const withTree = this.store.getState().snapshot == null || t0 - this.lastTreeAt >= TREE_GAP_MS;
    await this.poll(withTree);
    if (epoch !== this.loopEpoch || !this.active || this.subscribers === 0) {
      this.scheduled = false;
      return;
    }
    const gap = this.store.getState().selection != null ? DETAIL_GAP_MS : TREE_GAP_MS;
    const wait = Math.max(0, gap - (performance.now() - t0));
    this.timer = setTimeout(() => void this.tick(epoch), wait);
  }

  private async poll(withTree: boolean): Promise<void> {
    const sel = this.store.getState().selection;
    const res = await PlayRealm.snapshot(sel, { tree: withTree });
    if (!res) return;
    const cur = this.store.getState();
    // Keep the tree reference stable unless the structure changed, so the Outliner's
    // memoized tree build is skipped between samples; only the selected entity (the
    // Details payload) refreshes each tick. A detail-only sample has no tree.
    let snapshot = cur.snapshot;
    if (res.tree) {
      this.lastTreeAt = performance.now();
      const sig = treeSig(res.tree);
      if (cur.snapshot == null || sig !== this.curTreeSig) snapshot = res.tree;
      this.curTreeSig = sig;
    }
    const sameSelected = cur.selectedEntity === res.selected
      || (cur.selectedEntity != null && res.selected != null
        && JSON.stringify(cur.selectedEntity) === JSON.stringify(res.selected));
    if (snapshot === cur.snapshot && sameSelected) return;
    this.store.setState({
      snapshot,
      selectedEntity: sameSelected ? cur.selectedEntity : res.selected,
      selection: cur.selection,
    });
  }
}

export const PlayInspect = new PlayInspectImpl();
