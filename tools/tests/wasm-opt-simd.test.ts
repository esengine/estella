// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A build without wasm SIMD is optimized without it, so an opcode a library forced in anyway fails the build: the
 *        optimizer refuses a feature it was not given. The SIMD build keeps it.
 */
import { expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import config from '../../build-tools/build.config.js';
import { buildWasm } from '../../build-tools/tasks/wasm.js';

const calls: string[][] = [];
vi.mock('../../build-tools/tasks/shader-embeds.js', () => ({ generateShaderEmbeds: vi.fn() }));
vi.mock('../../build-tools/utils/emscripten.js', async () => {
    const { readFile, writeFile: write } = await import('node:fs/promises');
    return {
        getCpuCount: () => 1,
        runCommand: async (cmd: string, args: string[]) => {
            if (cmd !== 'wasm-opt') return;
            calls.push(args);
            await write(args[args.indexOf('-o') + 1], await readFile(args[args.length - 1]));
        },
    };
});

it.each([
    ['physics3d-quickgame', false],
    ['physics3d-wechat', true],
])('%s: wasm-opt is given SIMD = %s', async (target, simd) => {
    const root = await mkdtemp(path.join(tmpdir(), 'estella-wasm-opt-simd-'));
    const saved = { ...config.paths };
    const linked = path.join(root, config.wasm[target].buildDir, 'sdk');
    try {
        Object.assign(config.paths, { root, output: path.join(root, 'build'), cache: path.join(root, 'build/.cache') });
        await mkdir(path.join(root, 'src/esengine'), { recursive: true });
        await mkdir(path.join(root, 'cmake'));
        await writeFile(path.join(root, 'CMakeLists.txt'), '');
        await mkdir(linked, { recursive: true });
        await writeFile(path.join(linked, 'physics3d.js'), 'module.exports = () => {};');
        await writeFile(path.join(linked, 'physics3d.wasm'), Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]));
        calls.length = 0;
        await buildWasm(target, { noCache: true });
        expect(calls).toHaveLength(1);
        expect(calls[0].includes('--enable-simd')).toBe(simd);
    } finally {
        Object.assign(config.paths, saved);
        await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
});
