// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  agx.mjs — oracle scenes for the AgX view transform, against Blender's own.
 *
 * AgX is not a formula but a table (Blender ships it, and the engine's effect carries that table), so the answer here is Blender: the
 * same flat scene-linear colours drawn by Blender's Workbench under its AgX view transform, read back as 8-bit display values
 * (tools/oracle/agx/make-reference.mjs writes them; reference.json is data in the repository, so these scenes need no Blender to run).
 * What is compared is everything between the colour and the screen: the E-Gamut matrix, the log encode, the contrast, the table's
 * interpolation, and the display's encode. The base look is contrast 1; Blender's "Medium High Contrast" look is 1.2.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scene, camera, mesh, volume, probe } from './scene.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const load = (name) => JSON.parse(readFileSync(path.join(here, 'agx', name), 'utf8'));
const SLOTS = [[-75, -50], [-25, -50], [25, -50], [75, -50], [-75, 50], [-25, 50], [25, 50], [75, 50]];

function agxPatches({ id, reference, from, contrast, tol }) {
  const colours = reference.patches.slice(from, from + SLOTS.length), codes = reference.codes.slice(from, from + SLOTS.length);
  const doc = scene(id, () => [
    camera(),
    ...colours.map((c, i) => mesh(`Patch${i}`, 'cube', [SLOTS[i][0], 5, SLOTS[i][1]], [0.4, 0.1, 0.4], c, { lit: false })),
    volume([{ type: 'agx', enabled: true, uniforms: { u_contrast: contrast } }]),
  ]);
  const expect = codes.map((rgb, i) => {
    const p = probe(...SLOTS[i]);
    return { x: p.x, y: p.y, rgb, tol };
  });
  return { id, doc, colorSpace: 'linear', expect, about: `AgX (contrast ${contrast}) against Blender ${reference.source.split(',')[0]}: patches ${from + 1} to ${from + colours.length}` };
}

const BASE = load('reference.json'), MEDIUM_HIGH = load('reference-AgX-Medium-High-Contrast.json');
/**
 * The engine's AgX is Blender's: its two tables (the 57^3 view transform and the 37^3 luminance compensation of the contrast looks), its
 * matrices, its log encode, its tetrahedral interpolation. What is left between them is the 8-bit tables and Blender writing 8-bit: every
 * patch, grey or saturated, base look or Medium High Contrast, is within 1 code. (Before the 57^3 table, the tetrahedral read and the
 * look's own log space, saturated colours were up to 7 codes off and the contrast look up to 14.)
 */
const TOL = 2;
const NEUTRAL = TOL, SATURATED = TOL, LOOK_SATURATED = TOL;

export const AGX_SCENES = [
  agxPatches({ id: 'oracle-agx-grey-low', reference: BASE, from: 0, contrast: 1, tol: NEUTRAL }),
  agxPatches({ id: 'oracle-agx-grey-high', reference: BASE, from: 8, contrast: 1, tol: NEUTRAL }),
  agxPatches({ id: 'oracle-agx-colour-a', reference: BASE, from: 16, contrast: 1, tol: SATURATED }),
  agxPatches({ id: 'oracle-agx-colour-b', reference: BASE, from: 24, contrast: 1, tol: SATURATED }),
  agxPatches({ id: 'oracle-agx-contrast-grey', reference: MEDIUM_HIGH, from: 0, contrast: 1.2, tol: NEUTRAL }),
  agxPatches({ id: 'oracle-agx-contrast-colour', reference: MEDIUM_HIGH, from: 16, contrast: 1.2, tol: LOOK_SATURATED }),
];
