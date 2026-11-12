// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  build.mjs — writes the Generated World project's assets and scene.
 *
 * The ground textures, the pine and its colour strip are the Wilds example's (made there from numbers); the rock, the rules and the
 * scene are made here. The world itself is not in the scene: the scene names the rules (assets/worlds/wilds.esworld) and the zones,
 * and the engine lays the world out from them as the camera goes. Run it after changing a number:
 *
 *   node examples/worldgen/tools/build.mjs
 *
 * It needs the SDK built (`node build-tools/cli.js sdk`), for the mesh format and the terrain's own noise.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..');
const WILDS = path.resolve(PROJECT, '../wilds');
const { MeshChannel, MeshChannelType, packChannels, encodeMesh, NoiseSource } =
  await import(new URL('../../../sdk/dist/index.node.js', import.meta.url).href);

/** The ground, in one table: the scene's units are the Wilds', a pine about ninety of them tall. */
const GROUND = {
  seed: 4, frequency: 3, octaves: 5, persistence: 0.5, ridged: 0.3, warp: 0.35, erosion: 1, sizeX: 4200, height: 520,
  rockSlope: 0.34, dirtHeight: 0.55, snowHeight: 0.86,
};

function write(rel, data) {
  const file = path.join(PROJECT, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, data);
}

/** The `.meta` an asset carries once the editor has seen it: a stable name for the file, kept when it has one already. */
function meta(rel, type, importer = {}) {
  const file = path.join(PROJECT, `${rel}.meta`);
  const uuid = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).uuid : randomUUID();
  write(`${rel}.meta`, `${JSON.stringify({ uuid, version: '2.0', type, importer }, null, 2)}\n`);
}

/** One of the Wilds' assets, with its import settings. */
function borrow(rel) {
  mkdirSync(path.dirname(path.join(PROJECT, rel)), { recursive: true });
  copyFileSync(path.join(WILDS, rel), path.join(PROJECT, rel));
  copyFileSync(path.join(WILDS, `${rel}.meta`), path.join(PROJECT, `${rel}.meta`));
}

/** Positions, uvs and normals as an .esmesh, its colour white. */
function mesh(rel, pos, uv, nrm, idx) {
  const { channels, vertexStride } = packChannels([
    { semantic: MeshChannel.Position, components: 3, type: MeshChannelType.Float32 },
    { semantic: MeshChannel.TexCoord0, components: 2, type: MeshChannelType.Float32 },
    { semantic: MeshChannel.Color, components: 4, type: MeshChannelType.UNorm8 },
    { semantic: MeshChannel.Normal, components: 3, type: MeshChannelType.Float32 },
  ]);
  const count = pos.length / 3;
  const vertices = new Uint8Array(count * vertexStride);
  const view = new DataView(vertices.buffer);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < count; i++) {
    const at = i * vertexStride;
    for (let k = 0; k < 3; k++) {
      view.setFloat32(at + channels[0].offset + k * 4, pos[i * 3 + k], true);
      view.setFloat32(at + channels[3].offset + k * 4, nrm[i * 3 + k], true);
      min[k] = Math.min(min[k], pos[i * 3 + k]);
      max[k] = Math.max(max[k], pos[i * 3 + k]);
    }
    view.setFloat32(at + channels[1].offset, uv[i * 2], true);
    view.setFloat32(at + channels[1].offset + 4, uv[i * 2 + 1], true);
    view.setUint32(at + channels[2].offset, 0xffffffff, true);
  }
  write(rel, Buffer.from(encodeMesh({ channels, vertexStride, vertexCount: count, vertices, indices: new Uint32Array(idx), aabbMin: min, aabbMax: max })));
  meta(rel, 'mesh');
}

