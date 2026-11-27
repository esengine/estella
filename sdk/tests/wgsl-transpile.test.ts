// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { transpileFragment, transpileVertexHook } from '../src/shaders/wgsl/transpile';
import { TERRAIN_LAYERS_SHADER_TEMPLATE, TERRAIN_SHADER_TEMPLATE } from '../src/terrain/terrainShader';
import { PLANET_SHADER_TEMPLATE } from '../src/terrain/planetShader';
import { WATER_SHADER_TEMPLATE } from '../src/water/waterShader';
import { withWgslTwin, wgslTwinProblem } from '../src/shaders/wgsl/twin';
import { ENGINE_SHADER_API } from '../src/shaders/wgsl/engineApi.generated';
import { BUILTIN_SHADER_TEMPLATES, MODEL } from '../src/render/builtinShaders';
import { deriveVoxelGround } from '../src/voxel/voxelShader';
import { CHARACTER_SHADER_TEMPLATES } from '../src/character/characterShaders';
import { FOLIAGE_SHADER_TEMPLATE } from '../src/foliage/foliageShader';
import { STRANDS_SHADER_TEMPLATE } from '../src/groom/groomShader';
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

    it('hands the Lit header the varyings its GLSL reads straight: the probe slot, the bake and the tangent frame', () => {
        const setups = [...transpileFragment(MODEL, ENGINE_SHADER_API).matchAll(/es_v = es_in;[^\n]*\n([\s\S]*?)\n\s+es_main\(\);/g)].map((m) => m[1]!);
        expect(setups.length).toBeGreaterThan(0);
        for (const setup of setups) {
            expect(setup).toMatch(/^\s+g_probeSlot = es_in\.v_probeSlot;$/m);
            expect(setup).toMatch(/^#ifdef MESH_LIGHTMAP\n\s+g_lightmap = es_in\.v_lightmap;\n#endif$/m);
            expect(setup).toMatch(/^#ifdef MESH_TANGENTS\n\s+g_worldTangent = es_in\.v_worldTangent;\n#endif$/m);
        }
        expect(t('Unlit', 'in vec4 v_color;\nout vec4 fragColor;\nvoid main() { fragColor = v_color; }')).not.toMatch(/\bg_\w+ = es_in\./);
    });

    it('reads a normal map through its mips, as GLSL\'s texture() does', () => {
        const out = transpileFragment(MODEL, ENGINE_SHADER_API);
        expect(out).toContain('return sampleNormalGrad(map, samp, uv, dpdx(uv), dpdy(uv));');
        expect(out).toMatch(/es_sampleNormal\(\w+, \w+, uv\)/);
        expect(out).not.toMatch(/(?<![\w.])sampleNormal\(/);
    });
});

describe('a fullscreen pass, the engine\'s samplers and a vertex hook', () => {
    it('reads the pass\'s input and the scene by their units, and the scene\'s depth by texel', () => {
        const out = t('PostProcess', 'in vec2 v_texCoord;\nuniform sampler2D u_texture;\nuniform highp sampler2D u_sceneDepth;\nout vec4 fragColor;\n'
            + 'void main() { float d = texelFetch(u_sceneDepth, ivec2(0), 0).r; float e = texture(u_sceneDepth, v_texCoord).r;\n'
            + '    fragColor = texture(u_texture, v_texCoord) * (d + e); }');
        expect(out).toContain('textureSample(t0, s0, es_v.v_texCoord)');
        expect(out).toContain('vec4f(textureLoad(t7, vec2i(0), 0), 0.0, 0.0, 1.0).r');
        expect(out).toContain('es_depthAt(t7, es_v.v_texCoord)');
        expect(out).toContain('fn es_depthAt(t : texture_depth_2d, uv : vec2f) -> f32');
    });

    it('takes an array layer as GLSL does, the nearest one', () => {
        const out = t('Lit', 'in vec2 v_texCoord;\nout vec4 fragColor;\nvoid main() { fragColor = texture(u_layers, vec3(v_texCoord, 2.0)); }',
            '#pragma param u_layers textureArray');
        expect(out).toContain('textureSample(u_layers, u_layers_s, vec3f(es_v.v_texCoord, 2.0).xy, i32(floor(vec3f(es_v.v_texCoord, 2.0).z + 0.5)))');
    });

    it('writes what an engine function returns into its out arguments, and refuses an inout it does not know the meaning of', () => {
        const out = t('PostProcess', 'out vec4 fragColor;\n#pragma lights\nvoid main() { vec4 dir, colour; ivec2 tiles; findSun(dir, colour, tiles); fragColor = colour; }'
            .replace('#pragma lights\n', ''), '#pragma lights');
        expect(out).toMatch(/let (es_t\d+) = findSun\(\); dir = \1\.dir; colour = \1\.color; tiles = \1\.tiles;/);
        expect(() => t('Lit', 'in vec2 v_worldPos;\nout vec4 fragColor;\nvoid main() { vec3 lit = vec3(0.0);\n'
            + '    shadeLight2D(u_lights[0].posDir, u_lights[0].color, u_lights[0].spot, u_lights[0].shadow, u_lights[0].shadowMap, u_lights[0].falloff,\n'
            + '        vec3(0.0, 0.0, 1.0), vec3(v_worldPos, 0.0), false, vec4(1.0), vec4(1.0), lit, false);\n'
            + '    fragColor = vec4(lit, 1.0); }')).toThrow(/shadeLight2D/);
    });

    it('writes a vertex hook\'s functions, reading a texture at level 0 and refusing a derivative', () => {
        const src = `${shader('Lit', 'out vec4 fragColor;\nvoid main() { fragColor = vec4(1.0); }', '#pragma param u_height texture')}`
            .replace('#pragma fragment', '#pragma vertexoffset\nvoid esMaterialVertex(inout vec3 local, inout vec3 localNormal, in vec2 uv) {\n'
                + '    local.y += texture(u_height, uv).r * u_scale;\n}\n#pragma end\n#pragma fragment');
        const withScale = src.replace('#pragma param u_height texture', '#pragma param u_height texture\n#pragma param u_scale float');
        const hook = transpileVertexHook(withScale, ENGINE_SHADER_API);
        expect(hook).toContain('fn esMaterialVertex(local : ptr<function, vec3f>, localNormal : ptr<function, vec3f>, uv : vec2f)');
        expect(hook).toContain('(*local).y += textureSampleLevel(u_height, u_height_s, uv, 0.0).r * mc.u_scale;');
        expect(() => transpileVertexHook(withScale.replace('texture(u_height, uv).r', 'dFdx(uv.x)'), ENGINE_SHADER_API)).toThrow(/vertex stage/);
    });

    it('builds an array as a var, and writes `a = b = c` as two statements', () => {
        const out = t('Unlit', 'out vec4 fragColor;\nvoid main() { const float W[3] = float[3](0.25, 0.5, 0.25); vec3 a, b;\n'
            + '    a = b = vec3(W[1]); fragColor = vec4(a + b, 1.0); }');
        expect(out).toContain('var W : array<f32, 3> = array<f32, 3>(0.25, 0.5, 0.25);');
        expect(out).toMatch(/b = vec3f\(W\[1\]\);\n\s+a = b;/);
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
        ['Foliage', FOLIAGE_SHADER_TEMPLATE.source], ['Strands', STRANDS_SHADER_TEMPLATE.source], ['Particle', PARTICLE], ['Distortion', DISTORTION],
        ['Voxel Ground', deriveVoxelGround(MODEL)],
        ['Terrain', TERRAIN_SHADER_TEMPLATE.source], ['Terrain Layers', TERRAIN_LAYERS_SHADER_TEMPLATE.source],
        ['Planet', PLANET_SHADER_TEMPLATE.source], ['Water', WATER_SHADER_TEMPLATE.source],
    ];
    const glslOnly = [...new Map(sources).entries()].filter(([, s]) => /^#pragma fragment[ \t]*$/m.test(s) && !/^#pragma fragment wgsl\b/m.test(s));
    const withoutTwins = (s: string): string => s.replace(/^#pragma (?:fragment|vertexoffset) wgsl[^\n]*\n[\s\S]*?^#pragma end[^\n]*\n?/gm, '');

    it('are the ones whose twin was taken out', () => {
        expect(glslOnly.map(([n]) => n).sort()).toEqual(
            ['Distortion', 'Eye', 'Foliage', 'Gradient', 'Ground Blend', 'Hair', 'Lit Particle', 'Matcap', 'Model', 'Particle', 'Skin', 'Strands', 'Terrain Layers', 'Toon', 'Voxel Ground', 'Water'].sort());
    });

    it.each(glslOnly)('%s transpiles', (_, source) => {
        expect(() => transpileFragment(source, ENGINE_SHADER_API)).not.toThrow();
    });

    // The ones that still ship hand-written WGSL are held to transpiling too, fragment and vertex hook: a twin can only be taken out
    // of a shader the transpiler already writes, so a GLSL edit it cannot follow is found here and not the day the twin goes.
    it.each([...new Map(sources).entries()])('%s transpiles without its hand-written WGSL', (_, source) => {
        const glsl = withoutTwins(source);
        if (/^#pragma vertex[ \t]*\r?$/m.test(glsl)) return;
        expect(() => transpileFragment(glsl, ENGINE_SHADER_API)).not.toThrow();
        if (/^#pragma vertexoffset[ \t]*\r?$/m.test(glsl)) expect(() => transpileVertexHook(glsl, ENGINE_SHADER_API)).not.toThrow();
    });
});

describe('why a shader would draw on WebGL alone', () => {
    it('is nothing for a source that translates, or that has nothing to translate', () => {
        expect(wgslTwinProblem(shader('Unlit', 'in vec4 v_color;\nout vec4 fragColor;\nvoid main() { fragColor = v_color; }'))).toBeNull();
        expect(wgslTwinProblem('#pragma shader "T"\n#pragma domain Unlit\n')).toBeNull();
    });

    it('names the line of the whole file the transpiler stopped at, not the line of its section', () => {
        const source = shader('Unlit', 'in vec4 v_color;\nout vec4 fragColor;\nvoid main() {\n    fragColor = v_color *;\n}');
        const problem = wgslTwinProblem(source);
        expect(problem?.section).toBe('fragment');
        expect(problem?.line).toBe(source.split('\n').findIndex((l) => l.includes('v_color *;')) + 1);
        expect(problem?.message).not.toMatch(/^line \d+/);
        // Asked again, it answers again: nothing is remembered between edits.
        expect(wgslTwinProblem(source)).toEqual(problem);
    });
});

describe('the Gradient a screen is drawn with', () => {
    it('is a built-in template WebGPU can be given', () => {
        const gradient = BUILTIN_SHADER_TEMPLATES.find((t) => t.id === 'gradient');
        expect(gradient).toBeDefined();
        expect(wgslTwinProblem(gradient!.source)).toBeNull();
        expect(Object.keys(gradient!.defaults)).toEqual(expect.arrayContaining(['u_from', 'u_to', 'u_angle', 'u_fadeIn', 'u_fadeOut']));
    });
});
