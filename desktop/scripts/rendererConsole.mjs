// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  rendererConsole.mjs
 * @brief One way for a headless harness to read the renderer's console.
 *
 * Electron's `console-message` used to hand the listener positional arguments
 * (`event, level, message, line, sourceId`) and now hands it a single event
 * OBJECT (`{ level, message, lineNumber, sourceId, frame }`, with named
 * severities). Subscribing the old way logs a deprecation warning on every run.
 *
 * Every harness here wants the same thing — the message text, and sometimes how
 * bad it was — so the shape lives in one place instead of each script mashing
 * `...args` back into a string and quietly picking up whichever form it got.
 */

/**
 * Subscribe to a renderer's console. `onMessage(text, level)` — level is one of
 * `info` / `warning` / `error` / `debug`. Returns an unsubscribe.
 */
export function onRendererConsole(webContents, onMessage) {
  const listener = ({ message, level }) => onMessage(message, level);
  webContents.on('console-message', listener);
  return () => webContents.removeListener('console-message', listener);
}
