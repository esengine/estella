// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  PlayRealm.ts — controller for the isolated play realm.
 *        Owns a detached <iframe> (play.html) re-parented into the Game
 *        panel (mirrors EngineHost's detached-canvas pattern), and the typed
 *        postMessage protocol with it:
 *          out → init {sceneData, assetManifest} · setPaused {paused}
 *          in  ← hello (mounted) · ready (running) · error {message}
 *        Each Play loads a FRESH realm (own wasm + GL + World); Stop points the
 *        iframe at about:blank, tearing the realm down. The edit World is never
 *        touched, so there is nothing to restore.
 */
import { createStore } from 'zustand/vanilla';
import type { SceneData } from 'esengine';

export interface PlayPayload {
  sceneData: SceneData;
  assetManifest: Record<string, string>;
  /** Project-declared physics enable (features.physics) — forwarded to the realm. */
  physicsEnabled?: boolean;
  physicsGravity?: { x: number; y: number };
}

export interface PlayRealmSnapshot {
  playing: boolean;
  ready: boolean;
  error: string | null;
}

/** A live inspect snapshot: a shallow entity tree (Outliner) + the selected
 *  entity's full data (Details). See PlayRealm.snapshot. */
export interface PlaySnapshot {
  tree: SceneData;
  selected: SceneData['entities'][number] | null;
}

class PlayRealmImpl {
  private iframe: HTMLIFrameElement | null = null;
  private payload: PlayPayload | null = null;
  private epoch = 0;
  private readonly store = createStore<PlayRealmSnapshot>(() => ({ playing: false, ready: false, error: null }));

  subscribe = (fn: () => void): (() => void) => this.store.subscribe(fn);
  getSnapshot = (): PlayRealmSnapshot => this.store.getState();
  private set(patch: Partial<PlayRealmSnapshot>): void {
    this.store.setState({ ...this.store.getState(), ...patch });
  }

  private ensureIframe(): HTMLIFrameElement {
    if (!this.iframe) {
      const f = document.createElement('iframe');
      f.title = 'Game';
      f.style.cssText = 'display:block;width:100%;height:100%;border:0;background:#0e121b';
      window.addEventListener('message', this.onMessage);
      this.iframe = f;
    }
    return this.iframe;
  }

  /** Re-parent the realm iframe into the Game panel (kept alive across remounts). */
  attach(container: HTMLElement): void {
    container.appendChild(this.ensureIframe());
  }
  detach(): void {
    this.iframe?.parentElement?.removeChild(this.iframe);
  }

  /**
   * Boot a fresh realm and play `payload`. Stages the realm under the project's
   * `.esengine/play/` (host + SDK + wasm + project bundle) and loads it from the
   * project's `estella://` origin, so the host + the project bundle share one
   * esengine instance (custom components/systems run) and all assets are
   * same-origin. Init is posted on the realm's `hello`.
   */
  async start(payload: PlayPayload): Promise<void> {
    this.payload = payload;
    this.set({ playing: true, ready: false, error: null });
    const frame = this.ensureIframe();
    try {
      const realm = await window.estella.project.preparePlayRealm();
      if (!realm.ok) {
        this.set({ error: realm.errors[0] ?? 'failed to prepare play realm' });
        return;
      }
      frame.src = `estella://project/${realm.hostPath}?n=${++this.epoch}`;
    } catch (err) {
      this.set({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  /** Tear the realm down (releases its wasm + GL by navigating to a blank page). */
  stop(): void {
    this.payload = null;
    if (this.iframe) this.iframe.src = 'about:blank';
    this.set({ playing: false, ready: false, error: null });
  }

  setPaused(paused: boolean): void {
    this.post({ type: 'estella:play:setPaused', paused });
  }

  /** Hot-reload the running realm's project code in place: the realm re-imports
   *  the rebuilt bundle and rebuilds its World on the live wasm + GL + assets
   *  (fast restart from the play-start snapshot), no iframe reboot. No-op unless a
   *  session is live and ready; `ready` flips back on the realm's `ready` reply. */
  reload(): void {
    if (!this.iframe?.contentWindow || !this.store.getState().ready) return;
    this.set({ ready: false });
    this.post({ type: 'estella:play:reload' });
  }

  // — Live introspection bridge (the "Game" Details): query/mutate the running World —
  private reqSeq = 0;
  private readonly pending = new Map<number, (data: unknown) => void>();

  /** A live inspect snapshot: a SHALLOW tree of the running World (cheap to ship
   *  even for thousands of entities) plus the FULL data of `selectedId` for the
   *  Details panel. Null if not ready. */
  snapshot(selectedId: number | null): Promise<PlaySnapshot | null> {
    if (!this.iframe?.contentWindow || !this.store.getState().ready) return Promise.resolve(null);
    const reqId = ++this.reqSeq;
    return new Promise((resolve) => {
      const done = (data: unknown) => resolve((data as PlaySnapshot) ?? null);
      this.pending.set(reqId, done);
      this.post({ type: 'estella:play:query', kind: 'snapshot', reqId, selectedId });
      setTimeout(() => {
        if (this.pending.delete(reqId)) resolve(null);
      }, 2000);
    });
  }

  /** Live-edit a field of a running entity (debug; reverts on Stop). */
  setField(entityId: number, comp: string, key: string, value: unknown): void {
    this.post({ type: 'estella:play:setField', entityId, comp, key, value });
  }

  private post(message: Record<string, unknown>): void {
    this.iframe?.contentWindow?.postMessage(message, '*');
  }

  private onMessage = (e: MessageEvent): void => {
    if (!this.iframe || e.source !== this.iframe.contentWindow) return;
    const data = e.data as { type?: string; message?: string; reqId?: number; data?: unknown } | null;
    if (!data?.type) return;
    switch (data.type) {
      case 'estella:play:hello':
        // Realm mounted + listening — hand it the scene snapshot.
        if (this.payload) this.post({ type: 'estella:play:init', ...this.payload });
        break;
      case 'estella:play:ready':
        this.set({ ready: true });
        break;
      case 'estella:play:error':
        this.set({ error: data.message ?? 'play realm error' });
        break;
      case 'estella:play:reply': {
        const resolve = data.reqId != null ? this.pending.get(data.reqId) : undefined;
        if (resolve && data.reqId != null) {
          this.pending.delete(data.reqId);
          resolve(data.data);
        }
        break;
      }
    }
  };
}

export const PlayRealm = new PlayRealmImpl();
