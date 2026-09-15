// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The name a mini-game hands its host filesystem is the name it was given.
 *
 *        A build path is whatever the cook staged the file as, and the manifest
 *        has already said what that is by the time a read starts. So the adapter
 *        rewrites nothing: an extension it "corrects" on the way out is a name
 *        the package never wrote, and the device reports a missing asset.
 *
 *        The exporter side cannot see a rewrite here — it ships the right bytes
 *        under the right name either way — so this is the half that must hold it.
 */
import { describe, it, expect } from 'vitest';
import { MiniGamePlatformAdapter } from '../src/platform/minigame/adapter';
import type { MiniGameGlobal } from '../src/platform/minigame/api';

/** An adapter over a host whose filesystem records what it was asked for. */
function adapterAsking(asked: string[]): MiniGamePlatformAdapter {
    const fs = {
        readFileSync: (p: string, encoding?: string) => {
            asked.push(p);
            return encoding ? '{}' : new ArrayBuffer(0);
        },
        accessSync: (p: string) => { asked.push(p); },
    };
    const global = { getFileSystemManager: () => fs } as unknown as MiniGameGlobal;
    return new MiniGamePlatformAdapter({ id: 'wechat', hostLabel: 'WeChat', global });
}

// Every shape a staged path takes: the authored custom extensions, the scene the
// export restages as .json, the suffix it restages as .bin, and a plain texture.
const STAGED = [
    'assets/ui/Root.esprefab',
    'assets/ui/Root.esmaterial',
    'assets/i18n/zh.eslocale',
    'assets/tiles/town.estileset',
    'assets/hero.esanimator',
    'scenes/main.json',
    'assets/hero.ktx2.bin',
    'assets/hero.png',
];

describe('MiniGamePlatformAdapter — the path reaches the host verbatim', () => {
    it('reads text under the name it was given', async () => {
        const asked: string[] = [];
        const adapter = adapterAsking(asked);
        for (const p of STAGED) await adapter.readTextFile(p);
        expect(asked).toEqual(STAGED);
    });

    it('reads bytes under the name it was given', async () => {
        const asked: string[] = [];
        const adapter = adapterAsking(asked);
        for (const p of STAGED) await adapter.readFile(p);
        expect(asked).toEqual(STAGED);
    });

    it('asks whether THAT file exists', async () => {
        const asked: string[] = [];
        const adapter = adapterAsking(asked);
        for (const p of STAGED) await adapter.fileExists(p);
        expect(asked).toEqual(STAGED);
    });
});
