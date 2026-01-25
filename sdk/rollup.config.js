import typescript from '@rollup/plugin-typescript';
import dts from 'rollup-plugin-dts';

const input = 'src/index.ts';

export default [
  // ESM build
  {
    input,
    output: {
      file: 'dist/esengine.esm.js',
      format: 'esm',
      sourcemap: true,
    },
    plugins: [
      typescript({
        tsconfig: './tsconfig.json',
        declaration: false,
      }),
    ],
  },
  // CommonJS build
  {
    input,
    output: {
      file: 'dist/esengine.cjs.js',
      format: 'cjs',
      sourcemap: true,
    },
    plugins: [
      typescript({
        tsconfig: './tsconfig.json',
        declaration: false,
      }),
    ],
  },
  // Type declarations
  {
    input,
    output: {
      file: 'dist/index.d.ts',
      format: 'esm',
    },
    plugins: [dts()],
  },
];
