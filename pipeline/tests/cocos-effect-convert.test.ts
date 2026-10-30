// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A Cocos `.effect` pass as an Estella `.esshader`: what is read from the effect, what the converted fragment declares, and which passes are
 *        not converted because the engine's vertex stage cannot stand in for theirs.
 */
import { describe, expect, it } from 'vitest';
import { parseEffect, describeEffect } from '../src/import/cocos/effects';
import { convertEffect } from '../src/import/cocos/effectConvert';

const SPRITE_ADD = `
CCEffect %{
  techniques:
  - passes:
    - vert: sprite-vs:vert
      frag: sprite-fs:frag
      depthStencilState: { depthTest: false, depthWrite: false }
      blendState:
        targets:
        - blend: true
          blendSrc: src_alpha
          blendDst: one
      rasterizerState: { cullMode: none }
      properties:
        addColor: { value: [0.0, 0.5, 0.25, 1], editor: { type: color } }
        addWeight: { value: 1.0 }
        mainTexture: { value: grey }
}%
CCProgram sprite-vs %{
  precision highp float;
  #include <builtin/uniforms/cc-global>
  in vec3 a_position;
  in vec2 a_texCoord;
  in vec4 a_color;
  out vec4 color;
  out vec2 uv0;
  vec4 vert () {
    vec4 pos = cc_matViewProj * vec4(a_position, 1);
    uv0 = a_texCoord;
    color = a_color;
    return pos;
  }
}%
CCProgram sprite-fs %{
  precision highp float;
  #include <builtin/internal/alpha-test>
  in vec4 color;
  in vec2 uv0;
  uniform sampler2D mainTexture;
  uniform Constant {
    vec4 addColor;
    float addWeight;
  };
  vec4 frag () {
    vec4 o = texture(mainTexture, uv0) * color;
    #if USE_GLOW
      o.rgb += addColor.rgb * addWeight;
    #endif
    #if !USE_GLOW && USE_TINT
      o.rgb *= 0.5;
    #endif
    ALPHA_TEST(o);
    return CCFragOutput(o);
  }
}%
`;

describe('reading an effect', () => {
    it('reads its techniques, passes and properties, and its programs', () => {
        const effect = parseEffect(SPRITE_ADD);
        expect(effect.techniques).toHaveLength(1);
        const pass = effect.techniques[0]!.passes[0]!;
        expect(pass.frag).toBe('sprite-fs:frag');
        expect(pass.properties.map((p) => [p.name, p.editorType])).toEqual([['addColor', 'color'], ['addWeight', null], ['mainTexture', null]]);
        expect([...effect.programs.keys()]).toEqual(['sprite-vs', 'sprite-fs']);
    });

    it('says what the programs ask of the renderer', () => {
        const facts = describeEffect(parseEffect(SPRITE_ADD), 'sprite-add.effect');
        expect(facts.kind).toBe('sprite');
        expect(facts.macros).toEqual(['USE_GLOW', 'USE_TINT']);
        expect(facts.usesLighting).toBe(false);
        expect(facts.samplers).toBe(1);
    });
});

describe('converting a pass', () => {
    const pass = convertEffect(parseEffect(SPRITE_ADD), 'sprite-add').techniques[0]!.passes[0]!;

    it('turns the Constant block and the samplers into parameters, with the effect\'s defaults', () => {
        expect(pass.unsupported).toBeNull();
        const source = pass.shader!.source;
        expect(source).toContain('#pragma param addColor color default(0,0.5,0.25,1)');
        expect(source).toContain('#pragma param addWeight float default(1)');
        expect(source).toContain('#pragma param mainTexture texture default(grey)');
        expect(source).not.toMatch(/uniform\s+Constant/);
        expect(source).not.toMatch(/uniform sampler2D mainTexture/);
    });

    it('runs the effect vertex program ahead of the fragment, on what the engine vertex stage hands down', () => {
        const source = pass.shader!.source;
        expect(source).not.toContain('#pragma vertex');
        expect(source).toContain('in vec2 v_texCoord;');
        expect(source).toContain('vec4 cocos_vert()');
        expect(source).toContain('a_texCoord = v_texCoord;');
        expect(source).toContain('    cocos_vert();\n    fragColor = cocos_frag();');
    });

    it('makes the macros it branches on switches, asked as defined() because an undefined name is an error in GLSL ES', () => {
        expect(pass.shader!.switches).toEqual(['USE_GLOW', 'USE_TINT']);
        const source = pass.shader!.source;
        expect(source).toContain('#pragma switch USE_GLOW default(off)');
        expect(source).toContain('#if defined(USE_GLOW)');
        expect(source).toContain('#if !defined(USE_GLOW) && defined(USE_TINT)');
    });

    it('gives the alpha test its threshold as a parameter', () => {
        expect(pass.shader!.source).toContain('#pragma param alphaThreshold float default(0.5)');
        expect(pass.shader!.source).toContain('#define ALPHA_TEST(c) if ((c).a < alphaThreshold) discard;');
    });

    it('maps the pass\'s blend, depth and cull state', () => {
        expect(pass.state).toEqual({ blendMode: 1, depthTest: false, depthWrite: false, cull: 0 });
    });
});

describe('a pass whose vertex program does more than place the vertex', () => {
    const SWAY = SPRITE_ADD.replace('vec4 pos = cc_matViewProj * vec4(a_position, 1);', 'vec4 pos = cc_matViewProj * vec4(a_position + vec3(sin(cc_time.x), 0, 0), 1);');

    it('is converted without the displacement, and says so', () => {
        const swayed = convertEffect(parseEffect(SWAY), 'sway').techniques[0]!.passes[0]!;
        expect(swayed.unsupported).toBeNull();
        expect(swayed.shader!.approximations).toContain('a displacement of the vertex position is not applied');
    });

    it('is not converted when its vertex program skins the mesh', () => {
        const skinned = SPRITE_ADD.replace('in vec4 a_color;', 'in vec4 a_color;\n  in vec4 a_joints;');
        const converted = convertEffect(parseEffect(skinned), 'skin').techniques[0]!.passes[0]!;
        expect(converted.shader).toBeNull();
        expect(converted.unsupported).toMatch(/a_joints|skins/);
    });

    it('is not converted when its fragment reads something the vertex stage does not supply', () => {
        const odd = SPRITE_ADD.replace('in vec2 uv0;\n  uniform sampler2D', 'in vec2 uv0;\n  in vec3 v_barycentric;\n  uniform sampler2D');
        const converted = convertEffect(parseEffect(odd), 'odd').techniques[0]!.passes[0]!;
        expect(converted.shader).toBeNull();
        expect(converted.unsupported).toContain('v_barycentric');
    });
});
