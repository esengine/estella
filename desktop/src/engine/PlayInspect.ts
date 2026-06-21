/**
 * @file  PlayInspect.ts — the editor's "Game" inspection source (UE5-PIE Details).
 *        While playing, it polls the running realm for a live SceneData snapshot
 *        (via PlayRealm.snapshot → serializeScene of the realm's World) and holds
 *        the user's live selection. The Outliner/Details build their view-models
 *        from this snapshot (reusing buildSceneTree/buildInspector) when in Game
 *        mode; field edits route to PlayRealm.setField (live, reverts on Stop).
 *
 *        Selection here is a REALM runtime id — distinct from the editor's
 *        source-id selection (selectionStore), never mixed.
 */
import { createStore } from 'zustand/vanilla';
import type { SceneData } from 'esengine';
import type { EntityId } from '@/types';
import { PlayRealm } from './PlayRealm';

interface PlayInspectState {
  snapshot: SceneData | null;
  selection: EntityId | null;
}

const POLL_MS = 300;

class PlayInspectImpl {
  private readonly store = createStore<PlayInspectState>(() => ({ snapshot: null, selection: null }));
  private timer: ReturnType<typeof setInterval> | null = null;

  subscribe = (fn: () => void): (() => void) => this.store.subscribe(fn);
  getSnapshot = (): PlayInspectState => this.store.getState();

  select(selection: EntityId | null): void {
    this.store.setState({ ...this.store.getState(), selection });
  }

  /** Begin polling the running realm (call on Play). */
  start(): void {
    this.stop();
    void this.poll();
    this.timer = setInterval(() => void this.poll(), POLL_MS);
  }

  /** Stop polling + clear (call on Stop) — live state is discarded with the realm. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.store.setState({ snapshot: null, selection: null });
  }

  /** Live-edit a field of the running game; refresh immediately for snappy feedback. */
  setField(id: EntityId, comp: string, key: string, value: unknown): void {
    PlayRealm.setField(id, comp, key, value);
    void this.poll();
  }

  private async poll(): Promise<void> {
    const snapshot = await PlayRealm.snapshot();
    if (snapshot) this.store.setState({ ...this.store.getState(), snapshot });
  }
}

export const PlayInspect = new PlayInspectImpl();
