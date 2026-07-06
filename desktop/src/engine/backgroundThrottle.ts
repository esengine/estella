// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  backgroundThrottle.ts — editor-side "use less CPU in background".
 *
 * Chromium's own background throttling is disabled (main.ts) so automation
 * never freezes; this is the smart replacement: cap the engine loop at a low
 * frame rate while the window is unfocused (Unreal's "Use Less CPU when in
 * Background"), restore on focus. Driven by the `performance.*` setting.
 */
import { EngineHost } from './EngineHost';

const BACKGROUND_FPS = 10;

let enabled = true;
let focused = true;

function apply(): void {
  EngineHost.setTargetFrameRate(enabled && !focused ? BACKGROUND_FPS : 0);
}

/** Settings backing: toggle the background cap (applies immediately). */
export function setUseLessCpuInBackground(on: boolean): void {
  enabled = on;
  apply();
}

/** Attach the focus listeners once at boot. Automation windows are driven
 *  unfocused, so `?automation=1` opts out entirely. */
export function initBackgroundThrottle(): void {
  if (new URLSearchParams(location.search).has('automation')) return;
  focused = document.hasFocus();
  window.addEventListener('focus', () => { focused = true; apply(); });
  window.addEventListener('blur', () => { focused = false; apply(); });
  apply();
}
