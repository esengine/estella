// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// Package a project without the editor. `--help` states the options.
import path from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { installedTemplateDir, iosTemplateSources } from '../../build-tools/utils/nativeTemplate.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PIPELINE = path.join(HERE, '..');
const REPO = path.join(PIPELINE, '..');

const USAGE = `usage: node pipeline/bin/estella.mjs export <projectDir> [options]
       node pipeline/bin/estella.mjs import-gltf <file.gltf|file.glb> [outDir] [--project <dir>]

  --platform <id>     web | desktop | wechat | playable | android | ios (default web)
  --out <dir>         output dir (default <projectDir>/dist-<platform>)
  --wasm <dir>        engine runtime to ship (default: the build tree, else the editor's copy)
  --scene <path>      entry scene, project-relative (default: the project's own)
  --title <name>      app title (default: the project's name)
  --scripts <path>    scripts entry, project-relative (default src/main.ts if present)
  --template <dir>    android/ios/desktop: the runtime template to wrap, else the installed one
  --output project    android: emit a Gradle project instead of an apk
  --json <file>       also write the result here, for a caller that reads it back
  --enforce-budget    fail (exit 1) when the package is over a size limit
  --steam-sdk <dir>   desktop: a Steamworks SDK whose redistributable ships in the app
  --steam-appid <id>  desktop: also write the Steam depot scripts for this app id

The result is printed as JSON: errors, warnings, and what the package weighs
against the limits in force. The size report rides the result rather than being a
second file — \`result.size\` carries the verdicts the build dialog draws, so CI
and the editor cannot disagree about whether a build fits.

import-gltf writes one \`.esmesh\` per triangle primitive next to the source (or
into outDir), the images the file carries inline, and one \`.esprefab\` naming
which geometry is drawn with which image and tint. A glTF holds many primitives,
so it is a source that PRODUCES assets rather than one the engine loads — the
products are what a scene references. Asset refs are project-relative, so the
project is found above the source unless --project says otherwise.`;

/** Options take a value; these do not — without the distinction a trailing flag
 *  swallows nothing, ends the loop, and a CI job silently gets no gate. */
const FLAGS = new Set(['enforce-budget']);

function parseArgs(argv) {
  const [command, projectDir, ...rest] = argv;
  if (command === '--help' || command === '-h' || command === 'help') {
    console.log(USAGE);
    process.exit(0);
  }
  if (command === 'import-gltf') {
    if (!projectDir) {
      console.error(USAGE);
      process.exit(2);
    }
    const flag = rest.indexOf('--project');
    const out = rest[0] && !rest[0].startsWith('--') ? path.resolve(rest[0]) : null;
    return {
      command, out, source: path.resolve(projectDir),
      project: flag >= 0 && rest[flag + 1] ? path.resolve(rest[flag + 1]) : null,
    };
  }
  if (command !== 'export' || !projectDir) {
    console.error(USAGE);
    process.exit(2);
  }
  const opts = { projectDir: path.resolve(projectDir), platform: 'web' };
  for (let i = 0; i < rest.length;) {
    const key = rest[i]?.replace(/^--/, '');
    if (!key) break;
    if (FLAGS.has(key)) { opts[key] = true; i += 1; continue; }
    const value = rest[i + 1];
    if (value === undefined) break;
    opts[key] = value;
    i += 2;
  }
  return opts;
}

const firstExisting = (candidates) => candidates.find((c) => c && existsSync(c));
const fileUrl = (p) => `file:///${p.replace(/\\/g, '/')}`;

/** Which desktop template this machine can also RUN, for --template. */
const HOST_DESKTOP_OS = process.platform === 'darwin' ? 'macos'
  : process.platform === 'win32' ? 'windows' : 'linux';

/**
 * Bundle a pipeline entry to a temp module and import it. ESM, because the cook
 * reads `import.meta.url` (the basis encoder locates its binary that way) — and
 * with a `require` shim, because some dependencies are CommonJS (pngjs). esbuild
 * itself stays external and resolves at runtime.
 */
