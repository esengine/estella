import typescript from '@rollup/plugin-typescript';
import dts from 'rollup-plugin-dts';

// =============================================================================
// Module Entries
// =============================================================================

const modules = {
    'index': 'src/index.ts',           // Web entry
    'index.wechat': 'src/index.wechat.ts', // WeChat entry
    'wasm': 'src/wasm.ts',
};

// =============================================================================
// Local Dist Builds (ESM)
// =============================================================================

const esmBuilds = Object.entries(modules).map(([name, input]) => ({
    input,
    output: {
        file: `dist/${name}.js`,
        format: 'esm',
        sourcemap: true,
    },
    plugins: [
        typescript({
            tsconfig: './tsconfig.json',
            declaration: false,
        }),
    ],
    treeshake: {
        moduleSideEffects: false,
    },
}));

// =============================================================================
// Type Declarations
// =============================================================================

// Only generate .d.ts for main entries (Web and WeChat share the same types)
const dtsBuilds = [
    {
        input: 'src/index.ts',
        output: {
            file: 'dist/index.d.ts',
            format: 'esm',
        },
        plugins: [dts()],
    },
    {
        input: 'src/wasm.ts',
        output: {
            file: 'dist/wasm.d.ts',
            format: 'esm',
        },
        plugins: [dts()],
    },
];

// =============================================================================
// Desktop Public Builds
// =============================================================================

// ESM build for editor preview (Web)
const esmPublicBuild = {
    input: 'src/index.ts',
    output: {
        file: '../desktop/public/sdk/esm/esengine.js',
        format: 'esm',
        sourcemap: false,
    },
    plugins: [
        typescript({
            tsconfig: './tsconfig.json',
            declaration: false,
        }),
    ],
    treeshake: {
        moduleSideEffects: false,
    },
};

// CJS build for WeChat Mini Game (includes WeChat adapter)
const cjsWechatBuild = {
    input: 'src/index.wechat.ts',
    output: {
        file: '../desktop/public/sdk/cjs/esengine.wechat.js',
        format: 'cjs',
        sourcemap: false,
        exports: 'named',
    },
    plugins: [
        typescript({
            tsconfig: './tsconfig.json',
            declaration: false,
        }),
    ],
    treeshake: {
        moduleSideEffects: false,
    },
};

// CJS build for Web (no WeChat code)
const cjsWebBuild = {
    input: 'src/index.ts',
    output: {
        file: '../desktop/public/sdk/cjs/esengine.js',
        format: 'cjs',
        sourcemap: false,
        exports: 'named',
    },
    plugins: [
        typescript({
            tsconfig: './tsconfig.json',
            declaration: false,
        }),
    ],
    treeshake: {
        moduleSideEffects: false,
    },
};

// IIFE build for playable ads (Web, no WeChat code)
const iifePublicBuild = {
    input: 'src/index.ts',
    output: {
        file: '../desktop/public/sdk/iife/esengine.js',
        format: 'iife',
        name: 'ES',
        sourcemap: false,
    },
    plugins: [
        typescript({
            tsconfig: './tsconfig.json',
            declaration: false,
        }),
    ],
    treeshake: {
        moduleSideEffects: false,
    },
};

export default [
    ...esmBuilds,
    ...dtsBuilds,
    esmPublicBuild,
    cjsWebBuild,
    cjsWechatBuild,
    iifePublicBuild,
];
