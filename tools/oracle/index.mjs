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

export const ORACLE = [...LIGHT_SCENES, ...SHADOW_SCENES, ...POST_SCENES, ...SKY_SCENES, ...LENS_SCENES, ...VOLUMETRIC_SCENES];

/** The renderScenes.mjs entry for one oracle scene. */
export const oracleEntry = (o) => ({
  id: o.id, tier: 'pr', webgpu: true,
  env: {
    ESTELLA_VERIFY_SCENE: `/scenes/${o.id}.esscene`,
    ESTELLA_VERIFY_W: String(SIZE), ESTELLA_VERIFY_H: String(SIZE), ESTELLA_VERIFY_STEPS: '3',
    ...(o.colorSpace === 'linear' ? { ESTELLA_VERIFY_COLORSPACE: 'linear' } : {}),
    ...(o.outputTransform ? { ESTELLA_VERIFY_OUTPUT_TRANSFORM: o.outputTransform } : {}),
    ...(o.expect ? { ESTELLA_VERIFY_EXPECT: JSON.stringify(o.expect) } : {}),
    ...(o.count ? { ESTELLA_VERIFY_COUNT: JSON.stringify(o.count) } : {}),
    ...(o.uniform ? { ESTELLA_VERIFY_UNIFORM: '1' } : {}),
    ...(o.play ? { ESTELLA_VERIFY_PLAY: '1' } : {}),
    ...(o.twins ? { ESTELLA_VERIFY_TWINS: JSON.stringify(o.twins) } : {}),
  },
});
