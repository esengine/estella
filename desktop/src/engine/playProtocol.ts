// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    playProtocol.ts — the single typed contract for the editor↔play-realm
 *          postMessage boundary (RC10). Both ends import these discriminated unions
 *          so the message shapes can't drift: the editor controller (PlayRealm.ts)
 *          and the realm-side host (playHost.ts, esbuilt with esengine external).
 *
 *          Keep this module dependency-free beyond `import type` from esengine —
 *          playHost's esbuild has no '@/' alias and inlines local imports, so a value
 *          import of an editor module here would break the realm bundle. Type-only
 *          imports are erased before resolution and are safe.
 */
import type { SceneData, PhysicsPluginConfig, AudioProjectConfig, ThemeOverrides, AddressableManifest } from 'esengine';

/**
 * Editor↔realm message-contract version. The realm reports it in `hello`; the editor
 * compares it against its own and refuses a mismatch (P1) rather than failing
 * obscurely on a shape it doesn't understand. Bump on any incompatible message change.
 */
export const PLAY_PROTOCOL_VERSION = 2;

/**
 * The handshake check: `null` if the realm's reported protocol version is compatible
 * with this editor build, else a human-readable error. The editor calls this on the
 * realm's `hello` and refuses to hand over the scene on a mismatch — a stale realm
 * bundle (editor and running game built from different versions) fails loudly with a
 * "rebuild" hint instead of silently mis-handling a message shape it doesn't share.
 */
export function playProtocolMismatch(realmVersion: number | undefined): string | null {
  if (realmVersion === PLAY_PROTOCOL_VERSION) return null;
  return `Play realm protocol v${realmVersion ?? '?'} ≠ editor v${PLAY_PROTOCOL_VERSION}. `
    + `Rebuild the play realm — the editor and the running game were built from different versions.`;
}

/** Matches LogStore's LogLevel; redeclared here to keep the contract editor-dep-free. */
export type PlayLogLevel = 'info' | 'warn' | 'error';

/**
 * The realm's role in a multiplayer preview session. The server realm is the
 * listen host (authority + player 1); each client realm connects over a
 * MessageChannel port the editor transfers alongside `init` (`netPorts` on the
 * message — ports only cross realms via the postMessage transfer list, so they
 * ride the message itself, not this payload).
 */
export interface PlayNetConfig {
  role: 'server' | 'client';
  /** 1-based player number, for window titles/diagnostics. */
  player: number;
}

/** The scene + project config handed to a fresh realm on boot. */
export interface PlayPayload {
  sceneData: SceneData;
  assetManifest: Record<string, string>;
  /** AddressableManifest (groups + bundle modes) so `Assets.loadGroup` — remote /
   *  lazy groups — works in Play exactly as in a shipped build. */
  manifest?: AddressableManifest;
  /** Export name of the entry scene (scenes-dir-relative, sans extension), so
   *  switchTo back to it works exactly as in a shipped build. Absent = '__play'. */
  entrySceneName?: string;
  /** Every other project scene, registered lazily by project-relative path —
   *  the same switchTo targets a shipped build exposes (play == ship). */
  extraScenes?: Array<{ name: string; path: string }>;
  /** Project-declared physics enable (features.physics) — forwarded to the realm. */
  physicsEnabled?: boolean;
  /** Project physics world config (gravity, solver, collision matrix) — forwarded. */
  physicsConfig?: PhysicsPluginConfig;
  /** Project mixer state (bus volumes / effects / duck rules) — forwarded. */
  audioConfig?: AudioProjectConfig;
  /** Project widget theme; absent = dark (the default). */
  uiTheme?: 'light';
  /** Project theme token overrides (partial re-skin over the base) — forwarded. */
  uiThemeOverrides?: ThemeOverrides;
  /** Bitmask of render layers (0..31) that y-sort within the layer — forwarded. */
  ySortLayers?: number;
  /** Project color space — 'linear' boots the realm on the linear-light pipeline. */
  colorSpace?: 'gamma' | 'linear';
  /** Project camera fit (design resolution + scale mode) — letterboxes the realm's
   *  main camera without a UI Canvas; absent = no fit (raw orthoSize). */
  screenFit?: { designWidth: number; designHeight: number; scaleMode: number; matchWidthOrHeight: number };
  /** Multiplayer preview role; absent = a plain single-player session. */
  net?: PlayNetConfig;
  /**
   * The project's own native modules (`.esengine/modules/<id>/`), staged into
   * the realm by `buildPlayRealm` and declared here so `acquire(id)` resolves —
   * the Play-side twin of what `game.config.json` carries in a shipped build.
   *
   * Without it a developer could only find out whether their module works by
   * packaging the game, which is the feedback delay the editor exists to remove.
   */
  sideModules?: Array<{ id: string; file: string; globalName?: string }>;
}

