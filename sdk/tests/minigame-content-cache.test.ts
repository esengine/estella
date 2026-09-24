// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A mini-game keeps hot update's verified bytes under its user data
 *        directory, so an updated asset loads on the next launch without the CDN.
 */
import { describe, it, expect } from 'vitest';
import { MiniGamePlatformAdapter } from '../src/platform/minigame/adapter';
import { setPlatform, platformWriteCacheFile, platformReadCacheFile } from '../src/platform/base';
import { cacheEntryName } from '../src/platform/cacheEntryName';
import type { MiniGameGlobal, MiniGameProfile } from '../src/platform/minigame/api';

const URL = 'https://cdn.example/v2/assets/0123456789abcdef.png';

function host(opts: { dir?: string; refuses?: boolean } = {}) {
    const files = new Map<string, ArrayBuffer>();
    const fs = {
        readFile: (o: { filePath: string; success?: (r: { data: ArrayBuffer }) => void; fail?: (e: { errMsg: string }) => void }) => {
            const data = files.get(o.filePath);
            if (data) o.success?.({ data });
            else o.fail?.({ errMsg: 'readFile:fail no such file or directory' });
        },
        writeFile: (o: { filePath: string; data: ArrayBuffer; success?: () => void; fail?: (e: { errMsg: string }) => void }) => {
            if (opts.refuses) { o.fail?.({ errMsg: 'writeFile:fail the maximum size of the file storage limit is exceeded' }); return; }
            files.set(o.filePath, o.data);
            o.success?.();
        },
    };
    const profile: MiniGameProfile = {
        id: 'wechat',
        hostLabel: 'Test',
        global: {
            getSystemInfoSync: () => ({ pixelRatio: 1, screenWidth: 1, screenHeight: 1, platform: 'devtools', language: 'zh_CN' }),
            getFileSystemManager: () => fs,
            ...(opts.dir ? { env: { USER_DATA_PATH: opts.dir } } : {}),
        } as unknown as MiniGameGlobal,
    };
    setPlatform(new MiniGamePlatformAdapter(profile));
    return files;
}

describe('a mini-game content cache', () => {
    it('stores under the user data directory, named as on every platform, and reads it back', async () => {
        const files = host({ dir: 'wxfile://usr' });
        const bytes = new Uint8Array([1, 2, 3, 4]).buffer;
        expect(await platformWriteCacheFile(URL, bytes)).toBe('stored');
        expect([...files.keys()]).toEqual([`wxfile://usr/${cacheEntryName(URL)}`]);
        expect(new Uint8Array((await platformReadCacheFile(URL))!)).toEqual(new Uint8Array([1, 2, 3, 4]));
    });

    it('is a miss, not an error, for what was never stored', async () => {
        host({ dir: 'wxfile://usr' });
        expect(await platformReadCacheFile(URL)).toBeNull();
    });

    it('reports a write the host refused, so the update can say it is not cached', async () => {
        host({ dir: 'wxfile://usr', refuses: true });
        expect(await platformWriteCacheFile(URL, new ArrayBuffer(4))).toBe('failed');
    });

    it('reports a host with no user data directory as failed, not stored', async () => {
        host();
        expect(await platformWriteCacheFile(URL, new ArrayBuffer(4))).toBe('failed');
        expect(await platformReadCacheFile(URL)).toBeNull();
    });
});
