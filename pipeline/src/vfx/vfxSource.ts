// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    vfxSource.ts
 * @brief   A visual effect as a model writes one: layers of particles, a light that flickers or flashes, in metres and seconds.
 *
 * @details What a scene uses is a prefab: a root with one child per layer carrying a ParticleEmitter, and a child with a Light.
 *          A game places or spawns it like any prefab, and the Details panel edits each emitter as ever. This is the other side:
 *          a description in words a VFX artist uses (life, speed, a colour over life as stops, additive or alpha), each checked
 *          before anything is written, where a field write would take a gradient of the wrong shape and fail only when the game
 *          ran. Reading a prefab back gives the description again, so a model changes one layer and writes the effect whole.
 *
 *          A light that flickers or flashes has no component of its own: its intensity is keyed on a timeline the root plays,
 *          so the same clip the Sequencer opens is what moves it.
 */

const DEG = Math.PI / 180;

export const VFX_TEXTURES = ['glow', 'soft', 'smoke', 'spark', 'flame', 'ring'] as const;
export type VfxTexture = (typeof VFX_TEXTURES)[number];

const SHAPES: Record<string, number> = { point: 0, circle: 1, box: 2, cone: 3, sphere: 4, hemisphere: 5 };
const SHAPE_NAMES = Object.fromEntries(Object.entries(SHAPES).map(([k, v]) => [v, k])) as Record<number, string>;
const BLENDS: Record<string, number> = { alpha: 0, add: 1, multiply: 2 };
const BLEND_NAMES = Object.fromEntries(Object.entries(BLENDS).map(([k, v]) => [v, k])) as Record<number, string>;
const EASINGS: Record<string, number> = { linear: 0, in: 1, out: 2, inOut: 3 };
const EASING_NAMES = Object.fromEntries(Object.entries(EASINGS).map(([k, v]) => [v, k])) as Record<number, string>;

/** Two numbers, a low and a high a value is picked between; one number is both. */
export type Range = number | [number, number];
/** A colour as "#rrggbb" or "#rrggbbaa". */
export type Hex = string;

export interface VfxLayer {
  name: string;
  /** Where it sits in the effect, metres. */
  at?: [number, number, number];
  /** Degrees about x, y and z: a cone or hemisphere opens along the layer's +y, so [90, 0, 0] points it along +z. */
  turn?: [number, number, number];
  shape?: keyof typeof SHAPES;
  /** Circle, cone, sphere, hemisphere: metres. */
  radius?: number;
  /** Box: metres. */
  box?: [number, number, number];
  /** Cone: half-angle, degrees. */
  angle?: number;
  /** Particles a second while it emits. */
  rate?: number;
  /** [[seconds, count], ...] from when it starts: a burst is how a one-shot emits. */
  bursts?: [number, number][];
  /** Seconds it emits for; a loop repeats this. */
  duration?: number;
  loop?: boolean;
  /** Seconds before it starts. */
  delay?: number;
  /** The most alive at once. */
  max?: number;
  /** Seconds a particle lives. */
  life: Range;
  /** Metres a second it leaves at. */
  speed?: Range;
  /** Metres per second squared; a number is straight up (negative falls). */
  gravity?: number | [number, number, number];
  /** How fast it slows, per second. */
  drag?: number;
  noise?: { strength: number; frequency?: number; scroll?: number; octaves?: number };
  /** Metres across when born and when it dies: [start, end], each a number or [low, high]. */
  size: [Range, Range];
  sizeEase?: keyof typeof EASINGS;
  /** One colour, or [[t, "#rrggbbaa"], ...] over its life, t 0 to 1. Alpha 00 at both ends fades it in and out. */
  color: Hex | [number, Hex][];
  /** Degrees it is turned when born, and degrees a second it spins. */
  rotation?: Range;
  spin?: Range;
  /** One the tool draws (glow, soft, smoke, spark, flame, ring) or a picture's project path. */
  texture?: string;
  /** A sheet of frames on the texture, played over each particle. */
  flipbook?: { columns: number; rows: number; fps?: number; loop?: boolean };
  blend?: keyof typeof BLENDS;
  /** Billboard faces the camera; stretched lays it along its motion (sparks, rain). */
  render?: 'billboard' | 'stretched';
  /** Stretched: metres of length per metre a second of speed, and the quad's own length as a multiple of its size. */
  stretch?: { speed?: number; length?: number };
  /** Multiplies its colour, past 1 to bloom. */
  intensity?: number;
  /** World: what it left stays where it was when the effect moves. Local: it moves with the effect. */
  space?: 'world' | 'local';
  /** Bounce on the ground at y `floor` (metres, in the world). */
  collide?: { floor?: number; bounce?: number; friction?: number; loss?: number };
  /** Simulate on the GPU (WebGPU), for thousands. */
  gpu?: boolean;
}

