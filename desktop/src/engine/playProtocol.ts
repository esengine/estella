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
import type { SceneData, PhysicsPluginConfig } from 'esengine';

/**
 * Editor↔realm message-contract version. The realm reports it in `hello`; the editor
 * compares it against its own and refuses a mismatch (P1) rather than failing
 * obscurely on a shape it doesn't understand. Bump on any incompatible message change.
 */
export const PLAY_PROTOCOL_VERSION = 1;

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

/** The scene + project config handed to a fresh realm on boot. */
export interface PlayPayload {
  sceneData: SceneData;
  assetManifest: Record<string, string>;
  /** Project-declared physics enable (features.physics) — forwarded to the realm. */
  physicsEnabled?: boolean;
  /** Project physics world config (gravity, solver, collision matrix) — forwarded. */
  physicsConfig?: PhysicsPluginConfig;
}

/** A live inspect snapshot: a shallow entity tree (Outliner) + the selected entity's
 *  full data (Details). The reply payload of a `query { kind: 'snapshot' }`. */
export interface PlaySnapshot {
  tree: SceneData;
  selected: SceneData['entities'][number] | null;
}

export type PlayQueryKind = 'snapshot' | 'subsystems' | 'stats';

/** editor → realm. Discriminated by `type`. */
export type PlayOutbound =
  | ({ type: 'estella:play:init' } & PlayPayload)
  | { type: 'estella:play:setPaused'; paused: boolean }
  | { type: 'estella:play:reload' }
  | { type: 'estella:play:query'; kind: PlayQueryKind; reqId: number; selectedId?: number | null }
  | { type: 'estella:play:setField'; entityId: number; comp: string; key: string; value: unknown };

/** realm → editor. Discriminated by `type`. */
export type PlayInbound =
  | { type: 'estella:play:hello'; protocolVersion: number }
  | { type: 'estella:play:ready' }
  | { type: 'estella:play:error'; message: string }
  | { type: 'estella:play:log'; level: PlayLogLevel; line: string }
  | { type: 'estella:play:reply'; reqId: number; data: unknown };
