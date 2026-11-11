// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  pbr.mjs — oracle scenes for the PBR lighting model: a ball lit by a sun, by a uniform environment, and by both.
 *
 * The reference is the textbook model the engine claims, written here from the papers and not from its shader:
 *
 *   direct specular    D x Vis x F x pi x I x N.L, with D the GGX distribution (Walter et al. 2007, alpha = roughness^2), Vis the
 *                      height-correlated Smith visibility (Heitz 2014), F Schlick's Fresnel in V.H; the engine's `I` is irradiance / pi.
 *   direct diffuse    albedo x (1 - metallic) x I x N.L
 *   environment       a uniform environment E lights a diffuse surface with albedo x E and a specular one with E x (F0 x A + B), where A and B
 *                      are the split-sum terms of Karis (2013), INTEGRATED here by quadrature over the GGX lobe, not read from the engine's fit
 *   multiple scatter  the energy a single-scattering lobe loses is put back (Fdez-Aguera 2019): the direct specular is scaled by
 *                      1 + F0 (1 / Ess - 1), the environment adds FssEss x Favg x Ems / (1 - Ems x Favg), and the diffuse under the specular
 *                      keeps what is left of the energy, kd = 1 - (FssEss + FmsEms)
 *
 * The engine agrees with this model to 1 or 2 codes everywhere. The one exception is a highlight a few degrees wide (roughness 0.15), where the
 * ball's interpolated mesh normals move the answer by up to 5, so those scenes carry a tolerance of 6.
 *
 * The camera is orthographic and looks straight down, so the view vector is +Y for every pixel and a ball's normal at a pixel is its
 * position on the sphere. A scene with a bright highlight is dimmed by a grade (an effect already checked to the code) so that the highlight
 * stays under 1 and an error in it shows; a scene with none is not, which keeps the small terms (Fresnel, the diffuse's energy share) readable.
 */
import { scene, camera, mesh, sun, ambient, volume, probe } from './scene.mjs';
import { sunAim, dot, norm, encodeLinear8, clamp01 } from './formulas.mjs';

const R = 50;
const PROBES = [[0, 0], [14, 0], [-14, 0], [0, 14], [0, -14], [26, 10], [-26, -10], [10, -30], [-8, 33], [36, 0], [-36, 6], [0, 40]];

const ggx = (noh, a) => { const a2 = a * a, d = noh * noh * (a2 - 1) + 1; return a2 / (Math.PI * d * d); };
const visibility = (nov, nol, a) => { const a2 = a * a; return 0.5 / (nol * Math.sqrt(nov * nov * (1 - a2) + a2) + nov * Math.sqrt(nol * nol * (1 - a2) + a2)); };
const schlick = (voh, f0) => f0.map((f) => f + (1 - f) * Math.pow(1 - voh, 5));

/** The split-sum terms (A scales F0, B is the grazing share), by quadrature over the GGX lobe for a view at cosine `nov`. */
const dfgCache = new Map();
function dfg(nov, roughness) {
  const key = `${nov.toFixed(4)}:${roughness}`;
  if (dfgCache.has(key)) return dfgCache.get(key);
  const a = Math.max(roughness * roughness, 1e-3), v = [Math.sqrt(1 - nov * nov), 0, nov], n = 160;
  let A = 0, B = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const xi1 = (i + 0.5) / n, xi2 = (j + 0.5) / n, phi = 2 * Math.PI * xi1;
      const cosT = Math.sqrt((1 - xi2) / (1 + (a * a - 1) * xi2)), sinT = Math.sqrt(1 - cosT * cosT);
      const h = [sinT * Math.cos(phi), sinT * Math.sin(phi), cosT], voh = dot(v, h);
      const l = h.map((x, k) => 2 * voh * x - v[k]), nol = l[2], noh = h[2];
      if (nol <= 0 || voh <= 0) continue;
      const gVis = (4 * nol * nov * visibility(nov, nol, a)) * voh / (noh * nov), fc = Math.pow(1 - voh, 5);
      A += (1 - fc) * gVis; B += fc * gVis;
    }
  }
  const out = [A / (n * n), B / (n * n)];
  dfgCache.set(key, out);
  return out;
}

/** The environment term of the model for a view cosine: what a uniform environment of radiance 1 adds as specular, and the diffuse's share. */
function environment(nov, roughness, f0) {
  const [A, B] = dfg(nov, roughness), Ess = A + B;
  const fssEss = f0.map((f) => f * A + B), favg = f0.map((f) => f + (1 - f) / 21), ems = 1 - Ess;
  const fmsEms = fssEss.map((f, k) => (f * favg[k] * ems) / (1 - ems * favg[k]));
  return { specular: fssEss.map((f, k) => f + fmsEms[k]), kd: fssEss.map((f, k) => Math.max(1 - (f + fmsEms[k]), 0)), Ess };
}

/** The radiance of the ball at a pixel: direct sun (if any) plus the uniform environment (if any). */
function shade({ normal, view, toLight, sunI, sunLinear, ambientLinear, albedo, metallic, roughness }) {
  const f0 = albedo.map((c) => 0.04 * (1 - metallic) + c * metallic), diffuse = albedo.map((c) => c * (1 - metallic));
  const nov = Math.max(dot(normal, view), 1e-4), a = Math.max(roughness * roughness, 1e-3);
  const env = environment(nov, roughness, f0);
  let direct = [0, 0, 0], diffuseLight = ambientLinear.slice();
  if (sunI > 0) {
    const nol = Math.max(dot(normal, toLight), 0);
    diffuseLight = diffuseLight.map((e, k) => e + sunLinear[k] * sunI * nol);
    if (nol > 0) {
      const h = norm(toLight.map((x, k) => x + view[k])), noh = Math.max(dot(normal, h), 0), voh = Math.max(dot(view, h), 0);
      const F = schlick(voh, f0), d = ggx(noh, a), vis = visibility(nov, nol, a);
      // Multiple scattering restores the energy the lobe loses, as a gain on the direct specular.
      const gain = f0.map((f) => 1 + f * (1 / Math.max(env.Ess, 0.05) - 1));
      direct = F.map((f, k) => f * d * vis * Math.PI * sunLinear[k] * sunI * nol * gain[k]);
    }
  }
  return diffuse.map((c, k) => c * env.kd[k] * diffuseLight[k] + direct[k] + ambientLinear[k] * env.specular[k]);
}

