import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';
import dts from 'rollup-plugin-dts';

const ENTRY_FILES = ['/index.ts', '/index.wechat.ts'];
const treeshake = {
    moduleSideEffects: (id) => ENTRY_FILES.some(e => id.endsWith(e)),
};

const esmBuilds = [
    {
        input: {
            'index': 'src/index.ts',
            'physics/index': 'src/physics/index.ts',
            'spine/index': 'src/spine/index.ts',
            'wasm': 'src/wasm.ts',
        },
        output: {
            dir: 'dist',
            format: 'esm',
            sourcemap: true,
            chunkFileNames: 'shared/[name].js',
        },
        plugins: [
            typescript({ tsconfig: './tsconfig.json', declaration: false }),
            terser(),
        ],
        treeshake,
    },
    {
        input: 'src/index.ts',
        output: { file: 'dist/index.bundled.js', format: 'esm', sourcemap: true },
        plugins: [typescript({ tsconfig: './tsconfig.json', declaration: false }), terser()],
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
];

const dtsBuilds = [
    {
        input: {
            'index': 'src/index.ts',
            'physics/index': 'src/physics/index.ts',
            'spine/index': 'src/spine/index.ts',
            'wasm': 'src/wasm.ts',
        },
        output: {
            dir: 'dist',
            format: 'esm',
            chunkFileNames: 'shared/[name].d.ts',
        },
        plugins: [dts()],
    },
];

export default [...esmBuilds, ...dtsBuilds];