export interface VfxLight {
  at?: [number, number, number];
  color: Hex;
  intensity: number;
  /** Metres it reaches. */
  radius: number;
  /** Flickers round its intensity: `amount` 0..1 of it, `speed` changes a second. */
  flicker?: { amount: number; speed?: number; seed?: number };
  /** One-shot: falls from its intensity to 0 over this many seconds after `delay`. */
  fade?: number;
  delay?: number;
}

export interface VfxSpec {
  /** World units in a metre; 1 by default. A scene built in centimetres is 100. */
  unit?: number;
  layers: VfxLayer[];
  light?: VfxLight;
}

/** One entity of the prefab: what the desktop side writes, with textures named by what it must look up. */
export interface VfxEntity {
  name: string;
  components: { type: string; data: Record<string, unknown> }[];
  /** The texture this entity's emitter names, as written: a built-in's name or a project path. */
  texture?: string;
}

export interface VfxBuild {
  root: VfxEntity;
  children: VfxEntity[];
  /** Built-in textures the layers use, to be drawn once into the project. */
  textures: VfxTexture[];
  /** The light's clip, when it flickers or fades. */
  lightClip: Record<string, unknown> | null;
  /** How long a one-shot lasts until its last particle and its light are gone, seconds; null for a loop. */
  lasts: number | null;
  /** How far from the effect's origin anything reaches, metres. */
  reach: number;
  notes: string[];
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isRange = (v: unknown): v is Range => isNum(v) || (Array.isArray(v) && v.length === 2 && v.every(isNum));
const isVec = (v: unknown): v is [number, number, number] => Array.isArray(v) && v.length === 3 && v.every(isNum);
const lo = (r: Range): number => (Array.isArray(r) ? r[0] : r);
const hi = (r: Range): number => (Array.isArray(r) ? r[1] : r);
const HEX = /^#([0-9a-f]{6}|[0-9a-f]{8})$/i;

export function hexColor(hex: string): { r: number; g: number; b: number; a: number } {
  const h = hex.slice(1);
  const at = (i: number): number => parseInt(h.slice(i, i + 2), 16) / 255;
  return { r: at(0), g: at(2), b: at(4), a: h.length === 8 ? at(6) : 1 };
}
const toHex = (c: { r: number; g: number; b: number; a: number }): string =>
  `#${[c.r, c.g, c.b, c.a].map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('')}`;

/** Every way a description is not one, as sentences; empty when it can be built. */
export function checkVfx(spec: VfxSpec): string[] {
  const out: string[] = [];
  if (!spec || typeof spec !== 'object') return ['the effect is not an object'];
  if (spec.unit !== undefined && !(spec.unit > 0)) out.push('`unit` (world units in a metre) must be above 0');
  if (!Array.isArray(spec.layers) || spec.layers.length === 0) return [...out, '`layers` lists at least one layer of particles'];
  const names = new Set<string>();
  spec.layers.forEach((l, i) => {
    const at = `layer ${i} ("${l?.name}")`;
    if (typeof l?.name !== 'string' || !l.name || l.name.includes('/')) { out.push(`layer ${i} needs a name without "/"`); return; }
    if (names.has(l.name) || l.name === 'Light') out.push(`two layers are called "${l.name}" (and "Light" is the light's)`);
    names.add(l.name);
    if (l.at !== undefined && !isVec(l.at)) out.push(`${at}: \`at\` is [x, y, z] metres`);
    if (l.turn !== undefined && !isVec(l.turn)) out.push(`${at}: \`turn\` is [x, y, z] degrees`);
    if (l.shape !== undefined && !(l.shape in SHAPES)) out.push(`${at}: \`shape\` is one of ${Object.keys(SHAPES).join(', ')}`);
    if (l.radius !== undefined && !(isNum(l.radius) && l.radius >= 0)) out.push(`${at}: \`radius\` is metres, 0 or more`);
    if (l.box !== undefined && !isVec(l.box)) out.push(`${at}: \`box\` is [x, y, z] metres`);
    if (l.angle !== undefined && !(isNum(l.angle) && l.angle >= 0 && l.angle <= 90)) out.push(`${at}: \`angle\` is the cone's half-angle, 0 to 90 degrees`);
    if (l.rate !== undefined && !(isNum(l.rate) && l.rate >= 0)) out.push(`${at}: \`rate\` is particles a second, 0 or more`);
    if (l.bursts !== undefined && !(Array.isArray(l.bursts) && l.bursts.every((b) => Array.isArray(b) && b.length === 2 && b.every(isNum) && b[0] >= 0 && b[1] >= 1))) {
      out.push(`${at}: \`bursts\` is [[seconds, count], ...], a count of 1 or more`);
    }
    if ((l.rate ?? 0) === 0 && !l.bursts?.length) out.push(`${at} emits nothing: give it a \`rate\` or \`bursts\``);
    for (const k of ['duration', 'delay', 'drag', 'intensity'] as const) if (l[k] !== undefined && !(isNum(l[k]) && (l[k] as number) >= 0)) out.push(`${at}: \`${k}\` is a number, 0 or more`);
    if (l.max !== undefined && !(Number.isInteger(l.max) && l.max >= 1)) out.push(`${at}: \`max\` is a whole number of particles`);
    if (!isRange(l.life) || lo(l.life) <= 0) out.push(`${at}: \`life\` is seconds, a number or [low, high], above 0`);
    if (l.speed !== undefined && !isRange(l.speed)) out.push(`${at}: \`speed\` is metres a second, a number or [low, high]`);
    if (l.gravity !== undefined && !isNum(l.gravity) && !isVec(l.gravity)) out.push(`${at}: \`gravity\` is metres a second squared, a number (up) or [x, y, z]`);
    if (l.noise !== undefined && !(l.noise && isNum(l.noise.strength))) out.push(`${at}: \`noise\` is { strength, frequency?, scroll?, octaves? }`);
    if (!Array.isArray(l.size) || l.size.length !== 2 || !l.size.every(isRange)) out.push(`${at}: \`size\` is [start, end] metres across, each a number or [low, high]`);
    if (l.sizeEase !== undefined && !(l.sizeEase in EASINGS)) out.push(`${at}: \`sizeEase\` is ${Object.keys(EASINGS).join(', ')}`);
    if (typeof l.color === 'string') { if (!HEX.test(l.color)) out.push(`${at}: \`color\` "${l.color}" is not "#rrggbb" or "#rrggbbaa"`); }
    else if (!Array.isArray(l.color) || l.color.length === 0) out.push(`${at}: \`color\` is "#rrggbbaa" or [[t, "#rrggbbaa"], ...] over its life`);
    else l.color.forEach((s, k) => {
      if (!Array.isArray(s) || s.length !== 2 || !isNum(s[0]) || s[0] < 0 || s[0] > 1 || typeof s[1] !== 'string' || !HEX.test(s[1])) out.push(`${at}: colour stop ${k} is [t 0..1, "#rrggbbaa"]`);
    });
    if (l.rotation !== undefined && !isRange(l.rotation)) out.push(`${at}: \`rotation\` is degrees, a number or [low, high]`);
    if (l.spin !== undefined && !isRange(l.spin)) out.push(`${at}: \`spin\` is degrees a second, a number or [low, high]`);
    if (l.texture !== undefined && (typeof l.texture !== 'string' || !l.texture)) out.push(`${at}: \`texture\` is ${VFX_TEXTURES.join(', ')} or a picture's project path`);
    if (l.flipbook !== undefined && !(l.flipbook && Number.isInteger(l.flipbook.columns) && Number.isInteger(l.flipbook.rows) && l.flipbook.columns >= 1 && l.flipbook.rows >= 1)) out.push(`${at}: \`flipbook\` is { columns, rows, fps?, loop? }`);
    if (l.blend !== undefined && !(l.blend in BLENDS)) out.push(`${at}: \`blend\` is add (fire, sparks, glows), alpha (smoke, dust) or multiply`);
    if (l.render !== undefined && l.render !== 'billboard' && l.render !== 'stretched') out.push(`${at}: \`render\` is billboard or stretched`);
    if (l.space !== undefined && l.space !== 'world' && l.space !== 'local') out.push(`${at}: \`space\` is world or local`);
  });
  const L = spec.light;
  if (L !== undefined) {
    if (!L || typeof L.color !== 'string' || !HEX.test(L.color)) out.push('`light.color` is "#rrggbb"');
    if (!isNum(L?.intensity) || L.intensity < 0) out.push('`light.intensity` is a number, 0 or more');
    if (!isNum(L?.radius) || L.radius <= 0) out.push('`light.radius` is metres, above 0');
    if (L?.at !== undefined && !isVec(L.at)) out.push('`light.at` is [x, y, z] metres');
    if (L?.flicker !== undefined && !(isNum(L.flicker?.amount) && L.flicker.amount >= 0 && L.flicker.amount <= 1)) out.push('`light.flicker` is { amount 0..1, speed?, seed? }');
    if (L?.fade !== undefined && !(isNum(L.fade) && L.fade > 0)) out.push('`light.fade` is seconds, above 0');
    if (L?.flicker && L?.fade) out.push('a light either flickers (a loop) or fades (a one-shot), not both');
  }
  return out;
}

/** Degrees about x, then y, then z, as a quaternion: the order the Details panel applies them in. */
function quat(turn: [number, number, number] | undefined): { w: number; x: number; y: number; z: number } {
  const [x, y, z] = (turn ?? [0, 0, 0]).map((d) => (d * DEG) / 2);
  const cx = Math.cos(x!), sx = Math.sin(x!), cy = Math.cos(y!), sy = Math.sin(y!), cz = Math.cos(z!), sz = Math.sin(z!);
  // q = qz * qy * qx
  return {
    w: cz * cy * cx + sz * sy * sx,
    x: cz * cy * sx - sz * sy * cx,
    y: cz * sy * cx + sz * cy * sx,
    z: sz * cy * cx - cz * sy * sx,
  };
}
function euler(q: { w: number; x: number; y: number; z: number } | undefined): [number, number, number] | undefined {
  if (!q || Math.abs(q.w - 1) < 1e-9) return undefined;
  const { w, x, y, z } = q;
  const ex = Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y));
  const ey = Math.asin(Math.max(-1, Math.min(1, 2 * (w * y - z * x))));
  const ez = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
  return [ex, ey, ez].map((v) => Math.round((v / DEG) * 100) / 100) as [number, number, number];
}

