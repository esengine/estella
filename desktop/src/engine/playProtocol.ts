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
import type { SceneData, PhysicsPluginConfig, AudioProjectConfig, ThemeOverrides, AddressableManifest, FrameCosts } from 'esengine';

/**
 * Editor↔realm message-contract version. The realm reports it in `hello`; the editor
 * compares it against its own and refuses a mismatch (P1) rather than failing
 * obscurely on a shape it doesn't understand. Bump on any incompatible message change.
 */
export const PLAY_PROTOCOL_VERSION = 6;

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
  /** Bitmask of render layers (0..31) that resolve by real depth (2.5D) — forwarded. */
  depthLayers?: number;
  /** Project color space — 'linear' boots the realm on the linear-light pipeline. */
  colorSpace?: 'gamma' | 'linear';
  /** Project camera fit (design resolution + scale mode) — letterboxes the realm's
   *  main camera without a UI Canvas; absent = no fit (raw orthoSize). */
  screenFit?: { designWidth: number; designHeight: number; scaleMode: number; matchWidthOrHeight: number };
  /** The project's declared achievement ids — Play checks an unlock against the
   *  same set a shipped build does, so a typo is caught here rather than by a
   *  player whose achievement never fires. */
  achievements?: string[];
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
 *  the selected entity faster than the O(entities) tree.
 *
 *  Each tree entity carries {@link LiveVisibility} and {@link LiveOrigin} alongside
 *  the fields SceneData declares, so the running world's Outliner reads the same
 *  `hidden` bit an edited scene does and the shared tree builder needs no
 *  live-specific branch. */
export interface PlaySnapshot {
  tree: SceneData | null;
  selected: SceneData['entities'][number] | null;
  /** Where the selected entity sits on the realm's own canvas — null when
   *  nothing is selected, or it has no place on screen (a UI node, off camera). */
  overlay: PlayOverlayBox | null;
}

/**
 * A point on the realm's canvas, normalized 0..1 from the TOP-LEFT.
 *
 * Normalized because the two sides disagree about pixels — device ratio, a
 * letterboxed camera viewport, an iframe scaled to a device preset — and each
 * disagreement is a gizmo drawn off the thing it points at.
 */
export interface CanvasPoint {
  x: number;
  y: number;
}

/** An entity's drawn box, as the realm's own camera projects it. */
export interface PlayOverlayBox {
  /** The four corners, counter-clockwise from the box's local -x,-y. */
  corners: CanvasPoint[];
  /** The transform origin — where a move gizmo is anchored. Absent for a box a
   *  drag cannot move: a UI node is placed by layout, not by a position field. */
  origin?: CanvasPoint;
}

/** The visibility half of a live tree entity — what the Outliner's eye reads.
 *  `hideable` is a separate bit from `hidden` because they answer different
 *  questions: a bare transform is not hidden AND cannot be hidden (its children
 *  draw, it doesn't), and a row that cannot act shows no eye rather than a
 *  control that quietly does nothing. */
export interface LiveVisibility {
  hidden?: boolean;
  hideable?: boolean;
}

/**
 * The authoring identity of a live entity: the id it carries in the scene
 * DOCUMENT the editor has open. Absent means the running game spawned it, so
 * nothing in the editor's scene corresponds to it. A row keyed by `src` is the
 * same row before, during and after a play session.
 */
export interface LiveOrigin {
  src?: number;
}

export type PlayQueryKind = 'snapshot' | 'subsystems' | 'stats' | 'step' | 'pick';

/** What `query { kind: 'pick' }` answers with: the topmost entity at that canvas
 *  point, or null. Asked of the realm rather than computed in the editor because
 *  the side holding the camera and the renderer is the side that knows. */
export interface PlayPickReply {
  entityId: number | null;
}

/** What `query { kind: 'step' }` answers with: the clock AFTER the advance, so a
 *  caller can tell frames that ran from a request that reached no app. */
export interface PlayStepReply {
  frames: number;
  dt: number;
  frameCount: number;
  elapsed: number;
}

/** The running game's frame telemetry — reply payload of `query { kind: 'stats' }`.
 *  Feeds the editor profiler's engine segment while playing (PerfMonitor). */
export interface PlayStatsReply {
  phases: Record<string, number>;
  /** Per-system and per-scope cost with the domain/system attribution the
   *  profile tree is folded from. Null while the realm has stats off. */
  costs: FrameCosts | null;
  drawCalls: number;
  triangles: number;
  sprites: number;
  entities: number;
  gpuMs: number;
  cppScopes: Record<string, number>;
  cppCounters: Record<string, number>;
  gpuScopes: Record<string, number>;
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
  // How fast the realm's clock advances; 1 is normal. Distinct from paused:
  // a scale of 0 still runs the loop, and `step` still moves it by frames.
  | { type: 'estella:play:setTimeScale'; scale: number }
  | { type: 'estella:play:reload' }
  // `withTree: false` = detail-only snapshot (skip the O(entities) tree walk).
  | {
    type: 'estella:play:query'; kind: PlayQueryKind; reqId: number;
    selectedId?: number | null; withTree?: boolean;
    // `step` only: how far to advance, and with what fixed delta.
    frames?: number; dt?: number;
    // `pick` only: the canvas point to ask about.
    x?: number; y?: number;
  }
  | { type: 'estella:play:setField'; entityId: number; comp: string; key: string; value: unknown }
  // Show/hide a live entity (the Outliner's eye). An operation rather than a
  // field write: WHICH components carry visibility is the engine's knowledge, and
  // the realm answers it with the SDK's own setEntityVisible so the editor never
  // has to keep a second list of what counts as a renderer.
  | { type: 'estella:play:setVisible'; entityId: number; visible: boolean }
  /**
   * Put an entity's origin at a canvas point, optionally locked to a world axis.
   *
   * A drag is a screen-space gesture, so it is sent as one; the conversion to a
   * world position, and to the parent-local write a Transform holds, happens
   * where the camera is. The axis lock resolves after it, in world space.
   */
  | { type: 'estella:play:dragTo'; entityId: number; x: number; y: number; axis?: 'x' | 'y' }
  /**
   * Turn or resize a running entity by a RELATIVE amount.
   *
   * Neither needs the camera the way a move does: an angle about the origin and
   * a ratio of two distances mean the same under any pan, zoom or roll. The
   * editor computes them; the realm composes them onto the transform.
   */
  | { type: 'estella:play:transformBy'; entityId: number; rotateBy?: number; scaleBy?: { x: number; y: number } };

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
