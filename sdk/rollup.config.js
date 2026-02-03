import typescript from '@rollup/plugin-typescript';
import dts from 'rollup-plugin-dts';

const modules = {
    'index': 'src/index.ts',
    'wasm': 'src/wasm.ts',
    // TODO: Fix imports in scene and assets modules
    // 'scene/index': 'src/scene/index.ts',
    // 'assets/index': 'src/assets/index.ts',
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

export default [...esmBuilds, ...dtsBuilds];