/** How far a layer's particles get from where they are born, metres: the effect's size, for framing and for the answer. */
function layerReach(l: VfxLayer): number {
  const life = hi(l.life), speed = l.speed === undefined ? 0 : Math.abs(hi(l.speed));
  const g = l.gravity === undefined ? 0 : isNum(l.gravity) ? Math.abs(l.gravity) : Math.hypot(...l.gravity);
  const drag = l.drag ?? 0;
  // Travel under drag: v (1 - e^-dt) / d, no further than v t.
  const travel = drag > 0 ? (speed * (1 - Math.exp(-drag * life))) / drag : speed * life;
  const fall = 0.5 * g * life * life;
  const size = Math.max(hi(l.size[0]), hi(l.size[1])) / 2;
  const from = l.shape === 'box' && l.box ? Math.hypot(...l.box) / 2 : l.radius ?? 0;
  const at = l.at ? Math.hypot(...l.at) : 0;
  return at + from + travel + Math.min(fall, travel + fall) + size + (l.noise?.strength ?? 0) * 0.01;
}

/**
 * Where most of a layer's particles are, metres: a middle speed for a middle life, slowed by drag, with the end size. What a
 * view frames on: framed on the farthest spark, a fire is a dot.
 */
function layerBody(l: VfxLayer): { up: number; out: number } {
  const life = (lo(l.life) + hi(l.life)) / 2, speed = l.speed === undefined ? 0 : (Math.abs(lo(l.speed)) + Math.abs(hi(l.speed))) / 2;
  const drag = l.drag ?? 0, travel = (drag > 0 ? (speed * (1 - Math.exp(-drag * life))) / drag : speed * life) * 0.6;
  const g = l.gravity === undefined ? [0, 0, 0] : isNum(l.gravity) ? [0, l.gravity, 0] : l.gravity;
  const rise = 0.25 * g[1]! * life * life;
  const size = Math.max(hi(l.size[0]), hi(l.size[1])) / 2, from = l.shape === 'box' && l.box ? Math.hypot(...l.box) / 2 : l.radius ?? 0;
  const at = l.at ?? [0, 0, 0];
  const opens = l.shape === undefined || l.shape === 'cone' || l.shape === 'hemisphere';
  return { up: Math.max(0, at[1] + (opens ? travel : 0) + rise + size), out: Math.hypot(at[0], at[2]) + from + (opens ? travel * 0.4 : travel) + size };
}

