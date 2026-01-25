import typescript from '@rollup/plugin-typescript';

export default {
  input: 'index.ts',
  output: {
    file: 'index.js',
    format: 'esm',
    sourcemap: true,
  },
  plugins: [
    typescript({
      tsconfig: './tsconfig.json',
      declaration: false,
    }),
  ],
};
