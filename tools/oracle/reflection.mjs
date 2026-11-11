// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  reflection.mjs — oracle scenes for Screen Space Reflections.
 *
 * A mirror floor and a box standing on it, seen from a camera that looks down at both. A pixel of the floor shows what its reflected ray
 * meets, and that is geometry: the view ray meets the floor, reflects about its up normal, and meets the box or not. Where it does, the
 * pixel is  mix(floor, box, w x hit)  with
 *
 *   w   = fresnel x gloss x intensity,  fresnel = f0 + (1 - f0)(1 - cos)^5 (Schlick; f0 = 0.9 for a metal, 0.04 for an insulator),
 *         cos = the angle between the floor's normal and the way back to the eye, gloss = (1 - roughness)^2,
 *   hit = how far the hit is from the picture's edge (a ramp over the outer tenth) x how far the ray went (a ramp from 0.6 to 1 of
 *         the search distance).
 *
 * The box is unlit and one colour, and the floor is lit by nothing, so the floor itself is black and the reflection is the box's colour
 * times that weight. Probes are taken where the ray meets the middle of the box's near face, clear of its edges (the reflection is a
 * five-tap blur of the picture there).
 */
import { scene, camera, mesh, volume, SIZE } from './scene.mjs';
import { encodeLinear8, axisAngle, rotate, norm, dot, sub, smoothstep, clamp01 } from './formulas.mjs';

const FOV = 50, PITCH = -35, EYE = [0, 230, 280], FLOOR_TOP = 5;
const BOX = { min: [-60, FLOOR_TOP, -170], max: [60, FLOOR_TOP + 90, -150] };
const BOX_COLOUR = [0.9, 0.35, 0.2];
const MAX_DISTANCE = 700;

const material = (metallic, roughness) => ({ version: '1.0', type: 'material', shader: 'builtin:model', blendMode: 0, depthTest: true, depthWrite: true, cull: 0, properties: { u_metallic: metallic, u_roughness: roughness } });

