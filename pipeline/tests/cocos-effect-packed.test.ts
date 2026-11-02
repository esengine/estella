// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A uniform that properties are parts of (`colorScale: { value: [1,1,1], target: colorScaleAndCutoff.xyz }`) starts as those parts put together, not as
 *        zero: a fragment that multiplies by it would otherwise draw black.
 */
import { describe, expect, it } from 'vitest';
import { convertPass } from '../src/import/cocos/effectConvert';
import { parseEffect } from '../src/import/cocos/effects';

const EFFECT = `
CCEffect %{
  techniques:
  - name: opaque
    passes:
    - vert: unlit-vs:vert
      frag: unlit-fs:frag
      properties:
        mainColor:      { value: [1, 1, 1, 1], linear: true, editor: { type: color } }
        colorScale:     { value: [1, 0.5, 0.25], target: colorScaleAndCutoff.xyz }
        alphaThreshold: { value: 0.4, target: colorScaleAndCutoff.w }
}%

CCProgram unlit-vs %{
  precision highp float;
  in vec3 a_position;
  vec4 vert () { return vec4(a_position, 1.0); }
}%

CCProgram unlit-fs %{
  precision highp float;
  uniform Constant {
    vec4 mainColor;
    vec4 colorScaleAndCutoff;
  };
  vec4 frag () { vec4 o = mainColor; o.rgb *= colorScaleAndCutoff.xyz; return o; }
}%
`;

describe('a uniform made of properties', () => {
    it('starts as the properties it is made of', () => {
        const effect = parseEffect(EFFECT);
        const technique = effect.techniques[0]!;
        const converted = convertPass(effect, technique.passes[0]!, 'packed.opaque.0');
        const param = converted.shader?.params.find((p) => p.name === 'colorScaleAndCutoff');
        expect(param?.value).toEqual([1, 0.5, 0.25, 0.4]);
    });
});
