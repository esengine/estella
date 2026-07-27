// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// A `.ts` opened on its own has no tsconfig, so the SDK types staged into the
// project resolve to nothing and correct code gets red squiggles. The fix is one
// argument — the project, ahead of the file — and these pin down who gets it.
import { describe, it, expect } from 'vitest';
import { identify, argsFor, detectEditors, KNOWN_EDITORS } from '../electron/editorCatalog';

const ROOT = '/proj';
const FILE = '/proj/src/main.ts';

describe('identify', () => {
  it('recognises an editor by its executable, wherever it was installed', () => {
    // The point of matching on the name: a VS Code the user browsed to by hand,
    // in a directory nobody would guess, is still VS Code.
    expect(identify('/Applications/Visual Studio Code.app')?.id).toBe('vscode');
    expect(identify('C:/Program Files/Microsoft VS Code/Code.exe')?.id).toBe('vscode');
    expect(identify('/opt/weird/place/code')?.id).toBe('vscode');
    expect(identify('/Applications/Cursor.app')?.id).toBe('cursor');
  });

  it('is case-insensitive, because two of the three platforms are', () => {
    expect(identify('/x/CODE.EXE')?.id).toBe('vscode');
    expect(identify('/Applications/Sublime Text.app')?.id).toBe('sublime');
  });

  it('does not recognise something it has never heard of', () => {
    expect(identify('/Applications/Aseprite.app')).toBeNull();
    expect(identify('/usr/bin/vim')).toBeNull();
  });
});

describe('argsFor', () => {
  it('hands a code editor the project, then the file', () => {
    expect(argsFor('/Applications/Visual Studio Code.app', ROOT, FILE)).toEqual([ROOT, FILE]);
  });

  it('hands everything else the file alone', () => {
    // A paint program given a directory it did not ask for would try to open the
    // project folder as an image — so an unknown program gets only what it can use.
    expect(argsFor('/Applications/Aseprite.app', ROOT, FILE)).toEqual([FILE]);
  });
});

describe('detectEditors', () => {
  it('finds nothing on a platform nothing is catalogued for', async () => {
    // Not an error: an unrecognised platform means "no suggestions", and the OS
    // default still opens the file.
    expect(await detectEditors('sunos')).toEqual([]);
  });

  it('offers each editor at most once', async () => {
    const found = await detectEditors();
    expect(new Set(found.map((f) => f.id)).size).toBe(found.length);
  });

  it('catalogues every editor for every platform it can be installed on', () => {
    for (const editor of KNOWN_EDITORS) {
      for (const platform of ['darwin', 'win32', 'linux']) {
        expect(editor.candidates[platform]?.length, `${editor.id} has no ${platform} location`).toBeGreaterThan(0);
      }
      // An entry nothing can match is a row that can never be selected.
      expect(editor.matches.length).toBeGreaterThan(0);
      expect(editor.matches.every((m) => m === m.toLowerCase())).toBe(true);
    }
  });
});
