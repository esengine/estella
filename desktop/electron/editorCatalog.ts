// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    editorCatalog.ts
 * @brief   The programs the editor knows how to hand a file to, and where they
 *          usually live. Two things come out of this: a list to offer instead of a
 *          blank field, and — the part that actually matters — the ARGUMENTS each
 *          one wants.
 *
 *          A code editor opened on a lone file has no project. For this engine
 *          that is not a nicety: the SDK's types are staged into the project's
 *          `.esengine/sdk` and resolved through its tsconfig, so a `.ts` opened by
 *          itself gets no completion, no `esengine` types, and red squiggles under
 *          correct code. Every known editor is therefore handed the PROJECT ROOT
 *          and then the file.
 *
 *          A program is identified by what it IS — its executable's name — not by
 *          which row of the settings UI selected it. So a VS Code the user browsed
 *          to by hand, in a directory nobody would guess, still opens the project.
 */
import { access, constants } from 'node:fs/promises';
import path from 'node:path';
import { homedir } from 'node:os';

export interface KnownEditor {
  id: string;
  label: string;
  /** Lower-case executable / bundle names that identify it, however it was found. */
  matches: readonly string[];
  /** Where it installs, per platform. `~` is expanded. */
  candidates: Partial<Record<string, readonly string[]>>;
}

/**
 * Ordered by what a 2D TypeScript game project is most likely to want, because the
 * first one detected is what "auto" resolves to.
 */
export const KNOWN_EDITORS: readonly KnownEditor[] = [
  {
    id: 'vscode',
    label: 'Visual Studio Code',
    matches: ['code', 'code.exe', 'code - insiders', 'visual studio code.app'],
    candidates: {
      darwin: ['/Applications/Visual Studio Code.app', '~/Applications/Visual Studio Code.app'],
      win32: [
        '~/AppData/Local/Programs/Microsoft VS Code/Code.exe',
        'C:/Program Files/Microsoft VS Code/Code.exe',
        'C:/Program Files (x86)/Microsoft VS Code/Code.exe',
      ],
      linux: ['/usr/share/code/code', '/usr/bin/code', '/snap/bin/code'],
    },
  },
  {
    id: 'cursor',
    label: 'Cursor',
    matches: ['cursor', 'cursor.exe', 'cursor.app'],
    candidates: {
      darwin: ['/Applications/Cursor.app', '~/Applications/Cursor.app'],
      win32: ['~/AppData/Local/Programs/cursor/Cursor.exe'],
      linux: ['/usr/bin/cursor'],
    },
  },
  {
    id: 'webstorm',
    label: 'WebStorm',
    matches: ['webstorm', 'webstorm.exe', 'webstorm.app'],
    candidates: {
      darwin: ['/Applications/WebStorm.app', '~/Applications/WebStorm.app'],
      win32: ['C:/Program Files/JetBrains/WebStorm/bin/webstorm64.exe'],
      linux: ['/usr/bin/webstorm', '/snap/bin/webstorm'],
    },
  },
  {
    id: 'sublime',
    label: 'Sublime Text',
    matches: ['sublime text.app', 'sublime_text', 'sublime_text.exe', 'subl'],
    candidates: {
      darwin: ['/Applications/Sublime Text.app'],
      win32: ['C:/Program Files/Sublime Text/sublime_text.exe'],
      linux: ['/usr/bin/subl', '/opt/sublime_text/sublime_text'],
    },
  },
  {
    id: 'zed',
    label: 'Zed',
    matches: ['zed', 'zed.app', 'zed.exe'],
    candidates: {
      darwin: ['/Applications/Zed.app', '~/Applications/Zed.app'],
      win32: ['~/AppData/Local/Programs/Zed/Zed.exe'],
      linux: ['/usr/bin/zed', '~/.local/bin/zed'],
    },
  },
];

const expand = (p: string): string => (p.startsWith('~/') ? path.join(homedir(), p.slice(2)) : p);

/** The catalog entry a program path is, or null when it is something else. */
export function identify(program: string): KnownEditor | null {
  const name = path.basename(program).toLowerCase();
  return KNOWN_EDITORS.find((e) => e.matches.includes(name)) ?? null;
}

export interface DetectedEditor {
  id: string;
  label: string;
  path: string;
}

/** Every known editor actually installed, in catalog order. */
export async function detectEditors(platform: string = process.platform): Promise<DetectedEditor[]> {
  const found: DetectedEditor[] = [];
  for (const editor of KNOWN_EDITORS) {
    for (const candidate of editor.candidates[platform] ?? []) {
      const abs = expand(candidate);
      try {
        await access(abs, constants.F_OK);
        found.push({ id: editor.id, label: editor.label, path: abs });
        break; // first hit wins; a second install of the same editor is not a choice
      } catch {
        // Not here. Try the next location.
      }
    }
  }
  return found;
}

/**
 * What to pass a program after its own path.
 *
 * A known editor gets the project and then the file, which is what opens the file
 * IN its project rather than alone. Anything else gets only the file: an unknown
 * program handed a directory it did not ask for is at best confused, and a paint
 * program would open the project folder as an image.
 */
export function argsFor(program: string, projectRoot: string, file: string): string[] {
  return identify(program) ? [projectRoot, file] : [file];
}
