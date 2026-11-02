// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A vertex program that reads the position in the mesh's own space (a terrain tiles its detail by `position.xz`) is given the engine's local position,
 *        and one that puts it through the world matrix keeps the world position it was given.
 */
import { describe, expect, it } from 'vitest';
import { convertPass } from '../src/import/cocos/effectConvert';
import { parseEffect } from '../src/import/cocos/effects';

const effectWith = (vertexBody: string): string => `
CCEffect %{
  techniques:
  - name: opaque
    passes:
    - vert: pos-vs:vert
      frag: pos-fs:frag
      properties:
        mainColor: { value: [1, 1, 1, 1], editor: { type: color } }
}%

CCProgram pos-vs %{
  precision highp float;
  in vec3 a_position;
  out vec2 v_uv;
${vertexBody}
}%

CCProgram pos-fs %{
  precision highp float;
  in vec2 v_uv;
  uniform Constant {
    vec4 mainColor;
  };
  vec4 frag () { return mainColor * vec4(v_uv, 0.0, 1.0); }
}%
`;

const convert = (vertexBody: string) => {
    const effect = parseEffect(effectWith(vertexBody));
    return convertPass(effect, effect.techniques[0]!.passes[0]!, 'pos.opaque.0');
};

describe('the position a vertex program reads', () => {
    it('is the mesh\'s own when the program takes components of it', () => {
        const converted = convert(`
  vec4 vert () {
    vec4 position = vec4(a_position, 1.0);
    v_uv = position.xz * 0.5;
    return position;
  }`);
        expect(converted.unsupported).toBeNull();
        const source = converted.shader!.source;
        expect(source).toContain('#pragma feature MESH_LOCAL_POSITION');
        expect(source).toContain('a_position = cocos_localPosition');
        expect(source).toContain('in highp vec3 v_localPos;');
    });

    it('stays the world position when the program puts it through the world matrix', () => {
        const converted = convert(`
  uniform Local { mat4 cc_matWorld; };
  vec4 vert () {
    vec4 world = cc_matWorld * vec4(a_position, 1.0);
    v_uv = world.xz * 0.5;
    return world;
  }`);
        expect(converted.unsupported).toBeNull();
        const source = converted.shader!.source;
        expect(source).not.toContain('MESH_LOCAL_POSITION');
        expect(source).toContain('a_position = cocos_position');
    });
});