/** A rock: a sphere of faceted, flat-shaded faces pushed in and out, squat, about ten units across, its foot a little below the ground. */
function rock() {
  const STACKS = 6, SLICES = 9;
  const bump = (i, j) => 0.75 + 0.5 * (((Math.sin(i * 12.9898 + j * 78.233) * 43758.5453) % 1 + 1) % 1);
  const point = (i, j) => {
    const v = i / STACKS, a = ((j % SLICES) / SLICES) * Math.PI * 2, phi = v * Math.PI;
    const r = 5 * (i === 0 || i === STACKS ? 1 : bump(i, j % SLICES));
    return [Math.sin(phi) * Math.cos(a) * r, Math.cos(phi) * r * 0.62 + 1.2, Math.sin(phi) * Math.sin(a) * r];
  };
  const pos = [], uv = [], nrm = [], idx = [];
  const face = (a, b, c) => {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const len = Math.hypot(...n) || 1;
    for (const p of [a, b, c]) {
      pos.push(...p);
      uv.push(0.5, Math.min(Math.max((p[1] + 2) / 6, 0), 1));
      nrm.push(n[0] / len, n[1] / len, n[2] / len);
      idx.push(pos.length / 3 - 1);
    }
  };
  for (let i = 0; i < STACKS; i++) for (let j = 0; j < SLICES; j++) {
    const a = point(i, j), b = point(i, j + 1), c = point(i + 1, j), d = point(i + 1, j + 1);
    // Outward from above: down the stack, then round.
    face(a, b, c);
    face(b, d, c);
  }
  mesh('assets/models/rock.esmesh', pos, uv, nrm, idx);
}

function material(name, shader, properties) {
  write(`assets/materials/${name}.esmaterial`, `${JSON.stringify({ version: '1.0', type: 'material', shader, blendMode: 0, depthTest: true, depthWrite: true, cull: 0, properties }, null, 2)}\n`);
  meta(`assets/materials/${name}.esmaterial`, 'material');
}

function materials() {
  material('terrain', 'builtin:terrain', {
    u_layer0: 'assets/textures/grass.png', u_layer1: 'assets/textures/dirt.png', u_layer2: 'assets/textures/snow.png', u_layer3: 'assets/textures/rock.png',
    u_tint0: { r: 1, g: 1, b: 1, a: 1 }, u_tint1: { r: 1, g: 1, b: 1, a: 1 }, u_tint2: { r: 1, g: 1, b: 1, a: 1 }, u_tint3: { r: 1, g: 1, b: 1, a: 1 },
    u_tile0: 60, u_tile1: 70, u_tile2: 90, u_tile3: 120, u_macroVariation: 0.5, u_sharpness: 2.2, u_roughness: 0.93,
  });
  material('grass', 'builtin:foliage', {
    u_baseColor: { r: 0.1, g: 0.22, b: 0.05, a: 1 }, u_tipColor: { r: 0.5, g: 0.66, b: 0.2, a: 1 },
    u_windStrength: 3, u_windSpeed: 1.3, u_windDirection: 30, u_gustScale: 0.012, u_flutter: 0.35, u_translucency: 0.5,
  });
  material('pine', 'builtin:foliage', {
    u_albedo: 'assets/textures/pine.png', u_useTexture: 1, u_baseColor: { r: 1, g: 1, b: 1, a: 1 }, u_tipColor: { r: 1, g: 1, b: 1, a: 1 },
    u_windStrength: 0.9, u_windSpeed: 0.9, u_windDirection: 30, u_gustScale: 0.006, u_flutter: 0.1, u_translucency: 0.15, u_roughness: 0.9,
  });
  // Stone and ore stand still: the Foliage shader with no wind, its colour from the foot of the rock to its top.
  material('stone', 'builtin:foliage', {
    u_baseColor: { r: 0.26, g: 0.25, b: 0.23, a: 1 }, u_tipColor: { r: 0.52, g: 0.5, b: 0.46, a: 1 },
    u_windStrength: 0, u_flutter: 0, u_translucency: 0, u_roughness: 0.95,
  });
  material('copper', 'builtin:foliage', {
    u_baseColor: { r: 0.32, g: 0.16, b: 0.08, a: 1 }, u_tipColor: { r: 0.85, g: 0.48, b: 0.22, a: 1 },
    u_windStrength: 0, u_flutter: 0, u_translucency: 0, u_roughness: 0.55,
  });
}

