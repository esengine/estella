// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Web hosts import an ES module. Mini-game hosts require the same solver by
// its CommonJS factory, with the platform's WebAssembly prelude.
/**
 * The two mini-game builds of every side module, beside the engine they load with:
 * `wechat` with wasm SIMD, and `quickgame` without it for the hosts that refuse a
 * SIMD opcode (vivo's quick-game V8, Douyin on iOS). Same sources, same file
 * names, one directory each, so an export reads its whole runtime from one place.
 */
const MINIGAME_FLAVORS = [
    { name: 'wechat', flags: [] },
    { name: 'quickgame', flags: ['-DES_MAIN_DISABLE_SIMD=ON'] },
];

function physicsModules(file, feature, target) {
    const builds = {};
    for (const platform of ['web', ...MINIGAME_FLAVORS.map((f) => f.name)]) {
        const web = platform === 'web';
        const name = web ? file : `${file}-${platform}`;
        const flavor = MINIGAME_FLAVORS.find((f) => f.name === platform);
        builds[name] = {
            buildDir: `build/cmake/${name}`,
            cmakeFlags: [
                web ? '-DES_BUILD_WEB=ON' : '-DES_BUILD_WXGAME=ON',
                '-DES_BUILD_TESTS=OFF', `-DES_ENABLE_${feature}=ON`,
                `-DES_PHYSICS_ESM=${web ? 'ON' : 'OFF'}`,
                ...(flavor ? flavor.flags : []),
            ],
            targets: [web ? `${target}_esm` : target],
            outputs: {
                [`sdk/${file}.js`]: `wasm/${platform}/${file}.js`,
                [`sdk/${file}.wasm`]: `wasm/${platform}/${file}.wasm`,
            },
        };
    }
    return builds;
}

