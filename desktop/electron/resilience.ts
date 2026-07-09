// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    resilience.ts
 * @brief   Crash and error capture for the editor. Local-first: native crash
 *          minidumps and a main-process error log land under userData — no
 *          telemetry, nothing leaves the machine. The editor holds unsaved
 *          user scenes, so a main-process exception must never take the app
 *          down silently: log it, tell the user once, keep running so they
 *          can save.
 */
import { app, crashReporter, dialog, shell, BrowserWindow } from 'electron';
import { appendFileSync, mkdirSync, statSync, renameSync, existsSync } from 'node:fs';
import path from 'node:path';

const LOG_ROTATE_BYTES = 512 * 1024;

export function logsDir(): string {
  return path.join(app.getPath('userData'), 'logs');
}

function errorLogPath(): string {
  return path.join(logsDir(), 'main-errors.log');
}

/** Append one structured entry; rotate to `.old` past the cap so the log can't grow unbounded. */
function logError(kind: string, detail: unknown): void {
  try {
    mkdirSync(logsDir(), { recursive: true });
    const file = errorLogPath();
    if (existsSync(file) && statSync(file).size > LOG_ROTATE_BYTES) {
      renameSync(file, file + '.old');
    }
    const text = detail instanceof Error ? (detail.stack ?? detail.message) : JSON.stringify(detail);
    appendFileSync(file, `[${new Date().toISOString()}] ${kind}: ${text}\n`);
  } catch {
    // Logging must never become a second crash.
  }
  console.error(`[resilience] ${kind}:`, detail);
}

let shownExceptionDialog = false;

/**
 * Install crash capture. Call once, before `app.whenReady()` resolves, so the
 * crash reporter covers every renderer from the start.
 */
export function installCrashCapture(): void {
  // Native crash minidumps (main + renderers + GPU) → userData/Crashpad, local only.
  crashReporter.start({ uploadToServer: false, compress: true });

  process.on('uncaughtException', (err) => {
    logError('uncaughtException', err);
    // One dialog per session: inform, don't storm. Later exceptions still log.
    if (shownExceptionDialog) return;
    shownExceptionDialog = true;
    const win = BrowserWindow.getAllWindows()[0];
    const opts = {
      type: 'error' as const,
      buttons: ['Continue', 'Open Log Folder'],
      defaultId: 0,
      message: 'An unexpected error occurred in the editor.',
      detail:
        'The editor is still running — save your work. Details were written to the log folder.\n\n' +
        String(err?.message ?? err),
    };
    const choice = win ? dialog.showMessageBoxSync(win, opts) : dialog.showMessageBoxSync(opts);
    if (choice === 1) void shell.openPath(logsDir());
  });

  process.on('unhandledRejection', (reason) => {
    logError('unhandledRejection', reason);
  });

  // A dead renderer is a dead editor window — offer to reload it in place.
  app.on('render-process-gone', (_e, contents, details) => {
    logError('render-process-gone', details);
    if (details.reason === 'clean-exit' || details.reason === 'killed') return;
    const win = BrowserWindow.fromWebContents(contents);
    if (!win) return;
    const choice = dialog.showMessageBoxSync(win, {
      type: 'error',
      buttons: ['Reload Editor', 'Close'],
      defaultId: 0,
      message: 'The editor window crashed.',
      detail: `Reason: ${details.reason} (exit code ${details.exitCode}). A crash dump was saved locally.`,
    });
    if (choice === 0) contents.reload();
    else win.destroy();
  });

  // GPU / utility process losses are recoverable noise worth a trace, not a dialog.
  app.on('child-process-gone', (_e, details) => {
    if (details.reason !== 'clean-exit') logError('child-process-gone', details);
  });
}