// ── the rules ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

const PINE = 'assets/models/pine.esmesh', ROCK = 'assets/models/rock.esmesh';
/** A pine far off: a tent of cards showing the tree's part of its colour strip. */
const PINE_FAR = { u0: 0.2, v0: 0.22, u1: 0.8, v1: 0.95, tent: true };

/**
 * Three biomes by the fields (moisture, rock, how steep), each with its recipes: groves of pines with saplings round a tall one in
 * the forest, a scatter of single pines on the meadow's edge, rock groups where the stone comes up, and copper to mine near rock.
 */
const RULES = {
    id: 'worldgen-demo:wilds',
    versions: [1],
    biomes: [
        { id: 'forest', conditions: [{ field: 'moisture', min: 0.52, blend: 0.08 }, { field: 'up', min: 0.82, blend: 0.05 }],
            transition: 120, paint: [0.55, 0.45, 0, 0], paintStrength: 0.5,
            recipes: [{ recipe: 'grove', layer: 'groups', density: 0.75 }, { recipe: 'lone pine', layer: 'detail', density: 0.25 }] },
        { id: 'meadow', conditions: [{ field: 'moisture', max: 0.52, blend: 0.08 }, { field: 'rock', max: 0.58, blend: 0.06 }],
            transition: 120, paint: [1, 0, 0, 0], paintStrength: 0.45,
            recipes: [{ recipe: 'lone pine', layer: 'detail', density: 0.04 }, { recipe: 'stones', layer: 'detail', density: 0.03 }] },
        { id: 'rocky', conditions: [{ field: 'rock', min: 0.58, blend: 0.06 }, { field: 'moisture', max: 0.52, blend: 0.08 }],
            transition: 80, paint: [0.15, 0.35, 0, 0.5], paintStrength: 0.6,
            recipes: [{ recipe: 'outcrop', layer: 'groups', density: 0.6 }, { recipe: 'copper', layer: 'resources', density: 0.5 }] },
    ],
    recipes: [
        { id: 'grove', version: 1, tags: ['tree'],
            anchor: { id: 'elder', mesh: PINE, material: 'assets/materials/pine.esmaterial', scale: [1.4, 1.8], footprint: 10, canopy: 35, minUp: 0.82, far: PINE_FAR },
            members: [
                { id: 'pine', mesh: PINE, material: 'assets/materials/pine.esmaterial', count: [3, 6], ring: [45, 110], scale: [0.9, 1.3], footprint: 8, canopy: 25, minUp: 0.8, far: PINE_FAR },
                { id: 'sapling', mesh: PINE, material: 'assets/materials/pine.esmaterial', count: [2, 5], ring: [110, 170], scale: [0.35, 0.6], footprint: 4, minUp: 0.8, chance: 0.8, far: PINE_FAR },
                { id: 'stone', mesh: ROCK, material: 'assets/materials/stone.esmaterial', count: [0, 2], ring: [20, 60], scale: [0.8, 1.6], footprint: 6, tags: ['rock'] },
            ] },
        { id: 'lone pine', version: 1, tags: ['tree'],
            anchor: { id: 'pine', mesh: PINE, material: 'assets/materials/pine.esmaterial', scale: [0.8, 1.4], footprint: 8, minUp: 0.8, far: PINE_FAR } },
        { id: 'outcrop', version: 1, tags: ['rock'],
            anchor: { id: 'boulder', mesh: ROCK, material: 'assets/materials/stone.esmaterial', scale: [4, 6.5], footprint: 26, attach: 'align' },
            members: [
                { id: 'rock', mesh: ROCK, material: 'assets/materials/stone.esmaterial', count: [2, 4], ring: [32, 60], scale: [1.6, 3], footprint: 12, attach: 'align' },
                { id: 'scree', mesh: ROCK, material: 'assets/materials/stone.esmaterial', count: [4, 9], ring: [50, 95], scale: [0.4, 0.9], footprint: 4, attach: 'align' },
            ] },
        { id: 'stones', version: 1, tags: ['rock'],
            anchor: { id: 'stone', mesh: ROCK, material: 'assets/materials/stone.esmaterial', scale: [0.6, 1.4], footprint: 6, attach: 'align' } },
        { id: 'copper', version: 1, tags: ['ore'],
            anchor: { id: 'vein', mesh: ROCK, material: 'assets/materials/copper.esmaterial', interactive: 'copper', scale: [1.2, 1.8], footprint: 10, attach: 'align' } },
    ],
    layers: [
        { id: 'groups', spacing: 260, drawDistance: 4200, lodDistance: 1400, chunkSize: 512 },
        { id: 'resources', spacing: 220, drawDistance: 2400, chunkSize: 512 },
        { id: 'detail', spacing: 90, drawDistance: 2400, lodDistance: 1200, chunkSize: 384 },
    ],
};

