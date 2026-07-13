// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  PlayRealm.ts — controller for the isolated play realm(s).
 *        A realm instance owns a detached <iframe> (play.html) re-parented into
 *        a Game panel (mirrors EngineHost's detached-canvas pattern), and the
 *        typed postMessage protocol with it:
 *          out → init {sceneData, assetManifest[, net + transferred ports]} · setPaused
 *          in  ← hello (mounted) · ready (running) · error {message}
 *        Each Play loads a FRESH realm (own wasm + GL + World); Stop points the
 *        iframe at about:blank, tearing the realm down. The edit World is never
 *        touched, so there is nothing to restore.
 *
 *        Multiplayer preview (PlayRealms.startSession with players > 1): the
 *        primary realm boots as the listen server (authority + player 1) and
 *        each extra realm boots as a client, wired by MessageChannel ports the
 *        editor transfers with init — the same NetSession/NetTransport seam a
 *        shipped game uses over sockets.
 */
import { createStore } from 'zustand/vanilla';
import type { SubsystemStatus } from 'esengine';
import { LogStore } from '@/store/LogStore';
import { t } from '@/i18n';
import { playProtocolMismatch } from './playProtocol';
import type { PlayOutbound, PlayInbound, PlayPayload, PlaySnapshot, PlayStatsReply } from './playProtocol';

export type { PlayPayload, PlaySnapshot } from './playProtocol';

export interface PlayRealmSnapshot {
  playing: boolean;
  ready: boolean;
  error: string | null;
}

export class PlayRealmInstance {
  private iframe: HTMLIFrameElement | null = null;
  private payload: PlayPayload | null = null;
  private netPorts: MessagePort[] | null = null;
  private epoch = 0;
  private readonly store = createStore<PlayRealmSnapshot>(() => ({ playing: false, ready: false, error: null }));

  constructor(readonly id: number) {}

  subscribe = (fn: () => void): (() => void) => this.store.subscribe(fn);
  getSnapshot = (): PlayRealmSnapshot => this.store.getState();
  private set(patch: Partial<PlayRealmSnapshot>): void {
    this.store.setState({ ...this.store.getState(), ...patch });
  }

  private ensureIframe(): HTMLIFrameElement {
    if (!this.iframe) {
      const f = document.createElement('iframe');
      f.title = this.id === 0 ? 'Game' : `Game P${this.id + 1}`;
      f.style.cssText = 'display:block;width:100%;height:100%;border:0;background:var(--srf-1)';
      window.addEventListener('message', this.onMessage);
      this.iframe = f;
    }
    return this.iframe;
  }

  /** Re-parent the realm iframe into a Game panel (kept alive across remounts). */
  attach(container: HTMLElement): void {
    container.appendChild(this.ensureIframe());
  }

  /** Give the running game keyboard focus. Focusing the frame element routes key
   *  events into its document (where the game listens); focusing the contentWindow
   *  as well is belt-and-suspenders and is one of the few cross-origin-allowed calls. */
  focusGame(): void {
    this.iframe?.focus();
    try {
      this.iframe?.contentWindow?.focus();
    } catch {
      /* cross-origin contentWindow.focus can throw in some engines — element focus suffices */
    }
  }
  detach(): void {
    this.iframe?.parentElement?.removeChild(this.iframe);
  }

  /**
   * Boot a fresh realm and play `payload`. Stages the realm under the project's
   * `.esengine/play/` (host + SDK + wasm + project bundle) and loads it from the
   * project's `estella://` origin, so the host + the project bundle share one
   * esengine instance (custom components/systems run) and all assets are
   * same-origin. Init is posted on the realm's `hello`; `netPorts` (multiplayer
   * MessageChannel ends) transfer with it.
   */
  async start(payload: PlayPayload, netPorts?: MessagePort[]): Promise<void> {
    this.payload = payload;
    this.netPorts = netPorts ?? null;
    this.set({ playing: true, ready: false, error: null });
    const frame = this.ensureIframe();
    frame.style.visibility = 'hidden';
    try {
      const realm = await window.estella.project.preparePlayRealm();
      if (!realm.ok) {
        this.set({ error: realm.errors[0] ?? t('proj.playPrepareFailed') });
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
    this.netPorts = null;
    if (this.iframe) {
      this.iframe.style.visibility = 'hidden';
      this.iframe.src = 'about:blank';
    }
    this.set({ playing: false, ready: false, error: null });
  }

  /** Full teardown for a session-scoped (client) realm: stop + drop the iframe
   *  and the window listener. The instance is not reusable afterwards. */
  destroy(): void {
    this.stop();
    window.removeEventListener('message', this.onMessage);
    this.detach();
    this.iframe = null;
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

  /** The running game's subsystem (module) health, for the editor's Modules indicator.
   *  Null if not ready. */
  subsystems(): Promise<SubsystemStatus[] | null> {
    if (!this.iframe?.contentWindow || !this.store.getState().ready) return Promise.resolve(null);
    const reqId = ++this.reqSeq;
    return new Promise((resolve) => {
      this.pending.set(reqId, (data) => resolve((data as SubsystemStatus[]) ?? null));
      this.post({ type: 'estella:play:query', kind: 'subsystems', reqId });
      setTimeout(() => { if (this.pending.delete(reqId)) resolve(null); }, 2000);
    });
  }

  /** The running game's frame telemetry (phases/systems/counters) for the editor
   *  profiler's engine segment while playing. Null if not ready. */
  stats(): Promise<PlayStatsReply | null> {
    if (!this.iframe?.contentWindow || !this.store.getState().ready) return Promise.resolve(null);
    const reqId = ++this.reqSeq;
    return new Promise((resolve) => {
      this.pending.set(reqId, (data) => resolve((data as PlayStatsReply) ?? null));
      this.post({ type: 'estella:play:query', kind: 'stats', reqId });
      setTimeout(() => { if (this.pending.delete(reqId)) resolve(null); }, 2000);
    });
  }

  /** Live-edit a field of a running entity (debug; reverts on Stop). */
  setField(entityId: number, comp: string, key: string, value: unknown): void {
    this.post({ type: 'estella:play:setField', entityId, comp, key, value });
  }

  private post(message: PlayOutbound, transfer?: Transferable[]): void {
    this.iframe?.contentWindow?.postMessage(message, '*', transfer);
  }

  private onMessage = (e: MessageEvent): void => {
    if (!this.iframe || e.source !== this.iframe.contentWindow) return;
    const data = e.data as PlayInbound | null;
    if (!data?.type) return;
    switch (data.type) {
      case 'estella:play:hello': {
        // Realm mounted + listening. Verify the protocol contract before handing over
        // the scene — a version mismatch is a stale realm bundle, surfaced as an error
        // rather than a baffling downstream failure on an unknown message shape.
        const mismatch = playProtocolMismatch(data.protocolVersion);
        if (mismatch) {
          this.set({ error: mismatch });
          break;
        }
        if (this.payload) {
          const ports = this.netPorts ?? undefined;
          this.post({ type: 'estella:play:init', ...this.payload, netPorts: ports }, ports);
        }
        break;
      }
      case 'estella:play:log':
        // The running game's console/wasm output, forwarded from the realm iframe so
        // it lands in the editor's Output Log (it runs in a separate JS realm, so the
        // parent's console patch never sees it).
        LogStore.push(data.level ?? 'info', this.id === 0 ? 'Play' : `Play P${this.id + 1}`, data.line ?? '');
        break;
      case 'estella:play:ready':
        this.set({ ready: true });
        if (this.iframe) this.iframe.style.visibility = 'visible';
        // Hand the running game keyboard focus so it's playable immediately — the
        // realm's InputPlugin listens on the iframe's own document, which receives
        // key events only while the iframe is focused. Without this the user has to
        // click the game first and WASD/arrows do nothing until they do. In a
        // multiplayer session only player 1 grabs focus (last-ready would steal it).
        if (this.id === 0) this.focusGame();
        break;
      case 'estella:play:error':
        this.set({ error: data.message ?? t('proj.playRealmError') });
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

/**
 * The session controller. Single-player keeps the primary realm's exact old
 * behavior; `players > 1` boots primary as the listen server plus N-1 client
 * realms wired by MessageChannel ports. Client realms are session-scoped:
 * created on start, destroyed on stop.
 */
export interface PlaySessionSnapshot {
  /** Bumps on every session start/stop — client panels re-attach on it (a
   *  multiplayer reload replaces the realm instances behind the same panel). */
  epoch: number;
  clientIds: number[];
}

class PlayRealmsManager {
  readonly primary = new PlayRealmInstance(0);
  private clients_: PlayRealmInstance[] = [];
  private lastPayload_: PlayPayload | null = null;
  private lastPlayers_ = 1;
  private readonly session = createStore<PlaySessionSnapshot>(() => ({ epoch: 0, clientIds: [] }));

  subscribeSession = (fn: () => void): (() => void) => this.session.subscribe(fn);
  getSessionSnapshot = (): PlaySessionSnapshot => this.session.getState();
  private bumpSession(): void {
    this.session.setState({
      epoch: this.session.getState().epoch + 1,
      clientIds: this.clients_.map((c) => c.id),
    });
  }

  get clients(): readonly PlayRealmInstance[] {
    return this.clients_;
  }

  /** A live realm by id (0 = primary), or null. */
  get(id: number): PlayRealmInstance | null {
    if (id === 0) return this.primary;
    return this.clients_.find((c) => c.id === id) ?? null;
  }

  /** Stage the realm ahead of time so Play's prepare hits warm stamps. */
  prewarm(): void {
    window.estella.project.preparePlayRealm().catch(() => {});
  }

  async startSession(payload: PlayPayload, players = 1): Promise<void> {
    this.lastPayload_ = payload;
    this.lastPlayers_ = players;
    if (players <= 1) {
      await this.primary.start(payload);
      return;
    }
    // One MessageChannel per client; ports queue until both realms attach, so
    // boot order is free.
    const channels = Array.from({ length: players - 1 }, () => new MessageChannel());
    const started = this.primary.start(
      { ...payload, net: { role: 'server', player: 1 } },
      channels.map((c) => c.port1),
    );
    this.clients_ = channels.map((c, i) => {
      const realm = new PlayRealmInstance(i + 1);
      void realm.start({ ...payload, net: { role: 'client', player: i + 2 } }, [c.port2]);
      return realm;
    });
    this.bumpSession();
    await started;
  }

  stopSession(): void {
    this.primary.stop();
    for (const c of this.clients_) c.destroy();
    this.clients_ = [];
    this.bumpSession();
  }

  setPaused(paused: boolean): void {
    this.primary.setPaused(paused);
    for (const c of this.clients_) c.setPaused(paused);
  }

  /** Project-code reload. Single realm hot-reloads in place; a multiplayer
   *  session restarts whole (its MessageChannel ports were consumed by the live
   *  NetSessions — fresh realms need fresh ports). */
  reload(): void {
    if (this.clients_.length === 0) {
      this.primary.reload();
      return;
    }
    const payload = this.lastPayload_;
    const players = this.lastPlayers_;
    if (!payload) return;
    this.stopSession();
    void this.startSession(payload, players);
  }
}

export const PlayRealms = new PlayRealmsManager();

/** The primary realm — the single-player surface every existing consumer
 *  (inspect, profiler, subsystems, viewport PIE) talks to. */
export const PlayRealm = PlayRealms.primary;