/** The box a view should hold: how high and how wide most of the effect is, metres. */
export function vfxFrame(spec: VfxSpec): { height: number; width: number } {
  const bodies = spec.layers.map(layerBody);
  return { height: Math.max(0.3, ...bodies.map((b) => b.up)), width: Math.max(0.3, ...bodies.map((b) => b.out * 2)) };
}

/** A looping light clip of `amount` flicker round 1, closing on itself; or a fall from 1 to 0. Multiplied by the light's intensity. */
function lightKeys(L: VfxLight): { keys: [number, number][]; duration: number; loop: boolean } {
  if (L.fade) {
    const d = L.delay ?? 0;
    return { keys: [[0, d > 0 ? 0 : 1], ...(d > 0 ? [[d, 1] as [number, number]] : []), [d + L.fade * 0.15, 0.55], [d + L.fade, 0]], duration: d + L.fade, loop: false };
  }
  const f = L.flicker!, speed = Math.max(1, Math.min(30, f.speed ?? 8)), duration = 2;
  const n = Math.max(4, Math.round(speed * duration));
  // A seeded hash, so the same light flickers the same way every time it is written.
  let s = (f.seed ?? 7) * 9301 + 49297;
  const rand = (): number => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  const keys: [number, number][] = [];
  for (let i = 0; i < n; i++) keys.push([Math.round((i / n) * duration * 1000) / 1000, Math.round((1 - f.amount + rand() * f.amount * 2) * 1000) / 1000]);
  keys.push([duration, keys[0]![1]]);
  return { keys, duration, loop: true };
}

