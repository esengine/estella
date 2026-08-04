// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { defineConfig } from 'rolldown';

const ENTRY_FILES = ['/index.ts', '/index.wechat.ts', '/index.minigame.ts', '/index.node.ts', '/index.native.ts'];
const treeshake = {
    moduleSideEffects: (id) => ENTRY_FILES.some(e => id.endsWith(e)),
};

// OXC's minifier drops annotation comments unconditionally — rolldown 1.2.1
// exposes no knob for it — which would strip the `@vite-ignore` markers that our
// runtime-computed dynamic imports need to stay opaque to a downstream bundler.
// Legal comments it does keep, so smuggle the marker through disguised as one and
// swap it back after minification. Both substitutions are length-preserving, which
// keeps every sourcemap in the chain valid without regenerating it.
const VITE_IGNORE_RE = /\/\*\s*@vite-ignore\s*\*\//g;
const SMUGGLED = '/*! @vite-ignore*/';
const RESTORED = '/*  @vite-ignore*/';

function preserveViteIgnore() {
    let smuggled = 0;
    let restored = 0;
    return {
        name: 'preserve-vite-ignore',
        renderChunk(code) {
            const marked = code.replace(VITE_IGNORE_RE, () => (smuggled++, SMUGGLED));
            return marked === code ? null : { code: marked, map: null };
        },
        generateBundle(_options, bundle) {
            for (const chunk of Object.values(bundle)) {
                if (chunk.type !== 'chunk' || !chunk.code.includes(SMUGGLED)) continue;
                chunk.code = chunk.code.replaceAll(SMUGGLED, () => (restored++, RESTORED));
            }
            // A silent drop here would only surface as a downstream bundler warning in
            // someone else's project, so fail the build instead.
            if (restored !== smuggled) {
                this.error(`preserve-vite-ignore: smuggled ${smuggled} marker(s) past the minifier but recovered ${restored} — the minifier is no longer preserving legal comments.`);
            }
        },
    };
}

const minify = { compress: true, mangle: true, codegen: { removeWhitespace: true, legalComments: 'inline' } };

export default defineConfig([
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
            minify,
        },
        plugins: [preserveViteIgnore()],
        treeshake,
    },
    {
        input: 'src/index.ts',
        output: { file: 'dist/index.bundled.js', format: 'esm', sourcemap: true, minify },
        plugins: [preserveViteIgnore()],
        treeshake,
    },
    {
        input: 'src/index.wechat.ts',
        output: { file: 'dist/index.wechat.cjs.js', format: 'cjs', sourcemap: true, minify },
        plugins: [preserveViteIgnore()],
        treeshake,
    },
    {
        // Single-file IIFE for embedded JS engines (QuickJS on the native host):
        // no imports, no code-splitting — one script that installs `ESEngine` as a
        // global the game script uses (ESEngine.createNativeWorld(globalThis), …).
        // The native (embedded-Dawn) analog of index.wechat.cjs.js.
        input: 'src/index.native.ts',
        output: { file: 'dist/index.native.bundled.js', format: 'iife', name: 'ESEngine', sourcemap: false, minify },
        plugins: [preserveViteIgnore()],
        treeshake,
    },
    {
        // The built-in leaderboard, for the open data context — a SECOND JS
        // runtime with no WebGL, no wasm and almost none of the host API. It
        // ships as its own single file because the exporter bundles it into the
        // game package separately, and because nothing here may reach the
        // engine: one file with no imports is the shape that cannot.
        input: 'src/opendata/index.ts',
        output: { file: 'dist/open-data.js', format: 'cjs', sourcemap: false, minify },
        plugins: [preserveViteIgnore()],
        treeshake,
    },
    {
        input: 'src/index.node.ts',
        output: { file: 'dist/index.node.js', format: 'esm', sourcemap: true, minify },
        external: (id) => id.startsWith('node:'),
        plugins: [preserveViteIgnore()],
        treeshake,
    },
]);
