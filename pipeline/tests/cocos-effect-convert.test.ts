// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A Cocos `.effect` pass as an Estella `.esshader`: what is read from the effect, what the converted fragment declares, and which passes are
 *        not converted because the engine's vertex stage cannot stand in for theirs.
 */
import { describe, expect, it } from 'vitest';
import { parseEffect, describeEffect } from '../src/import/cocos/effects';
import { convertEffect, convertPass, pruneUnreachable } from '../src/import/cocos/effectConvert';

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

// The Creator install's own chunk, which a project has no copy of: the alpha test applies only where the effect switches USE_ALPHA_TEST on.
const ALPHA_TEST_CHUNK = `
#if USE_ALPHA_TEST
  uniform ALPHA_TEST_DATA {
    float alphaThreshold;
  };
#endif
void ALPHA_TEST (in vec4 color) {
  #if USE_ALPHA_TEST
    if (color.a < alphaThreshold) discard;
  #endif
}
`;
const chunk = (name: string): string | null => (name === 'builtin/internal/alpha-test' ? ALPHA_TEST_CHUNK : null);
const convertWithChunks = (effect: ReturnType<typeof parseEffect>, stem: string) => convertEffect(effect, stem, { chunk });

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
    const pass = convertWithChunks(parseEffect(SPRITE_ADD), 'sprite-add').techniques[0]!.passes[0]!;

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
        expect(pass.shader!.switches).toEqual(['USE_ALPHA_TEST', 'USE_GLOW', 'USE_TINT']);
        const source = pass.shader!.source;
        expect(source).toContain('#pragma switch USE_GLOW default(off)');
        expect(source).toContain('#if defined(USE_GLOW)');
        expect(source).toContain('#if !defined(USE_GLOW) && defined(USE_TINT)');
    });

    it('reads the alpha test from the install chunk, so it applies only where the effect switches it on', () => {
        const source = pass.shader!.source;
        expect(source).toContain('#pragma param alphaThreshold float default(0.5)');
        expect(source).toContain('#if defined(USE_ALPHA_TEST)');
        expect(source).toContain('void ALPHA_TEST (in vec4 color)');
        expect(source).not.toContain('#define ALPHA_TEST(c)');
    });

    it('has no switches when a material fixes its macros: they are baked in, and what is off is not defined', () => {
        const effect = parseEffect(SPRITE_ADD);
        const baked = convertPass(effect, effect.techniques[0]!.passes[0]!, 'baked', { chunk }, { USE_GLOW: true, USE_TINT: false });
        expect(baked.unsupported).toBeNull();
        const source = baked.shader!.source;
        expect(baked.shader!.switches).toEqual([]);
        expect(source).not.toContain('#pragma switch');
        expect(source).toContain('#define USE_GLOW 1');
        expect(source).not.toContain('#define USE_TINT');
        expect(source).not.toContain('#define USE_ALPHA_TEST');
    });

    it('maps the pass\'s blend, depth and cull state', () => {
        expect(pass.state).toEqual({ blendMode: 1, depthTest: false, depthWrite: false, cull: 0 });
    });
});

describe('a pass whose vertex program does more than place the vertex', () => {
    const SWAY = SPRITE_ADD.replace('vec4 pos = cc_matViewProj * vec4(a_position, 1);', 'vec4 pos = cc_matViewProj * vec4(a_position + vec3(sin(cc_time.x), 0, 0), 1);');

    it('is converted with its displacement as the material vertex hook, and that hook translates for WebGPU as well', async () => {
        const effect = parseEffect(SWAY);
        const swayed = convertPass(effect, effect.techniques[0]!.passes[0]!, 'sway', { chunk }, {});
        expect(swayed.unsupported).toBeNull();
        const source = swayed.shader!.source;
        expect(source).toContain('#pragma vertexoffset');
        expect(source).toContain('void esMaterialVertex(inout vec3 local, inout vec3 localNormal, in vec2 uv)');
        expect(source).toContain('local = cocos_vert().xyz;');
        // the hook has attribute names of its own: the engine vertex stage declares a_position and the others
        const hook = /#pragma vertexoffset\n([\s\S]*?)#pragma end/.exec(source)![1]!;
        expect(hook).not.toMatch(/(?<!hook_)\ba_position\b/);
        expect(swayed.shader!.approximations.join('\n')).not.toContain('displacement');
        // and the twin tool derives its WGSL, which is what a GLSL error in it would show as
        // @ts-expect-error a repo tool, shipped as .mjs with no declarations
        const tool = await import('../../tools/gen-shader-twins.mjs');
        let module: unknown = null;
        try { module = await tool.loadTwinModule(); } catch { /* no built engine here */ }
        if (module) {
            const derived = await tool.deriveTwin(module, source, {});
            expect(derived.status).toBe('generated');
            expect(derived.text).toContain('#pragma vertexoffset wgsl');
            expect(derived.text).toContain('tc.u_time');
        }
    }, 120000);

    it('is not converted when its vertex program skins the mesh', () => {
        const skinned = SPRITE_ADD.replace('in vec4 a_color;', 'in vec4 a_color;\n  in vec4 a_joints;');
        const converted = convertWithChunks(parseEffect(skinned), 'skin').techniques[0]!.passes[0]!;
        expect(converted.shader).toBeNull();
        expect(converted.unsupported).toMatch(/a_joints|skins/);
    });

    it('is not converted when its fragment reads something the vertex stage does not supply', () => {
        const odd = SPRITE_ADD.replace('in vec2 uv0;\n  uniform sampler2D', 'in vec2 uv0;\n  in vec3 v_barycentric;\n  uniform sampler2D');
        const converted = convertWithChunks(parseEffect(odd), 'odd').techniques[0]!.passes[0]!;
        expect(converted.shader).toBeNull();
        expect(converted.unsupported).toContain('v_barycentric');
    });
});

describe('what an entry does not reach', () => {
    it('is dropped, so a function of another entry that reads what this pass never declares cannot stop the shader', () => {
        const source = [
            'uniform float k;',
            'float helper(float x) { return x * k; }',
            'vec4 other() { return vec4(undeclaredName); }',
            'vec4 cocos_frag() {',
            '  if (k > 0.0) { return vec4(helper(1.0)); }',
            '  return vec4(0.0);',
            '}',
        ].join('\n');
        const pruned = pruneUnreachable(source, ['cocos_frag']);
        expect(pruned).toContain('float helper(float x)');
        expect(pruned).toContain('vec4 cocos_frag()');
        expect(pruned).not.toContain('undeclaredName');
        expect(pruned).toContain('uniform float k;');
    });

    it('keeps what a macro or a declaration outside the functions names', () => {
        const source = ['float a() { return 1.0; }', '#define USE_A a()', 'vec4 cocos_frag() { return vec4(USE_A); }'].join('\n');
        expect(pruneUnreachable(source, ['cocos_frag'])).toContain('float a()');
    });
});
