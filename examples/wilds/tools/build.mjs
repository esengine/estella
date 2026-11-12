// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  build.mjs — writes the Wilds project's generated assets and scene.
 *
 * Everything in the project is made here from numbers, so there is no source art to credit: four tileable ground textures, one pine tree
 * (a mesh and its colour strip), the materials, and the scene. Run it after changing a number:
 *
 *   node examples/wilds/tools/build.mjs
 *
 * It needs the SDK built (`node build-tools/cli.js sdk`), for the mesh format and the terrain's own noise.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..');
const { MeshChannel, MeshChannelType, packChannels, encodeMesh } =
  await import(new URL('../../../sdk/dist/index.node.js', import.meta.url).href);

/** The look of the place, in one table. Lengths are the scene's units: a pine is about ninety of them tall. */
const WORLD = {
  size: 3200,
  height: 560,
  resolution: 513,
  /** The lake's surface, as a share of the terrain's height, and where its middle is, as shares of the size. */
  water: 0.2,
  lake: { u: 0.5, v: 0.42 },
};

// ── files ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

function write(rel, data) {
  const file = path.join(PROJECT, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, data);
  return file;
}

/** The `.meta` an asset carries once the editor has seen it: a stable name for the file. */
function meta(rel, type, importer = {}) {
  write(`${rel}.meta`, `${JSON.stringify({ uuid: randomUUID(), version: '2.0', type, importer }, null, 2)}\n`);
}

// ── images ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

