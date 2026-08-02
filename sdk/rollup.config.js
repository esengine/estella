// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
// Types only — the JS bundles are built by rolldown (see rolldown.config.js).
// The `.d.ts` rollup stays on tsc-backed rollup-plugin-dts: it costs ~10% of the
// build and switching generators would need `isolatedDeclarations` across the
// whole source tree, with nothing in CI comparing the emitted types.
import dts from 'rollup-plugin-dts';

export default [
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
