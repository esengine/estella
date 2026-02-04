import typescript from '@rollup/plugin-typescript';
import dts from 'rollup-plugin-dts';

const modules = {
    'index': 'src/index.ts',
    'wasm': 'src/wasm.ts',
};

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

const dtsBuilds = Object.entries(modules).map(([name, input]) => ({
    input,
    output: {
        file: `dist/${name}.d.ts`,
        format: 'esm',
    },
    plugins: [dts()],
}));

// IIFE build for playable ads (no ES6 modules, single global)
const iifeBuild = {
    input: 'src/index.ts',
    output: {
        file: 'dist/esengine.iife.js',
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

// Preview bundle for editor preview server
const previewBuild = {
    input: 'src/index.ts',
    output: {
        file: '../desktop/public/esengine-sdk.js',
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

export default [...esmBuilds, ...dtsBuilds, iifeBuild, previewBuild];
