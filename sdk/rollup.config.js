// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';
import dts from 'rollup-plugin-dts';

const ENTRY_FILES = ['/index.ts', '/index.wechat.ts', '/index.minigame.ts', '/index.node.ts', '/index.native.ts'];
const treeshake = {
    moduleSideEffects: (id) => ENTRY_FILES.some(e => id.endsWith(e)),
};

const esmBuilds = [
    {
        // ONE code-split graph for every ESM entry a bundler can combine:
        // `esengine` (web or wechat) and the `esengine/*` subpaths must resolve
        // into the SAME shared chunks, or a game bundle that imports both gets
        // two copies of the core — and identity-keyed resources (Res(Spine))
        // split-brain: the runtime inserts into one copy, systems read the other.
        input: {
            'index': 'src/index.ts',
            'index.wechat': 'src/index.wechat.ts',
            'index.minigame': 'src/index.minigame.ts',
            'index.native': 'src/index.native.ts',
            'physics/index': 'src/physics/index.ts',
            'spine/index': 'src/spine/index.ts',
            'dragonbones/index': 'src/dragonbones/index.ts',
            'wasm': 'src/wasm.ts',
        },
        output: {
            dir: 'dist',
            format: 'esm',
            sourcemap: true,
            chunkFileNames: 'shared/[name].js',
        },
        plugins: [
            typescript({ tsconfig: './tsconfig.json', declaration: false }),
            terser({ format: { comments: (_, comment) => comment.value.includes('@vite-ignore') } }),
        ],
        treeshake,
    },
    {
        input: 'src/index.ts',
        output: { file: 'dist/index.bundled.js', format: 'esm', sourcemap: true },
        plugins: [typescript({ tsconfig: './tsconfig.json', declaration: false }), terser({ format: { comments: (_, comment) => comment.value.includes('@vite-ignore') } })],
        treeshake,
    },
    {
        input: 'src/index.wechat.ts',
        output: { file: 'dist/index.wechat.cjs.js', format: 'cjs', sourcemap: true },
        plugins: [typescript({ tsconfig: './tsconfig.json', declaration: false }), terser({ format: { comments: (_, comment) => comment.value.includes('@vite-ignore') } })],
        treeshake,
    },
    {
        // Single-file IIFE for embedded JS engines (QuickJS on the native host):
        // no imports, no code-splitting — one script that installs `ESEngine` as a
        // global the game script uses (ESEngine.createNativeWorld(globalThis), …).
        // The native (embedded-Dawn) analog of index.wechat.cjs.js.
        input: 'src/index.native.ts',
        output: { file: 'dist/index.native.bundled.js', format: 'iife', name: 'ESEngine', sourcemap: false },
        plugins: [typescript({ tsconfig: './tsconfig.json', declaration: false }), terser({ format: { comments: (_, comment) => comment.value.includes('@vite-ignore') } })],
        treeshake,
    },
    {
        input: 'src/index.node.ts',
        output: { file: 'dist/index.node.js', format: 'esm', sourcemap: true },
        external: (id) => id.startsWith('node:'),
        plugins: [typescript({ tsconfig: './tsconfig.json', declaration: false }), terser({ format: { comments: (_, comment) => comment.value.includes('@vite-ignore') } })],
        treeshake,
    },
];

const dtsBuilds = [
    {
        input: {
            'index': 'src/index.ts',
            'index.node': 'src/index.node.ts',
            'index.wechat': 'src/index.wechat.ts',
            'index.minigame': 'src/index.minigame.ts',
            'index.native': 'src/index.native.ts',
            'physics/index': 'src/physics/index.ts',
            'spine/index': 'src/spine/index.ts',
            'dragonbones/index': 'src/dragonbones/index.ts',
            'wasm': 'src/wasm.ts',
        },
        output: {
            dir: 'dist',
            format: 'esm',
            chunkFileNames: 'shared/[name].d.ts',
        },
        plugins: [dts()],
    },
];

export default [...esmBuilds, ...dtsBuilds];
