// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { transpileFragment } from '../src/shaders/wgsl/transpile';
import { withWgslTwin } from '../src/shaders/wgsl/twin';
import { ENGINE_SHADER_API } from '../src/shaders/wgsl/engineApi.generated';
import { BUILTIN_SHADER_TEMPLATES, MODEL } from '../src/render/builtinShaders';
import { deriveVoxelGround } from '../src/voxel/voxelShader';
import { CHARACTER_SHADER_TEMPLATES } from '../src/character/characterShaders';
import { FOLIAGE_SHADER_TEMPLATE } from '../src/foliage/foliageShader';
import { PARTICLE, DISTORTION } from '../src/render/vfxShaders';

const shader = (domain: string, body: string, params = ''): string =>
    `#pragma shader "T"\n#pragma version 300 es\n#pragma domain ${domain}\n${params}\n#pragma fragment\nprecision mediump float;\n${body}\n#pragma end\n`;
const t = (domain: string, body: string, params = ''): string => transpileFragment(shader(domain, body, params), ENGINE_SHADER_API);

describe('the WGSL a shader written in GLSL is given', () => {
    it('reads its params from the material block, its varyings from VSOut, its batch textures from their units', () => {
        const out = t('Unlit', 'in vec4 v_color;\nin vec2 v_texCoord;\nuniform sampler2D u_textures[1];\nout vec4 fragColor;\n'
            + 'void main() { vec4 base = texture(u_textures[0], v_texCoord) * v_color; fragColor = vec4(base.rgb * u_k, base.a); }',
        '#pragma param u_k float default(1)');
        expect(out).toContain('textureSample(t0, s0, es_v.v_texCoord) * es_v.v_color');
        expect(out).toContain('base.rgb * mc.u_k');
        expect(out).toMatch(/@fragment fn fs_main\(es_in : VSOut\) -> @location\(0\) vec4f/);
    });

    it('keeps the #ifdef it was written under, and declares a name of both branches once in each', () => {
        const out = t('Lit', 'in vec4 v_color;\n#ifdef MESH_NORMALS\nin highp vec3 v_worldNormal;\n#endif\nout vec4 fragColor;\nvoid main() {\n'
            + '#ifdef MESH_NORMALS\n    vec3 N = normalize(v_worldNormal);\n#else\n    vec3 N = vec3(0.0, 0.0, 1.0);\n#endif\n    fragColor = vec4(N, 1.0);\n}');
        expect(out).toMatch(/#ifdef MESH_NORMALS\n\s+let N = normalize\(es_v\.v_worldNormal\);\n#else\n\s+let N = vec3f\(0\.0, 0\.0, 1\.0\);\n#endif/);
    });

    it('writes an output the branches declare apart once, and one entry per combination of them', () => {
        const out = t('Lit', 'in vec4 v_color;\n#ifdef ES_GBUFFER\nlayout(location = 0) out vec4 fragColor;\nlayout(location = 1) out vec4 fragSurface;\n'
            + '#else\nout vec4 fragColor;\n#endif\nvoid main() { fragColor = v_color;\n#ifdef ES_GBUFFER\n    fragSurface = vec4(0.0);\n#endif\n}');
        expect(out.match(/var<private> fragColor/g)).toHaveLength(1);
        expect(out).toContain('#if defined(ES_GBUFFER)');
        expect(out).toContain('#if !defined(ES_GBUFFER)');
        expect(out).toContain('@location(1) fragSurface : vec4f');
    });

    it('writes a swizzle one component at a time, a scalar reaching each as itself', () => {
        const out = t('Unlit', 'out vec4 fragColor;\nvoid main() { vec4 c = vec4(1.0); c.rgb *= 0.5; c.xy = vec2(0.25, 0.75); fragColor = c; }');
        expect(out).toMatch(/c\.r \*= es_t\d+; c\.g \*= es_t\d+; c\.b \*= es_t\d+;/);
        expect(out).toMatch(/c\.x = es_t\d+\.x; c\.y = es_t\d+\.y;/);
    });

    it('renames a GLSL name WGSL keeps for itself, a builtin included', () => {
        const out = t('Unlit', 'in vec2 v_texCoord;\nout vec4 fragColor;\nvoid main() { vec2 dpdx = dFdx(v_texCoord); float ref = 1.0; fragColor = vec4(dpdx, ref, 1.0); }');
        expect(out).toContain('let dpdx_ = dpdx(es_v.v_texCoord);');
        expect(out).toContain('let ref_ = 1.0;');
    });

    it('takes the WGSL shadeLight returns into the arguments the GLSL one adds to', () => {
        const out = t('Lit', 'in vec2 v_worldPos;\nout vec4 fragColor;\nvoid main() {\n    vec3 l = vec3(0.0), g = vec3(0.0), x = vec3(0.0);\n'
            + '    SurfaceExt ext = surfaceExtNone(vec3(0.0, 0.0, 1.0));\n'
            + '    shadeLight(u_lights[0].posDir, u_lights[0].color, u_lights[0].spot, u_lights[0].shadow, u_lights[0].shadowMap, u_lights[0].falloff,\n'
            + '        vec3(0.0, 0.0, 1.0), vec3(0.0, 0.0, 1.0), vec3(v_worldPos, 0.0), 0.5, vec3(0.04), 1.0, 1.0, 0.5, ext, l, g, x, true);\n'
            + '    fragColor = vec4(l + g + x, 1.0);\n}');
        expect(out).toMatch(/let (es_t\d+) = shadeLight\(lc\.u_lights\[0\]\.posDir,[^;]*\); l \+= \1\.lit; g \+= \1\.gloss; x \+= \1\.extra;/);
    });

    it('turns GLSL\'s mod, atan and vector equality into what WGSL means by them', () => {
        const out = t('Unlit', 'out vec4 fragColor;\nvoid main() { vec2 a = vec2(1.0); float m = mod(a.x, 0.3); float b = atan(a.y, a.x); bool e = a == vec2(1.0); fragColor = vec4(m, b, float(e), 1.0); }');
        expect(out).toContain('fn es_mod1(x : f32, y : f32) -> f32 { return x - y * floor(x / y); }');
        expect(out).toContain('atan2(a.y, a.x)');
        expect(out).toContain('all(a == vec2f(1.0))');
    });

    it('names what it cannot write, and gives no twin for it', () => {
        expect(() => t('Unlit', 'out vec4 fragColor;\nvoid main() { float a = 0.0; float b = a++; fragColor = vec4(b); }')).toThrow(/inside an expression/);
        expect(() => t('Unlit', 'out vec4 fragColor;\nvoid main() { fragColor = vec4(u_nowhere); }')).toThrow(/'u_nowhere' is not declared/);
    });
});

describe('withWgslTwin', () => {
    it('adds a twin to a source with none, and leaves one that has its own', () => {
        const src = shader('Unlit', 'out vec4 fragColor;\nvoid main() { fragColor = vec4(1.0); }');
        expect(withWgslTwin(src)).toMatch(/\n#pragma fragment wgsl\n[\s\S]*@fragment fn fs_main[\s\S]*#pragma end\n$/);
        const twinned = `${src}#pragma fragment wgsl\n@fragment fn fs_main() -> @location(0) vec4f { return vec4f(1.0); }\n#pragma end\n`;
        expect(withWgslTwin(twinned)).toBe(twinned);
    });

    it('leaves a source whose own vertex stage has no WGSL', () => {
        const src = shader('Unlit', 'out vec4 fragColor;\nvoid main() { fragColor = vec4(1.0); }').replace('#pragma fragment', '#pragma vertex\nvoid main() {}\n#pragma end\n#pragma fragment');
        expect(withWgslTwin(src)).toBe(src);
    });
});

describe('the built-in shaders written in GLSL alone', () => {
    // Every built-in that ships no WGSL of its own is given it by the transpiler as it compiles on WebGPU; one that stopped
    // transpiling would draw nothing there, so each is held to it here.
    const sources: [string, string][] = [
        ...BUILTIN_SHADER_TEMPLATES.map((x) => [x.label, x.source] as [string, string]),
        ...CHARACTER_SHADER_TEMPLATES.map((x) => [x.label, x.source] as [string, string]),
        ['Foliage', FOLIAGE_SHADER_TEMPLATE.source], ['Particle', PARTICLE], ['Distortion', DISTORTION],
        ['Voxel Ground', deriveVoxelGround(MODEL)],
    ];
    const glslOnly = [...new Map(sources).entries()].filter(([, s]) => /^#pragma fragment[ \t]*$/m.test(s) && !/^#pragma fragment wgsl\b/m.test(s));

    it('are the ones whose twin was taken out', () => {
        expect(glslOnly.map(([n]) => n).sort()).toEqual(
            ['Distortion', 'Eye', 'Foliage', 'Ground Blend', 'Hair', 'Lit Particle', 'Matcap', 'Model', 'Particle', 'Skin', 'Toon', 'Voxel Ground'].sort());
    });

    it.each(glslOnly)('%s transpiles', (_, source) => {
        expect(() => transpileFragment(source, ENGINE_SHADER_API)).not.toThrow();
    });
});
