// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    automationGate.ts
 * @brief   When the editor's automation hook may exist — the one rule, in one
 *          place, testable on its own.
 *
 * The hook (`window.__estellaEditor`) is the UNCURATED door: project, asset,
 * play, document and command operations, next to the scene surface. Plugin code
 * shares that realm and is deliberately handed a curated subset instead
 * (src/plugins/types.ts), so publishing the hook unconditionally would quietly
 * widen what a plugin can reach. It is therefore published only while a driver
 * is actually authorized.
 *
 * Two authorizations, arriving differently: a launch flag (ESTELLA_SHOT /
 * --mcp), which is in the URL before the first paint and holds for the session,
 * and the editor setting, which can open the endpoint at any later moment — a
 * boot replay, or a click — and can close it again.
 *
 * Kept free of `window` on purpose. The renderer supplies publish/retract, so
 * the rule is exercised in the pure-node suite rather than only in an editor
 * nobody can boot from a test — which is exactly how a listening endpoint once
 * came up against a window that had never published the hook at all.
 */

/**
 * Publish the hook exactly while `authorized()` is true, re-checking whenever
 * `subscribe` fires. Transitions only: repeated notifications with an unchanged
 * answer do nothing, so a status bump does not rebuild the hook under a driver
 * that is mid-call.
 *
 * @returns an unsubscribe, for a realm that is torn down (a popped-out window).
 */
export function guardAutomationHook(
  authorized: () => boolean,
  subscribe: (fn: () => void) => () => void,
  publish: () => void,
  retract: () => void,
): () => void {
  let published = false;
  const sync = (): void => {
    const want = authorized();
    if (want === published) return;
    published = want;
    if (want) publish();
    else retract();
  };
  const stop = subscribe(sync);
  sync();
  return stop;
}
