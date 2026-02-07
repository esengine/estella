import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import alias from '@rollup/plugin-alias';
import dts from 'rollup-plugin-dts';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default [
    {
        input: 'src/index.ts',
        output: {
            file: 'dist/index.js',
            format: 'es',
            sourcemap: true,
        },
        external: ['esengine'],
        plugins: [
            alias({
                entries: [
                    {
                        find: 'lucide',
                        replacement: path.resolve(
                            __dirname,
                            'node_modules/lucide/dist/esm/lucide/src/lucide.js'
                        ),
                    },
                ],
            }),
            resolve(),
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
