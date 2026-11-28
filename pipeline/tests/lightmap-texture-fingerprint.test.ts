// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { createReadStream } from 'node:fs';
import { mkdtemp, rename, rm, stat, unlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { bakeTextureFingerprint } from '../src/assets/lightmapMaterials';

vi.mock('node:fs', async importOriginal => {
    const fs = await importOriginal<typeof import('node:fs')>();
    return { ...fs, createReadStream: vi.fn(fs.createReadStream) };
});

it('shares a texture read across checks and revalidates same-timestamp writes, replacement and deletion', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'estella-lightmap-hash-'));
    try {
        const texture = path.join(dir, 'base.png');
        const replaced = path.join(dir, 'replace.png');
        const time = new Date('2020-01-01T00:00:00.000Z');
        const paint = async (file: string, value: number) => {
            await writeFile(file, Buffer.alloc(1024, value));
            await utimes(file, time, time);
        };
        const check = () => bakeTextureFingerprint('scene', {
            materialProject: { root: dir },
            surfaces: [{ label: 'Wall', meshFile: '', builtinRef: 'builtin:cube', transform: [], baseColorTexture: texture }],
        });

        await paint(texture, 1);
        const mtime = (await stat(texture, { bigint: true })).mtimeNs;
        const read = vi.mocked(createReadStream);
        read.mockClear();
        const [original, concurrent] = await Promise.all([check(), check()]);
        expect(concurrent).toBe(original);
        expect(await check()).toBe(original);
        expect(read).toHaveBeenCalledTimes(1);

        await paint(texture, 2);
        expect((await stat(texture, { bigint: true })).mtimeNs).toBe(mtime);
        const edited = await check();
        expect(edited).not.toBe(original);
        expect(read).toHaveBeenCalledTimes(2);

        await paint(replaced, 3);
        await rename(replaced, texture);
        const replacement = await check();
        expect(replacement).not.toBe(edited);
        expect(read).toHaveBeenCalledTimes(3);

        await unlink(texture);
        expect(await check()).not.toBe(replacement);
        expect(read).toHaveBeenCalledTimes(3);
        await paint(texture, 1);
        expect(await check()).toBe(original);
        expect(read).toHaveBeenCalledTimes(4);

        await paint(texture, 4);
        const fs = await vi.importActual<typeof import('node:fs')>('node:fs');
        read.mockImplementationOnce((file, options) => {
            const stream = fs.createReadStream(file, options);
            stream.once('data', () => fs.writeFileSync(texture, Buffer.alloc(1024, 1)));
            return stream;
        });
        expect(await check()).toBe(original);
        expect(read).toHaveBeenCalledTimes(6);
    } finally {
        if (path.dirname(dir) === tmpdir()) await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
});
