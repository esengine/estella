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

const USAGE = `usage: node pipeline/bin/estella.mjs create <template> <dir> [--name <project name>]
       node pipeline/bin/estella.mjs templates
       node pipeline/bin/estella.mjs tools status [--json]
       node pipeline/bin/estella.mjs tools install <tool> [--yes] [--base <dir|url>]
       node pipeline/bin/estella.mjs tools remove <tool>
       node pipeline/bin/estella.mjs luban gen|check <projectDir>
       node pipeline/bin/estella.mjs proto gen|check <projectDir>
       node pipeline/bin/estella.mjs export <projectDir> [options]
       node pipeline/bin/estella.mjs import-model <file.gltf|file.glb|file.fbx> [outDir]
                                     [--project <dir>] [--scale <n>]
                                     [--specular-map color|orm] [--lightmap-uv] [--lods <0-3>]
       node pipeline/bin/estella.mjs import-hdr <file.hdr> [outDir] [--face-size <n>]
       node pipeline/bin/estella.mjs import-cocos <cocosProjectDir> <estellaProjectDir>
                                     [--only <assets/ subpath>]... [--into <folder>] [--dry-run]
       node pipeline/bin/estella.mjs bake-scene <scene.esscene> [--check]
       node pipeline/bin/estella.mjs package-openpaas <exportDir> --config <local.json> --out <game.sp>

  --platform <id>     a built-in (web, desktop, wechat, douyin, kuaishou, bilibili, playable, android, ios)
                      or a platform the project defines in .esengine/platforms/ (default web)
  --profile <name>    one of the project's export profiles (packaging.profiles): its
                      target, development or shipping, and the settings it overrides
                      A shipping Android build is signed with the project's release
                      key (platforms.android.releaseKey); its passphrase comes from
                      ESTELLA_ANDROID_KEY_PASSPHRASE
  --out <dir>         output dir (default <projectDir>/dist-<platform>)
  --wasm <dir>        engine runtime to ship (default: the build tree, else the editor's copy)
  --scene <path>      entry scene, project-relative (default: the project's own)
  --title <name>      app title (default: the project's name)
  --scripts <path>    scripts entry, project-relative (default: the project's scripts.main)
  --template <dir>    android/ios/desktop: the runtime template to wrap, else the installed one
  --output project    android: emit a Gradle project instead of an apk
  --emulator-abi      android: also carry the emulator's x86_64 libraries (about half of an empty
                      package; phones do not run them, so the default leaves them out)
  --json <file>       also write the result here, for a caller that reads it back
  --enforce-budget    fail (exit 1) when the package is over a size limit
  --minify            minify the bundled scripts, as a shipping build (or profile) does
  --debug-channel <url>  a development build dials this editor address
                      (ws://host:port/?token=…) so its frames can be captured;
                      refused together with --minify
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
--specular-map orm reads an FBX's specular map as packed occlusion/roughness/
metalness (Falcor-era scenes such as Bistro); the source's own \`.meta\` setting
is used when the flag is absent. DDS images are converted to PNG on the way in.
--lightmap-uv gives every mesh a lightmap UV set (Generate Lightmap UVs in the
editor), unwrapping one where the source's second set is too sparse to bake into.
--lods <n> writes n cheaper levels of every mesh (about 50%, 20% and 7% of its
triangles) as <mesh>_lod<n>.esmesh and a LODGroup that swaps them in (Generate
LODs in the editor); skinned and morphing meshes keep one level.

import-cocos takes a Cocos Creator 3.x project into an Estella project without touching
it: the source is only read, and an output folder inside it is refused. Prefabs and scenes
become \`.esprefab\` / \`.esscene\` under assets/<into> (default cocos), keeping the source's
folder layout; a prefab instance stays a nested prefab whose changes are overrides. Only the
textures and fonts the converted documents use are copied. Components with a counterpart
(Node, Sprite, Label, RichText, Camera) are mapped; every other component is kept verbatim
under the entity's metadata.cocos and counted. assets/<into>/import-report.json says what
was mapped, approximated and left out, and --dry-run writes nothing but still prints it.
--only restricts the documents converted to those under the given assets/ subpath(s).

import-hdr bakes an equirectangular panorama into the two things a renderer asks
an environment for: nine irradiance coefficients (in the \`.esenv\`) and one
prefiltered octahedral atlas beside it, which the document names as a sibling.
The panorama itself is not shipped — a light references the \`.esenv\`.`;