function png(width, height, pixel) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1);
    for (let x = 0; x < width; x++) {
      const p = pixel(x, y);
      for (let k = 0; k < 4; k++) raw[row + 1 + x * 4 + k] = Math.max(0, Math.min(255, Math.round(p[k])));
    }
  }
  const table = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (buf) => { let c = -1; for (const b of buf) c = table[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (type, data) => {
    const head = Buffer.alloc(8); head.writeUInt32BE(data.length, 0); head.write(type, 4);
    const tail = Buffer.alloc(4); tail.writeUInt32BE(crc(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, tail]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const hash = (x, y, s) => {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};

/** Value noise that wraps every `period` cells, so the picture tiles without a seam. */
function tiled(x, y, period, seed) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const at = (i, j) => hash(((i % period) + period) % period, ((j % period) + period) % period, seed);
  const a = at(ix, iy), b = at(ix + 1, iy), c = at(ix, iy + 1), d = at(ix + 1, iy + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function fractal(u, v, seed, octaves = 5, base = 4) {
  let sum = 0, amp = 0.5, norm = 0;
  for (let o = 0; o < octaves; o++) {
    const period = base << o;
    sum += amp * tiled(u * period, v * period, period, seed + o * 17);
    norm += amp;
    amp *= 0.5;
  }
  return sum / norm;
}

// ── the ground ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const smooth = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };

/** Value noise from lattice hashes, not tiled: the ground does not repeat. */
function noise(x, y, seed) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, seed), b = hash(ix + 1, iy, seed), c = hash(ix, iy + 1, seed), d = hash(ix + 1, iy + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function fbm(x, y, seed, octaves, ridged) {
  let sum = 0, amp = 0.5, norm = 0;
  for (let o = 0; o < octaves; o++) {
    let n = noise(x, y, seed + o * 31);
    if (ridged) n = 1 - Math.abs(n * 2 - 1);
    sum += n * amp; norm += amp; amp *= 0.5; x *= 2.07; y *= 2.07;
  }
  return sum / norm;
}

/**
 * The land, 0 to 1 over the whole square: a lake with a shore that wanders, meadows and low hills round it, and mountains that rise
 * toward the rim and close the picture on every side.
 */
function landHeight(u, v) {
  const dx = u - WORLD.lake.u, dz = v - WORLD.lake.v;
  const warp = (fbm(u * 5, v * 5, 5, 3, false) - 0.5) * 0.16;
  const r = Math.hypot(dx, dz) + warp;
  const mountains = 0.3 + 0.7 * Math.pow(fbm(u * 3.1 + 7, v * 3.1 + 3, 21, 6, true), 1.25) * 1.15;
  const meadow = 0.235 + 0.07 * fbm(u * 9, v * 9, 33, 4, false) + 0.03 * fbm(u * 2, v * 2, 40, 2, false);
  let h = meadow + (mountains - meadow) * smooth(0.34, 0.62, r);
  // The basin: it deepens toward the middle and meets the shore at the water's own height, a little above it.
  const basin = 0.045 + 0.19 * smooth(0.05, 0.27, r);
  h = basin + (h - basin) * smooth(0.22, 0.3, r);
  // Mountains close the edge of the world.
  const edge = Math.max(Math.abs(u - 0.5), Math.abs(v - 0.5)) * 2;
  const wall = smooth(0.72, 1, edge);
  const rim = 0.5 + 0.5 * fbm(u * 4 + 11, v * 4 + 5, 61, 5, true);
  return Math.min(1, Math.max(h, h + (rim - h) * wall));
}

/** The heightmap: sixteen bits across red (high) and green (low), which the Terrain reads back as one number (its format RedGreen16). */
function heightmap() {
  const n = WORLD.resolution;
  const image = png(n, n, (x, y) => {
    const value = Math.round(Math.min(1, Math.max(0, landHeight(x / (n - 1), y / (n - 1)))) * 65535);
    return [value >> 8, value & 255, 0, 255];
  });
  write('assets/textures/height.png', image);
  // A heightmap is data, read raw: it must not be colour-managed or compressed on the way in.
  meta('assets/textures/height.png', 'texture');
}

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

function texture(name, seed, shade) {
  const size = 512;
  const image = png(size, size, (x, y) => {
    const u = x / size, v = y / size;
    const rgb = shade(u, v, (s, o, b) => fractal(u, v, seed + s, o, b));
    return [rgb[0], rgb[1], rgb[2], 255];
  });
  write(`assets/textures/${name}.png`, image);
  // Tiled by world position across the whole ground: it must repeat, or every texel past the first tile is its edge stretched.
  meta(`assets/textures/${name}.png`, 'texture', { wrapMode: 'repeat' });
}

function textures() {
  texture('grass', 1, (u, v, n) => {
    const broad = n(0, 4, 3), fine = n(40, 5, 24), blade = n(80, 2, 96);
    return mix(mix([46, 72, 28], [92, 128, 46], broad), [64, 98, 34], fine * 0.6).map((c) => c * (0.78 + 0.45 * blade));
  });
  texture('dirt', 2, (u, v, n) => {
    const broad = n(0, 4, 3), fine = n(30, 5, 16);
    return mix([84, 64, 44], [128, 100, 70], broad).map((c) => c * (0.8 + 0.4 * fine));
  });
  texture('snow', 3, (u, v, n) => {
    const fine = n(0, 4, 8);
    return mix([226, 232, 242], [250, 252, 255], fine);
  });
  texture('rock', 4, (u, v, n) => {
    const broad = n(0, 4, 4), ridge = 1 - Math.abs(n(20, 5, 6) * 2 - 1), fine = n(60, 4, 32);
    return mix([70, 66, 64], [138, 130, 122], broad * 0.7 + ridge * 0.4).map((c) => c * (0.82 + 0.36 * fine));
  });
  // The tree's colour: bark at the foot, then needles that darken toward the shade under each tier.
  const strip = png(8, 128, (x, y) => {
    const v = 1 - y / 127;
    if (v < 0.2) return mix([70, 50, 34], [96, 70, 48], hash(x, y, 7))
      .concat(255);
    const t = (v - 0.2) / 0.8;
    const needles = 0.8 + 0.4 * hash(x, y, 9);
    return mix([22, 52, 30], [58, 104, 52], t).map((c) => c * needles).concat(255);
  });
  write('assets/textures/pine.png', strip);
  meta('assets/textures/pine.png', 'texture');
}

// ── the tree ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A pine: a trunk and five tiers of cone, about ninety units tall, with uv.y running up it (the strip's bark is the first fifth). */
function tree() {
  const pos = [], uv = [], nrm = [], idx = [];
  const vert = (x, y, z, nx, ny, nz, v) => { pos.push(x, y, z); uv.push(0.5, v); nrm.push(nx, ny, nz); return pos.length / 3 - 1; };
  const SIDES = 10;
  const H = 90;
  // The trunk: a tapered column up to two thirds of the height.
  const trunk = [[0, 4.2], [20, 3.4], [60, 1.8]];
  const rings = trunk.map(([y, r]) => {
    const ring = [];
    for (let k = 0; k <= SIDES; k++) {
      const a = (k / SIDES) * Math.PI * 2;
      ring.push(vert(Math.sin(a) * r, y, Math.cos(a) * r, Math.sin(a), 0.1, Math.cos(a), (y / H) * 0.19));
    }
    return ring;
  });
  for (let i = 0; i < rings.length - 1; i++) for (let k = 0; k < SIDES; k++) {
    const a = rings[i][k], b = rings[i][k + 1], c = rings[i + 1][k], d = rings[i + 1][k + 1];
    idx.push(a, c, b, b, c, d);
  }
  // The needles: each tier a cone, wide at its skirt and sharp at the top.
  const tiers = [[16, 30, 26], [30, 44, 21], [44, 58, 16.5], [58, 72, 12], [70, 90, 7.5]];
  for (const [low, high, radius] of tiers) {
    const skirt = [];
    for (let k = 0; k <= SIDES; k++) {
      const a = (k / SIDES) * Math.PI * 2;
      const slope = radius / (high - low);
      const len = Math.hypot(1, slope);
      skirt.push(vert(Math.sin(a) * radius, low, Math.cos(a) * radius, Math.sin(a) / len, slope / len, Math.cos(a) / len, 0.22 + (low / H) * 0.75));
    }
    const tip = [];
    for (let k = 0; k <= SIDES; k++) {
      const a = (k / SIDES) * Math.PI * 2;
      const slope = radius / (high - low);
      const len = Math.hypot(1, slope);
      tip.push(vert(0, high, 0, Math.sin(a) / len, slope / len, Math.cos(a) / len, 0.22 + (high / H) * 0.77));
    }
    for (let k = 0; k < SIDES; k++) idx.push(skirt[k], tip[k], skirt[k + 1]);
    // The underside, dark, so a tier has a shade under it.
    const centre = vert(0, low, 0, 0, -1, 0, 0.22);
    const under = [];
    for (let k = 0; k <= SIDES; k++) {
      const a = (k / SIDES) * Math.PI * 2;
      under.push(vert(Math.sin(a) * radius, low, Math.cos(a) * radius, 0, -1, 0, 0.22));
    }
    for (let k = 0; k < SIDES; k++) idx.push(centre, under[k], under[k + 1]);
  }
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
  const bytes = encodeMesh({ channels, vertexStride, vertexCount: count, vertices, indices: new Uint32Array(idx), aabbMin: min, aabbMax: max });
  write('assets/models/pine.esmesh', Buffer.from(bytes));
  meta('assets/models/pine.esmesh', 'mesh');
}

// ── materials ──────────────────────────────────────────────────────────────────────────────────────────────────────────

function material(name, shader, properties, extra = {}) {
  write(`assets/materials/${name}.esmaterial`, `${JSON.stringify({ version: '1.0', type: 'material', shader, blendMode: 0, depthTest: true, depthWrite: true, cull: 0, properties, ...extra }, null, 2)}\n`);
  meta(`assets/materials/${name}.esmaterial`, 'material');
}

function materials() {
  material('terrain', 'builtin:terrain', {
    u_layer0: 'assets/textures/grass.png', u_layer1: 'assets/textures/dirt.png', u_layer2: 'assets/textures/snow.png', u_layer3: 'assets/textures/rock.png',
    u_tint0: { r: 1, g: 1, b: 1, a: 1 }, u_tint1: { r: 1, g: 1, b: 1, a: 1 }, u_tint2: { r: 1, g: 1, b: 1, a: 1 }, u_tint3: { r: 1, g: 1, b: 1, a: 1 },
    u_tile0: 60, u_tile1: 70, u_tile2: 90, u_tile3: 120, u_macroVariation: 0.5, u_sharpness: 2.2, u_roughness: 0.93,
  });
  material('water', 'builtin:water', {
    u_waveLength: 220, u_waveHeight: 5, u_waveSpeed: 0.8, u_waveDirection: 25, u_rippleLength: 26, u_rippleStrength: 0.34,
    u_density: 0.009, u_foamWidth: 34, u_foamCrest: 0.35, u_distortionRange: 180, u_fallbackDepth: 120, u_roughness: 0.03,
    u_shallowColor: { r: 0.14, g: 0.46, b: 0.46, a: 1 }, u_deepColor: { r: 0.012, g: 0.07, b: 0.13, a: 1 },
  });
  material('grass', 'builtin:foliage', {
    u_baseColor: { r: 0.1, g: 0.22, b: 0.05, a: 1 }, u_tipColor: { r: 0.5, g: 0.66, b: 0.2, a: 1 },
    u_windStrength: 3, u_windSpeed: 1.3, u_windDirection: 30, u_gustScale: 0.012, u_flutter: 0.35, u_translucency: 0.5,
  });
  material('pine', 'builtin:foliage', {
    u_albedo: 'assets/textures/pine.png', u_useTexture: 1, u_baseColor: { r: 1, g: 1, b: 1, a: 1 }, u_tipColor: { r: 1, g: 1, b: 1, a: 1 },
    u_windStrength: 0.9, u_windSpeed: 0.9, u_windDirection: 30, u_gustScale: 0.006, u_flutter: 0.1, u_translucency: 0.15, u_roughness: 0.9,
  });
}

// ── the scene ──────────────────────────────────────────────────────────────────────────────────────────────────────────

function scene() {
  const waterY = WORLD.water * WORLD.height;
  const groundAt = (x, z) => landHeight(x / WORLD.size + 0.5, z / WORLD.size + 0.5) * WORLD.height;

  // The camera stands on the lake's south shore and looks north across the water to the mountains.
  const eyeZ = (WORLD.lake.v - 0.5) * WORLD.size + 0.33 * WORLD.size;
  const eye = { x: -170, z: eyeZ, y: groundAt(-170, eyeZ) };
  console.log(`wilds: water at ${waterY.toFixed(0)}, camera on the shore at (${eye.x}, ${eye.y.toFixed(0)}, ${eye.z.toFixed(0)})`);
  const yaw = 0;
  const pitch = Number(process.env.WILDS_PITCH ?? -0.04);
  const qx = { w: Math.cos(pitch / 2), x: Math.sin(pitch / 2) };
  const aim = { x: qx.x, y: 0, z: 0, w: qx.w };

  const entity = (id, name, components) => ({ id, name, parent: null, children: [], visible: true, components });
  const white = { r: 1, g: 1, b: 1, a: 1 };
  const post = [
    { type: 'skyAtmosphere', enabled: true, uniforms: { u_intensity: 1.05, u_haze: 1.1, u_sunBrightness: 40, u_clouds: 0.5, u_cloudShadow: 0.7, u_unitsPerKm: 1000, u_windSpeed: 0.03 } },
    { type: 'gtao', enabled: true, uniforms: { u_radius: 60, u_intensity: 1 } },
    { type: 'ssr', enabled: false, uniforms: { u_intensity: 0.7, u_maxDistance: 900, u_thickness: 10 } },
    { type: 'heightFog', enabled: true, colors: { u_fogColor: { r: 0.62, g: 0.72, b: 0.84, a: 1 }, u_sunColor: { r: 1, g: 0.86, b: 0.62, a: 1 } },
      uniforms: { u_density: 0.00012, u_heightFalloff: 0.0014, u_baseHeight: waterY, u_inscatter: 0.6, u_skyFog: 0.5, u_volumetric: 0.5, u_volumeRange: 4000 } },
    { type: 'lightShafts', enabled: true, uniforms: { u_intensity: 0.35 } },
    { type: 'taa', enabled: true, uniforms: { u_blend: 0.1 } },
    { type: 'autoExposure', enabled: true, uniforms: { u_bias: -0.1, u_minEV: -2, u_maxEV: 2 } },
    { type: 'colorGrade', enabled: true, uniforms: { u_contrast: 1.08, u_saturation: 1.12 } },
    { type: 'bloom', enabled: true, uniforms: { u_threshold: 0.9, u_intensity: 0.4, u_radius: 1.1 } },
    { type: 'fxaa', enabled: true, uniforms: { u_intensity: 1 } },
  ];
  const entities = [
    entity(0, 'Camera', [
      { type: 'Transform', data: { ...(process.env.WILDS_TOP ? { position: { x: 0, y: 4200, z: 0 }, rotation: { x: -0.7071, y: 0, z: 0, w: 0.7071 } } : { position: { x: eye.x, y: eye.y + 150, z: eye.z }, rotation: aim }) } },
      { type: 'Camera', data: { projectionType: 0, fov: 52, nearPlane: 2, farPlane: 20000, isActive: true, priority: 0 } },
      { type: 'PostProcessVolume', data: { isGlobal: true, priority: 0, weight: 1, effects: post } },
    ]),
    entity(1, 'Clock', [
      { type: 'Transform', data: {} },
      { type: 'TimeOfDay', data: { hour: 17, daySeconds: 0, latitude: 45, declination: 15, north: 0, drive: 31 } },
    ]),
    entity(2, 'Sun', [
      { type: 'Transform', data: {} },
      { type: 'Light', data: { type: 1, color: white, intensity: 3, enabled: true, meshShadows: true, shadowExtent: 3000, shadowStrength: 1, sourceAngle: 0.5 } },
    ]),
    entity(3, 'Sky', [
      { type: 'Transform', data: {} },
      { type: 'Light', data: { type: 2, color: { r: 0.8, g: 0.88, b: 1, a: 1 }, intensity: 0.55, enabled: true } },
    ]),
    entity(4, 'Terrain', [
      { type: 'Transform', data: {} },
      { type: 'Terrain', data: {
        sizeX: WORLD.size, sizeZ: WORLD.size, height: WORLD.height, cellSize: 4, detail: 1.4, collisionDistance: 64,
        heightmap: 'assets/textures/height.png', heightmapFormat: 1, rockSlope: 0.34, dirtHeight: 0.5, snowHeight: 0.84, material: 'assets/materials/terrain.esmaterial' } },
    ]),
    entity(5, 'Lake', [
      { type: 'Transform', data: { position: { x: 0, y: waterY, z: 0 }, scale: { x: WORLD.size / 100, y: 1, z: WORLD.size / 100 } } },
      { type: 'MeshRenderer', data: { mesh: 'builtin:plane', lit: true, opaque: false, cullBackfaces: false, material: 'assets/materials/water.esmaterial', color: white } },
    ]),
    entity(6, 'Meadow', [
      { type: 'Transform', data: { position: { x: eye.x, y: 0, z: eye.z - 260 } } },
      { type: 'Foliage', data: {
        material: 'assets/materials/grass.esmaterial', sizeX: 420, sizeZ: 420, cellSize: 30, count: 1400, seed: 3, minScale: 0.7, maxScale: 1.3, minUp: 0.8,
        heightMin: waterY + 6, heightMax: WORLD.height * 0.7, bladeHeight: 46, bladeWidth: 4.2, lodDistance: 160, drawDistance: 420 } },
    ]),
    entity(7, 'Pines', [
      { type: 'Transform', data: { position: { x: 0, y: 0, z: 0 } } },
      { type: 'Foliage', data: {
        mesh: 'assets/models/pine.esmesh', material: 'assets/materials/pine.esmaterial', sizeX: WORLD.size * 0.8, sizeZ: WORLD.size * 0.8, cellSize: 160, count: 16, seed: 8,
        minScale: 0.7, maxScale: 1.6, minUp: 0.8, heightMin: waterY + 42, heightMax: WORLD.height * 0.66, lodDistance: 650, drawDistance: 3600,
        cardU0: 0.2, cardV0: 0.22, cardU1: 0.8, cardV1: 0.95, cardTent: 1 } },
    ]),
  ];
  // For looking at one thing at a time: WILDS_DROP=Lake,Pines leaves those out.
  const drop = (process.env.WILDS_DROP ?? '').split(',');
  const kept = entities.filter((e) => !drop.includes(e.name));
  if (drop.includes('Post')) kept[0].components = kept[0].components.filter((c) => c.type !== 'PostProcessVolume');
  write('assets/scenes/main.esscene', `${JSON.stringify({ version: 4, name: 'Wilds', entities: kept }, null, 1)}\n`);
  meta('assets/scenes/main.esscene', 'scene');
}

heightmap();
textures();
tree();
materials();
scene();