/** The prefab a description makes, in world units, with what else has to be written beside it. Throws on one {@link checkVfx} refuses. */
export function buildVfx(spec: VfxSpec): VfxBuild {
  const problems = checkVfx(spec);
  if (problems.length) throw new Error(problems.join('; '));
  const k = spec.unit ?? 1, notes: string[] = [];
  const textures = new Set<VfxTexture>();
  const vec = (v: [number, number, number]) => ({ x: v[0] * k, y: v[1] * k, z: v[2] * k });
  const children: VfxEntity[] = spec.layers.map((l) => {
    const loop = l.loop ?? !(l.bursts?.length && !l.rate);
    const gravity = l.gravity === undefined ? [0, 0, 0] : isNum(l.gravity) ? [0, l.gravity, 0] : l.gravity;
    const stops = typeof l.color === 'string' ? null : [...l.color].sort((a, b) => a[0] - b[0]);
    const first = stops ? hexColor(stops[0]![1]) : hexColor(l.color as string), last = stops ? hexColor(stops[stops.length - 1]![1]) : first;
    const lifeMax = hi(l.life), rate = l.rate ?? 0;
    const burstTotal = (l.bursts ?? []).reduce((n, b) => n + b[1], 0);
    // Enough for all a layer can have alive at once, with a little room, unless it is said.
    const max = l.max ?? Math.max(8, Math.ceil(rate * lifeMax * 1.2 + burstTotal));
    if (l.max !== undefined && rate * lifeMax > l.max) notes.push(`layer "${l.name}": ${rate} a second living up to ${lifeMax} s is ${Math.ceil(rate * lifeMax)} at once, over its max of ${l.max}: some are never born`);
    const data: Record<string, unknown> = {
      rate, duration: l.duration ?? (loop ? 5 : Math.max(0.05, ...(l.bursts ?? [[0, 0]]).map((b) => b[0] + 0.05))), looping: loop,
      startDelay: l.delay ?? 0, playOnStart: true, maxParticles: max, gpuSimulation: l.gpu ?? false,
      lifetimeMin: lo(l.life), lifetimeMax: hi(l.life),
      shape: SHAPES[l.shape ?? 'cone'], shapeRadius: (l.radius ?? 0) * k, shapeAngle: l.angle ?? 15,
      ...(l.box ? { shapeSize: vec(l.box) } : {}),
      speedMin: lo(l.speed ?? 0) * k, speedMax: hi(l.speed ?? 0) * k,
      startSizeMin: lo(l.size[0]) * k, startSizeMax: hi(l.size[0]) * k, endSizeMin: lo(l.size[1]) * k, endSizeMax: hi(l.size[1]) * k,
      sizeEasing: EASINGS[l.sizeEase ?? 'linear'],
      startColor: first, endColor: last,
      rotationMin: lo(l.rotation ?? 0), rotationMax: hi(l.rotation ?? 0), angularVelocityMin: lo(l.spin ?? 0), angularVelocityMax: hi(l.spin ?? 0),
      gravity: vec(gravity as [number, number, number]), damping: l.drag ?? 0,
      noiseStrength: (l.noise?.strength ?? 0) * k, noiseFrequency: (l.noise?.frequency ?? 1) / k, noiseScrollSpeed: l.noise?.scroll ?? 0, noiseOctaves: l.noise?.octaves ?? 1,
      spriteColumns: l.flipbook?.columns ?? 1, spriteRows: l.flipbook?.rows ?? 1, spriteFPS: l.flipbook?.fps ?? 10, spriteLoop: l.flipbook?.loop ?? true,
      blendMode: BLENDS[l.blend ?? 'add'], simulationSpace: l.space === 'local' ? 1 : 0,
      renderMode: l.render === 'stretched' ? 1 : 0,
      velocityScale: l.render === 'stretched' ? (l.stretch?.speed ?? 0.05) : 0, lengthScale: l.stretch?.length ?? 1,
      intensity: l.intensity ?? 1,
      ...(l.collide ? {
        collisionEnabled: true, collisionMode: 0, collisionFloor: (l.collide.floor ?? 0) * k,
        collisionBounce: l.collide.bounce ?? 0.3, collisionFriction: l.collide.friction ?? 0.3, collisionLifetimeLoss: l.collide.loss ?? 0,
      } : {}),
      ...(stops && stops.length > 1 ? { colorGradient: { stops: stops.map(([t, c]) => ({ t, color: hexColor(c) })) } } : {}),
      ...(l.bursts?.length ? { bursts: l.bursts.map(([time, count]) => ({ time, count })) } : {}),
    };
    if (l.texture && (VFX_TEXTURES as readonly string[]).includes(l.texture)) textures.add(l.texture as VfxTexture);
    if (!l.texture) notes.push(`layer "${l.name}" has no texture and draws as hard squares: give it one (glow for light, smoke for smoke, spark for sparks)`);
    if (l.blend === 'alpha' && (l.intensity ?? 1) > 1) notes.push(`layer "${l.name}" is alpha-blended with an intensity over 1: smoke does not glow, so it only darkens nothing and brightens its colour`);
    return {
      name: l.name, texture: l.texture,
      components: [
        { type: 'Transform', data: { position: vec(l.at ?? [0, 0, 0]), rotation: quat(l.turn) } },
        { type: 'ParticleEmitter', data },
      ],
    };
  });

  let lightClip: Record<string, unknown> | null = null;
  const root: VfxEntity = { name: 'root', components: [{ type: 'Transform', data: {} }] };
  const L = spec.light;
  if (L) {
    children.push({
      name: 'Light',
      components: [
        { type: 'Transform', data: { position: vec(L.at ?? [0, 0, 0]) } },
        { type: 'Light', data: { type: 0, color: hexColor(L.color), intensity: L.fade && (L.delay ?? 0) > 0 ? 0 : L.intensity, radius: L.radius * k, falloff: 1 } },
      ],
    });
    if (L.flicker || L.fade) {
      const { keys, duration, loop } = lightKeys(L);
      lightClip = {
        version: '1.3', type: 'timeline', duration, wrapMode: loop ? 'loop' : 'once',
        tracks: [{
          type: 'property', name: 'Light', childPath: 'Light', component: 'Light',
          channels: [{ property: 'intensity', keyframes: keys.map(([time, v]) => ({ time, value: Math.round(v * L.intensity * 1000) / 1000, inTangent: 0, outTangent: 0, interpolation: 'linear' })) }],
        }],
      };
    }
  }

  const loops = spec.layers.some((l) => l.loop ?? !(l.bursts?.length && !l.rate)) || !!L?.flicker;
  const lasts = loops ? null : Math.max(
    ...spec.layers.map((l) => (l.delay ?? 0) + Math.max(l.duration ?? 0, ...(l.bursts ?? []).map((b) => b[0])) + hi(l.life)),
    L?.fade ? (L.delay ?? 0) + L.fade : 0,
  );
  const reach = Math.max(...spec.layers.map(layerReach), L ? Math.hypot(...(L.at ?? [0, 0, 0])) : 0);
  return { root, children, textures: [...textures], lightClip, lasts: lasts === null ? null : Math.round(lasts * 100) / 100, reach: Math.round(reach * 100) / 100, notes };
}

