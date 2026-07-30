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
import { bootProfiler } from './bootProfiler';
import type { PlayOutbound, PlayInbound, PlayPayload, PlaySnapshot, PlayStatsReply } from './playProtocol';

export type { PlayPayload, PlaySnapshot } from './playProtocol';

/** A cold first Play stages the SDK + wasm and bundles the project scripts (a few
 *  seconds). Cap the wait so a WEDGED prepare step — e.g. a hung esbuild service —
 *  surfaces as a retryable play error instead of an indefinite "Starting game…". */
const PREPARE_TIMEOUT_MS = 30_000;

/** Reject `p` if it hasn't settled within `ms`; otherwise pass its result through. */
function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

export interface PlayRealmSnapshot {
  playing: boolean;
  ready: boolean;
  error: string | null;
  /** Frames per second the realm is ACTUALLY running, from its own heartbeat. An
   *  unfocused window has the realm's rAF throttled to about 1 — which looks exactly
   *  like a frozen game to anything driving the editor from outside. `null` until the
   *  first heartbeat arrives. */
  fps: number | null;
  /** The realm's engine frame counter at that heartbeat. */
  frameCount: number;
}

export class PlayRealmInstance {
  private iframe: HTMLIFrameElement | null = null;
  private payload: PlayPayload | null = null;
  private netPorts: MessagePort[] | null = null;
  private epoch = 0;
  // The realm's wasm + GL are alive in the (persistent) iframe from a prior Play,
  // so a re-Play hands over the new scene instead of cold-booting a fresh iframe
  // (single-player primary only; multiplayer + play-in-window cold-boot as before).
  private warm = false;
  private warmedResolve: (() => void) | null = null;
  private readonly store = createStore<PlayRealmSnapshot>(() => ({
    playing: false, ready: false, error: null, fps: null, frameCount: 0,
  }));

  constructor(readonly id: number) {}

  subscribe = (fn: () => void): (() => void) => this.store.subscribe(fn);
  getSnapshot = (): PlayRealmSnapshot => this.store.getState();
  private set(patch: Partial<PlayRealmSnapshot>): void {
    this.store.setState({ ...this.store.getState(), ...patch });
  }

  // The window the realm→editor message listener is bound to. The realm iframe posts
  // to its PARENT window, which is whichever window currently hosts the iframe element
  // — the main window normally, but the popout window when the viewport is popped out.
  // The listener must live on that window or the hello/ready handshake never arrives.
  private msgWin: Window | null = null;

  private bindMessages(win: Window): void {
    if (this.msgWin === win) return;
    try { this.msgWin?.removeEventListener('message', this.onMessage); } catch { /* window may be closed */ }
    win.addEventListener('message', this.onMessage);
    this.msgWin = win;
  }

  private ensureIframe(): HTMLIFrameElement {
    if (!this.iframe) {
      const f = document.createElement('iframe');
      f.title = this.id === 0 ? 'Game' : `Game P${this.id + 1}`;
      f.style.cssText = 'display:block;width:100%;height:100%;border:0;background:var(--srf-1)';
      this.bindMessages(window);
      this.iframe = f;
    }
    return this.iframe;
  }

