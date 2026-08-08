// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    externalProgram.ts
 * @brief   Hand a file to a program the user chose — the script editor, the image
 *          editor, the browser. Two operations, both of which are only interesting
 *          because of how differently the three platforms spell them.
 *
 *          LAUNCHING. On macOS an application is a DIRECTORY (`Foo.app`), not an
 *          executable, so spawning it fails with EACCES; it has to go through
 *          `open -a`, which also reuses a running instance instead of starting a
 *          second copy. Elsewhere the path IS the executable and is spawned
 *          directly. Never through a shell: a file name containing a space, a
 *          quote or an `&` is ordinary on every platform and would be re-parsed
 *          into different arguments — or into a different command.
 *
 *          The child is detached and its streams released, so the editor is not
 *          the parent of a long-lived Photoshop, and quitting the editor does not
 *          take the user's editor down with it.
 */
import { spawn } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import type { BrowserWindow } from 'electron';
import { showOpenDialog } from './shotDialogs';
import { argsFor } from './editorCatalog';

/** Why a launch did not happen, or `null` when it did. */
export type LaunchError = 'missing' | 'failed';

/**
 * Open `filePath` with `program`. Resolves to null on success, or a reason the
 * caller can turn into a message — a program the user configured months ago and
 * has since uninstalled is the common case, and it deserves better than a stack
 * trace in the console.
 *
 * `projectRoot` is passed ahead of the file to editors that understand a project
 * (see editorCatalog.ts) — the difference between a `.ts` with completion and a
 * `.ts` with red squiggles under correct code.
 */
export async function launchProgram(
  program: string,
  filePath: string,
  projectRoot: string,
): Promise<LaunchError | null> {
  try {
    await access(program, constants.F_OK);
  } catch {
    return 'missing';
  }

  const argv = argsFor(program, projectRoot, filePath);
  const [cmd, args] =
    process.platform === 'darwin' && program.endsWith('.app')
      ? ['/usr/bin/open', ['-a', program, ...argv]]
      : [program, argv];

  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore', shell: false });
    child.on('error', (err) => console.error('[external] launch failed', program, err));
    child.unref();
    return null;
  } catch (err) {
    console.error('[external] launch failed', program, err);
    return 'failed';
  }
}

/**
 * Ask for a program. macOS shows `/Applications` and must be told to treat a
 * bundle as one selectable thing rather than a folder to descend into; Windows
 * filters to what it considers runnable. Linux has no convention worth encoding,
 * so it gets an unfiltered picker.
 */
export async function pickProgram(win: BrowserWindow, title: string): Promise<string | null> {
  const perPlatform: Partial<Electron.OpenDialogOptions> =
    process.platform === 'darwin'
      ? { defaultPath: '/Applications', properties: ['openFile', 'treatPackageAsDirectory'] }
      : process.platform === 'win32'
        ? { filters: [{ name: 'Programs', extensions: ['exe', 'bat', 'cmd'] }, { name: 'All Files', extensions: ['*'] }] }
        : {};

  const res = await showOpenDialog(win, {
    title,
    properties: ['openFile'],
    ...perPlatform,
  });
  return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0];
}

/** Ask for a directory on this machine — an SDK, a toolchain root, a checkout. */
export async function pickDirectory(win: BrowserWindow, title: string): Promise<string | null> {
  const res = await showOpenDialog(win, { title, properties: ['openDirectory'] });
  return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0];
}
