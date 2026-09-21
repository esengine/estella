// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { defineConfig } from 'rolldown';

// An entry's body runs; every other module is pure and its top-level statements
// may be dropped. So an entry's prologue is a CALL it makes, never a statement
// in a module it shares — see runtime/webEntry.ts.
const ENTRY_FILES = ['/index.ts', '/index.lean.ts', '/index.wechat.ts', '/index.wechat.lean.ts', '/index.minigame.ts', '/index.node.ts', '/index.native.ts'];
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

// One code-split graph feeds eleven entries, so `dist/shared/` is their union and
// a packager copying the directory hands a web player the mini-game runtime.
// Which chunk belongs to which entry is the bundler's to say, so it says it here.
function emitChunkManifest() {
    return {
        name: 'emit-chunk-manifest',
        generateBundle(_options, bundle) {
            const chunks = new Map(
                Object.values(bundle).filter((c) => c.type === 'chunk').map((c) => [c.fileName, c]),
            );
            const reach = (entry) => {
                const seen = new Set();
                const queue = [entry];
                while (queue.length > 0) {
                    const name = queue.pop();
                    if (seen.has(name) || !chunks.has(name)) continue;
                    seen.add(name);
                    queue.push(...chunks.get(name).imports, ...chunks.get(name).dynamicImports);
                }
                seen.delete(entry);
                return [...seen].sort();
            };
            const manifest = {};
            for (const [fileName, chunk] of chunks) if (chunk.isEntry) manifest[fileName] = reach(fileName);
            this.emitFile({ type: 'asset', fileName: 'chunks.json', source: `${JSON.stringify(manifest, null, 2)}\n` });
        },
    };
}

const minify = { compress: true, mangle: true, codegen: { removeWhitespace: true, legalComments: 'inline' } };

export default defineConfig([
    {
        // ONE code-split graph for every ESM entry a bundler can combine:
        // `esengine` (web, wechat or node) and the `esengine/*` subpaths must
        // resolve into the SAME shared chunks, or a bundle that imports both gets
        // two copies of the core — and identity-keyed resources (Res(Spine))
        // split-brain: the runtime inserts into one copy, systems read the other.
        // The dedicated-server example proved it: `esengine/node` built on its own
        // registered the replication plugin in a registry `esengine/replication`
        // could not see, and the authority came up with no Net resource.
        input: {
            'index': 'src/index.ts',
            'index.node': 'src/index.node.ts',
            'index.lean': 'src/index.lean.ts',
            'index.wechat': 'src/index.wechat.ts',
            'index.wechat.lean': 'src/index.wechat.lean.ts',
            'index.minigame': 'src/index.minigame.ts',
            'index.native': 'src/index.native.ts',
            'physics/index': 'src/physics/index.ts',
            'physics3d/index': 'src/physics3d/index.ts',
            'spine/index': 'src/spine/index.ts',
            'tilemap/index': 'src/tilemap/index.ts',
            'logic/index': 'src/logic/index.ts',
            'ai/index': 'src/ai/index.ts',
            'net/replication/index': 'src/net/replication/index.ts',
            'dragonbones/index': 'src/dragonbones/index.ts',
            'douyin/index': 'src/platform/douyin/index.ts',
            'wasm': 'src/wasm.ts',
        },
        // Only the node entry reaches these; a browser entry that did would fail
        // to bundle, which is the point.
        external: (id) => id.startsWith('node:'),
        output: {
            dir: 'dist',
            format: 'esm',
            sourcemap: true,
            chunkFileNames: 'shared/[name].js',
            minify,
        },
        plugins: [preserveViteIgnore(), emitChunkManifest()],
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
]);
