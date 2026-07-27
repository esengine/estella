// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  panelActions.ts — a way for a command to ask the Plugins panel to open one
 *        of its dialogs.
 *
 * The dialogs are the panel's own UI state, and hoisting them into a store just so
 * a command could reach them would put editor-wide state behind two booleans that
 * only one component reads. This is the smaller shape: the command names an intent,
 * the panel performs it.
 *
 * A request made with nothing listening is HELD, not dropped. The commands open the
 * panel and then ask — but `openPanel` only schedules the dock change, so on the
 * first invocation the panel mounts a render later and a dropped request means the
 * command visibly does nothing. The held request is consumed by the next subscriber
 * and cleared, and it expires, so a panel mounted much later for its own reasons
 * never inherits a dialog nobody asked for.
 */
export type PluginPanelAction = 'new' | 'import';

/** How long a request waits for the panel to mount. Generous next to a React
 *  render, far short of "the user opened this panel themselves later". */
const PENDING_TTL_MS = 5000;

const listeners = new Set<(action: PluginPanelAction) => void>();
let pending: { action: PluginPanelAction; at: number } | null = null;

export function subscribePluginPanelActions(fn: (action: PluginPanelAction) => void): () => void {
  listeners.add(fn);
  if (pending && Date.now() - pending.at < PENDING_TTL_MS) {
    const { action } = pending;
    pending = null;
    fn(action);
  } else {
    pending = null;
  }
  return () => listeners.delete(fn);
}

export function requestPluginPanelAction(action: PluginPanelAction): void {
  if (listeners.size === 0) {
    pending = { action, at: Date.now() };
    return;
  }
  for (const fn of listeners) fn(action);
}
