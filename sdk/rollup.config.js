import typescript from '@rollup/plugin-typescript';
import dts from 'rollup-plugin-dts';

const modules = {
    'index': 'src/index.ts',
    'wasm': 'src/wasm.ts',
};

// Local dist builds (ESM)
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

// Type declarations
const dtsBuilds = Object.entries(modules).map(([name, input]) => ({
    input,
    output: {
        file: `dist/${name}.d.ts`,
        format: 'esm',
    },
    plugins: [dts()],
}));

// =============================================================================
// Desktop Public Builds (organized by format)
// =============================================================================

// ESM build for editor preview
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

// CJS build for WeChat Mini Game
const cjsPublicBuild = {
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

// IIFE build for playable ads
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
    cjsPublicBuild,
    iifePublicBuild,
];
