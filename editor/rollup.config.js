import typescript from '@rollup/plugin-typescript';
import dts from 'rollup-plugin-dts';

export default [
    {
        input: 'src/index.ts',
        output: {
            file: 'dist/index.js',
            format: 'es',
        },
        external: ['esengine'],
        plugins: [
            typescript({
                tsconfig: './tsconfig.json',
                declaration: false,
            }),
        ],
    },
    {
        input: 'src/index.ts',
        output: {
            file: 'dist/index.d.ts',
            format: 'es',
        },
        external: ['esengine'],
        plugins: [dts()],
    },
];