/** The rules as the file the scene's WorldGen names: biomes, recipes and layers, with the meshes and materials they place by path. */
function rules() {
  write('assets/worlds/wilds.esworld', `${JSON.stringify(RULES, null, 2)}\n`);
  meta('assets/worlds/wilds.esworld', 'world-rules');
}

function scene() {
  const ground = new NoiseSource(GROUND);
  const home = { x: 0, z: 0 };
  const eye = { x: home.x + 40, z: home.z + 620 };
  const eyeY = ground.height(eye.x, eye.z) + 180;
  const pitch = -0.2;
  const entity = (id, name, components) => ({ id, name, parent: null, children: [], visible: true, components });
  const white = { r: 1, g: 1, b: 1, a: 1 };
  const post = [
    { type: 'skyAtmosphere', enabled: true, uniforms: { u_intensity: 1.05, u_haze: 1.1, u_sunBrightness: 40, u_clouds: 0.45, u_cloudShadow: 0.6, u_unitsPerKm: 1000, u_windSpeed: 0.03 } },
    { type: 'gtao', enabled: true, uniforms: { u_radius: 60, u_intensity: 1 } },
    { type: 'heightFog', enabled: true, colors: { u_fogColor: { r: 0.62, g: 0.72, b: 0.84, a: 1 }, u_sunColor: { r: 1, g: 0.86, b: 0.62, a: 1 } },
      uniforms: { u_density: 0.0001, u_heightFalloff: 0.0012, u_baseHeight: 0, u_inscatter: 0.6, u_skyFog: 0.5, u_volumetric: 0.4, u_volumeRange: 4000 } },
    { type: 'taa', enabled: true, uniforms: { u_blend: 0.1 } },
    { type: 'autoExposure', enabled: true, uniforms: { u_bias: -0.1, u_minEV: -2, u_maxEV: 2 } },
    { type: 'colorGrade', enabled: true, uniforms: { u_contrast: 1.06, u_saturation: 1.1 } },
    { type: 'fxaa', enabled: true, uniforms: { u_intensity: 1 } },
  ];
  const entities = [
    entity(0, 'Camera', [
      // WORLDGEN_TOP=1 looks straight down on the home from high up, to see how the world is laid out.
      { type: 'Transform', data: process.env.WORLDGEN_TOP
        ? { position: { x: home.x, y: 2600, z: home.z }, rotation: { x: -0.7071, y: 0, z: 0, w: 0.7071 } }
        : { position: { x: eye.x, y: eyeY, z: eye.z }, rotation: { x: Math.sin(pitch / 2), y: 0, z: 0, w: Math.cos(pitch / 2) } } },
      { type: 'Camera', data: { projectionType: 0, fov: 55, nearPlane: 2, farPlane: 20000, isActive: true, priority: 0 } },
      { type: 'PostProcessVolume', data: { isGlobal: true, priority: 0, weight: 1, effects: post } },
    ]),
    entity(1, 'Clock', [
      { type: 'Transform', data: {} },
      { type: 'TimeOfDay', data: { hour: 15.5, daySeconds: 0, latitude: 45, declination: 15, north: 0, drive: 31 } },
    ]),
    entity(2, 'Sun', [
      { type: 'Transform', data: {} },
      { type: 'Light', data: { type: 1, color: white, intensity: 3, enabled: true, meshShadows: true, shadowExtent: 2500, shadowStrength: 1, sourceAngle: 0.5 } },
    ]),
    entity(3, 'Sky', [
      { type: 'Transform', data: {} },
      { type: 'Light', data: { type: 2, color: { r: 0.8, g: 0.88, b: 1, a: 1 }, intensity: 0.55, enabled: true } },
    ]),
    entity(4, 'Ground', [
      { type: 'Transform', data: {} },
      { type: 'Terrain', data: {
        extent: 1, provider: 'estella:noise', world: 'demo', generatorVersion: 1, ...GROUND, cellSize: 4, detail: 1.4, drawDistance: 9000, collisionDistance: 64,
        material: 'assets/materials/terrain.esmaterial' } },
    ]),
    entity(5, 'World', [
      { type: 'Transform', data: {} },
      { type: 'WorldGen', data: { rules: 'assets/worlds/wilds.esworld', version: 1, world: 'demo', seed: 7, paintGround: true } },
    ]),
    // The home: a clearing kept free of everything, held to meadow, its edge thinning out over sixty units.
    entity(6, 'Home', [
      { type: 'Transform', data: { position: { x: home.x, y: 0, z: home.z } } },
      { type: 'WorldZone', data: { kind: 'home', shape: 0, radius: 130, falloff: 70, priority: 10, excludes: '*', biome: 'meadow' } },
    ]),
    // The road out of it: kept free of trees and rocks, so the ground and the grass run on along it.
    entity(7, 'Road', [
      { type: 'Transform', data: { position: { x: home.x + 520, y: 0, z: home.z - 40 }, rotation: { x: 0, y: Math.sin(0.15), z: 0, w: Math.cos(0.15) } } },
      { type: 'WorldZone', data: { kind: 'road', shape: 1, sizeX: 900, sizeZ: 36, falloff: 24, priority: 5, excludes: 'tree,rock', biome: '' } },
    ]),
    entity(9, 'Canvas', [
      { type: 'Transform', data: {} },
      { type: 'Canvas', data: { designResolution: { x: 1480, y: 920 }, scaleMode: 2 } },
      { type: 'UINode', data: {} },
    ]),
    entity(8, 'Meadow', [
      { type: 'Transform', data: { position: { x: eye.x, y: 0, z: eye.z - 300 } } },
      { type: 'Foliage', data: {
        material: 'assets/materials/grass.esmaterial', sizeX: 700, sizeZ: 700, cellSize: 35, count: 1300, seed: 3, minScale: 0.7, maxScale: 1.3, minUp: 0.8,
        heightMin: -1000, heightMax: 1000, bladeHeight: 40, bladeWidth: 4, lodDistance: 180, drawDistance: 520 } },
    ]),
  ];
  write('assets/scenes/main.esscene', `${JSON.stringify({ version: 4, name: 'Generated World', entities }, null, 1)}\n`);
  meta('assets/scenes/main.esscene', 'scene');
}

for (const name of ['grass', 'dirt', 'snow', 'rock', 'pine']) borrow(`assets/textures/${name}.png`);
borrow('assets/models/pine.esmesh');
rock();
materials();
rules();
scene();
