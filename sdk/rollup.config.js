import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';
import dts from 'rollup-plugin-dts';

const tsPlugin = typescript({
    tsconfig: './tsconfig.json',
    declaration: false,
});

const treeshake = {
    moduleSideEffects: false,
};

const esmBuilds = [
    {
        input: 'src/index.ts',
        output: { file: 'dist/index.js', format: 'esm', sourcemap: true },
        plugins: [tsPlugin, terser()],
        treeshake,
    },
    {
        input: 'src/index.wechat.ts',
        output: { file: 'dist/index.wechat.js', format: 'esm', sourcemap: true },
        plugins: [typescript({ tsconfig: './tsconfig.json', declaration: false }), terser()],
        treeshake,
    },
    {
        input: 'src/index.wechat.ts',
        output: { file: 'dist/index.wechat.cjs.js', format: 'cjs', sourcemap: true },
        plugins: [typescript({ tsconfig: './tsconfig.json', declaration: false }), terser()],
        treeshake,
    },
    {
        input: 'src/wasm.ts',
        output: { file: 'dist/wasm.js', format: 'esm', sourcemap: true },
        plugins: [typescript({ tsconfig: './tsconfig.json', declaration: false }), terser()],
        treeshake,
    },
    {
        input: 'src/spine/index.ts',
        output: { file: 'dist/spine/index.js', format: 'esm', sourcemap: true },
        plugins: [typescript({ tsconfig: './tsconfig.json', declaration: false }), terser()],
        treeshake,
    },
    {
        input: 'src/physics/index.ts',
        output: { file: 'dist/physics/index.js', format: 'esm', sourcemap: true },
        plugins: [typescript({ tsconfig: './tsconfig.json', declaration: false }), terser()],
        treeshake,
    },
];

const dtsBuilds = [
    {
        input: 'src/index.ts',
        output: { file: 'dist/index.d.ts', format: 'esm' },
        plugins: [dts()],
    },
    {
        input: 'src/wasm.ts',
        output: { file: 'dist/wasm.d.ts', format: 'esm' },
        plugins: [dts()],
    },
    {
        input: 'src/spine/index.ts',
        output: { file: 'dist/spine/index.d.ts', format: 'esm' },
        plugins: [dts()],
    },
    {
        input: 'src/physics/index.ts',
        output: { file: 'dist/physics/index.d.ts', format: 'esm' },
        plugins: [dts()],
    },
];

export default [...esmBuilds, ...dtsBuilds];