/** A live inspect snapshot: a shallow entity tree (Outliner) + the selected entity's
 *  full data (Details). The reply payload of a `query { kind: 'snapshot' }`.
 *  `tree` is null for a detail-only sample (`withTree: false`) — the editor polls
 *  the selected entity faster than the O(entities) tree. */
export interface PlaySnapshot {
  tree: SceneData | null;
  selected: SceneData['entities'][number] | null;
}

export type PlayQueryKind = 'snapshot' | 'subsystems' | 'stats';

/** The running game's frame telemetry — reply payload of `query { kind: 'stats' }`.
 *  Feeds the editor profiler's engine segment while playing (PerfMonitor). */
export interface PlayStatsReply {
  phases: Record<string, number>;
  systems: Record<string, number>;
  drawCalls: number;
  triangles: number;
  sprites: number;
  entities: number;
  gpuMs: number;
  cppScopes: Record<string, number>;
  cppCounters: Record<string, number>;
  gpuScopes: Record<string, number>;
  jsScopes: Record<string, number>;
  wasmBytes: number;
  vramBytes: number;
}

/** editor → realm. Discriminated by `type`. `init` may carry transferred
 *  MessagePorts in `netPorts` (server: one per client; client: exactly one). */
export type PlayOutbound =
  | ({ type: 'estella:play:init'; netPorts?: MessagePort[] } & PlayPayload)
  // Boot the realm's wasm + GL WITHOUT a scene (idle prewarm), so the first Play
  // is a warm scene load, not a cold engine bring-up. Replied with `warmed`.
  | { type: 'estella:play:warm' }
  | { type: 'estella:play:setPaused'; paused: boolean }
  | { type: 'estella:play:reload' }
  // `withTree: false` = detail-only snapshot (skip the O(entities) tree walk).
  | { type: 'estella:play:query'; kind: PlayQueryKind; reqId: number; selectedId?: number | null; withTree?: boolean }
  | { type: 'estella:play:setField'; entityId: number; comp: string; key: string; value: unknown };

/** realm → editor. Discriminated by `type`. */
export type PlayInbound =
  | { type: 'estella:play:hello'; protocolVersion: number }
  // The realm's engine is up (reply to `warm`) — the editor's first Play will be warm.
  | { type: 'estella:play:warmed' }
  // `phases` (optional) carries the realm's own boot sub-timing (bundle import,
  // wasm instantiate, scene+asset load) so the editor can fold it into the Play
  // profile — the realm runs in a separate JS realm and can't share the profiler.
  | { type: 'estella:play:ready'; phases?: Record<string, number> }
  | { type: 'estella:play:error'; message: string }
  | { type: 'estella:play:log'; level: PlayLogLevel; line: string }
  // How fast the realm is actually running. "Playing" and "running frames" are not the
  // same thing — an unfocused window has its realm's rAF throttled to about 1 Hz — and
  // a driver reading a frozen game needs to be able to tell those apart.
  | { type: 'estella:play:frames'; frameCount: number; fps: number }
  | { type: 'estella:play:reply'; reqId: number; data: unknown };