  /** Re-parent the realm iframe into a host panel (kept alive across remounts), and
   *  bind the realm→editor listener to the host's window so it keeps working when the
   *  viewport (and its play host) is popped out into its own OS window. */
  attach(container: HTMLElement): void {
    this.bindMessages(container.ownerDocument.defaultView ?? window);
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
    // Time Play-click → first frame. Only the primary realm profiles (a
    // multiplayer session's client realms would clobber the shared singleton).
    if (this.id === 0) bootProfiler.begin('play (click → first frame)');
    const frame = this.ensureIframe();
    frame.style.visibility = 'hidden';

    // Warm re-Play: the engine is alive in the persistent iframe — hand it the new
    // scene directly (the host does a warm rebuild: no second wasm instantiate, no
    // iframe/bundle reload). Single-player primary only; anything else cold-boots.
    if (this.warm && this.id === 0 && !this.netPorts) {
      // The bundle on disk is only rebuilt by preparePlayRealm (cold path) and by
      // fsWatch WHILE playing — so code edited between Stop and re-Play would replay
      // stale. Rebuild first (incremental esbuild, ~100ms); the host re-imports the
      // bundle cache-busted. Best-effort: a build failure keeps the last-good bundle.
      try {
        await window.estella?.project?.buildScripts?.();
      } catch {
        /* keep the last-good bundle — builtin-only projects have none to rebuild */
      }
      bootProfiler.mark('warm re-Play (rebuild scripts + engine kept alive)');
      this.postInit();
      return;
    }

    try {
      const realm = await withTimeout(
        window.estella.project.preparePlayRealm(),
        PREPARE_TIMEOUT_MS,
        t('proj.playPrepareTimeout'),
      );
      if (this.id === 0) bootProfiler.mark('preparePlayRealm (stage + esbuild)');
      if (!realm.ok) {
        this.set({ error: realm.errors[0] ?? t('proj.playPrepareFailed') });
        return;
      }
      frame.src = `estella://project/${realm.hostPath}?n=${++this.epoch}`;
    } catch (err) {
      this.set({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  /** Post the scene payload to the (loaded) realm — cold on `hello`, or directly
   *  on a warm re-Play. Transfers net MessagePorts with it for multiplayer. */
  private postInit(): void {
    if (!this.payload) return;
    const ports = this.netPorts ?? undefined;
    this.post({ type: 'estella:play:init', ...this.payload, netPorts: ports }, ports);
  }

  /** Stop the game. Single-player keeps the engine WARM (hide + pause, no reboot)
   *  so the next Play is a fast scene swap; multiplayer/other realms release the
   *  wasm + GL by navigating to a blank page. */
  stop(): void {
    this.payload = null;
    this.netPorts = null;
    if (this.warm && this.id === 0) {
      if (this.iframe) this.iframe.style.visibility = 'hidden';
      this.setPaused(true); // freeze the world so a hidden realm doesn't keep simulating
      this.set({ playing: false, ready: false, error: null, fps: null, frameCount: 0 });
      return;
    }
    if (this.iframe) {
      this.iframe.style.visibility = 'hidden';
      this.iframe.src = 'about:blank';
    }
    this.warm = false;
    this.set({ playing: false, ready: false, error: null, fps: null, frameCount: 0 });
  }

  /** Drop the staged realm but keep the iframe + listener (reusable): cold
   *  teardown so the NEXT prewarm/Play stages the current project. Call when the
   *  open project changes — a warm realm still holds the previous project's
   *  bundle + wasm + assets and would silently play the wrong project. */
  reset(): void {
    this.warm = false;
    this.stop();
  }

  /** Full teardown for a session-scoped (client) realm: stop + drop the iframe
   *  and the window listener. The instance is not reusable afterwards. */
  destroy(): void {
    this.warm = false; // force stop() down the cold teardown path (release wasm + GL)
    this.stop();
    // Unbind from the window the listener was actually added to (msgWin — the
    // popout window when the viewport is popped out), not the global window.
    try { this.msgWin?.removeEventListener('message', this.onMessage); } catch { /* window may be closed */ }
    this.msgWin = null;
    this.detach();
    this.iframe = null;
  }

  setPaused(paused: boolean): void {
    this.post({ type: 'estella:play:setPaused', paused });
  }

  /** Idle prewarm: mount + boot the realm's engine (wasm + GL, NO scene) in the
   *  persistent iframe so the FIRST Play is a warm scene load, not a cold engine
   *  bring-up. Resolves when the engine is up (or on a timeout / if it can't warm
   *  yet). Best-effort: any failure just leaves the first Play cold. */
  async prewarm(): Promise<void> {
    if (this.id !== 0 || this.warm || this.store.getState().playing) return;
    const realm = await window.estella.project.preparePlayRealm().catch(() => null);
    if (!realm?.ok || this.warm || this.store.getState().playing) return;
    const frame = this.ensureIframe();
    // Must be in the DOM to load; the viewport attaches it as the persistent play
    // host. Not attached yet ⇒ skip — a later prewarm tick warms it.
    if (!frame.isConnected) return;
    frame.style.visibility = 'hidden';
    frame.src = `estella://project/${realm.hostPath}?n=${++this.epoch}`;
    // hello (no payload) → we post 'warm' → host boots engine → 'warmed' resolves this.
    await new Promise<void>((resolve) => {
      this.warmedResolve = resolve;
      setTimeout(resolve, 10000); // never block the loading gate forever
    });
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
   *  Details panel. `opts.tree: false` samples the selected entity only (the
   *  realm skips its O(entities) tree walk; `tree` comes back null). Null if not
   *  ready. */
  snapshot(selectedId: number | null, opts?: { tree?: boolean }): Promise<PlaySnapshot | null> {
    if (!this.iframe?.contentWindow || !this.store.getState().ready) return Promise.resolve(null);
    const reqId = ++this.reqSeq;
    return new Promise((resolve) => {
      const done = (data: unknown) => resolve((data as PlaySnapshot) ?? null);
      this.pending.set(reqId, done);
      this.post({ type: 'estella:play:query', kind: 'snapshot', reqId, selectedId, withTree: opts?.tree !== false });
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
        if (this.id === 0) bootProfiler.mark('iframe + host bundle load (→hello)');
        // A real start() set the payload → play it; a prewarm navigate left it null
        // → boot the engine only (no scene) so the first Play is warm.
        if (this.payload) this.postInit();
        else this.post({ type: 'estella:play:warm' });
        break;
      }
      case 'estella:play:frames':
        this.set({ fps: data.fps ?? 0, frameCount: data.frameCount ?? 0 });
        break;
      case 'estella:play:log':
        // The running game's console/wasm output, forwarded from the realm iframe so
        // it lands in the editor's Output Log (it runs in a separate JS realm, so the
        // parent's console patch never sees it).
        LogStore.push(data.level ?? 'info', this.id === 0 ? 'Play' : `Play P${this.id + 1}`, data.line ?? '');
        break;
      case 'estella:play:ready':
        if (this.id === 0) {
          // Fold the realm's own boot sub-timing (bundle/wasm/scene) into the
          // 'realm boot' phase, then close the Play profile.
          if (data.phases) bootProfiler.detail('realm boot: wasm + scene (→ready)', data.phases);
          bootProfiler.mark('realm boot: wasm + scene (→ready)');
          bootProfiler.report();
        }
        // The engine is now alive in the iframe; a single-player primary keeps it
        // warm across Stop so the next Play is a scene swap, not a cold reboot.
        if (this.id === 0 && !this.netPorts) this.warm = true;
        this.set({ ready: true });
        if (this.iframe) this.iframe.style.visibility = 'visible';
        // Hand the running game keyboard focus so it's playable immediately — the
        // realm's InputPlugin listens on the iframe's own document, which receives
        // key events only while the iframe is focused. Without this the user has to
        // click the game first and WASD/arrows do nothing until they do. In a
        // multiplayer session only player 1 grabs focus (last-ready would steal it).
        if (this.id === 0) this.focusGame();
        break;
      case 'estella:play:warmed':
        // Idle prewarm finished: the engine is up with no scene, so the first
        // Play is a warm scene load. Resolve any awaiting prewarm() (loading gate).
        if (this.id === 0 && !this.netPorts) this.warm = true;
        this.warmedResolve?.();
        this.warmedResolve = null;
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

  /** Prewarm the primary realm's engine ahead of Play (idle / project-open loading
   *  gate): boots its wasm + GL with no scene so the first Play is a warm scene
   *  load. Resolves when warm (or on timeout). Best-effort. */
  prewarm(): Promise<void> {
    return this.primary.prewarm();
  }

  /** Cold-reset the primary realm on a project switch / return to launcher, so a
   *  realm warmed for project A never serves project B (see {@link PlayRealmInstance.reset}). */
  resetPrimary(): void {
    this.primary.reset();
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
