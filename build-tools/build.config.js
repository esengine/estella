// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default {
    paths: {
        root: path.resolve(__dirname, '..'),
        output: path.resolve(__dirname, '../build'),
        cache: path.resolve(__dirname, '../build/.cache'),
        desktop: path.resolve(__dirname, '../desktop/public'),
        sdk: path.resolve(__dirname, '../sdk'),
    },

    optimization: {
        web: { cmakeOpt: '-O2', wasmOpt: '-O2' },
        wechat: { cmakeOpt: '-O2', wasmOpt: '-O2' },
        playable: { cmakeOpt: '-Oz', wasmOpt: '-Oz' },
    },

    wasm: {
        web: {
            buildDir: 'build-web',
            cmakeFlags: ['-DES_BUILD_WEB=ON', '-DES_BUILD_TESTS=OFF'],
            targets: ['esengine_sdk'],
            outputs: {
                'sdk/esengine.js': 'wasm/web/esengine.js',
                'sdk/esengine.wasm': 'wasm/web/esengine.wasm',
            },
        },
        wechat: {
            buildDir: 'build-wxgame',
            cmakeFlags: ['-DES_BUILD_WXGAME=ON', '-DES_BUILD_TESTS=OFF'],
            targets: ['esengine_wxgame'],
            outputs: {
                'sdk/esengine.wxgame.js': 'wasm/wechat/esengine.wxgame.js',
                'sdk/esengine.wxgame.wasm': 'wasm/wechat/esengine.wxgame.wasm',
            },
        },
        playable: {
            buildDir: 'build-playable',
            cmakeFlags: ['-DES_BUILD_WEB=ON', '-DES_BUILD_TESTS=OFF', '-DES_BUILD_SINGLE_FILE=ON'],
            targets: ['esengine_single'],
            outputs: {
                'sdk/esengine.single.js': 'wasm/playable/esengine.single.js',
            },
        },
        physics: {
            buildDir: 'build-physics',
            cmakeFlags: ['-DES_BUILD_WEB=ON', '-DES_BUILD_TESTS=OFF', '-DES_ENABLE_BOX2D=ON'],
            // ESM variant (EXPORT_ES6=1, `export default`) — the ONE physics build
            // for every realm. The SideModuleHost loader resolves the factory the
            // same way everywhere (fetch / inlined base64 / WeChat require), so
            // there is no separate side-module or playable physics build.
            targets: ['physics_module_esm'],
            outputs: {
                'sdk/physics.js': 'wasm/web/physics.js',
                'sdk/physics.wasm': 'wasm/web/physics.wasm',
            },
        },
        basis: {
            buildDir: 'build-basis',
            cmakeFlags: ['-DES_BUILD_WEB=ON', '-DES_BUILD_TESTS=OFF', '-DES_ENABLE_BASIS=ON'],
            targets: ['basis_module'],
            outputs: {
                'sdk/basis.js': 'wasm/web/basis.js',
                'sdk/basis.wasm': 'wasm/web/basis.wasm',
            },
        },
        spine: {
            buildDir: 'build-web',
            cmakeFlags: ['-DES_BUILD_WEB=ON', '-DES_BUILD_TESTS=OFF'],
            targets: ['spine_module'],
            outputs: {
                'sdk/spine42.js': 'wasm/web/spine42.js',
                'sdk/spine42.wasm': 'wasm/web/spine42.wasm',
            },
        },
        spine38: {
            buildDir: 'build-web',
            cmakeFlags: ['-DES_BUILD_WEB=ON', '-DES_BUILD_TESTS=OFF'],
            targets: ['spine_module_38'],
            outputs: {
                'sdk/spine38.js': 'wasm/web/spine38.js',
                'sdk/spine38.wasm': 'wasm/web/spine38.wasm',
            },
        },
        spine41: {
            buildDir: 'build-web',
            cmakeFlags: ['-DES_BUILD_WEB=ON', '-DES_BUILD_TESTS=OFF'],
            targets: ['spine_module_41'],
            outputs: {
                'sdk/spine41.js': 'wasm/web/spine41.js',
                'sdk/spine41.wasm': 'wasm/web/spine41.wasm',
            },
        },
        // WeChat-targeted side modules: the SAME standalone modules built under
        // ES_BUILD_WXGAME, which forces ENVIRONMENT=web + the wxgame-pre.js shim so
        // they evaluate inside the MiniGame runtime. Web-aligned filenames in a
        // separate wechat dir (synced to desktop/public/wasm-wechat) → exportWeChat
        // require()s `./wasm/physics.js` / `./wasm/spine42.js` exactly as the host expects.
        'physics-wechat': {
            buildDir: 'build-physics-wechat',
            cmakeFlags: ['-DES_BUILD_WXGAME=ON', '-DES_BUILD_TESTS=OFF', '-DES_ENABLE_BOX2D=ON'],
            targets: ['physics_module'],
            outputs: {
                'sdk/physics.js': 'wasm/wechat/physics.js',
                'sdk/physics.wasm': 'wasm/wechat/physics.wasm',
            },
        },
        'spine-wechat': {
            buildDir: 'build-spine-wechat',
            cmakeFlags: ['-DES_BUILD_WXGAME=ON', '-DES_BUILD_TESTS=OFF'],
            targets: ['spine_module', 'spine_module_41', 'spine_module_38'],
            outputs: {
                'sdk/spine42.js': 'wasm/wechat/spine42.js',
                'sdk/spine42.wasm': 'wasm/wechat/spine42.wasm',
                'sdk/spine41.js': 'wasm/wechat/spine41.js',
                'sdk/spine41.wasm': 'wasm/wechat/spine41.wasm',
                'sdk/spine38.js': 'wasm/wechat/spine38.js',
                'sdk/spine38.wasm': 'wasm/wechat/spine38.wasm',
            },
        },
    },

    sdk: {
        esm: {
            input: 'src/index.ts',
            output: 'esm/index.js',
            format: 'esm',
        },
        cjs: {
            input: 'src/index.wechat.ts',
            output: 'cjs/index.wechat.js',
            format: 'cjs',
        },
    },

    eht: {
        inputDir: 'src/esengine/ecs/components',
        outputDir: 'src/esengine/bindings',
        tsOutputDir: 'sdk/src',
        script: 'tools/eht.py',
    },

    watch: {
        cpp: ['src/**/*.cpp', 'src/**/*.hpp'],
        ts: ['sdk/src/**/*.ts'],
        components: ['src/esengine/ecs/components/**/*.hpp'],
    },

    sync: {
        wasm: {
            'build/wasm/web': 'desktop/public/wasm',
            // WeChat artifacts go to their OWN dir (main.ts resolves wechatWasm from
            // wasm-wechat first) — web-aligned filenames (physics.js, spine42.js, …)
            // would otherwise overwrite the web modules in desktop/public/wasm.
            'build/wasm/wechat': 'desktop/public/wasm-wechat',
            'build/wasm/playable': 'desktop/public/wasm',
        },
        sdk: {
            'build/sdk/esm': 'desktop/public/sdk/esm',
            'build/sdk/cjs': 'desktop/public/sdk/cjs',
        },
    },
};
