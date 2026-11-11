// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  index.mjs — the oracle scenes as render-registry entries, and the fixture files they load.
 */
import { SIZE } from './scene.mjs';
import { LIGHT_SCENES } from './lights.mjs';
import { SHADOW_SCENES } from './shadows.mjs';
import { POST_SCENES } from './post.mjs';
import { SKY_SCENES } from './sky.mjs';
import { LENS_SCENES } from './lens.mjs';
import { VOLUMETRIC_SCENES } from './volumetric.mjs';
import { EXPOSURE_SCENES } from './exposure.mjs';
import { OCCLUSION_SCENES } from './occlusion.mjs';
import { REFLECTION_SCENES } from './reflection.mjs';
import { AGX_SCENES } from './agx.mjs';
import { SOFT_LIGHT_SCENES } from './softlight.mjs';

export const ORACLE = [...LIGHT_SCENES, ...SHADOW_SCENES, ...POST_SCENES, ...SKY_SCENES, ...LENS_SCENES, ...VOLUMETRIC_SCENES, ...EXPOSURE_SCENES, ...OCCLUSION_SCENES, ...REFLECTION_SCENES, ...AGX_SCENES, ...SOFT_LIGHT_SCENES];

/** The renderScenes.mjs entry for one oracle scene. */
export const oracleEntry = (o) => ({
  id: o.id, tier: 'pr', webgpu: true,
  env: {
    ESTELLA_VERIFY_SCENE: `/scenes/${o.id}.esscene`,
    ESTELLA_VERIFY_W: String(SIZE), ESTELLA_VERIFY_H: String(SIZE), ESTELLA_VERIFY_STEPS: '3',
    ...(o.colorSpace === 'linear' ? { ESTELLA_VERIFY_COLORSPACE: 'linear' } : {}),
    ...(o.outputTransform ? { ESTELLA_VERIFY_OUTPUT_TRANSFORM: o.outputTransform } : {}),
    // ORACLE_PROBES='[[x,y],...]' (frame fractions from the top-left) reads those pixels too, as failing probes, so their values print.
    ...(o.expect || process.env.ORACLE_PROBES ? { ESTELLA_VERIFY_EXPECT: JSON.stringify([...(o.expect ?? []), ...JSON.parse(process.env.ORACLE_PROBES ?? '[]').map(([x, y]) => ({ x, y, rgb: [1, 2, 3], tol: 0 }))]) } : {}),
    // ORACLE_DUMP=1 adds a count that cannot hold, so the run fails and prints what every count measured (and every probe read).
    ...(o.count || process.env.ORACLE_DUMP ? { ESTELLA_VERIFY_COUNT: JSON.stringify([...(o.count ?? []), ...(process.env.ORACLE_DUMP ? [{ rgb: [1, 2, 3], tol: 0, atLeast: SIZE * SIZE + 1 }] : [])]) } : {}),
    ...(o.uniform ? { ESTELLA_VERIFY_UNIFORM: '1' } : {}),
    ...(o.play ? { ESTELLA_VERIFY_PLAY: '1' } : {}),
    ...(o.twins ? { ESTELLA_VERIFY_TWINS: JSON.stringify(o.twins) } : {}),
  },
});
