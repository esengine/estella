// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    PanelWindow.tsx
 * @brief   The Window a subtree's DOM currently lives in — the one seam that makes
 *          every floating primitive (context menus, popovers, tooltips, palettes)
 *          correct once a dock panel is popped out into its own OS window.
 *
 *          A popped-out panel keeps rendering in the MAIN window's JS realm (dockview
 *          only re-parents its DOM into the child window), so `document`/`window`
 *          globals still point at the main window. A menu that portals into
 *          `document.body` and clamps against `window.innerWidth` would therefore land
 *          in the wrong window at the wrong spot. Each dock panel provides its live
 *          window here (tracked across pop-out / dock-back via onDidLocationChange);
 *          floating UI reads it with `usePanelWindow()` and portals into — and measures
 *          against — that window instead. Anything outside a panel (main-window chrome)
 *          gets the default: the main window.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { DockviewPanelApi } from 'dockview';

// The main editor window — resolved defensively so importing this module in a
// non-DOM context (unit tests run under node) doesn't touch an undefined `window`
// at load time. In the browser/Electron renderer this is always the real window.
const mainWindow: Window = (typeof window !== 'undefined' ? window : globalThis) as Window;

const PanelWindowContext = createContext<Window>(mainWindow);

/** The Window the calling subtree's DOM lives in (main window unless popped out). */
export function usePanelWindow(): Window {
  return useContext(PanelWindowContext);
}

const resolveWindow = (api: DockviewPanelApi): Window => {
  const loc = api.location;
  return loc.type === 'popout' ? loc.getWindow() : mainWindow;
};

/** Wrap a dock panel's content so its descendants resolve the right window. */
export function PanelWindowProvider({ api, children }: { api: DockviewPanelApi; children: ReactNode }) {
  const [win, setWin] = useState<Window>(() => resolveWindow(api));
  useEffect(() => {
    setWin(resolveWindow(api));
    const d = api.onDidLocationChange(() => setWin(resolveWindow(api)));
    return () => d.dispose();
  }, [api]);
  return <PanelWindowContext.Provider value={win}>{children}</PanelWindowContext.Provider>;
}
