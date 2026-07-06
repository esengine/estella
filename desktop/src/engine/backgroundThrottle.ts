// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  backgroundThrottle.ts — cap the engine loop while the window is
 *        unfocused (Chromium's own throttling is disabled for automation).
 */
import { EngineHost } from './EngineHost';

const BACKGROUND_FPS = 10;

let enabled = true;
let focused = true;

function apply(): void {
  EngineHost.setTargetFrameRate(enabled && !focused ? BACKGROUND_FPS : 0);
}

export function setUseLessCpuInBackground(on: boolean): void {
  enabled = on;
  apply();
}

export function initBackgroundThrottle(): void {
  // Automation windows are driven unfocused; never throttle them.
  if (new URLSearchParams(location.search).has('automation')) return;
  focused = document.hasFocus();
  window.addEventListener('focus', () => { focused = true; apply(); });
  window.addEventListener('blur', () => { focused = false; apply(); });
  apply();
}