async function loadPipeline(entry, outName) {
  const require = createRequire(path.join(PIPELINE, 'package.json'));
  const esbuild = require('esbuild');
  // As deep in the package as the cook is: the Basis encoder is kept external so
  // it finds its own .cjs/.wasm, which means its relative specifier has to
  // resolve from the temp dir the same way it does from the cook.
  const dir = mkdtempSync(path.join(PIPELINE, 'src', '.build-'));
  const outfile = path.join(dir, outName);
  await esbuild.build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    external: ['esbuild', 'electron', 'sharp', '../../../build-tools/basis/encoder.mjs'],
    logLevel: 'error',
    banner: {
      js: "import { createRequire as __esCreateRequire } from 'node:module';\n"
        + `const require = __esCreateRequire('${fileUrl(path.join(PIPELINE, 'package.json'))}');\n`,
    },
  });
  const mod = await import(fileUrl(outfile));
  return { mod, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const PROJECT_FILES = ['project.esproject', 'project.esproj', 'project.json'];

/** The project directory a path sits in, walking up; null when it is outside one. */
function findProjectRoot(from) {
  for (let dir = from, prev = ''; dir !== prev; prev = dir, dir = path.dirname(dir)) {
    if (PROJECT_FILES.some((name) => existsSync(path.join(dir, name)))) return dir;
  }
  return null;
}

/** The project's raw settings file, for the fields read before the parser runs. */
function projectSettings(projectDir) {
  for (const name of PROJECT_FILES) {
    const file = path.join(projectDir, name);
    if (existsSync(file)) {
      try {
        return JSON.parse(readFileSync(file, 'utf8'));
      } catch {
        return {};
      }
    }
  }
  return {};
}

/**
 * The engine runtime for this target. The build tree is preferred over the copy
 * synced into the editor's public/, so a machine that built the engine and never
 * built the editor can still package. WeChat's is a different build (WXWebAssembly
 * glue) — handing it the web one produces a package that cannot boot on a device.
 */
function engineRuntimeDir(platform) {
  const dirs = platform === 'wechat'
    ? [path.join(REPO, 'build', 'wasm', 'wechat'), path.join(REPO, 'desktop', 'public', 'wasm-wechat')]
    : [path.join(REPO, 'build', 'wasm', 'web'), path.join(REPO, 'desktop', 'public', 'wasm')];
  return firstExisting(dirs) ?? dirs[dirs.length - 1];
}

const opts = parseArgs(process.argv.slice(2));

if (opts.command === 'import-gltf') {
  const { mod: importer, cleanup } = await loadPipeline(
    path.join(PIPELINE, 'src', 'assets', 'gltfImport.ts'), 'gltfImport.mjs');
  let imported = 0;
  try {
    const sourceDir = path.dirname(opts.source);
    const dir = opts.out ?? sourceDir;
    const stem = path.basename(opts.source).replace(/\.(gltf|glb)$/i, '');
    // A component's asset ref is project-relative, so the products can only be
    // named once the project root is known; without one they are bare names.
    const root = opts.project ?? findProjectRoot(sourceDir);
    const projectRef = (abs) => path.relative(root, abs).split(path.sep).join('/');
    const refs = root
      ? { prefix: projectRef(dir) ? `${projectRef(dir)}/` : '',
          external: (uri) => projectRef(path.resolve(sourceDir, uri)) }
      : {};

    const { meshes, textures, warnings } = importer.importGltfMeshes(
      new Uint8Array(readFileSync(opts.source)), stem,
      (uri) => {
        const abs = path.join(sourceDir, uri);
        return existsSync(abs) ? new Uint8Array(readFileSync(abs)) : null;
      },
    );
    for (const w of warnings) console.warn(`  ! ${w}`);
    if (!root && meshes.length > 0) {
      console.warn('  ! no project found above the source — refs are bare file names'
        + ' (pass --project <dir>)');
    }
    const report = (file, what) =>
      console.log(`${path.relative(process.cwd(), file)}: ${what}`);

    for (const mesh of meshes) {
      const outFile = path.join(dir, `${mesh.name}.esmesh`);
      writeFileSync(outFile, importer.encodeImportedMesh(mesh));
      report(outFile, `${mesh.vertexCount} vertices, ${mesh.triangleCount} triangles`);
    }
    for (const texture of textures) {
      const outFile = path.join(dir, texture.name);
      writeFileSync(outFile, texture.bytes);
      report(outFile, `${texture.bytes.length} bytes`);
    }
    if (meshes.length > 0) {
      const outFile = path.join(dir, `${stem}.esprefab`);
      const prefab = importer.assembleGltfPrefab(stem, meshes, refs);
      writeFileSync(outFile, `${JSON.stringify(prefab, null, 2)}\n`);
      report(outFile, `${meshes.length} mesh entit${meshes.length === 1 ? 'y' : 'ies'}`);
    }
    imported = meshes.length;
  } finally {
    cleanup();
  }
  process.exit(imported > 0 ? 0 : 1);
}

const project = projectSettings(opts.projectDir);
const platform = opts.platform;

const entryScene = opts.scene ?? project.defaultScene ?? (
  firstExisting([
    path.join(opts.projectDir, 'assets', 'scenes', 'main.esscene'),
    path.join(opts.projectDir, 'scenes', 'main.esscene'),
  ])?.slice(opts.projectDir.length + 1).replace(/\\/g, '/')
);
if (!entryScene) {
  console.error(`No entry scene found in ${opts.projectDir} (pass --scene <project-relative path>).`);
  process.exit(2);
}

const scriptsEntry = opts.scripts ?? (existsSync(path.join(opts.projectDir, 'src', 'main.ts'))
  ? 'src/main.ts' : undefined);

const outDir = path.resolve(opts.out ?? path.join(opts.projectDir, `dist-${platform}`));

// The editor's package.json is the version of the whole product, and the runtime
// templates are stored per version.
const engineVersion = JSON.parse(readFileSync(path.join(REPO, 'desktop', 'package.json'), 'utf8')).version;
const nativePlatform = platform === 'android' || platform === 'ios';
const templateDir = nativePlatform
  ? (opts.template ? path.resolve(opts.template) : firstExisting([installedTemplateDir(engineVersion, platform)]) ?? null)
  : null;
// Desktop takes a template PER OS and assembles one app for each it finds; the
// assembler is pure Node, so one machine produces the set the editor would.
// --template names one and then it is the only one.
const desktopTemplates = platform !== 'desktop' ? [] : (opts.template
  ? [{ os: HOST_DESKTOP_OS, dir: path.resolve(opts.template) }]
  : ['windows', 'macos', 'linux'].flatMap((os) => {
    const dir = firstExisting([installedTemplateDir(engineVersion, os)]);
    return dir ? [{ os, dir }] : [];
  }));

const { mod: fmt, cleanup: cleanupFmt } = await loadPipeline(
  path.join(PIPELINE, 'src', 'project', 'index.ts'), 'projectFormat.mjs');
const { resolveOrientation, parseManifest, runtimeConfigOf, cookOptionsOf } = fmt;
// PARSED, not read by hand: the parser normalizes legacy platform ids and drops
// values that could not be judged against. A setting read straight off the JSON
// here is a second answer to what a project means.
const manifest = parseManifest(project);
const sizeBudgetBytes = manifest.packaging?.sizeBudget?.[platform];

const { mod: exporter, cleanup: cleanupExport } = await loadPipeline(
  path.join(PIPELINE, 'src', 'export', 'exportGame.ts'), 'exportGame.mjs');

let code = 1;
try {
  const result = await exporter.exportGame({
    root: opts.projectDir,
    entryScene,
    scriptsEntry,
    gameHostEntry: path.join(PIPELINE, 'src', 'runtime', 'gameHost.ts'),
    playableHostEntry: path.join(PIPELINE, 'src', 'runtime', 'playableHost.ts'),
    sdkDistDir: path.join(REPO, 'sdk', 'dist'),
    wasmDir: opts.wasm ? path.resolve(opts.wasm) : engineRuntimeDir(platform),
    outDir,
    platform,
    title: opts.title ?? project.name ?? path.basename(opts.projectDir),
    orientation: resolveOrientation(project),
    // The project's OWN settings, through the same derivation the editor uses:
    // without it a headless package ships every setting at its default while
    // claiming to be the package the dialog makes.
    runtime: runtimeConfigOf(manifest),
    ...cookOptionsOf(manifest),
    androidTemplate: platform === 'android' ? templateDir : null,
    desktopTemplates,
    desktopChannel: opts['steam-appid'] ? 'steam' : undefined,
    steam: (opts['steam-appid'] || opts['steam-sdk'])
      ? { appId: Number(opts['steam-appid']) || undefined, sdkPath: opts['steam-sdk'] }
      : undefined,
    iosSources: platform === 'ios' && templateDir ? iosTemplateSources(templateDir) : null,
    androidOutput: opts.output === 'project' ? 'project' : undefined,
    sizeBudgetBytes,
  });
  const report = { ...result, outDir };
  console.log(JSON.stringify(report, null, 2));
  // stdout carries the cook's own progress too, so a caller that wants the result
  // mechanically cannot just redirect it.
  if (opts.json) writeFileSync(path.resolve(opts.json), `${JSON.stringify(report, null, 2)}\n`);
  code = result.ok ? 0 : 1;

  // The gate is opt-in. A package over its limit is still a package — whether that
  // blocks a release belongs to the caller. Said in prose on stderr as well as in
  // the exit code, because a CI log that only goes red tells nobody which limit.
  const over = (result.size?.verdicts ?? []).filter((v) => v.status === 'over');
  for (const v of over) {
    const mb = (n) => `${(n / 1024 / 1024).toFixed(2)}MB`;
    console.error(`size budget: ${v.budget.scope} is ${mb(v.measuredBytes)}, over the `
      + `${mb(v.budget.maxBytes)} limit (${v.budget.note}).`);
  }
  if (over.length > 0 && opts['enforce-budget']) code = 1;
} finally {
  // Before the exit, not after: process.exit() in the try block would skip this
  // and leave the bundle dirs behind.
  cleanupExport();
  cleanupFmt();
}
process.exit(code);
