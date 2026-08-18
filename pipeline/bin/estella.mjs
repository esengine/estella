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
       node pipeline/bin/estella.mjs import-model <file.gltf|file.glb|file.fbx> [outDir]
                                     [--project <dir>] [--scale <n>]
       node pipeline/bin/estella.mjs import-hdr <file.hdr> [outDir] [--face-size <n>]

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

import-model writes one \`.esmesh\` per triangle primitive next to the source (or
into outDir), the images the file carries inline, and one \`.esprefab\` placing
each piece where the source's node tree puts it, with its image and tint. A model
holds many primitives, so it is a source that PRODUCES assets rather than one the
engine loads — the products are what a scene references. Asset refs are
project-relative, so the project is found above the source unless --project says
otherwise; --scale sizes the model, whose metres are world units otherwise.

import-hdr bakes an equirectangular panorama into the two things a renderer asks
an environment for: nine irradiance coefficients (in the \`.esenv\`) and one
prefiltered octahedral atlas beside it, which the document names as a sibling.
The panorama itself is not shipped — a light references the \`.esenv\`.`;

/** Options take a value; these do not — without the distinction a trailing flag
 *  swallows nothing, ends the loop, and a CI job silently gets no gate. */
const FLAGS = new Set(['enforce-budget']);

function parseArgs(argv) {
  const [command, projectDir, ...rest] = argv;
  if (command === '--help' || command === '-h' || command === 'help') {
    console.log(USAGE);
    process.exit(0);
  }
  if (command === 'import-model' || command === 'import-gltf' || command === 'import-hdr') {
    if (!projectDir) {
      console.error(USAGE);
      process.exit(2);
    }
    const flag = rest.indexOf('--project');
    const scale = rest.indexOf('--scale');
    const faceSize = rest.indexOf('--face-size');
    const out = rest[0] && !rest[0].startsWith('--') ? path.resolve(rest[0]) : null;
    return {
      command, out, source: path.resolve(projectDir),
      project: flag >= 0 && rest[flag + 1] ? path.resolve(rest[flag + 1]) : null,
      scale: scale >= 0 ? Number(rest[scale + 1]) || 1 : 1,
      faceSize: faceSize >= 0 ? Number(rest[faceSize + 1]) || undefined : undefined,
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
    external: ['esbuild', 'electron', 'sharp', 'draco3dgltf',
      '../../../build-tools/basis/encoder.mjs', '../../../build-tools/ufbx/reader.mjs'],
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

// `import-gltf` is the name this command shipped under; it reads any of the
// model sources now, and the old spelling keeps working.
if (opts.command === 'import-model' || opts.command === 'import-gltf') {
  const { mod: reader, cleanup: cleanupReader } = await loadPipeline(
    path.join(PIPELINE, 'src', 'assets', 'readModelSource.ts'), 'readModelSource.mjs');
  const { mod: importer, cleanup } = await loadPipeline(
    path.join(PIPELINE, 'src', 'assets', 'modelImport.ts'), 'modelImport.mjs');
  // The products are project assets, so they get their `.meta` here rather than
  // waiting for a scan — which is also the only moment the source's own import
  // settings (a sampler's filter and wrap) are still in hand.
  const { mod: meta, cleanup: cleanupMeta } = await loadPipeline(
    path.join(PIPELINE, 'src', 'assets', 'assetMeta.ts'), 'assetMeta.mjs');
  let imported = 0;
  try {
    const sourceDir = path.dirname(opts.source);
    const dir = opts.out ?? sourceDir;
    const stem = reader.modelStem(opts.source);
    // A component's asset ref is project-relative, so the products can only be
    // named once the project root is known; without one they are bare names.
    const root = opts.project ?? findProjectRoot(sourceDir);
    const projectRef = (abs) => path.relative(root, abs).split(path.sep).join('/');
    const refs = root
      ? { prefix: projectRef(dir) ? `${projectRef(dir)}/` : '',
          external: (uri) => projectRef(path.resolve(sourceDir, uri)) }
      : {};

    const { meshes, textures, nodes, animations, warnings } = await reader.readModelSource(
      new Uint8Array(readFileSync(opts.source)), stem,
      {
        filename: opts.source,
        externalBuffers: (uri) => {
          const abs = path.join(sourceDir, uri);
          return existsSync(abs) ? new Uint8Array(readFileSync(abs)) : null;
        },
      },
    );
    for (const w of warnings) console.warn(`  ! ${w}`);
    if (!root && meshes.length > 0) {
      console.warn('  ! no project found above the source — refs are bare file names'
        + ' (pass --project <dir>)');
    }
    const report = (file, what) =>
      console.log(`${path.relative(process.cwd(), file)}: ${what}`);
    // Settings the source asked for, by product name; only ever the FIRST mint.
    const settings = new Map();
    for (const mesh of meshes) {
      for (const image of [mesh.material?.baseColorTexture, mesh.material?.normalTexture,
                           mesh.material?.emissiveTexture, mesh.material?.occlusionTexture]) {
        if (image?.settings) settings.set(image.file, image.settings);
      }
    }
    const adopt = (file) => meta.adoptOrphan(file, settings.get(path.basename(file)));

    for (const mesh of meshes) {
      const outFile = path.join(dir, `${mesh.name}.esmesh`);
      writeFileSync(outFile, importer.encodeImportedMesh(mesh));
      await adopt(outFile);
      report(outFile, `${mesh.vertexCount} vertices, ${mesh.triangleCount} triangles`);
    }
    for (const texture of textures) {
      const outFile = path.join(dir, texture.name);
      writeFileSync(outFile, texture.bytes);
      await adopt(outFile);
      report(outFile, `${texture.bytes.length} bytes`);
    }
    for (const material of importer.materialProducts(meshes, stem, refs)) {
      const outFile = path.join(dir, `${material.name}.esmaterial`);
      writeFileSync(outFile, `${JSON.stringify(material.data, null, 2)}\n`);
      await adopt(outFile);
      report(outFile, Object.keys(material.data.properties).join(', '));
    }
    let firstClip;
    for (const animation of animations) {
      const outFile = path.join(dir, `${animation.name}.estimeline`);
      writeFileSync(outFile, `${JSON.stringify(animation.document, null, 2)}\n`);
      await adopt(outFile);
      const tracks = animation.document.tracks.length;
      report(outFile, `${animation.document.duration}s, ${tracks} track${tracks === 1 ? '' : 's'}`);
      firstClip ??= `${refs.prefix ?? ''}${animation.name}.estimeline`;
    }
    if (meshes.length > 0) {
      const outFile = path.join(dir, `${stem}.esprefab`);
      const prefab = importer.assembleModelPrefab(
        stem, meshes, { refs, nodes, scale: opts.scale, timeline: firstClip });
      writeFileSync(outFile, `${JSON.stringify(prefab, null, 2)}\n`);
      await adopt(outFile);
      report(outFile, `${prefab.entities.length} entit${prefab.entities.length === 1 ? 'y' : 'ies'}`);

      // A glTF is authored in metres and a world unit is a design pixel, so a
      // real-world model arrives a few pixels across unless --scale says otherwise.
      const extent = Math.max(...meshes.flatMap(
        (m) => m.data.aabbMax.map((v, i) => v - m.data.aabbMin[i])));
      if (opts.scale === 1 && extent < 8) {
        console.warn(`  ! the model is ${extent.toFixed(2)} units across — models are authored`
          + ' in metres and a world unit is a design pixel; pass --scale if it should be bigger');
      }
    }
    imported = meshes.length;
  } finally {
    cleanupReader();
    cleanup();
    cleanupMeta();
  }
  process.exit(imported > 0 ? 0 : 1);
}

if (opts.command === 'import-hdr') {
  const { mod: importer, cleanup } = await loadPipeline(
    path.join(PIPELINE, 'src', 'assets', 'environmentImport.ts'), 'environmentImport.mjs');
  const { mod: meta, cleanup: cleanupMeta } = await loadPipeline(
    path.join(PIPELINE, 'src', 'assets', 'assetMeta.ts'), 'assetMeta.mjs');
  try {
    const sourceDir = path.dirname(opts.source);
    const dir = opts.out ?? sourceDir;
    const stem = path.basename(opts.source).replace(/\.hdr$/i, '');
    const result = importer.importEnvironment(
      new Uint8Array(readFileSync(opts.source)), stem, { faceSize: opts.faceSize });
    for (const w of result.warnings) console.warn(`  ! ${w}`);
    const report = (file, what) =>
      console.log(`${path.relative(process.cwd(), file)}: ${what}`);

    const atlasFile = path.join(dir, result.atlasName);
    writeFileSync(atlasFile, result.atlasBytes);
    // An RGBM encoding of radiance, not a picture: sRGB would linearize what is
    // already linear, and a block compressor would quantize the shared multiplier
    // along with the colour it scales.
    await meta.adoptOrphan(atlasFile, { sRGB: false, compress: false, wrapMode: 'clamp' });
    report(atlasFile, `${result.document.mipCount} prefiltered mips`);

    // Beside the document, the way an imported material names its images.
    result.document.specular = result.atlasName;
    const envFile = path.join(dir, `${stem}.esenv`);
    writeFileSync(envFile, `${JSON.stringify(result.document, null, 2)}\n`);
    await meta.adoptOrphan(envFile);
    report(envFile, `irradiance + ${result.document.faceSize}px reflection`);
  } finally {
    cleanup();
    cleanupMeta();
  }
  process.exit(0);
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
