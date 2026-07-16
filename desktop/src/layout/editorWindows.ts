// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    editorWindows.ts
 * @brief   The set of live editor windows — the main window plus every popped-out
 *          dock panel's OS window — and a way to run per-window setup for each
 *          current AND future one.
 *
 *          A popout shares the main window's JS realm, but it's still a distinct
 *          Window with its own event target: a keydown in a popped-out panel fires
 *          there, not on the main window. Window-global features (the editor keymap)
 *          register their setup with forEachEditorWindow so they attach to every
 *          window and keep working no matter which one has focus. DockLayout feeds
 *          popout openings/closings in as dockview creates/destroys them.
 */
import { mainWindow } from '@/components/PanelWindow';

/** Per-window setup: attach to `win`, optionally return a teardown run on removal. */
type PerWindow = (win: Window) => (() => void) | void;

const windows = new Set<Window>([mainWindow]);
const setups = new Set<PerWindow>();
// Teardown callbacks, per window, per setup — so removing a window (or a setup)
// runs exactly the cleanups it created.
const teardowns = new Map<Window, Map<PerWindow, () => void>>();

function runSetup(win: Window, setup: PerWindow): void {
  const teardown = setup(win);
  if (!teardown) return;
  let bySetup = teardowns.get(win);
  if (!bySetup) teardowns.set(win, (bySetup = new Map()));
  bySetup.set(setup, teardown);
}

function tearDown(win: Window, setup: PerWindow): void {
  const bySetup = teardowns.get(win);
  const t = bySetup?.get(setup);
  if (t) {
    t();
    bySetup!.delete(setup);
  }
}

/** Register a popout window; runs every registered setup for it. Idempotent. */
export function addEditorWindow(win: Window): void {
  if (windows.has(win)) return;
  windows.add(win);
  for (const setup of setups) runSetup(win, setup);
}

/** Unregister a window (its popout closed); runs every teardown it accrued. */
export function removeEditorWindow(win: Window): void {
  if (win === mainWindow || !windows.delete(win)) return;
  const bySetup = teardowns.get(win);
  if (bySetup) {
    for (const t of bySetup.values()) t();
    teardowns.delete(win);
  }
}

/**
 * Run `setup` for every current and future editor window; returns an unsubscribe
 * that tears the setup down in each window. The single seam a window-global
 * feature uses instead of `window.addEventListener`.
 */
export function forEachEditorWindow(setup: PerWindow): () => void {
  setups.add(setup);
  for (const win of windows) runSetup(win, setup);
  return () => {
    setups.delete(setup);
    for (const win of windows) tearDown(win, setup);
  };
}