/** A prefab entity as stored: what {@link describeVfx} reads. */
export interface StoredEntity { name: string; parent: string | null; components: { type: string; data: Record<string, unknown> }[] }

const r2 = (v: number): number => Math.round(v * 1000) / 1000;
const range = (a: unknown, b: unknown, k = 1): Range => {
  const x = r2(Number(a ?? 0) / k), y = r2(Number(b ?? a ?? 0) / k);
  return x === y ? x : [x, y];
};

/**
 * The description a prefab is, as {@link buildVfx} reads one. `textureName` turns a texture ref back into what was written (a
 * built-in's name or a project path). A layer edited by hand keeps what the description can say; the rest of its emitter is
 * reported in `other` so nothing is silently dropped by writing it back.
 */
export function describeVfx(entities: readonly StoredEntity[], unit = 1, textureName: (ref: string) => string | undefined = () => undefined): { spec: VfxSpec; other: string[] } {
  const k = unit, other: string[] = [];
  const layers: VfxLayer[] = [];
  let light: VfxLight | undefined;
  const vecOf = (v: unknown): [number, number, number] => {
    const o = (v ?? {}) as { x?: number; y?: number; z?: number };
    return [r2((o.x ?? 0) / k), r2((o.y ?? 0) / k), r2((o.z ?? 0) / k)];
  };
  for (const e of entities) {
    const tf = e.components.find((c) => c.type === 'Transform')?.data ?? {};
    const pe = e.components.find((c) => c.type === 'ParticleEmitter')?.data;
    const li = e.components.find((c) => c.type === 'Light')?.data;
    const at = vecOf(tf.position);
    const atOrNone = at.some((v) => v !== 0) ? at : undefined;
    if (pe) {
      const d = pe as Record<string, any>;
      const stops = (d.colorGradient?.stops ?? []) as { t: number; color: { r: number; g: number; b: number; a: number } }[];
      const color: VfxLayer['color'] = stops.length > 1
        ? stops.map((s) => [r2(s.t), toHex(s.color)] as [number, Hex])
        : toHex(d.startColor ?? { r: 1, g: 1, b: 1, a: 1 }) === toHex(d.endColor ?? d.startColor ?? { r: 1, g: 1, b: 1, a: 1 })
          ? toHex(d.startColor ?? { r: 1, g: 1, b: 1, a: 1 })
          : [[0, toHex(d.startColor)], [1, toHex(d.endColor)]];
      const g = vecOf(d.gravity);
      const layer: VfxLayer = {
        name: e.name, ...(atOrNone ? { at: atOrNone } : {}),
        ...(euler(tf.rotation as never) ? { turn: euler(tf.rotation as never) } : {}),
        shape: (SHAPE_NAMES[d.shape ?? 3] ?? 'cone') as VfxLayer['shape'],
        ...([1, 3, 4, 5].includes(d.shape ?? 3) ? { radius: r2((d.shapeRadius ?? 0) / k) } : {}),
        ...(d.shape === 2 ? { box: vecOf(d.shapeSize) } : {}),
        ...((d.shape ?? 3) === 3 ? { angle: d.shapeAngle ?? 25 } : {}),
        rate: d.rate ?? 0,
        ...(Array.isArray(d.bursts) && d.bursts.length ? { bursts: d.bursts.map((b: { time: number; count: number }) => [b.time, b.count]) } : {}),
        duration: d.duration ?? 5, loop: d.looping ?? true,
        ...(d.startDelay ? { delay: d.startDelay } : {}),
        max: d.maxParticles ?? 1000,
        life: range(d.lifetimeMin, d.lifetimeMax),
        speed: range(d.speedMin, d.speedMax, k),
        ...(g.some((v) => v !== 0) ? { gravity: g[0] === 0 && g[2] === 0 ? g[1] : g } : {}),
        ...(d.damping ? { drag: d.damping } : {}),
        ...(d.noiseStrength ? { noise: { strength: r2(d.noiseStrength / k), frequency: r2((d.noiseFrequency ?? 0.01) * k), scroll: d.noiseScrollSpeed ?? 0, octaves: d.noiseOctaves ?? 1 } } : {}),
        size: [range(d.startSizeMin, d.startSizeMax, k), range(d.endSizeMin, d.endSizeMax, k)],
        ...(d.sizeEasing ? { sizeEase: EASING_NAMES[d.sizeEasing] as VfxLayer['sizeEase'] } : {}),
        color,
        ...(d.rotationMin || d.rotationMax ? { rotation: range(d.rotationMin, d.rotationMax) } : {}),
        ...(d.angularVelocityMin || d.angularVelocityMax ? { spin: range(d.angularVelocityMin, d.angularVelocityMax) } : {}),
        ...(typeof d.texture === 'string' && d.texture ? { texture: textureName(d.texture) ?? d.texture } : {}),
        ...((d.spriteColumns ?? 1) > 1 || (d.spriteRows ?? 1) > 1 ? { flipbook: { columns: d.spriteColumns, rows: d.spriteRows, fps: d.spriteFPS ?? 10, loop: d.spriteLoop ?? true } } : {}),
        blend: (BLEND_NAMES[d.blendMode ?? 1] ?? 'add') as VfxLayer['blend'],
        ...(d.renderMode === 1 ? { render: 'stretched' as const, stretch: { speed: d.velocityScale ?? 0, length: d.lengthScale ?? 1 } } : {}),
        ...((d.intensity ?? 1) !== 1 ? { intensity: d.intensity } : {}),
        ...(d.simulationSpace === 1 ? { space: 'local' as const } : {}),
        ...(d.collisionEnabled ? { collide: { floor: r2((d.collisionFloor ?? 0) / k), bounce: d.collisionBounce ?? 0.3, friction: d.collisionFriction ?? 0.3, loss: d.collisionLifetimeLoss ?? 0 } } : {}),
        ...(d.gpuSimulation ? { gpu: true } : {}),
      };
      for (const key of ['subEmitter', 'trailEnabled', 'material', 'addedVelocityMin', 'speedLimit', 'sizeCurve']) {
        const v = d[key];
        if (v && !(typeof v === 'object' && !Array.isArray(v) && Object.values(v).every((x) => !x || (Array.isArray(x) && !x.length)))) other.push(`${e.name}.${key}`);
      }
      layers.push(layer);
    } else if (li) {
      const d = li as Record<string, any>;
      light = { ...(atOrNone ? { at: atOrNone } : {}), color: toHex(d.color ?? { r: 1, g: 1, b: 1, a: 1 }).slice(0, 7), intensity: d.intensity ?? 1, radius: r2((d.radius ?? 200) / k) };
    }
  }
  return { spec: { ...(unit !== 1 ? { unit } : {}), layers, ...(light ? { light } : {}) }, other };
}

/** Folds the light clip back into the description: whether it flickers or fades, and its full intensity. */
export function describeLightClip(light: VfxLight, clip: { duration?: number; wrapMode?: string; tracks?: unknown[] } | null): VfxLight {
  const keys = (clip?.tracks as { channels?: { property: string; keyframes: { time: number; value: number }[] }[] }[] | undefined)?.[0]?.channels?.find((c) => c.property === 'intensity')?.keyframes;
  if (!keys?.length) return light;
  const peak = Math.max(...keys.map((k) => k.value));
  if (clip?.wrapMode === 'loop') {
    // The light's own intensity is what the flicker is round: the keys are random either side of it, so their middle is not.
    const min = Math.min(...keys.map((k) => k.value)), base = light.intensity || (peak + min) / 2;
    return { ...light, flicker: { amount: r2(Math.max(peak - base, base - min) / (base || 1)), speed: Math.round((keys.length - 1) / (clip.duration || 2)) } };
  }
  const rise = keys.findIndex((k) => k.value === peak);
  const delay = rise > 0 ? keys[rise]!.time : 0;
  return { ...light, intensity: peak, fade: r2((clip?.duration ?? keys[keys.length - 1]!.time) - delay), ...(delay > 0 ? { delay } : {}) };
}
