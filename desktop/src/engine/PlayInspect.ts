// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  PlayInspect.ts — the editor's window into the running world.
 *        While playing, it samples the realm for a live SceneData snapshot
 *        (via PlayRealm.snapshot → the realm's own World walk) and resolves the
 *        editor's {@link EntityRef} selection against it. The Outliner/Details
 *        build their view-models from this snapshot; field edits route to
 *        PlayRealm.setField (live, reverts on Stop).
 *
 *        Sampling is a COALESCED loop, not a fixed-interval poll: one request is
 *        in flight at a time and the next is armed only after the reply. It runs
 *        ONLY while a consumer is actually subscribed, and at split rates: the
 *        O(entities) tree at ~7Hz, the selected entity's full data at ~30Hz
 *        (detail-only samples skip the realm's tree walk entirely).
 *
 *        Selection lives in selectionStore, as a ref — this holds only the
 *        mapping that resolves one to a realm runtime id.
 */
import { createStore } from 'zustand/vanilla';
import type { SceneData } from 'esengine';
import type { EntityId } from '@/types';
import type { LiveOrigin, PlayOverlayBox } from './playProtocol';
import { useSelection } from '@/store/selectionStore';
import { refOfLive, type EntityRef } from './entityRef';
import { PlayRealm } from './PlayRealm';

interface PlayInspectState {
  /** Shallow entity tree of the running World (Outliner). */
  snapshot: SceneData | null;
  /** Full data of the selected entity (Details), fetched alongside the tree. */
  selectedEntity: SceneData['entities'][number] | null;
  /** Where that entity is drawn on the realm's canvas (the viewport overlay). */
  overlay: PlayOverlayBox | null;
}

/** Minimum gap between STRUCTURAL tree samples (ms) — the Outliner doesn't need
 *  more than ~7Hz, and the tree serialize is the O(entities) part. */
const TREE_GAP_MS = 150;
/** Minimum gap between selected-entity samples (ms, ~30Hz) — the Details tracks
 *  live values smoothly; the realm decodes data only for that one entity. */
const DETAIL_GAP_MS = 33;

type LiveEntity = SceneData['entities'][number] & LiveOrigin;

/** A cheap structural signature of the shallow tree (ids / parent / name / component
 *  types) — drives keeping the tree reference stable when only values changed.
 *
 *  `hidden` and `src` ride along despite not being structure: they are what the
 *  TREE shows and what its rows are keyed by, so leaving them out would hold the
 *  old reference and the eye you just clicked would not change. */
function treeSig(t: SceneData): string {
  return t.entities
    .map((e) => {
      const live = e as LiveEntity & { hidden?: boolean };
      return `${e.id},${e.parent ?? ''},${e.name},${live.hidden ? 'h' : ''},${live.src ?? ''},${e.components.map((c) => c.type).join('+')}`;
    })
    .join('|');
}

class PlayInspectImpl {
  private readonly store = createStore<PlayInspectState>(() => ({ snapshot: null, selectedEntity: null, overlay: null }));
  private active = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  // Consumers of the live snapshot. Zero subscribers = nobody is looking = don't
  // sample the realm at all.
  private subscribers = 0;
  // One loop at a time: `scheduled` covers a queued-or-in-flight tick; `epoch`
  // invalidates an in-flight tick across stop()/start() so it can't double-arm.
  private scheduled = false;
  private loopEpoch = 0;
  private lastTreeAt = 0;
  // Signature of the CURRENT tree snapshot — computed once when a tree arrives,
  // cached so a new sample hashes only itself (not the old tree again).
  private curTreeSig = '';
  // Identity, both ways, for the tree currently held. Rebuilt with it.
  private srcToLive = new Map<EntityId, EntityId>();
  private liveToSrc = new Map<EntityId, EntityId>();
  private liveIds = new Set<EntityId>();

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

  /** The realm runtime id `ref` names right now, or null when the running world
   *  has no such entity (never spawned, or already destroyed). */
  liveIdOf(ref: EntityRef | null): EntityId | null {
    if (ref == null) return null;
    if (ref.world === 'spawned') return this.liveIds.has(ref.live) ? ref.live : null;
    return this.srcToLive.get(ref.src) ?? null;
  }

  /** Identity of a realm runtime id — authored when the realm reported a document
   *  id for it, else spawned. */
  refOf(live: EntityId): EntityRef {
    return refOfLive(live, this.liveToSrc.get(live));
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
    this.srcToLive = new Map();
    this.liveToSrc = new Map();
    this.liveIds = new Set();
    this.store.setState({ snapshot: null, selectedEntity: null, overlay: null });
    // A selection the realm owned outlives nothing: with the realm gone there is
    // no entity behind it and no row to show it on.
    useSelection.getState().dropSpawnedSelection();
  }

  /** Where the selection is drawn on the realm's canvas, as of the last sample. */
  getOverlay = (): PlayOverlayBox | null => this.store.getState().overlay;

  /** The live data of `comp` on `id`, for a write that has to merge into it.
   *  Only the SELECTED entity's data is sampled, so anything else answers empty. */
  componentData(id: EntityId, comp: string): Record<string, unknown> {
    const sel = this.store.getState().selectedEntity;
    if (!sel || sel.id !== id) return {};
    return (sel.components.find((c) => c.type === comp)?.data as Record<string, unknown>) ?? {};
  }

  /** Live-edit a field of the running game; refresh immediately for snappy feedback. */
  setField(id: EntityId, comp: string, key: string, value: unknown): void {
    PlayRealm.setField(id, comp, key, value);
    void this.poll(false);
  }

  /** Show/hide a running entity. The eye is a TREE fact, so this resamples the
   *  tree — a detail-only poll would leave the row it was clicked on unchanged. */
  setVisible(id: EntityId, visible: boolean): void {
    PlayRealm.setVisible(id, visible);
    void this.poll(true);
  }

  /** Re-sample now (a selection change wants its entity's data without waiting). */
  refresh(): void {
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
    const gap = this.selectedLiveId() != null ? DETAIL_GAP_MS : TREE_GAP_MS;
    const wait = Math.max(0, gap - (performance.now() - t0));
    this.timer = setTimeout(() => void this.tick(epoch), wait);
  }

  private selectedLiveId(): EntityId | null {
    return this.liveIdOf(useSelection.getState().selectedRef);
  }

  private async poll(withTree: boolean): Promise<void> {
    const sel = this.selectedLiveId();
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
      if (cur.snapshot == null || sig !== this.curTreeSig) {
        snapshot = res.tree;
        this.reindex(res.tree);
      }
      this.curTreeSig = sig;
    }
    const sameSelected = cur.selectedEntity === res.selected
      || (cur.selectedEntity != null && res.selected != null
        && JSON.stringify(cur.selectedEntity) === JSON.stringify(res.selected));
    // The overlay moves with the game whether or not any value changed — a
    // gizmo that only redrew when the Inspector did would lag the sprite it is
    // drawn around by however long that took.
    const sameOverlay = JSON.stringify(cur.overlay) === JSON.stringify(res.overlay ?? null);
    if (snapshot === cur.snapshot && sameSelected && sameOverlay) return;
    this.store.setState({
      snapshot,
      selectedEntity: sameSelected ? cur.selectedEntity : res.selected,
      overlay: sameOverlay ? cur.overlay : (res.overlay ?? null),
    });
  }

  private reindex(tree: SceneData): void {
    this.srcToLive = new Map();
    this.liveToSrc = new Map();
    this.liveIds = new Set();
    for (const e of tree.entities as LiveEntity[]) {
      this.liveIds.add(e.id);
      if (e.src === undefined) continue;
      this.srcToLive.set(e.src, e.id);
      this.liveToSrc.set(e.id, e.src);
    }
  }
}

export const PlayInspect = new PlayInspectImpl();