const material = (metallic, roughness) => ({ version: '1.0', type: 'material', shader: 'builtin:model', blendMode: 0, depthTest: true, depthWrite: true, cull: 0, properties: { u_metallic: metallic, u_roughness: roughness } });

function ball({ id, metallic, roughness, sunI = 0, ambientI = 0, albedo = [0.8, 0.5, 0.3], pitch = 50, yaw = 30, tol = 2, dimStops = 0 }) {
  const aim = sunAim(pitch, yaw), materialName = `${id}_m0.esmaterial`;
  const doc = scene(id, () => [
    camera(),
    mesh('Ball', 'sphere', [0, R, 0], [1, 1, 1], albedo, { material: `/scenes/${materialName}` }),
    ...(sunI > 0 ? [sun(aim, sunI, [1, 1, 1])] : []),
    ...(ambientI > 0 ? [ambient(ambientI, [1, 1, 1])] : []),
    ...(dimStops > 0 ? [volume([{ type: 'colorGrade', enabled: true, uniforms: { u_exposure: -dimStops } }])] : []),
  ]);
  const view = [0, 1, 0], dim = 2 ** -dimStops;
  const colourAt = (normal) => encodeLinear8(shade({ normal, view, toLight: aim.toLight, sunI, sunLinear: [1, 1, 1], ambientLinear: [ambientI, ambientI, ambientI], albedo, metallic, roughness }).map((c) => clamp01(c * dim)));
  // The ball is a mesh: its normal between vertices is interpolated, a fraction of a degree off the true sphere's. A narrow highlight (a
  // low roughness) falls off faster than that, so a probe on its flank asks about the mesh and not the lighting. Keep the probes whose
  // answer holds when the normal is turned by 0.8 degrees any way.
  const wobble = 0.8 * (Math.PI / 180);
  const steady = (normal) => {
    const here = colourAt(normal), t1 = norm([normal[2], 0, -normal[0]]), t2 = norm([normal[1] * t1[2], normal[2] * t1[0] - normal[0] * t1[2], -normal[1] * t1[0]]);
    return [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([a, b]) => {
      const n = norm(normal.map((c, k) => c + wobble * (a * t1[k] + b * t2[k])));
      return Math.max(...colourAt(n).map((c, k) => Math.abs(c - here[k]))) <= tol * 0.6;
    });
  };
  // The highlight sits where the normal is the half vector between the light and the view: crowd probes round it.
  const half = norm(aim.toLight.map((c, k) => c + view[k]));
  const near = sunI > 0 ? [[0, 0], [5, 0], [-5, 0], [0, 5], [0, -5], [10, 0], [-10, 0], [0, 10], [0, -10], [16, 6], [-16, -6], [22, 0]].map(([dx, dz]) => [half[0] * R + dx, half[2] * R + dz]) : [];
  const expect = [...PROBES, ...near].flatMap(([x, z]) => {
    const p = probe(x, z), [px, pz] = p.at, r2 = px * px + pz * pz;
    const normal = [px / R, Math.sqrt(Math.max(R * R - r2, 0)) / R, pz / R];
    return steady(normal) ? [{ x: p.x, y: p.y, rgb: colourAt(normal), tol }] : [];
  });
  return { id, doc, colorSpace: 'linear', expect, files: { [materialName]: material(metallic, roughness) },
    about: `PBR ball, metallic ${metallic}, roughness ${roughness}, sun ${sunI}, environment ${ambientI}` };
}

const SUN = [[0, 0.15, 1], [0, 0.45, 1], [0, 0.9, 0], [1, 0.15, 3], [1, 0.25, 3], [1, 0.45, 2], [1, 0.9, 0]];
export const PBR_SCENES = [
  ...SUN.map(([m, r, dimStops]) => ball({ id: `oracle-pbr-sun-m${m}-r${String(r).replace('.', '')}`, metallic: m, roughness: r, sunI: 0.8, dimStops, tol: r < 0.2 ? 6 : 2 })),
  ...[[0, 0.15], [0, 0.45], [0, 0.9], [1, 0.15], [1, 0.45], [1, 0.9]].map(([m, r]) => ball({ id: `oracle-pbr-env-m${m}-r${String(r).replace('.', '')}`, metallic: m, roughness: r, ambientI: 0.8 })),
  ball({ id: 'oracle-pbr-both-dielectric', metallic: 0, roughness: 0.3, sunI: 0.7, ambientI: 0.3, dimStops: 1 }),
  ball({ id: 'oracle-pbr-both-metal', metallic: 1, roughness: 0.3, sunI: 0.7, ambientI: 0.3, dimStops: 1 }),
  // A light from BELOW the ball, seen from above: it can only light the rim, where V.H is small and Schlick's (1 - V.H)^5 is large.
  ball({ id: 'oracle-pbr-rim-dielectric', metallic: 0, roughness: 0.3, sunI: 1.5, pitch: -50, yaw: 30, dimStops: 1 }),
  ball({ id: 'oracle-pbr-rim-metal', metallic: 1, roughness: 0.3, sunI: 1.5, pitch: -50, yaw: 30, dimStops: 2 }),
];
