// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-lean-bundle.mjs — a blank mini-game package carries none of an optional subsystem it does not use.
 *
 * The lean WeChat entry is what a package that uses no terrain, no foliage, no generated world and no water is built from. It once carried 47KB of terrain and
 * 37KB of water anyway: `dist/shared/` is the union of every entry's code, so a chunk the lean entry takes one function from also holds every top-level
 * `defineComponent(...)` and `new SomePlugin()` of the modules grouped with it, and a bundler cannot drop a statement it cannot tell is pure. The chunks now keep
 * their `/* @__PURE__ *\/` annotations (see sdk/rolldown.config.js) and the modules mark the statements that only define something.
 *
 * This bundles the built lean entry the way the mini-game export does, reads the output's source map, and says how many bytes each optional directory left
 * behind. A directory over its ceiling is a subsystem riding along again: find the top-level statement a bundler had to keep (`node output/impure-scan.mjs` style:
 * a call or `new` with no `/* @__PURE__ *\/`) and mark it, or take the import that reaches it out of the base.
 *
 * Needs the SDK built (`sdk-build`).
 */
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

/** The most each directory may leave in a blank package, in bytes of the minified bundle. Water keeps what the post-process underwater state needs; timeline, its component definition. */
const CEILING = { terrain: 0, foliage: 0, worldgen: 0, water: 8192, timeline: 1024 };

const entry = path.join(ROOT, 'sdk/dist/index.wechat.lean.js');
if (!existsSync(entry)) {
  console.error('check-lean-bundle: sdk/dist is not built (run sdk-build first)');
  process.exit(1);
}
let SourceMapConsumer;
try {
  ({ SourceMapConsumer } = require('source-map-js'));
} catch {
  ({ SourceMapConsumer } = require(path.join(ROOT, 'node_modules/.pnpm/source-map-js@1.2.1/node_modules/source-map-js')));
}

const result = await build({
  stdin: { contents: "import { initWeChatRuntime } from 'esengine'; export { initWeChatRuntime };", resolveDir: ROOT, loader: 'js' },
  alias: { esengine: entry },
  bundle: true, minify: true, sourcemap: 'external', outfile: path.join(ROOT, 'output/lean-check.js'), write: false,
  target: 'es2017', format: 'cjs', platform: 'browser', logLevel: 'silent',
});
const code = result.outputFiles.find((f) => f.path.endsWith('.js')).text;
const map = JSON.parse(result.outputFiles.find((f) => f.path.endsWith('.map')).text);
const lines = code.split('\n');
const consumer = new SourceMapConsumer(map);
const bySource = new Map();
let prev = null;
const flush = (until) => {
  if (prev) bySource.set(prev.source, (bySource.get(prev.source) ?? 0) + Math.max(0, until - prev.col));
};
consumer.eachMapping((m) => {
  if (prev && prev.line === m.generatedLine) flush(m.generatedColumn);
  else if (prev) flush(lines[prev.line - 1].length);
  prev = { line: m.generatedLine, col: m.generatedColumn, source: m.source };
}, null, SourceMapConsumer.GENERATED_ORDER);
if (prev) flush(lines[prev.line - 1].length);

const BS = String.fromCharCode(92);
const byDir = new Map();
for (const [source, bytes] of bySource) {
  const m = /sdk\/src\/([^/]+)\//.exec(source.split(BS).join('/'));
  if (m) byDir.set(m[1], (byDir.get(m[1]) ?? 0) + bytes);
}

/** Files that belong to an optional module inside a directory the base also uses: the animator graph is esengine/skeletal-animation, the tweens and sprite clips beside it are not. */
const FILE_CEILING = { 'animation/Animator.ts': 0, 'animation/motion.ts': 0, 'animation/animatorIK.ts': 0, 'animation/animatorAvatar.ts': 0, 'animation/layerStack.ts': 0 };
const byFile = new Map();
for (const [source, bytes] of bySource) {
  const m = /sdk\/src\/(.+)$/.exec(source.split(BS).join('/'));
  if (m) byFile.set(m[1], (byFile.get(m[1]) ?? 0) + bytes);
}

let failed = false;
for (const [file, ceiling] of Object.entries(FILE_CEILING)) {
  const bytes = byFile.get(file) ?? 0;
  if (bytes > ceiling) {
    failed = true;
    console.error(`check-lean-bundle: ${file} left ${bytes} bytes in a blank package (ceiling ${ceiling}) — a subsystem is riding along again`);
  }
}
for (const [dir, ceiling] of Object.entries(CEILING)) {
  const bytes = byDir.get(dir) ?? 0;
  if (bytes > ceiling) {
    failed = true;
    console.error(`check-lean-bundle: ${dir}/ left ${bytes} bytes in a blank package (ceiling ${ceiling}) — a subsystem is riding along again`);
  }
}
if (failed) process.exit(1);
console.log(`check-lean-bundle: a blank package is ${code.length} bytes; `
  + Object.keys(CEILING).map((d) => `${d} ${byDir.get(d) ?? 0}/${CEILING[d]}`).join(', '));
