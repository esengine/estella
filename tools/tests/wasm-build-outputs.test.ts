// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import config from '../../build-tools/build.config.js';
import { buildWasm } from '../../build-tools/tasks/wasm.js';
import { syncToDesktop } from '../../build-tools/tasks/sync.js';

vi.mock('../../build-tools/tasks/shader-embeds.js', () => ({ generateShaderEmbeds: vi.fn() }));
vi.mock('../../build-tools/utils/emscripten.js', () => ({
    getCpuCount: () => 1,
    runCommand: async (cmd: string, args: string[]) => {
        if (cmd === 'wasm-opt') {
            const input = await readFile(args[args.length - 1]);
            await writeFile(args[args.indexOf('-o') + 1], Buffer.concat([input, Buffer.from([0, 1, 0])]));
        }
    },
}));

it('restores the cached solver pair and syncs only the selected output files', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'estella-build-cache-'));
    const saved = { ...config.paths };
    const output = path.join(root, 'build');
    const target = 'physics3d-wechat';
    const linked = path.join(root, config.wasm[target].buildDir, 'sdk');
    const artifacts = {
        'physics3d.js': Buffer.from('module.exports = () => {};'),
        'physics3d.wasm': Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]),
    };
    try {
        Object.assign(config.paths, { root, output, cache: path.join(output, '.cache') });
        await mkdir(path.join(root, 'src/esengine'), { recursive: true });
        await mkdir(path.join(root, 'cmake'));
        await writeFile(path.join(root, 'CMakeLists.txt'), '');
        await mkdir(linked, { recursive: true });
        for (const [file, bytes] of Object.entries(artifacts)) await writeFile(path.join(linked, file), bytes);
        await buildWasm(target);
        expect((await buildWasm(target)).skipped).toBe(true);

        for (const [file, bytes] of Object.entries(artifacts)) {
            const staged = path.join(output, 'wasm/wechat', file);
            const published = await readFile(staged);
            await rm(staged);
            await buildWasm(target);
            expect(await readFile(staged)).toEqual(published);
            expect(await readFile(path.join(linked, file))).toEqual(bytes);
        }
        const editor = path.join(root, 'desktop/public/wasm-wechat');
        await mkdir(editor, { recursive: true });
        await writeFile(path.join(output, 'wasm/wechat/esengine.wxgame.wasm'), 'another build');
        await writeFile(path.join(editor, 'esengine.wxgame.wasm'), 'installed core');
        const { synced } = await syncToDesktop({ sdk: false, wasmOutputs: Object.values(config.wasm[target].outputs) });
        expect(synced).toBe(2);
        expect(await readFile(path.join(editor, 'esengine.wxgame.wasm'), 'utf8')).toBe('installed core');
        for (const file of Object.keys(artifacts)) {
            expect(await readFile(path.join(editor, file))).toEqual(await readFile(path.join(output, 'wasm/wechat', file)));
        }
    } finally {
        Object.assign(config.paths, saved);
        await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
});
