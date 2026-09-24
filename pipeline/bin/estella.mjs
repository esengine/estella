// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// Package a project without the editor. `--help` states the options.
import path from 'node:path';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
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
       node pipeline/bin/estella.mjs bake-scene <scene.esscene> [--check]

  --platform <id>     a built-in (web, desktop, wechat, douyin, kuaishou, bilibili, playable, android, ios)
                      or a platform the project defines in .esengine/platforms/ (default web)
  --out <dir>         output dir (default <projectDir>/dist-<platform>)
  --wasm <dir>        engine runtime to ship (default: the build tree, else the editor's copy)
  --scene <path>      entry scene, project-relative (default: the project's own)
  --title <name>      app title (default: the project's name)
  --scripts <path>    scripts entry, project-relative (default src/main.ts if present)
  --template <dir>    android/ios/desktop: the runtime template to wrap, else the installed one
  --output project    android: emit a Gradle project instead of an apk
  --json <file>       also write the result here, for a caller that reads it back
  --enforce-budget    fail (exit 1) when the package is over a size limit
  --minify            minify the bundled scripts, as a shipping build does
  --no-aot            package without compiling the systems marked @compiled, so
                      the same project runs both ways and the frames are compared
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
const FLAGS = new Set(['enforce-budget', 'minify', 'no-aot']);

function parseArgs(argv) {
  const [command, projectDir, ...rest] = argv;
  if (command === '--help' || command === '-h' || command === 'help') {
    console.log(USAGE);
    process.exit(0);
  }
  if (command === 'bake-scene') {
    if (!projectDir) {
      console.error(USAGE);
      process.exit(2);
    }
    return { command, source: path.resolve(projectDir), check: rest.includes('--check') };
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
const BAKE_IDENTITY_Q = { x: 0, y: 0, z: 0, w: 1 };
const BAKE_ONE = { x: 1, y: 1, z: 1 };
const BAKE_ZERO = { x: 0, y: 0, z: 0 };

const bakeComponent = (entity, type) => entity.components?.find((c) => c.type === type);

/** The project a scene belongs to: the nearest ancestor holding a `.esproject`.
 *  An asset ref is PROJECT-relative, which is what the editor resolves against. */
function bakeProjectRoot(sceneFile) {
  let dir = path.dirname(sceneFile);
  for (;;) {
    if (existsSync(path.join(dir, 'project.esproject'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

/** uuid -> project-relative path, out of the `.meta` beside each asset. A scene
 *  the editor saved names its assets by uuid and one a person wrote names them
 *  by path; both have to reach the same file. */
function bakeAssetIndex(root) {
  const index = new Map();
  if (!root) return index;
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const at = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (entry.name[0] !== '.') walk(at); continue; }
      if (!entry.name.endsWith('.meta')) continue;
      try {
        const uuid = JSON.parse(readFileSync(at, 'utf8')).uuid;
        if (typeof uuid === 'string') {
          index.set(uuid, path.relative(root, at.slice(0, -'.meta'.length)).split(path.sep).join('/'));
        }
      } catch { /* a half-written .meta names nothing */ }
    }
  };
  walk(root);
  return index;
}
const bakeVec = (v, fallback) => ({ ...fallback, ...(v ?? {}) });

/** Column-major 4x4 from a document's Transform, through the SDK's own compose.
 *  Flat scenes only — see bakeScene. */
function bakeTransformOf(baker, entity) {
  const tf = bakeComponent(entity, 'Transform')?.data ?? {};
  return baker.composeTRS(bakeVec(tf.position, BAKE_ZERO),
                          bakeVec(tf.rotation, BAKE_IDENTITY_Q),
                          bakeVec(tf.scale, BAKE_ONE));
}

/**
 * Bakes a shipped scene, or checks that what is committed IS a bake of it.
 *
 * Reads the DOCUMENT rather than a world, which is why a scene with a hierarchy
 * is refused: resolving one is the editor's job, and an atlas lit for a place
 * nothing is at looks like a bake that is wrong rather than one never run.
 */
async function bakeScene(baker, meta, sceneFile, check) {
  const sceneDir = path.dirname(sceneFile);
  const rel = path.relative(REPO, sceneFile);
  const scene = JSON.parse(readFileSync(sceneFile, 'utf8'));

  const parented = (scene.entities ?? []).filter((e) => e.parent != null);
  if (parented.length > 0) {
    console.error(`bake-scene: ${rel} has ${parented.length} parented entit(ies), whose world`
      + ' transforms only the editor resolves — bake it there instead.');
    return 1;
  }

  // The scene's own knobs, where it states them. Absent leaves the bake at its
  // defaults, which is what every scene got before the component existed.
  const declared = (scene.entities ?? [])
    .map((e) => bakeComponent(e, 'BakedLighting')).find(Boolean)?.data ?? {};
  const options = {
    atlasSize: declared.atlasSize, texelsPerUnit: declared.texelsPerUnit,
    bounces: declared.bounces, samples: declared.samples,
    probeSamples: declared.probeSamples,
  };
  for (const k of Object.keys(options)) if (typeof options[k] !== 'number') delete options[k];

  // Where an asset ref resolves to. Not relative to the SCENE: a ref is what the
  // project's asset browser shows, and the editor resolves it against the root.
  const projectRoot = bakeProjectRoot(sceneFile);
  const byUuid = bakeAssetIndex(projectRoot);
  const resolveRef = (ref) => {
    if (typeof ref !== 'string' || ref === '') return '';
    const relative = ref.startsWith('@uuid:') ? byUuid.get(ref.slice(6)) : ref;
    if (!relative) return '';
    return projectRoot ? path.resolve(projectRoot, relative) : path.resolve(sceneDir, relative);
  };

  const surfaces = [];
  const lights = [];
  const volumes = [];
  const reflectionProbes = [];
  const ambient = [0, 0, 0];
  // The sky a capture sees and the format its atlas adopts. Read from the FIRST
  // ambient light naming one, which is the frame's environment too.
  let environment = null;
  const readEnvironment = (ref) => {
    const file = resolveRef(ref);
    if (!file || !existsSync(file)) return null;
    try {
      const document = JSON.parse(readFileSync(file, 'utf8'));
      // A sibling of the document, which is how an import names it — or a ref,
      // which is how one survives a package renaming files to their hash.
      const spec = typeof document.specular === 'string' ? document.specular : '';
      const atlas = spec.startsWith('@uuid:') ? resolveRef(spec)
                                              : path.resolve(path.dirname(file), spec);
      return { document, atlasPng: atlas && existsSync(atlas)
        ? new Uint8Array(readFileSync(atlas)) : new Uint8Array() };
    } catch { return null; }
  };
  // The REF as the document spells it, not the path it resolves to: the editor's
  // collector fingerprints the same string, and an absolute path would differ
  // between two checkouts of one project.
  const fingerprintSurfaces = [];
  for (const entity of scene.entities ?? []) {
    const tf = bakeComponent(entity, 'Transform')?.data ?? {};
    const mesh = bakeComponent(entity, 'MeshRenderer');
    const light = bakeComponent(entity, 'Light');
    const volume = bakeComponent(entity, 'LightProbeVolume');
    if (volume && volume.data?.enabled !== false) {
      const p = bakeVec(tf.position, BAKE_ZERO);
      const h = bakeVec(volume.data?.halfExtents, { x: 100, y: 100, z: 100 });
      volumes.push({
        entity: entity.id, label: entity.name ?? String(entity.id),
        center: [p.x, p.y, p.z], halfExtents: [h.x, h.y, h.z],
        spacing: volume.data?.spacing ?? 100,
      });
    }
    // A decal is not a lightmap receiver: what it prints on was baked already,
    // and baking the overlay too would light the same surface twice.
    const isDecal = !!bakeComponent(entity, 'DecalProjector');
    if (mesh && mesh.data?.enabled !== false && !isDecal) {
      const ref = typeof mesh.data?.mesh === 'string' ? mesh.data.mesh : '';
      const builtin = ref.startsWith('builtin:') ? ref : undefined;
      const file = builtin ? '' : resolveRef(ref);
      if (builtin || (ref && existsSync(file))) {
        const c = mesh.data?.color;
        const body = bakeComponent(entity, 'RigidBody3D');
        const textureRef = typeof mesh.data?.texture === 'string' ? mesh.data.texture : '';
        const textureFile = resolveRef(textureRef);
        const transform = bakeTransformOf(baker, entity);
        const holdsStill = baker.bakeHoldsStill({
          characterController: !!bakeComponent(entity, 'CharacterController3D'),
          bodyType: body ? (body.data?.bodyType ?? 2) : undefined,
        });
        const albedo = c ? [c.r ?? 1, c.g ?? 1, c.b ?? 1] : undefined;
        surfaces.push({
          entity: entity.id, label: entity.name ?? String(entity.id),
          meshFile: file, builtinRef: builtin, transform,
          baseColor: albedo, holdsStill,
          baseColorTexture: textureFile && existsSync(textureFile) ? textureFile : undefined,
        });
        fingerprintSurfaces.push({ mesh: ref, transform, albedo, texture: textureRef, holdsStill });
      }
    }
    const reflection = bakeComponent(entity, 'ReflectionProbe');
    if (reflection && reflection.data?.enabled !== false) {
      const p = bakeVec(tf.position, BAKE_ZERO);
      reflectionProbes.push({ entity: entity.id, label: entity.name ?? String(entity.id),
                              center: [p.x, p.y, p.z] });
    }
    if (light) {
      if (!environment && typeof light.data?.environment === 'string'
          && light.data.environment !== '') {
        environment = readEnvironment(light.data.environment);
      }
      const p = bakeVec(tf.position, BAKE_ZERO);
      const made = baker.bakeLightOf(light.data, [p.x, p.y, p.z],
                                     bakeVec(tf.rotation, BAKE_IDENTITY_Q));
      if (made?.lamp) lights.push(made.lamp);
      else if (made?.ambient) {
        ambient[0] += made.ambient[0];
        ambient[1] += made.ambient[1];
        ambient[2] += made.ambient[2];
      }
    }
  }

  const fingerprint = baker.bakeFingerprint({
    surfaces: fingerprintSurfaces, lights,
    volumes: volumes.map((v) => ({ center: v.center, halfExtents: v.halfExtents,
                                   spacing: v.spacing })),
    // A reflection is captured from a POINT, so where it stands is the whole of
    // what it contributes — a moved probe is a stale bake.
    reflections: reflectionProbes.map((p) => p.center),
    ambient, options,
  });
  const result = baker.bakeSceneLightmap({
    surfaces, lights, probeVolumes: volumes, reflectionProbes, environment,
    options: { ...options, ambient },
  });
  for (const w of result.warnings) console.warn(`  ! ${w}`);

  const stem = path.basename(sceneFile).replace(/\.esscene$/i, '');
  const atlasName = `${stem}_lightmap.png`;
  const atlasFile = path.join(sceneDir, atlasName);

  // The REF and not the file name: a package addresses assets by uuid and renames
  // files to their content hash. Read from the product's own `.meta`, since `byUuid`
  // was built before this bake wrote anything.
  const refTo = (absFile) => {
    try {
      const meta = JSON.parse(readFileSync(`${absFile}.meta`, 'utf8'));
      return typeof meta.uuid === 'string' ? `@uuid:${meta.uuid}` : '';
    } catch { return ''; }
  };
  const atlasRef = refTo(atlasFile);

  // One file per volume, named for the entity that holds it: adding a second
  // volume must not rename the first one's grid.
  const grids = new Map();
  result.probes.forEach((doc, i) => {
    if (!doc) return;
    const name = `${stem}_probes_${volumes[i].entity}.esprobes`;
    grids.set(volumes[i].entity, {
      name, text: baker.probeDocumentText(doc), ref: refTo(path.join(sceneDir, name)),
    });
  });

  // The scene's reflections: one atlas and one document beside the lightmap, and
  // a column number written onto each probe. Named for the scene rather than for
  // a probe — there is one of these however many probes stand in it.
  const reflectionName = `${stem}_reflections.png`;
  const reflectionDocName = `${stem}_reflections.esenv`;
  const reflectionFile = path.join(sceneDir, reflectionName);
  const reflectionDocFile = path.join(sceneDir, reflectionDocName);
  let reflectionText = null;
  if (result.reflection) {
    result.reflection.document.specular = reflectionName;
    reflectionText = `${JSON.stringify(result.reflection.document, null, 2)}\n`;
  }
  const reflectionRef = reflectionText ? (refTo(reflectionDocFile) || reflectionDocName) : '';

  const placed = new Map();
  result.scaleOffset.forEach((rect, i) => { if (rect) placed.set(surfaces[i].entity, rect); });
  for (const entity of scene.entities ?? []) {
    const rect = placed.get(entity.id);
    const at = entity.components.findIndex((c) => c.type === 'MeshLightmap');
    if (!rect) {
      if (at >= 0) entity.components.splice(at, 1);
      continue;
    }
    const data = { lightmap: atlasRef || atlasName,
                   scaleOffset: { x: rect[0], y: rect[1], z: rect[2], w: rect[3] } };
    if (at >= 0) entity.components[at] = { type: 'MeshLightmap', data };
    else entity.components.push({ type: 'MeshLightmap', data });
  }
  for (const entity of scene.entities ?? []) {
    const at = entity.components.findIndex((c) => c.type === 'BakedLighting');
    if (at < 0) continue;
    entity.components[at] = {
      type: 'BakedLighting',
      data: { ...entity.components[at].data, bakedFrom: fingerprint },
    };
  }
  for (const entity of scene.entities ?? []) {
    const at = entity.components.findIndex((c) => c.type === 'ReflectionProbe');
    if (at < 0) continue;
    // Column 0 is the sky, so the first probe is column 1. A probe the bake did
    // not take keeps neither ref nor column: a stale one would reflect whatever
    // room happens to be baked at that number.
    const column = reflectionProbes.findIndex((p) => p.entity === entity.id);
    entity.components[at] = {
      type: 'ReflectionProbe',
      data: { ...entity.components[at].data,
              reflection: column >= 0 ? reflectionRef : '',
              slot: column >= 0 ? column + 1 : 0 },
    };
  }
  for (const entity of scene.entities ?? []) {
    const at = entity.components.findIndex((c) => c.type === 'LightProbeVolume');
    if (at < 0) continue;
    // A refused volume loses its ref rather than keeping the last grid: a box
    // the author has since resized is not described by what fitted the old one.
    const grid = grids.get(entity.id);
    entity.components[at] = {
      type: 'LightProbeVolume',
      data: { ...entity.components[at].data, probes: grid ? (grid.ref || grid.name) : '' },
    };
  }
  const document = `${JSON.stringify(scene, null, 2)}\n`;

  // A product with no `.meta` has no identity, so the cook carries neither it nor
  // the light in it. Checked here rather than written: a uuid is the stable name
  // refs resolve through, and minting one is the importer's to do.
  const products = [atlasFile, ...[...grids.values()].map((g) => path.join(sceneDir, g.name)),
                    ...(reflectionText ? [reflectionFile, reflectionDocFile] : [])];
  const unnamed = products.filter((f) => existsSync(f) && !existsSync(`${f}.meta`));
  if (check && unnamed.length > 0) {
    for (const f of unnamed) console.error(`bake-scene: ${path.relative(REPO, f)} has no .meta`);
    console.error('A package carries what has an identity. Give them one:'
      + `  node tools/asset-meta.js ${path.relative(REPO, sceneDir)}`);
    return 1;
  }

  if (check) {
    const staleAtlas = !existsSync(atlasFile)
      || Buffer.compare(readFileSync(atlasFile), Buffer.from(result.atlasBytes)) !== 0;
    const staleScene = readFileSync(sceneFile, 'utf8') !== document;
    const staleGrids = [...grids.values()].some((g) => {
      const file = path.join(sceneDir, g.name);
      return !existsSync(file) || readFileSync(file, 'utf8') !== g.text;
    });
    const staleReflections = reflectionText != null && (
      !existsSync(reflectionFile)
      || Buffer.compare(readFileSync(reflectionFile),
                        Buffer.from(result.reflection.atlasBytes)) !== 0
      || !existsSync(reflectionDocFile)
      || readFileSync(reflectionDocFile, 'utf8') !== reflectionText);
    if (staleAtlas || staleScene || staleGrids || staleReflections) {
      const what = [staleAtlas && 'the atlas', staleScene && 'the scene',
                    staleGrids && 'a probe grid',
                    staleReflections && 'the reflections'].filter(Boolean).join(' and ');
      console.error(`bake-scene: ${rel} is not what a bake of it produces (${what} differ).`);
      console.error(`Rebake: node pipeline/bin/estella.mjs bake-scene ${rel}`);
      return 1;
    }
    console.log(`bake-scene: ${rel} matches a fresh bake`
      + ` (${result.lumels} lumel(s) over ${placed.size} object(s)`
      + `${grids.size ? `, ${grids.size} probe grid(s)` : ''}`
      + `${result.reflection ? `, ${result.reflection.columns} reflection column(s)` : ''}).`);
    return 0;
  }

  writeFileSync(atlasFile, result.atlasBytes);
  for (const g of grids.values()) writeFileSync(path.join(sceneDir, g.name), g.text);
  if (reflectionText) {
    writeFileSync(reflectionFile, result.reflection.atlasBytes);
    writeFileSync(reflectionDocFile, reflectionText);
    // An RGBM encoding of radiance, the three settings an HDR import gives its own
    // atlas. Adopted here because this bake IS this file's importer, and a default
    // meta would linearize the multiplier and then compress it.
    await meta.adoptOrphan(reflectionFile, { sRGB: false, compress: false, wrapMode: 'clamp' });
    await meta.adoptOrphan(reflectionDocFile);
  }
  writeFileSync(sceneFile, document);

  // A product written for the first time has no `.meta` yet, so the scene had to
  // name it by file name — which an export cannot resolve. Said here rather than
  // left to --check, since this is the run that produced it.
  const nameless = [atlasRef ? '' : atlasName,
                    ...[...grids.values()].filter((g) => !g.ref).map((g) => g.name)].filter(Boolean);
  if (nameless.length > 0) {
    console.warn(`bake-scene: ${nameless.join(', ')} — no .meta, so the scene names it by file`
      + ' name and a package cannot carry it. Mint one and bake again:'
      + `  node tools/asset-meta.js ${path.relative(REPO, sceneDir)}`);
  }
  console.log(`bake-scene: ${result.lumels} lumel(s) over ${placed.size} object(s)`
    + `${grids.size ? `, ${grids.size} probe grid(s)` : ''}`
    + ` -> ${path.relative(REPO, atlasFile)}`);
  return 0;
}

/** An hour: longer than any run, so this can only be a dir nothing owns. */
const STALE_MS = 60 * 60 * 1000;

/**
 * Remove build dirs a previous run could not: `process.on('exit')` covers a
 * normal end, and Ctrl-C is not one. 277 of them had collected, 219MB of half
 * the toolchain sitting where every source-scanning gate reads.
 */
function sweepStaleBuildDirs(srcDir) {
  const now = Date.now();
  for (const name of readdirSync(srcDir)) {
    if (!name.startsWith('.build-')) continue;
    const dir = path.join(srcDir, name);
    try {
      if (now - statSync(dir).mtimeMs < STALE_MS) continue;
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    } catch { /* a concurrent run may be removing it; either way it is gone. */ }
  }
}

async function loadPipeline(entry, outName) {
  const require = createRequire(path.join(PIPELINE, 'package.json'));
  const esbuild = require('esbuild');
  // As deep in the package as the cook is: the Basis encoder is kept external so
  // it finds its own .cjs/.wasm, which means its relative specifier has to
  // resolve from the temp dir the same way it does from the cook.
  sweepStaleBuildDirs(path.join(PIPELINE, 'src'));
  const dir = mkdtempSync(path.join(PIPELINE, 'src', '.build-'));
  const outfile = path.join(dir, outName);
  await esbuild.build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    // 'typescript' (the AOT step parses a project with it) reads `__filename` at
    // load, which an ESM bundle has none of: inlined, the bundle dies before it
    // exports anything.
    external: ['esbuild', 'electron', 'sharp', 'draco3dgltf', 'typescript',
      '../../../build-tools/basis/encoder.mjs', '../../../build-tools/ufbx/reader.mjs'],
    logLevel: 'error',
    banner: {
      js: "import { createRequire as __esCreateRequire } from 'node:module';\n"
        + `const require = __esCreateRequire('${fileUrl(path.join(PIPELINE, 'package.json'))}');\n`,
    },
  });
  let gone = false;
  const cleanup = () => {
    if (gone) return;
    gone = true;
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  };
  // The dir lives inside `pipeline/src`, so one left behind is half the toolchain
  // sitting where every source-scanning gate reads. A caller's own cleanup is a
  // path that can be missed — 277 had been — so the exit is what guarantees it.
  process.on('exit', cleanup);
  try {
    return { mod: await import(fileUrl(outfile)), cleanup };
  } catch (err) {
    cleanup();
    throw err;
  }
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
 * built the editor can still package. A mini-game takes a different build of the
 * same engine — handing it the web one is a syntax error at the first `require`.
 */
function engineRuntimeDir(platform) {
  const dirs = fmt.isMiniGamePlatform(platform)
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

if (opts.command === 'bake-scene') {
  const { mod: baker, cleanup } = await loadPipeline(
    path.join(PIPELINE, 'src', 'assets', 'lightmapBake.ts'), 'lightmapBake.mjs');
  const { mod: meta, cleanup: cleanupMeta } = await loadPipeline(
    path.join(PIPELINE, 'src', 'assets', 'assetMeta.ts'), 'assetMeta.mjs');
  try {
    process.exit(await bakeScene(baker, meta, opts.source, opts.check));
  } finally {
    cleanup();
    cleanupMeta();
  }
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
const engineVersion = JSON.parse(readFileSync(path.join(REPO, 'package.json'), 'utf8')).version;
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
const { resolveOrientation, parseManifest, runtimeConfigOf, cookOptionsOf, packagingOptionsOf } = fmt;
// PARSED, not read by hand: the parser normalizes legacy platform ids and drops
// values that could not be judged against. A setting read straight off the JSON
// here is a second answer to what a project means.
const manifest = parseManifest(project);
const sizeBudgetBytes = manifest.packaging?.sizeBudget?.[platform];

const { mod: exporter, cleanup: cleanupExport } = await loadPipeline(
  path.join(PIPELINE, 'src', 'export', 'exportGame.ts'), 'exportGame.mjs');

// A platform the project defines in .esengine/platforms/, loaded the way the
// build dialog loads it, so a headless package is the one the dialog makes.
let projectPlatform = null;
if (!fmt.BUILTIN_PLATFORMS.includes(platform)) {
  const { mod: catalog, cleanup: cleanupCatalog } = await loadPipeline(
    path.join(PIPELINE, 'src', 'export', 'platformCatalog.ts'), 'platformCatalog.mjs');
  try {
    projectPlatform = await catalog.loadProjectPlatform(opts.projectDir, platform,
      { web: engineRuntimeDir('web'), minigame: engineRuntimeDir('wechat') });
  } finally {
    cleanupCatalog();
  }
  if (!projectPlatform) {
    console.error(`Unknown platform "${platform}": not a built-in (${fmt.BUILTIN_PLATFORMS.join(', ')}),`
      + ` and ${opts.projectDir} defines none by that id in .esengine/platforms/.`);
    process.exit(2);
  }
}

let code = 1;
try {
  const result = await exporter.exportGame({
    root: opts.projectDir,
    entryScene,
    scriptsEntry,
    hostsDir: path.join(PIPELINE, 'src', 'runtime'),
    packagesDir: path.join(REPO, 'plugins'),
    sdkDistDir: path.join(REPO, 'sdk', 'dist'),
    wasmDir: opts.wasm ? path.resolve(opts.wasm) : projectPlatform?.wasmDir ?? engineRuntimeDir(platform),
    miniGameProfile: projectPlatform?.profile,
    outDir,
    platform,
    title: opts.title ?? project.name ?? path.basename(opts.projectDir),
    orientation: resolveOrientation(project),
    // The project's OWN settings, through the same derivation the editor uses:
    // without it a headless package ships every setting at its default while
    // claiming to be the package the dialog makes.
    runtime: runtimeConfigOf(manifest),
    ...cookOptionsOf(manifest),
    ...packagingOptionsOf(manifest),
    androidTemplate: platform === 'android' ? templateDir : null,
    desktopTemplates,
    desktopChannel: opts['steam-appid'] ? 'steam' : undefined,
    steam: (opts['steam-appid'] || opts['steam-sdk'])
      ? { appId: Number(opts['steam-appid']) || undefined, sdkPath: opts['steam-sdk'] }
      : undefined,
    iosSources: platform === 'ios' && templateDir ? iosTemplateSources(templateDir) : null,
    androidOutput: opts.output === 'project' ? 'project' : undefined,
    minify: opts.minify,
    // `dev` is what the AOT step calls "do not compile" — the editor's preview
    // mode, reused here so there is one word for it (docs/REARCH_AOT.md §9).
    ...(opts['no-aot'] ? { aotMode: 'dev' } : {}),
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
  const mb = (n) => `${(n / 1024 / 1024).toFixed(2)}MB`;
  // What the engine weighs, when it is still in the package the limit counts.
  const engineBytes = (result.subPackageRoots ?? []).length > 0 ? 0
    : (result.size?.byKind ?? []).find((k) => k.kind === 'engine')?.bytes ?? 0;
  for (const v of over) {
    console.error(`size budget: ${v.budget.scope} is ${mb(v.measuredBytes)}, over the `
      + `${mb(v.budget.maxBytes)} limit (${v.budget.note}).`);
    // Naming the limit and stopping there leaves the reader to discover two
    // settings that exist: five of the corpus's projects, three over this limit,
    // and every one of them over it by less than the engine weighs.
    if (v.budget.scope === 'initial' && engineBytes > v.measuredBytes - v.budget.maxBytes) {
      console.error(`  the engine is ${mb(engineBytes)} of that, in the main package. `
        + '`packaging.engineSubpackage` moves it into a subpackage the host loads at '
        + 'startup; `packaging.compressWasm` ships it compressed.');
    }
  }
  if (over.length > 0 && opts['enforce-budget']) code = 1;
} finally {
  // Before the exit, not after: process.exit() in the try block would skip this
  // and leave the bundle dirs behind.
  cleanupExport();
  cleanupFmt();
}
process.exit(code);