/** The require()-based side modules a mini-game package loads, in each mini-game flavor (see MINIGAME_FLAVORS). */
function miniGameSideModules() {
    const spineOutputs = (dir) => Object.fromEntries(['42', '43', '41', '38', '21'].flatMap((v) => [
        [`sdk/spine${v}.js`, `wasm/${dir}/spine${v}.js`], [`sdk/spine${v}.wasm`, `wasm/${dir}/spine${v}.wasm`],
    ]));
    const one = (file, dir) => ({ [`sdk/${file}.js`]: `wasm/${dir}/${file}.js`, [`sdk/${file}.wasm`]: `wasm/${dir}/${file}.wasm` });
    const builds = {};
    for (const { name, flags } of MINIGAME_FLAVORS) {
        const base = ['-DES_BUILD_WXGAME=ON', '-DES_BUILD_TESTS=OFF', ...flags];
        builds[`basis-${name}`] = {
            buildDir: `build/cmake/basis-${name}`,
            cmakeFlags: [...base, '-DES_ENABLE_BASIS=ON'],
            targets: ['basis_module'],
            outputs: one('basis', name),
        };
        builds[`videodec-${name}`] = {
            buildDir: `build/cmake/videodec-${name}`,
            cmakeFlags: base,
            targets: ['video_module'],
            outputs: one('videodec', name),
        };
        builds[`spine-${name}`] = {
            buildDir: `build/cmake/spine-${name}`,
            cmakeFlags: base,
            targets: ['spine_module', 'spine_module_43', 'spine_module_41', 'spine_module_38', 'spine_module_21'],
            outputs: spineOutputs(name),
        };
        builds[`dragonbones-${name}`] = {
            buildDir: `build/cmake/dragonbones-${name}`,
            cmakeFlags: [...base, '-DES_ENABLE_DRAGONBONES=ON'],
            targets: ['dragonbones_module'],
            outputs: one('dragonbones', name),
        };
    }
    return builds;
}

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
        'web-threaded': { cmakeOpt: '-O2', wasmOpt: '-O2' },
        'web-js': { cmakeOpt: '-O2', wasmOpt: '-O2' },
        wechat: { cmakeOpt: '-O2', wasmOpt: '-O2' },
        'wechat-glx': { cmakeOpt: '-O2', wasmOpt: '-O2' },
        'wechat-lite': { cmakeOpt: '-O2', wasmOpt: '-O2' },
        quickgame: { cmakeOpt: '-O2', wasmOpt: '-O2' },
    },

    wasm: {
        web: {
            buildDir: 'build/cmake/web',
            // WebGPU backend ships in the web SDK only — WeChat/playable have no
            // WebGPU and skip the emdawnwebgpu glue. Variants sharing build/cmake/web
            // (spine*) must carry identical flags or configures would thrash.
            cmakeFlags: ['-DES_BUILD_WEB=ON', '-DES_BUILD_TESTS=OFF', '-DES_ENABLE_WEBGPU=ON'],
            targets: ['esengine_sdk'],
            outputs: {
                'sdk/esengine.js': 'wasm/web/esengine.js',
                'sdk/esengine.wasm': 'wasm/web/esengine.wasm',
            },
        },
        'web-threaded': {
            buildDir: 'build/cmake/web-threaded',
            cmakeFlags: ['-DES_BUILD_WEB=ON', '-DES_BUILD_TESTS=OFF', '-DES_WEB_RENDER_THREAD=ON', '-DES_ENABLE_WEBGPU=ON'],
            targets: ['esengine_sdk'],
            outputs: {
                'sdk/esengine-threaded.js': 'wasm/web/esengine-threaded.js',
                'sdk/esengine-threaded.wasm': 'wasm/web/esengine-threaded.wasm',
            },
        },
        // The same engine as plain JavaScript (wasm2js), for a host with no
        // WebAssembly: an exported web page loads it only when `WebAssembly` is
        // absent (gameHost). No SIMD, no BigInt, no WebGPU — a host without wasm
        // has none of the three.
        'web-js': {
            buildDir: 'build/cmake/web-js',
            cmakeFlags: ['-DES_BUILD_WEB=ON', '-DES_BUILD_TESTS=OFF', '-DES_WASM2JS=ON',
                '-DES_MAIN_DISABLE_SIMD=ON'],
            targets: ['esengine_sdk'],
            // Beside the wasm engine, so the editor's copy and every web export
            // carry both and the page picks at boot.
            outputs: {
                'sdk/esengine.js': 'wasm/web/esengine.asm.js',
            },
        },
        wechat: {
            buildDir: 'build/cmake/wxgame',
            cmakeFlags: ['-DES_BUILD_WXGAME=ON', '-DES_BUILD_TESTS=OFF'],
            targets: ['esengine_wxgame'],
            outputs: {
                'sdk/esengine.wxgame.js': 'wasm/wechat/esengine.wxgame.js',
                'sdk/esengine.wxgame.wasm': 'wasm/wechat/esengine.wxgame.wasm',
            },
        },
        // The WeChat engine without the particle, post-process and tilemap subsystems, for a package whose content uses none
        // of them: the same binary otherwise, ~200 KB smaller against a 4 MB main package. The export picks it from the same
        // evidence it picks the engine's lean entry by (pipeline/src/export/liteEngine.ts).
        'wechat-lite': {
            buildDir: 'build/cmake/wxgame-lite',
            cmakeFlags: ['-DES_BUILD_WXGAME=ON', '-DES_BUILD_TESTS=OFF', '-DES_ENABLE_PARTICLES=OFF',
                '-DES_ENABLE_POSTPROCESS=OFF', '-DES_ENABLE_TILEMAP=OFF'],
            targets: ['esengine_wxgame'],
            outputs: {
                'sdk/esengine.wxgame.js': 'wasm/wechat-lite/esengine.wxgame.js',
                'sdk/esengine.wxgame.wasm': 'wasm/wechat-lite/esengine.wxgame.wasm',
            },
        },
        // The WeChat engine with EmscriptenGLX linked in, for a project that turns it
        // on: WeChat publishes the library for emsdk 4.0.10, so this one target
        // builds with that emsdk (build-tools/toolchain/glx.js).
        'wechat-glx': {
            buildDir: 'build/cmake/wxgame-glx',
            cmakeFlags: ['-DES_BUILD_WXGAME=ON', '-DES_BUILD_TESTS=OFF'],
            targets: ['esengine_wxgame'],
            emsdk: '4.0.10',
            glx: true,
            outputs: {
                'sdk/esengine.wxgame.js': 'wasm/wechat-glx/esengine.wxgame.js',
                'sdk/esengine.wxgame.wasm': 'wasm/wechat-glx/esengine.wxgame.wasm',
            },
        },
        // The mini-game engine without wasm SIMD, for the hosts that refuse a SIMD opcode:
        // vivo's quick-game V8 (8.3) ("Invalid opcode (enable with --experimental-wasm-simd)")
        // and Douyin on iOS (「iOS 平台目前不支持 SIMD 等 WebAssembly 提案特性」). Its side
        // modules are built the same way, into the same directory (MINIGAME_FLAVORS).
        // What vivo also refuses, an i64 in a wasm↔JS signature, no mini-game build carries.
        quickgame: {
            buildDir: 'build/cmake/qgame',
            cmakeFlags: ['-DES_BUILD_WXGAME=ON', '-DES_BUILD_TESTS=OFF', '-DES_MAIN_DISABLE_SIMD=ON'],
            targets: ['esengine_wxgame'],
            outputs: {
                'sdk/esengine.wxgame.js': 'wasm/quickgame/esengine.wxgame.js',
                'sdk/esengine.wxgame.wasm': 'wasm/quickgame/esengine.wxgame.wasm',
            },
        },
        ...physicsModules('physics', 'BOX2D', 'physics_module'),
        ...physicsModules('physics3d', 'JOLT', 'physics3d_module'),
        ...physicsModules('physics3d-physx', 'PHYSX', 'physics3d_physx_module'),
        basis: {
            buildDir: 'build/cmake/basis',
            cmakeFlags: ['-DES_BUILD_WEB=ON', '-DES_BUILD_TESTS=OFF', '-DES_ENABLE_BASIS=ON'],
            targets: ['basis_module'],
            outputs: {
                'sdk/basis.js': 'wasm/web/basis.js',
                'sdk/basis.wasm': 'wasm/web/basis.wasm',
            },
        },
        spine: {
            buildDir: 'build/cmake/web',
            cmakeFlags: ['-DES_BUILD_WEB=ON', '-DES_BUILD_TESTS=OFF', '-DES_ENABLE_WEBGPU=ON'],
            targets: ['spine_module'],
            outputs: {
                'sdk/spine42.js': 'wasm/web/spine42.js',
                'sdk/spine42.wasm': 'wasm/web/spine42.wasm',
            },
        },
        videodec: {
            buildDir: 'build/cmake/web',
            cmakeFlags: ['-DES_BUILD_WEB=ON', '-DES_BUILD_TESTS=OFF', '-DES_ENABLE_WEBGPU=ON'],
            targets: ['video_module'],
            outputs: {
                'sdk/videodec.js': 'wasm/web/videodec.js',
                'sdk/videodec.wasm': 'wasm/web/videodec.wasm',
            },
        },
        spine38: {
            buildDir: 'build/cmake/web',
            cmakeFlags: ['-DES_BUILD_WEB=ON', '-DES_BUILD_TESTS=OFF', '-DES_ENABLE_WEBGPU=ON'],
            targets: ['spine_module_38'],
            outputs: {
                'sdk/spine38.js': 'wasm/web/spine38.js',
                'sdk/spine38.wasm': 'wasm/web/spine38.wasm',
            },
        },
        spine41: {
            buildDir: 'build/cmake/web',
            cmakeFlags: ['-DES_BUILD_WEB=ON', '-DES_BUILD_TESTS=OFF', '-DES_ENABLE_WEBGPU=ON'],
            targets: ['spine_module_41'],
            outputs: {
                'sdk/spine41.js': 'wasm/web/spine41.js',
                'sdk/spine41.wasm': 'wasm/web/spine41.wasm',
            },
        },
        dragonbones: {
            buildDir: 'build/cmake/web',
            cmakeFlags: ['-DES_BUILD_WEB=ON', '-DES_BUILD_TESTS=OFF', '-DES_ENABLE_WEBGPU=ON', '-DES_ENABLE_DRAGONBONES=ON'],
            targets: ['dragonbones_module'],
            outputs: {
                'sdk/dragonbones.js': 'wasm/web/dragonbones.js',
                'sdk/dragonbones.wasm': 'wasm/web/dragonbones.wasm',
            },
        },
        spine21: {
            buildDir: 'build/cmake/web',
            cmakeFlags: ['-DES_BUILD_WEB=ON', '-DES_BUILD_TESTS=OFF', '-DES_ENABLE_WEBGPU=ON'],
            targets: ['spine_module_21'],
            outputs: {
                'sdk/spine21.js': 'wasm/web/spine21.js',
                'sdk/spine21.wasm': 'wasm/web/spine21.wasm',
            },
        },
        spine43: {
            buildDir: 'build/cmake/web',
            cmakeFlags: ['-DES_BUILD_WEB=ON', '-DES_BUILD_TESTS=OFF', '-DES_ENABLE_WEBGPU=ON'],
            targets: ['spine_module_43'],
            outputs: {
                'sdk/spine43.js': 'wasm/web/spine43.js',
                'sdk/spine43.wasm': 'wasm/web/spine43.wasm',
            },
        },
        // WeChat-targeted side modules: the SAME standalone modules built under
        // ES_BUILD_WXGAME, which forces ENVIRONMENT=web + the wxgame-pre.js shim so
        // they evaluate inside the MiniGame runtime. Web-aligned filenames in a
        // separate wechat dir (synced to desktop/public/wasm-wechat) → exportWeChat
        // require()s `./wasm/physics.js` / `./wasm/spine42.js` exactly as the host expects.
        ...miniGameSideModules(),
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
        entityHeader: 'src/esengine/core/Types.hpp',
        constRoots: ['src/esengine'],
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
            'build/wasm/wechat-glx': 'desktop/public/wasm-wechat-glx',
            'build/wasm/wechat-lite': 'desktop/public/wasm-wechat-lite',
            'build/wasm/quickgame': 'desktop/public/wasm-quickgame',
        },
        sdk: {
            'build/sdk/esm': 'desktop/public/sdk/esm',
            'build/sdk/cjs': 'desktop/public/sdk/cjs',
        },
    },
};
