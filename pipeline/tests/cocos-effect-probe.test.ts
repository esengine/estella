// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A vertex program that reads light-probe data only under `CC_USE_LIGHT_PROBE` does not read it for a material, which is given none: such a pass converts,
 *        and one that reads probes without that guard still does not.
 */
import { describe, expect, it } from 'vitest';
import { convertPass } from '../src/import/cocos/effectConvert';
import { parseEffect } from '../src/import/cocos/effects';

const effectWith = (vertexBody: string): string => `
CCEffect %{
  techniques:
  - name: opaque
    passes:
    - vert: probe-vs:vert
      frag: probe-fs:frag
      properties:
        mainColor: { value: [1, 1, 1, 1], editor: { type: color } }
}%

CCProgram probe-vs %{
  precision highp float;
  in vec3 a_position;
${vertexBody}
}%

CCProgram probe-fs %{
  precision highp float;
  uniform Constant {
    vec4 mainColor;
  };
  vec4 frag () { return mainColor; }
}%
`;

const convert = (vertexBody: string) => {
    const effect = parseEffect(effectWith(vertexBody));
    return convertPass(effect, effect.techniques[0]!.passes[0]!, 'probe.opaque.0');
};

describe('a vertex program that mentions light probes', () => {
    it('converts when it reads them only under the probe macro', () => {
        const converted = convert(`
  #if CC_USE_LIGHT_PROBE
    in vec4 a_sh_linear_const_r;
    out vec3 v_sh;
    vec3 probe () { return CCGetSH(a_sh_linear_const_r); }
  #endif
  vec4 vert () {
  #if CC_USE_LIGHT_PROBE
    vec3 sh = probe();
  #else
    vec3 sh = vec3(0.0);
  #endif
    return vec4(a_position + sh, 1.0);
  }`);
        expect(converted.unsupported).toBeNull();
        expect(converted.shader?.source).toContain('cocos_vert');
    });

    it('is still refused when it reads them outside that guard', () => {
        const converted = convert(`
  in vec4 a_sh_linear_const_r;
  vec4 vert () { return vec4(a_position + CCGetSH(a_sh_linear_const_r), 1.0); }`);
        expect(converted.unsupported).toContain('light-probe');
    });
});