/** Options take a value; these do not — without the distinction a trailing flag
 *  swallows nothing, ends the loop, and a CI job silently gets no gate. */
const FLAGS = new Set(['enforce-budget', 'minify', 'no-aot', 'emulator-abi']);

function parseArgs(argv) {
  const [command, projectDir, ...rest] = argv;
  if (command === '--help' || command === '-h' || command === 'help') {
    console.log(USAGE);
    process.exit(0);
  }
  if (command === 'templates') return { command };
  // Optional third-party tools (a project switches them on in project.esproject `tools`; nothing here
  // fetches one the project did not ask for, and `install` shows what it would download and asks first).
  if (command === 'tools') {
    const sub = projectDir;
    const flags = rest.filter((a) => a.startsWith('--'));
    const base = rest.indexOf('--base');
    const id = rest.find((a, i) => !a.startsWith('--') && !(base >= 0 && i === base + 1));
    if (!['status', 'install', 'remove'].includes(sub) || (sub !== 'status' && !id)) {
      console.error('usage: tools status [--json] | tools install <tool> [--yes] [--base <dir|url>] | tools remove <tool>');
      process.exit(2);
    }
    return { command, sub, id, yes: flags.includes('--yes'), json: flags.includes('--json'), base: base >= 0 ? rest[base + 1] : undefined };
  }
  if (command === 'luban' || command === 'proto') {
    if (!['gen', 'check'].includes(projectDir) || !rest[0]) {
      console.error(`usage: ${command} gen|check <projectDir>`);
      process.exit(2);
    }
    return { command, sub: projectDir, projectDir: path.resolve(rest[0]) };
  }
  if (command === 'create') {
    const named = rest.indexOf('--name');
    if (!projectDir || !rest[0] || rest[0].startsWith('--')) {
      console.error('create requires a template and a folder: node pipeline/bin/estella.mjs create <template> <dir> [--name <project name>]');
      process.exit(2);
    }
    return { command, template: projectDir, dest: path.resolve(rest[0]), name: named >= 0 ? rest[named + 1] : undefined };
  }
  if (command === 'bake-scene') {
    if (!projectDir) {
      console.error(USAGE);
      process.exit(2);
    }
    return { command, source: path.resolve(projectDir), check: rest.includes('--check') };
  }
  if (command === 'package-openpaas') {
    const config = rest.indexOf('--config'), out = rest.indexOf('--out');
    if (!projectDir || config < 0 || !rest[config + 1] || out < 0 || !rest[out + 1]) {
      console.error('package-openpaas requires an exported directory, --config <local.json> and --out <game.sp>');
      process.exit(2);
    }
    return { command, source: path.resolve(projectDir), config: path.resolve(rest[config + 1]), out: path.resolve(rest[out + 1]) };
  }
  if (command === 'import-cocos') {
    const target = rest.find((a, i) => !a.startsWith('--') && rest[i - 1] !== '--only' && rest[i - 1] !== '--into');
    if (!projectDir || !target) {
      console.error(USAGE);
      process.exit(2);
    }
    const only = [];
    for (let i = 0; i < rest.length; i++) if (rest[i] === '--only' && rest[i + 1]) only.push(rest[i + 1].replace(/^\/+/, ''));
    const into = rest.indexOf('--into');
    return {
      command, source: path.resolve(projectDir), out: path.resolve(target), only,
      into: into >= 0 ? rest[into + 1] : undefined, dryRun: rest.includes('--dry-run'),
    };
  }
  if (command === 'import-model' || command === 'import-gltf' || command === 'import-hdr') {
    if (!projectDir) {
      console.error(USAGE);
      process.exit(2);
    }
    const flag = rest.indexOf('--project');
    const scale = rest.indexOf('--scale');
    const faceSize = rest.indexOf('--face-size');
    const specular = rest.indexOf('--specular-map');
    const lightmapUV = rest.includes('--lightmap-uv');
    const lods = rest.indexOf('--lods');
    const out = rest[0] && !rest[0].startsWith('--') ? path.resolve(rest[0]) : null;
    return {
      command, out, source: path.resolve(projectDir),
      project: flag >= 0 && rest[flag + 1] ? path.resolve(rest[flag + 1]) : null,
      scale: scale >= 0 ? Number(rest[scale + 1]) || 1 : 1,
      faceSize: faceSize >= 0 ? Number(rest[faceSize + 1]) || undefined : undefined,
      specularMap: specular >= 0 ? rest[specular + 1] : undefined,
      lightmapUV,
      lodLevels: lods >= 0 ? Number(rest[lods + 1]) : undefined,
    };
  }
  if (command !== 'export' || !projectDir) {
    console.error(USAGE);
    process.exit(2);
  }
  const opts = { projectDir: path.resolve(projectDir) };
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
// Match the Transform component's float32 fields before composing a world pose.
const bakeWorldVec = (v, fallback) => Object.fromEntries(
  Object.entries(bakeVec(v, fallback)).map(([key, value]) => [key, Math.fround(value)]));

/** Column-major 4x4 from a document's Transform, through the SDK's own compose.
 *  Flat scenes only — see bakeScene. */
function bakeTransformOf(baker, entity) {
  const tf = bakeComponent(entity, 'Transform')?.data ?? {};
  return baker.composeTRS(bakeWorldVec(tf.position, BAKE_ZERO),
                          bakeWorldVec(tf.rotation, BAKE_IDENTITY_Q),
                          bakeWorldVec(tf.scale, BAKE_ONE));
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
  const instances = (scene.entities ?? []).filter((e) => typeof e.prefab === 'string');
  if (instances.length > 0) {
    console.error(`bake-scene: ${rel} has ${instances.length} prefab instance(s), whose contents`
      + ' only the editor expands — bake it there instead.');
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
  // The frame lights with the colour linearized in a linear project; so must the bake.
  let linearColor = false;
  try {
    const manifest = JSON.parse(readFileSync(path.join(projectRoot, 'project.esproject'), 'utf8'));
    linearColor = manifest.features?.rendering?.colorSpace === 'linear';
  } catch { /* no project: the gamma pipeline, as the runtime defaults to */ }
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
  // The sky a capture sees and the format its atlas adopts: the frame's environment,
  // which `sceneEnvironment` answers for every door that needs it (see below).
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
      const p = bakeWorldVec(tf.position, BAKE_ZERO);
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
        const materialRef = typeof mesh.data?.material === 'string' ? mesh.data.material : '';
        const materialFile = resolveRef(materialRef);
        const transform = bakeTransformOf(baker, entity);
        const holdsStill = baker.bakeHoldsStill({
          characterController: !!bakeComponent(entity, 'CharacterController3D'),
          bodyType: body ? (body.data?.bodyType ?? 2) : undefined,
        });
        const albedo = c ? [c.r ?? 1, c.g ?? 1, c.b ?? 1] : undefined;
        surfaces.push({
          entity: entity.id, label: entity.name ?? String(entity.id),
          meshFile: file, builtinRef: builtin, transform,
          baseColor: albedo, holdsStill, realtimeDirect: mesh.data?.lit === true,
          twoSided: mesh.data?.cullBackfaces === false,
          material: materialFile && existsSync(materialFile) ? materialFile : undefined,
          baseColorTexture: textureFile && existsSync(textureFile) ? textureFile : undefined,
        });
        fingerprintSurfaces.push({ mesh: ref, transform, albedo, texture: textureRef, holdsStill,
                                   realtimeDirect: mesh.data?.lit === true,
                                   twoSided: mesh.data?.cullBackfaces === false,
                                   material: materialRef || undefined });
      }
    }
    const reflection = bakeComponent(entity, 'ReflectionProbe');
    if (reflection && reflection.data?.enabled !== false) {
      const p = bakeWorldVec(tf.position, BAKE_ZERO);
      reflectionProbes.push({ entity: entity.id, label: entity.name ?? String(entity.id),
                              center: [p.x, p.y, p.z] });
    }
    if (light) {
      const p = bakeWorldVec(tf.position, BAKE_ZERO);
      const made = baker.bakeLightOf(light.data, [p.x, p.y, p.z],
                                     bakeWorldVec(tf.rotation, BAKE_IDENTITY_Q), linearColor);
      if (made?.lamp) lights.push(made.lamp);
      else if (made?.ambient) {
        ambient[0] += made.ambient[0];
        ambient[1] += made.ambient[1];
        ambient[2] += made.ambient[2];
      }
    }
  }

  // The same rule the frame and the editor's collector apply, read once from the
  // document rather than re-derived per light.
  const chosen = baker.sceneEnvironment(baker.sceneAmbientLights(scene.entities ?? [], (ref) => {
    const file = resolveRef(ref);
    return !!file && existsSync(file);
  })).effective;
  if (chosen?.environment) {
    environment = readEnvironment(chosen.environment);
    if (environment) environment.rotation = chosen.rotation;
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
  const kernel = await baker.BakeKernelExecutor.load();
  let result;
  try {
    result = await baker.bakeSceneLightmapParallel({
      surfaces, lights, probeVolumes: volumes, reflectionProbes, environment,
      options: { ...options, ambient },
    }, kernel);
  } finally {
    await kernel.close();
  }
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
    // The atlas's import settings are the bake's too: an atlas decoded as sRGB, or
    // block-compressed, draws other light than the one that was baked.
    let staleSettings = false;
    if (existsSync(`${atlasFile}.meta`)) {
      const importer = JSON.parse(readFileSync(`${atlasFile}.meta`, 'utf8')).importer ?? {};
      staleSettings = JSON.stringify(baker.claimedLightmapImporter(importer, result.size)) !== JSON.stringify(importer);
    }
    const readText = (file) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    const staleScene = readText(sceneFile) !== document;
    const staleGrids = [...grids.values()].some((g) => {
      const file = path.join(sceneDir, g.name);
      return !existsSync(file) || readText(file) !== g.text;
    });
    const staleReflections = reflectionText != null && (
      !existsSync(reflectionFile)
      || Buffer.compare(readFileSync(reflectionFile),
                        Buffer.from(result.reflection.atlasBytes)) !== 0
      || !existsSync(reflectionDocFile)
      || readText(reflectionDocFile) !== reflectionText);
    if (staleAtlas || staleSettings || staleScene || staleGrids || staleReflections) {
      const what = [staleAtlas && 'the atlas', staleSettings && "the atlas's import settings", staleScene && 'the scene',
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
  await baker.claimLightmapImage(atlasFile, result.size);
  for (const g of grids.values()) writeFileSync(path.join(sceneDir, g.name), g.text);
  if (reflectionText) {
    writeFileSync(reflectionFile, result.reflection.atlasBytes);
    writeFileSync(reflectionDocFile, reflectionText);
    // An RGBM encoding of radiance, the three settings an HDR import gives its own
    // atlas. Adopted here because this bake IS this file's importer, and a default
    // meta would linearize the multiplier and then compress it.
    await meta.adoptOrphan(reflectionFile, { sRGB: false, compress: 'off', wrapMode: 'clamp' });
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
  const { outfile, cleanup } = await bundlePipeline(entry, outName);
  try {
    return { mod: await import(fileUrl(outfile)), cleanup };
  } catch (err) {
    cleanup();
    throw err;
  }
}

/** A pipeline module bundled to a runnable file, for a worker thread to start from. */
async function bundlePipeline(entry, outName) {
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
      '../../../build-tools/basis/encoder.mjs', '../../../build-tools/ufbx/reader.mjs',
      '../../../build-tools/lightmap/kernel.mjs'],
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
  return { outfile, cleanup };
}

const PROJECT_FILES = ['project.esproject', 'project.esproj', 'project.json'];

/** The project directory a path sits in, walking up; null when it is outside one. */
/** The flag, else the source's own `.meta` import setting, else the plain reading. */
function specularMapFor(opts) {
  if (opts.specularMap) {
    if (opts.specularMap !== 'color' && opts.specularMap !== 'orm') {
      console.error(`--specular-map must be color or orm, not "${opts.specularMap}"`);
      process.exit(2);
    }
    return opts.specularMap;
  }
  try {
    return JSON.parse(readFileSync(`${opts.source}.meta`, 'utf8')).importer?.specularMap === 'orm' ? 'orm' : 'color';
  } catch {
    return 'color';
  }
}

/** The flag, else the source's own `.meta` import setting — the editor's door reads the same one. */
function lightmapUVFor(opts) {
  if (opts.lightmapUV) return true;
  try {
    return JSON.parse(readFileSync(`${opts.source}.meta`, 'utf8')).importer?.lightmapUV === true;
  } catch {
    return false;
  }
}

/** The flag, else the source's own `.meta` import settings: [levels, minimum triangles]. */
function lodSettingsFor(opts) {
  let importerMeta = {};
  try {
    importerMeta = JSON.parse(readFileSync(`${opts.source}.meta`, 'utf8')).importer ?? {};
  } catch { /* no meta: the schema's defaults */ }
  const levels = Number.isFinite(opts.lodLevels) ? opts.lodLevels : importerMeta.lodLevels;
  const min = importerMeta.lodMinTriangles;
  return {
    levels: typeof levels === 'number' ? Math.min(3, Math.max(0, Math.floor(levels))) : 0,
    minTriangles: typeof min === 'number' && min >= 0 ? min : 256,
  };
}

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
  const build = fmt.engineBuildFor(platform);
  const dirs = build === 'quickgame'
    ? [path.join(REPO, 'build', 'wasm', 'quickgame'), path.join(REPO, 'desktop', 'public', 'wasm-quickgame')]
    : build === 'minigame'
      ? [path.join(REPO, 'build', 'wasm', 'wechat'), path.join(REPO, 'desktop', 'public', 'wasm-wechat')]
      : [path.join(REPO, 'build', 'wasm', 'web'), path.join(REPO, 'desktop', 'public', 'wasm')];
  return firstExisting(dirs) ?? dirs[dirs.length - 1];
}

const opts = parseArgs(process.argv.slice(2));

// The editor's New Project gallery and these two are one implementation (src/project/scaffold.ts): the same templates, the same files.
if (opts.command === 'templates' || opts.command === 'create') {
  const { mod, cleanup } = await loadPipeline(path.join(PIPELINE, 'src/project/scaffold.ts'), 'scaffold.mjs');
  try {
    const roots = [{ root: path.join(REPO, 'templates'), kind: 'starter' }, { root: path.join(REPO, 'examples'), kind: 'example' }];
    const found = await mod.listTemplates(roots);
    if (opts.command === 'templates') {
      const width = Math.max(...found.map((t) => path.basename(t.dir).length));
      for (const t of found) console.log(`${path.basename(t.dir).padEnd(width)}  ${t.kind.padEnd(7)}  ${t.description ?? t.name}`);
    } else {
      const template = found.find((t) => path.basename(t.dir) === opts.template);
      if (!template) throw new Error(`no template "${opts.template}"; \`templates\` lists them`);
      const root = await mod.createFromTemplate(template.dir, path.dirname(opts.dest), path.basename(opts.dest), opts.name ?? path.basename(opts.dest));
      console.log(`created ${path.relative(process.cwd(), root) || root} from ${opts.template}`);
      console.log('Open it in the Estella editor once (it stages the SDK types the project\'s tsconfig points at), or export it with:');
      console.log(`  node pipeline/bin/estella.mjs export ${path.relative(process.cwd(), root) || root}`);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally { cleanup(); }
  process.exit(process.exitCode ?? 0);
}

if (opts.command === 'tools' || opts.command === 'luban' || opts.command === 'proto') {
  const { mod, cleanup } = await loadPipeline(path.join(PIPELINE, 'src', 'tools', 'toolsCli.ts'), 'toolsCli.mjs');
  let code = 1;
  try {
    if (opts.command === 'luban') code = await mod.lubanCommand(opts.sub, opts.projectDir);
    else if (opts.command === 'proto') code = await mod.protoCommand(opts.sub, opts.projectDir);
    else if (opts.sub === 'status') code = mod.toolsStatus({ json: opts.json });
    else if (opts.sub === 'install') code = await mod.toolsInstall(opts.id, { yes: opts.yes, base: opts.base });
    else code = mod.toolsRemove(opts.id);
  } catch (error) {
    console.error(error.message);
  } finally { cleanup(); }
  process.exit(code);
}

if (opts.command === 'package-openpaas') {
  const { mod, cleanup } = await loadPipeline(path.join(PIPELINE, 'src/export/openpaasPackage.ts'), 'openpaasPackage.mjs');
  try {
    console.log(JSON.stringify(await mod.packageOpenPaaS(opts.source, opts.out, opts.config), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally { cleanup(); }
  // No export, login or upload follows packaging.
  process.exit(process.exitCode ?? 0);
}

if (opts.command === 'import-cocos') {
  const { mod, cleanup } = await loadPipeline(path.join(PIPELINE, 'src', 'import', 'cocos', 'index.ts'), 'cocosImport.mjs');
  try {
    const report = await mod.importCocosProject({
      source: opts.source, out: opts.out, only: opts.only, dryRun: opts.dryRun, ...(opts.into ? { into: opts.into } : {}),
    });
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.documents.failed.length ? 1 : 0;
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  } finally { cleanup(); }
  process.exit(process.exitCode ?? 0);
}

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
    let characters = false;
    let springBones = false;
    try {
      const importerMeta = JSON.parse(readFileSync(`${opts.source}.meta`, 'utf8')).importer;
      characters = importerMeta?.characterMaterials === 'auto';
      springBones = importerMeta?.springBones === 'auto';
    } catch { /* no meta: the schema's default */ }
    const refs = root
      ? { prefix: projectRef(dir) ? `${projectRef(dir)}/` : '',
          external: (uri) => projectRef(path.resolve(sourceDir, uri)), characters, springBones }
      : { characters, springBones };

    const { meshes, textures, nodes, animations, warnings } = await reader.readModelSource(
      new Uint8Array(readFileSync(opts.source)), stem,
      {
        filename: opts.source,
        externalBuffers: (uri) => {
          const abs = path.join(sourceDir, uri);
          return existsSync(abs) ? new Uint8Array(readFileSync(abs)) : null;
        },
        specularMap: specularMapFor(opts),
      },
    );
    if (lightmapUVFor(opts)) warnings.push(...importer.applyLightmapUV(meshes));
    warnings.push(...await importer.generateLods(meshes, lodSettingsFor(opts)));
    if (characters) importer.orderHairTriangles(meshes);
    for (const w of warnings) console.warn(`  ! ${w}`);
    if (!root && meshes.length > 0) {
      console.warn('  ! no project found above the source — refs are bare file names'
        + ' (pass --project <dir>)');
    }
    const report = (file, what) =>
      console.log(`${path.relative(process.cwd(), file)}: ${what}`);
    // Settings the source asked for, by product name; only ever the FIRST mint.
    const settings = new Map();
    const externalImages = new Set();
    for (const [file, { external, settings: asked }] of importer.importedImageSettings(meshes)) {
      settings.set(external ? path.resolve(sourceDir, file) : file, asked);
      if (external) externalImages.add(path.resolve(sourceDir, file));
    }
    const adopt = (file) => meta.adoptOrphan(file, settings.get(file) ?? settings.get(path.basename(file)));

    // An image the source names on disk is referenced where it lies, so it has to
    // be an asset too: an export resolves refs through the registry, and a file
    // with no sidecar is one it does not ship.
    for (const file of externalImages) {
      if (!existsSync(file)) {
        console.warn(`  ! ${path.relative(process.cwd(), file)} is referenced by the model and does not exist`);
        continue;
      }
      if ((await adopt(file)) === 'adopted') report(file, 'registered');
    }

    for (const mesh of meshes) {
      const outFile = path.join(dir, `${mesh.name}.esmesh`);
      writeFileSync(outFile, importer.encodeImportedMesh(mesh));
      await adopt(outFile);
      report(outFile, `${mesh.vertexCount} vertices, ${mesh.triangleCount} triangles`);
      for (const [i, lod] of (mesh.lods ?? []).entries()) {
        const lodFile = path.join(dir, `${importer.lodName(mesh, i + 1)}.esmesh`);
        writeFileSync(lodFile, importer.encodeGeneratedLod(lod));
        await adopt(lodFile);
        report(lodFile, `LOD ${i + 1}: ${lod.triangleCount} triangles`);
      }
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
    await meta.adoptOrphan(atlasFile, { ...importer.ENV_IMAGE_SETTINGS });
    report(atlasFile, `${result.document.mipCount} prefiltered mips`);
    if (result.sky) {
      const skyFile = path.join(dir, result.sky.name);
      writeFileSync(skyFile, result.sky.bytes);
      await meta.adoptOrphan(skyFile, { ...importer.ENV_IMAGE_SETTINGS });
      result.document.sky = result.sky.name;
      report(skyFile, 'the sky, at the panorama\'s resolution');
    }

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
// A profile names its target, so `--profile` alone is enough; the parser that
// applies it refuses one that disagrees with an explicit --platform.
const platform = opts.platform ?? project.packaging?.profiles?.[opts.profile]?.platform ?? 'web';

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
const { parseManifest, ignoredManifestKeys } = fmt;
// PARSED, not read by hand: the parser normalizes legacy platform ids and drops
// values that could not be judged against. A setting read straight off the JSON
// here is a second answer to what a project means.
const manifest = parseManifest(project);
for (const { key, under } of ignoredManifestKeys(project)) {
  console.warn(under
    ? `  ! project.esproject: "${key}" belongs under "${under}" — ignored where it is`
    : `  ! project.esproject: "${key}" is not a project setting — ignored`);
}

// A project that has Luban or Protobuf switched on is packaged from generated files that are up to date, or not at
// all. One that has them off is not touched, and nothing is looked for or downloaded.
if (project.tools?.luban?.enabled === true || project.tools?.protobuf?.enabled === true) {
  const { mod: toolsCli, cleanup: cleanupTools } = await loadPipeline(path.join(PIPELINE, 'src', 'tools', 'toolsCli.ts'), 'toolsCli.mjs');
  try {
    const stop = await toolsCli.prepareProjectTools(opts.projectDir);
    if (stop) {
      console.error(stop);
      process.exit(1);
    }
  } finally { cleanupTools(); }
}

const { mod: exporter, cleanup: cleanupExport } = await loadPipeline(
  path.join(PIPELINE, 'src', 'export', 'exportGame.ts'), 'exportGame.mjs');
const { mod: projectOpts, cleanup: cleanupProjectOpts } = await loadPipeline(
  path.join(PIPELINE, 'src', 'export', 'projectExportOptions.ts'), 'projectExportOptions.mjs');

// A platform the project defines in .esengine/platforms/, loaded the way the
// build dialog loads it, so a headless package is the one the dialog makes.
let projectPlatform = null;
if (!fmt.BUILTIN_PLATFORMS.includes(platform)) {
  const { mod: catalog, cleanup: cleanupCatalog } = await loadPipeline(
    path.join(PIPELINE, 'src', 'export', 'platformCatalog.ts'), 'platformCatalog.mjs');
  try {
    projectPlatform = await catalog.loadProjectPlatform(opts.projectDir, platform,
      { web: engineRuntimeDir('web'), minigame: engineRuntimeDir('wechat'), quickgame: engineRuntimeDir('quickgame') });
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
    ...await projectOpts.projectExportOptions(opts.projectDir, manifest, platform, opts.profile,
      { androidKeyPassphrase: process.env.ESTELLA_ANDROID_KEY_PASSPHRASE }),
    entryScene,
    ...(opts.scripts ? { scriptsEntry: opts.scripts } : {}),
    ...(opts.title ? { title: opts.title } : {}),
    hostsDir: path.join(PIPELINE, 'src', 'runtime'),
    packagesDir: path.join(REPO, 'plugins'),
    sdkDistDir: path.join(REPO, 'sdk', 'dist'),
    wasmDir: opts.wasm ? path.resolve(opts.wasm) : projectPlatform?.wasmDir ?? engineRuntimeDir(platform),
    miniGameProfile: projectPlatform?.profile,
    outDir,
    androidTemplate: platform === 'android' ? templateDir : null,
    desktopTemplates,
    ...(opts['steam-appid'] ? { desktopChannel: 'steam' } : {}),
    ...((opts['steam-appid'] || opts['steam-sdk']) ? {
      steam: {
        ...manifest.packaging?.platforms?.desktop?.steam,
        ...(opts['steam-appid'] ? { appId: Number(opts['steam-appid']) } : {}),
        ...(opts['steam-sdk'] ? { sdkPath: opts['steam-sdk'] } : {}),
      },
    } : {}),
    iosSources: platform === 'ios' && templateDir ? iosTemplateSources(templateDir) : null,
    ...(opts.output === 'project' ? { androidOutput: 'project' } : {}),
    ...(opts['emulator-abi'] ? { androidEmulatorAbi: true } : {}),
    ...(opts.minify ? { minify: true } : {}),
    ...(opts['debug-channel'] ? { debugChannel: { url: opts['debug-channel'] } } : {}),
    // `dev` is what the AOT step calls "do not compile" — the editor's preview
    // mode, reused here so there is one word for it (docs/REARCH_AOT.md §9).
    ...(opts['no-aot'] ? { aotMode: 'dev' } : {}),
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
  cleanupProjectOpts();
  cleanupFmt();
}
process.exit(code);
