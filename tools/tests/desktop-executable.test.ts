// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Which file inside an assembled app is the one you run.
 *
 *        Two gate runners answered this by searching for "a file with no
 *        extension". Every signed macOS bundle carries
 *        `Contents/_CodeSignature/CodeResources`, which fits that shape, and
 *        directory order decided which of the two a walk reached first — so they
 *        launched the signature manifest and reported that the engine had
 *        installed no module, dispatched to nothing and never drawn a frame.
 *
 *        The signed bundle is therefore the case that matters here: a fixture
 *        with only the executable in it would pass against the old answer too.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
// @ts-expect-error — a build-tools .js helper the CLI runs unbuilt
import { desktopExecutableIn } from '../../build-tools/utils/desktopApp.js';

let root = '';

function file(...parts: string[]): string {
    const full = path.join(root, ...parts);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, '');
    return full;
}

beforeAll(() => { root = mkdtempSync(path.join(tmpdir(), 'estella-exe-')); });
afterAll(() => { rmSync(root, { recursive: true, force: true }); });

describe('desktopExecutableIn', () => {
    it('picks the bundle executable over a signed bundle\'s CodeResources', () => {
        const exe = file('mac', 'Game.app', 'Contents', 'MacOS', 'Game');
        file('mac', 'Game.app', 'Contents', '_CodeSignature', 'CodeResources');
        file('mac', 'Game.app', 'Contents', 'Info.plist');
        expect(desktopExecutableIn(path.join(root, 'mac'), 'macos')).toBe(exe);
    });

    it('finds an app nested under the export directory', () => {
        const exe = file('nested', 'out', 'deep', 'Game.app', 'Contents', 'MacOS', 'Game');
        expect(desktopExecutableIn(path.join(root, 'nested'), 'macos')).toBe(exe);
    });

    // The content directory is the GAME's files, and it is full of names with no
    // extension once assets are cooked. It is not somewhere to look for a binary.
    it('does not mistake cooked content for the executable', () => {
        const exe = file('content', 'Game.app', 'Contents', 'MacOS', 'Game');
        file('content', 'Game.app', 'Contents', 'Resources', 'Content', 'a1b2c3d4');
        file('content', 'Game.app', 'Contents', 'Resources', 'Content', 'e5f6a7b8');
        expect(desktopExecutableIn(path.join(root, 'content'), 'macos')).toBe(exe);
    });

    it('reads the windows and linux layouts by their own rule', () => {
        const win = file('win', 'Game', 'Game.exe');
        file('win', 'Game', 'Content', 'a1b2c3d4');
        expect(desktopExecutableIn(path.join(root, 'win'), 'windows')).toBe(win);

        const lin = file('lin', 'Game', 'Game');
        file('lin', 'Game', 'Content', 'a1b2c3d4');
        expect(desktopExecutableIn(path.join(root, 'lin'), 'linux')).toBe(lin);
    });

    // Null is a runner saying "the export assembled no app", which is a different
    // sentence from "the app it assembled does not work".
    it('answers null when no app was assembled', () => {
        file('empty', 'notes.txt');
        expect(desktopExecutableIn(path.join(root, 'empty'), 'macos')).toBeNull();
    });
});
