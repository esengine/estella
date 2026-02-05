import typescript from '@rollup/plugin-typescript';
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
        plugins: [tsPlugin],
        treeshake,
    },
    {
        input: 'src/index.wechat.ts',
        output: { file: 'dist/index.wechat.js', format: 'esm', sourcemap: true },
        plugins: [typescript({ tsconfig: './tsconfig.json', declaration: false })],
        treeshake,
    },
    {
        input: 'src/wasm.ts',
        output: { file: 'dist/wasm.js', format: 'esm', sourcemap: true },
        plugins: [typescript({ tsconfig: './tsconfig.json', declaration: false })],
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
];

export default [...esmBuilds, ...dtsBuilds];