function mirrorFloor({ id, metallic, roughness, intensity = 1, floorBias = 0, ssrIntensity = intensity }) {
  const materialName = `${id}_m0.esmaterial`;
  const doc = scene(id, () => [
    camera({ projectionType: 0, fov: FOV, nearPlane: 1, farPlane: 4000 }),
    mesh('Floor', 'cube', [0, 0, 0], [8, 0.1, 8], [0.5, 0.5, 0.5], { lit: true, material: `/scenes/${materialName}` }),
    mesh('Box', 'cube', [0, (BOX.min[1] + BOX.max[1]) / 2, (BOX.min[2] + BOX.max[2]) / 2], [1.2, 0.9, 0.2], BOX_COLOUR, { lit: false }),
    volume([{ type: 'ssr', enabled: true, uniforms: { u_intensity: ssrIntensity, u_maxDistance: MAX_DISTANCE, u_thickness: 12, u_floorBias: floorBias, u_skyReflection: 0 } }]),
  ]);
  const cam = doc.entities.find((e) => e.name === 'Camera');
  cam.components[0].data.position = { x: EYE[0], y: EYE[1], z: EYE[2] };
  const q = axisAngle([1, 0, 0], PITCH);
  cam.components[0].data.rotation = q;
  const t = Math.tan((FOV * Math.PI) / 360);
  const f0 = 0.04 + (0.9 - 0.04) * metallic, gloss = (1 - roughness) ** 2;
  const slab = (origin, dir) => {
    let t0 = 0, t1 = Infinity;
    for (let a = 0; a < 3; a++) {
      if (Math.abs(dir[a]) < 1e-9) { if (origin[a] < BOX.min[a] || origin[a] > BOX.max[a]) return null; continue; }
      let ta = (BOX.min[a] - origin[a]) / dir[a], tb = (BOX.max[a] - origin[a]) / dir[a];
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      if (t0 > t1) return null;
    }
    return t0;
  };
  const right = rotate(q, [1, 0, 0]), up = rotate(q, [0, 1, 0]), forward = rotate(q, [0, 0, -1]);
  const project = (p) => { const rel = sub(p, EYE); const cz = dot(rel, forward); return [0.5 + 0.5 * dot(rel, right) / (cz * t), 0.5 + 0.5 * dot(rel, up) / (cz * t)]; };

  const reflected = [], clear = [];
  for (let j = 10; j < SIZE - 6; j += 4) {
    for (let i = 6; i < SIZE - 6; i += 4) {
      const nx = (2 * (i + 0.5)) / SIZE - 1, ny = 1 - (2 * (j + 0.5)) / SIZE;
      const dir = norm([forward[0] + nx * t * right[0] + ny * t * up[0], forward[1] + nx * t * right[1] + ny * t * up[1], forward[2] + nx * t * right[2] + ny * t * up[2]]);
      if (dir[1] >= -0.02) continue;
      const s = (FLOOR_TOP - EYE[1]) / dir[1], P = [EYE[0] + dir[0] * s, FLOOR_TOP, EYE[2] + dir[2] * s];
      if (Math.abs(P[0]) > 380 || Math.abs(P[2]) > 380) continue;          // off the floor
      if (slab(EYE, dir) !== null && slab(EYE, dir) < s) continue;           // the box stands in front of this floor point
      const R = [dir[0], -dir[1], dir[2]], tHit = slab(P, R);
      const cosT = clamp01(-dir[1]);
      const fresnel = f0 + (1 - f0) * Math.pow(1 - cosT, 5);
      const w = roughness > 0.75 ? 0 : fresnel * gloss * ssrIntensity;      // a surface rougher than Max Roughness (0.75) is not marched at all
      if (tHit === null) { clear.push({ i, j, near: false }); continue; }
      const H = [P[0] + R[0] * tHit, P[1] + R[1] * tHit, P[2] + R[2] * tHit];
      // Well inside the box's near face (z = -150): clear of its edges, where the blur reads the background.
      const insideFace = Math.abs(H[2] - BOX.max[2]) < 0.5 && H[0] > BOX.min[0] + 22 && H[0] < BOX.max[0] - 22 && H[1] > BOX.min[1] + 18 && H[1] < BOX.max[1] - 18;
      if (!insideFace) continue;
      const [u, v] = project(H), edge = smoothstep(0, 0.1, Math.min(u, 1 - u, v, 1 - v));
      const hit = edge * (1 - smoothstep(0.6, 1, tHit / MAX_DISTANCE));
      reflected.push({ i, j, k: clamp01(w * hit) });
    }
  }
  const pick = (list, n) => list.filter((_, idx) => idx % Math.max(1, Math.floor(list.length / n)) === 0).slice(0, n);
  const expect = [
    ...pick(reflected, 14).map(({ i, j, k }) => ({ x: i / (SIZE - 1), y: j / (SIZE - 1), rgb: encodeLinear8(BOX_COLOUR.map((c) => c * k)), tol: 5 })),
    // Where the reflected ray misses the box there is nothing on screen to find: the floor is what lit it, which is nothing.
    ...pick(clear.filter((c) => c.j > 150), 6).map(({ i, j }) => ({ x: i / (SIZE - 1), y: j / (SIZE - 1), rgb: [0, 0, 0], tol: 2 })),
  ];
  return { id, doc, colorSpace: 'linear', expect, files: { [materialName]: material(metallic, roughness) }, reflectedCount: reflected.length,
    about: `SSR on a floor of metallic ${metallic}, roughness ${roughness}: the box's reflection is its colour x fresnel x gloss` };
}

export const REFLECTION_SCENES = [
  mirrorFloor({ id: 'oracle-ssr-mirror', metallic: 1, roughness: 0.05 }),
  mirrorFloor({ id: 'oracle-ssr-glossy', metallic: 1, roughness: 0.4 }),
  mirrorFloor({ id: 'oracle-ssr-dielectric', metallic: 0, roughness: 0.05 }),
  mirrorFloor({ id: 'oracle-ssr-half', metallic: 1, roughness: 0.05, ssrIntensity: 0.5 }),
  mirrorFloor({ id: 'oracle-ssr-rough', metallic: 1, roughness: 0.9 }),
];
