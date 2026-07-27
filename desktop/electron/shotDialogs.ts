// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  shotDialogs.ts — the editor's ONE door to an OS file dialog.
 *
 * A native dialog is the one thing a screenshot run cannot get past: it is modal,
 * it is drawn by the OS, and the shot harness only evaluates JavaScript in the
 * renderer. Any flow that opens one was simply unreachable from automation — which
 * is why import/export flows went unverified while everything around them did not.
 *
 * So under `ESTELLA_SHOT` the answer comes from the script instead:
 *
 *   ESTELLA_SHOT_PICK_FILE   what the next open dialog returns
 *   ESTELLA_SHOT_SAVE_FILE   what the next save dialog returns
 *
 * Each is a path, or a JSON array of paths to hand back to successive dialogs (so
 * one shot can export and then import). An entry may itself be an array of paths,
 * for a multi-selection picker.
 *
 * THE IMPORTANT RULE IS THE EMPTY CASE. In shot mode with nothing scripted, this
 * returns "cancelled" and says so loudly — it does NOT fall through to a real
 * dialog. A headless run that opened one would block until the harness timed out,
 * and the failure would look like a hang rather than like the missing script it is.
 *
 * Outside shot mode this is a straight delegation with no behaviour of its own.
 */
import { dialog, type BrowserWindow, type OpenDialogOptions, type SaveDialogOptions } from 'electron';

const shotMode = (): boolean => !!process.env.ESTELLA_SHOT;

/**
 * Parse a scripted queue. A bare path is the one-entry case, which is what almost
 * every shot wants; JSON is there for the ones that drive more than one dialog.
 */
function parseQueue(raw: string | undefined): (string | string[])[] {
  if (!raw) return [];
  const text = raw.trim();
  if (text.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed as (string | string[])[];
    } catch {
      // Fall through: a path that merely starts with '[' is not our problem to
      // guess at, and treating it as one literal path is the harmless reading.
    }
  }
  return [text];
}

// Consumed per call, so a shot scripts dialogs in the order its flow opens them.
let openQueue: (string | string[])[] | null = null;
let saveQueue: (string | string[])[] | null = null;

const nextOpen = (): (string | string[]) | undefined => {
  openQueue ??= parseQueue(process.env.ESTELLA_SHOT_PICK_FILE);
  return openQueue.shift();
};

const nextSave = (): (string | string[]) | undefined => {
  saveQueue ??= parseQueue(process.env.ESTELLA_SHOT_SAVE_FILE);
  return saveQueue.shift();
};

/**
 * Show an open dialog, or hand back what the shot scripted.
 * `win` may be null — the caller has already decided a dialog is possible.
 */
export async function showOpenDialog(
  win: BrowserWindow,
  options: OpenDialogOptions,
): Promise<{ canceled: boolean; filePaths: string[] }> {
  if (shotMode()) {
    const scripted = nextOpen();
    if (scripted === undefined) {
      console.log(`[shotDialog] open "${options.title ?? ''}" — nothing scripted (set ESTELLA_SHOT_PICK_FILE); returning cancelled`);
      return { canceled: true, filePaths: [] };
    }
    const filePaths = Array.isArray(scripted) ? scripted : [scripted];
    console.log(`[shotDialog] open "${options.title ?? ''}" →`, filePaths.join(', '));
    return { canceled: false, filePaths };
  }
  return dialog.showOpenDialog(win, options);
}

/** Show a save dialog, or hand back what the shot scripted. */
export async function showSaveDialog(
  win: BrowserWindow,
  options: SaveDialogOptions,
): Promise<{ canceled: boolean; filePath?: string }> {
  if (shotMode()) {
    const scripted = nextSave();
    if (scripted === undefined) {
      console.log(`[shotDialog] save "${options.title ?? ''}" — nothing scripted (set ESTELLA_SHOT_SAVE_FILE); returning cancelled`);
      return { canceled: true };
    }
    const filePath = Array.isArray(scripted) ? scripted[0] : scripted;
    console.log(`[shotDialog] save "${options.title ?? ''}" →`, filePath);
    return { canceled: false, filePath };
  }
  return dialog.showSaveDialog(win, options);
}
