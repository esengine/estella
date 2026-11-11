// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The example's scene, composed rather than hand-placed.
 *
 * The fort is Poly Haven's modular kit: twenty-two pieces laid out for a catalogue, not a
 * building. This reads the import's prefab, takes each piece by name, and stands them up as a
 * walled courtyard — four round towers hiding the joins, thin curtain walls between them with a
 * gate in the front, a fire pit in the yard. Positions are in the kit's own metres; one
 * `Fort` entity carries the scale that turns a metre into engine units.
 *
 *   node examples/dusk-fort/tools/build-scene.mjs
 */
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8'));

/** One engine unit per centimetre-ish: the kit is in metres, a primitive is 100 units. */
const UNITS_PER_METRE = 20;

const fort = read('assets/models/modular_fort_01_2k.esprefab');
const pit = read('assets/models/stone_fire_pit_2k.esprefab');
const door = read('assets/models/large_castle_door_2k.esprefab');

const entities = [];
const add = (e) => { e.id = entities.length; e.children ??= []; e.visible ??= true; entities.push(e); if (e.parent != null) entities[e.parent].children.push(e.id); return e.id; };

const quatY = (deg) => { const a = deg * Math.PI / 360; return { x: 0, y: Math.sin(a), z: 0, w: Math.cos(a) }; };
const mul = (a, b) => ({
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
});
/** The rotation that turns a thing facing -Z (a camera, a light) to face `d`. */
const aim = (d) => {
  const h = Math.hypot(d.x, d.z) || 1e-6, len = Math.hypot(d.x, d.y, d.z);
  const yaw = Math.atan2(-d.x, -d.z), pitch = Math.asin(d.y / len);
  const qy = { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
  const qx = { x: Math.sin(pitch / 2), y: 0, z: 0, w: Math.cos(pitch / 2) };
  void h;
  return mul(qy, qx);
};
const tr = (position, rotation, scale) => ({
  type: 'Transform',
  data: { position, ...(rotation ? { rotation } : {}), ...(scale ? { scale } : {}) },
});

/** Copy one kit node (a piece and its mesh children) under `parent`, placed by `position`/`yaw`. */
function place(prefab, nodeName, parent, position, yawDeg = 0, scale) {
  const byId = new Map(prefab.entities.map((e) => [e.prefabEntityId, e]));
  const node = prefab.entities.find((e) => e.name === nodeName);
  if (!node) throw new Error(`no piece called ${nodeName}`);
  const id = add({
    name: nodeName.replace(/^modular_fort_01_/, ''),
    parent,
    components: [tr(position, yawDeg ? quatY(yawDeg) : undefined, scale)],
  });
  for (const childId of node.children) {
    const child = byId.get(childId);
    add({ name: child.name, parent: id, components: structuredClone(child.components) });
  }
  return id;
}
const piece = (name) => `modular_fort_01_${name}`;

// ── the world ────────────────────────────────────────────────────────────
const camera = add({ name: 'Camera', parent: null, components: [
  tr({ x: 400, y: 440, z: 1000 }, aim({ x: -400, y: -380, z: -1040 })),
  { type: 'Camera', data: { projectionType: 0, fov: 42, nearPlane: 20, farPlane: 9000, isActive: true, priority: 0 } },
  { type: 'PostProcessVolume', data: {
    isGlobal: true, priority: 0, weight: 1,
    effects: [
      { type: 'ssao', enabled: true, uniforms: { u_radius: 90, u_intensity: 1.1, u_bias: 0.12, u_power: 1.5 } },
      { type: 'distanceFog', enabled: true, uniforms: { u_fogNear: 140, u_fogFar: 480, u_intensity: 0.55 }, colors: { u_fogColor: { r: 0.62, g: 0.42, b: 0.40, a: 1 } } },
      { type: 'bloom', enabled: true, uniforms: { u_threshold: 0.85, u_intensity: 0.9, u_radius: 1.4 } },
      { type: 'colorGrade', enabled: true, uniforms: { u_exposure: 0.1, u_contrast: 1.08, u_saturation: 1.1, u_temperature: 0.08, u_tint: 0 } },
      { type: 'tonemap', enabled: true, uniforms: { u_exposure: 0.2 } },
      { type: 'vignette', enabled: true, uniforms: { u_intensity: 0.4, u_softness: 0.6 } },
      { type: 'fxaa', enabled: true, uniforms: { u_intensity: 1 } },
    ],
  } },
] });
void camera;

// The low sun the sky shows, from the left and behind the camera so the front faces are lit and the
// towers throw long shadows into the yard.
add({ name: 'Sun', parent: null, components: [
  tr({ x: 0, y: 0, z: 0 }, aim({ x: 0.72, y: -0.2, z: -0.66 })),
  { type: 'Light', data: {
    type: 1, color: { r: 1, g: 0.6, b: 0.32, a: 1 }, intensity: 2.1, enabled: true,
    meshShadows: true, shadowExtent: 1700, shadowStrength: 0.9, shadowSoftness: 0.4,
  } },
] });
add({ name: 'Sky', parent: null, components: [
  tr({ x: 0, y: 0, z: 0 }),
  { type: 'Light', data: {
    type: 2, color: { r: 1, g: 1, b: 1, a: 1 }, intensity: 0.85, enabled: true,
    environment: 'assets/env/the_sky_is_on_fire_2k.esenv', drawEnvironment: true,
  } },
] });

add({ name: 'Ground', parent: null, components: [
  tr({ x: 0, y: -1, z: 0 }, undefined, { x: 120, y: 1, z: 120 }),
  { type: 'MeshRenderer', data: {
    mesh: 'builtin:plane', lit: true, opaque: true, enabled: true,
    color: { r: 0.15, g: 0.13, b: 0.115, a: 1 },
  } },
] });

// ── the fort, in metres ──────────────────────────────────────────────────
const root = add({ name: 'Fort', parent: null, components: [
  tr({ x: 0, y: 0, z: 0 }, undefined, { x: UNITS_PER_METRE, y: UNITS_PER_METRE, z: UNITS_PER_METRE }),
] });

const X = 22.2, Z = 14.8; // tower centres: x = ±X, z = ±Z
const wall = 1.25;        // half the thin wall's thickness
for (const sx of [-1, 1]) for (const sz of [-1, 1]) place(fort, piece('tower_round'), root, { x: sx * X, y: 0, z: sz * Z });

// Front and back run along x: a straight turned a quarter so its length lies along +x, its
// thickness then hangs toward -z, so the origin sits half a wall in front of the centre line.
const run = (zLine, names) => {
  let x = -X;
  for (const [name, len] of names) { place(fort, piece(name), root, { x, y: 0, z: zLine + wall }, 90); x += len; }
};
run(Z, [['wall_thin_straight_01', 14.8], ['wall_thin_straight_04', 7.4], ['wall_thin_gate_01', 7.4], ['wall_thin_straight_04', 7.4], ['wall_thin_straight_04', 7.4]]);
run(-Z, [['wall_thin_straight_01', 14.8], ['wall_thin_straight_02', 14.8], ['wall_thin_straight_03', 7.4], ['wall_thin_straight_04', 7.4]]);
// The sides run along z with their thickness along +x.
for (const sx of [-1, 1]) {
  place(fort, piece('wall_thin_straight_01'), root, { x: sx * X - wall, y: 0, z: -Z });
  place(fort, piece('wall_thin_straight_02'), root, { x: sx * X - wall, y: 0, z: 0 });
}

// The yard: a fire to read the dusk against, and a door set into the back wall.
const fire = add({ name: 'FirePit', parent: root, components: [tr({ x: 0, y: 0.2, z: 3 })] });
for (const e of pit.entities.filter((x) => x.components.some((c) => c.type === 'MeshRenderer'))) {
  add({ name: e.name, parent: fire, components: structuredClone(e.components) });
}
add({ name: 'FireLight', parent: fire, components: [
  tr({ x: 0, y: 1.1, z: 0 }),
  { type: 'Light', data: { type: 0, color: { r: 1, g: 0.5, b: 0.2, a: 1 }, intensity: 3.2, radius: 24, innerRadius: 1, falloff: 1.4, enabled: true } },
] });

const doorRoot = add({ name: 'Door', parent: root, components: [tr({ x: 0, y: 0, z: -Z + wall + 0.12 })] });
const byDoor = new Map(door.entities.map((e) => [e.prefabEntityId, e]));
for (const e of door.entities.filter((x) => x.prefabEntityId !== 'root')) {
  const parent = e.parent === 'root' ? doorRoot : null;
  if (parent == null) continue;
  void byDoor;
  add({ name: e.name, parent, components: structuredClone(e.components) });
}

writeFileSync(path.join(ROOT, 'assets/scenes/main.esscene'), JSON.stringify({ version: 4, name: 'Main', entities }, null, 2));
// The scene is an asset like any other: without its .meta it has no id, an export reaches nothing from it, and the
// package boots to "asset not found". Kept when it exists, so a rebuild does not change what refers to it.
const meta = path.join(ROOT, 'assets/scenes/main.esscene.meta');
if (!existsSync(meta)) {
  writeFileSync(meta, `${JSON.stringify({ uuid: randomUUID(), version: '2.0', type: 'scene', importer: {} }, null, 2)}\n`);
}
console.log(`wrote ${entities.length} entities`);
