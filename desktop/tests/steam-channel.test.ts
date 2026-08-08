// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Steam as a channel on the desktop target: the depot scripts, and the two
 *        things about them that are dangerous rather than merely wrong.
 *
 * A script that parses is not a script that is safe. Uploading is not reversible
 * by uploading again, and a mapping that takes the whole content root would put
 * the loose cooked content in the depot beside the app that already contains it.
 * Both are pinned here; the format itself is cross-checked by
 * build-tools/tests/verify-vdf.py, which is a reader written from the format.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { emitSteamBuild, defaultDepotId } from '../../build-tools/utils/steamChannel.js';
import { writeVdf } from '../../build-tools/utils/vdf.js';

let out: string;

beforeEach(() => { out = mkdtempSync(path.join(tmpdir(), 'estella-steam-')); });
afterEach(() => { rmSync(out, { recursive: true, force: true }); });

const emit = () => emitSteamBuild({
    outDir: out, appId: 480, appName: 'Physics Spinner',
    depots: [{ os: 'macos', depotId: defaultDepotId(480, 0) }],
});

describe('the Steam channel', () => {
    it('never writes a script that can publish on its first run', async () => {
        await emit();
        const build = readFileSync(path.join(out, 'steam', 'app_build_480.vdf'), 'utf8');
        expect(build).toContain('"Preview"\t\t"1"');
        // Empty, not a branch name: uploading and going live are two decisions and
        // only one of them can be undone by uploading again.
        expect(build).toContain('"SetLive"\t\t""');
    });

    it('anchors a Windows depot at the app directory too, not at the export root', async () => {
        await emitSteamBuild({
            outDir: out, appId: 480, appName: 'Spinner',
            depots: [{ os: 'windows', depotId: 481 }],
        });
        const depot = readFileSync(path.join(out, 'steam', 'depot_481_windows.vdf'), 'utf8');
        expect(depot).toContain('"LocalPath"\t\t"Spinner/*"');
        expect(depot).not.toContain('"LocalPath"\t\t"*"');
    });

    it('maps only the app, so the loose content beside it is not uploaded', async () => {
        // The export dir holds the cooked content AND the app that contains it;
        // a depot that took both would ship every asset twice.
        writeFileSync(path.join(out, 'game.config.json'), '{}');
        await emit();
        const depot = readFileSync(path.join(out, 'steam', 'depot_481_macos.vdf'), 'utf8');
        expect(depot).toContain('"LocalPath"\t\t"Physics Spinner.app/*"');
        expect(depot).not.toContain('"LocalPath"\t\t"*"');
    });

    it('never writes steam_appid.txt — shipping one disables the Steam check', async () => {
        await emit();
        const listed = readFileSync(path.join(out, 'STEAM.md'), 'utf8');
        expect(existsSync(path.join(out, 'steam_appid.txt'))).toBe(false);
        expect(listed).toContain('steam_appid.txt');   // named as a thing NOT to ship
    });

    it('tells this build what the backend needs, not what a manual would', async () => {
        const { checklist } = await emit();
        const text = readFileSync(checklist, 'utf8');
        expect(text).toContain('`481`');                       // the depot id in use
        expect(text).toContain('`Physics Spinner.app`');        // the launch string
        // The save path the engine actually writes to, in the words Auto-Cloud uses.
        expect(text).toContain('`MacHome`');
        expect(text).toContain('Library/Application Support/Estella/Physics Spinner');
    });

    it('says the depot ids are a guess, because Valve assigns them', async () => {
        const { checklist } = await emit();
        expect(readFileSync(checklist, 'utf8')).toMatch(/guess|assigns/i);
    });

    it('honours depot ids the project was given', async () => {
        await emitSteamBuild({
            outDir: out, appId: 480, appName: 'G', depots: [{ os: 'macos', depotId: 90210 }],
        });
        expect(existsSync(path.join(out, 'steam', 'depot_90210_macos.vdf'))).toBe(true);
        expect(readFileSync(path.join(out, 'steam', 'app_build_480.vdf'), 'utf8'))
            .toContain('"90210"\t\t"depot_90210_macos.vdf"');
    });
});

describe('the KeyValues writer', () => {
    it('escapes what would otherwise change the path', () => {
        // A Windows content root is the reason this exists: raw, `C:\build` carries
        // a \b into whatever reads it.
        const text = writeVdf('R', { ContentRoot: 'C:\\build\\out', Desc: 'a "quoted" name' });
        expect(text).toContain('"C:\\\\build\\\\out"');
        expect(text).toContain('a \\"quoted\\" name');
    });

    it('nests objects and leaves everything else a leaf', () => {
        expect(writeVdf('R', { a: '1', b: { c: '2' } })).toBe(
            '"R"\n{\n\t"a"\t\t"1"\n\t"b"\n\t{\n\t\t"c"\t\t"2"\n\t}\n}\n',
        );
    });
});
