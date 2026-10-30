// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    effectConvert.ts
 * @brief   A Cocos `.effect` pass as an Estella `.esshader` and the render state of its `.esmaterial`.
 *
 * What carries across is what a pass says about its own fragment: the `frag()` function, the properties it reads (a `Constant` block's
 * members and its samplers, which become `#pragma param`), the macros it branches on (`#pragma switch`) and the pass's blend, depth and cull
 * state. The vertex stage is the engine's own: a pass whose vertex program only applies the standard transform needs nothing of its own, which
 * is the usual case (a sprite, a UI quad, an unlit mesh). A pass whose vertex program does more (a wave, a sway, an outline expansion) cannot be
 * given the engine's stage and is reported, not approximated: the converted material would draw something other than what it was made to.
 *
 * The Cocos built-ins a fragment calls (`CCFragOutput`, `CC_APPLY_FOG`, `cc_time`…) are given by a short prelude written here, not by
 * expanding the chunks of the Creator install, which are written against Cocos's own uniform buffers and pipeline.
 */
import { macrosIn, type CocosEffect, type EffectPass, type EffectProperty } from './effects';

export interface ConvertedShader {
    /** The `.esshader` source. */
    source: string;
    /** The macros the shader branches on, which a material turns on by name (`switches`). */
    switches: string[];
    /** The parameters it declares, by name, with the value a material starts from. */
    params: Array<{ name: string; type: 'float' | 'vec2' | 'vec3' | 'vec4' | 'color' | 'int' | 'texture'; value: number[] | string }>;
    /** What the engine does not do the way the effect asked: the shader still converts, and says so. */
    approximations: string[];
}

export interface PassConversion {
    shader: ConvertedShader | null;
    /** Why there is no shader: what the pass needs that the engine's stage does not give. */
    unsupported: string | null;
    /** `.esmaterial` render state. */
    state: { blendMode: number; depthTest: boolean; depthWrite: boolean; cull: number };
}

// ---------------------------------------------------------------------------
// Render state
// ---------------------------------------------------------------------------

const FACTOR = (v: unknown): string => String(v ?? '').toLowerCase();

/** The engine's blend mode for a Cocos blend target, or null where the pair is none of the engine's. */
function blendModeOf(blend: unknown): number {
    const targets = (blend as { targets?: Array<Record<string, unknown>> } | null)?.targets;
    const t = targets?.[0];
    if (!t || t.blend === false || t.blend === undefined) return 9;   // BlendMode.None: the source replaces
    const src = FACTOR(t.blendSrc ?? 'one');
    const dst = FACTOR(t.blendDst ?? 'zero');
    if (src === 'src_alpha' && dst === 'one_minus_src_alpha') return 0;
    if (src === 'src_alpha' && dst === 'one') return 1;
    if ((src === 'dst_color' || src === 'zero') && (dst === 'one_minus_src_alpha' || dst === 'src_color')) return 2;
    if (src === 'one' && dst === 'one_minus_src_color') return 3;
    if (src === 'one' && dst === 'one_minus_src_alpha') return 4;
    if (src === 'one' && dst === 'one') return 5;
    return 0;
}

function cullOf(rasterizer: unknown): number {
    const c = FACTOR((rasterizer as { cullMode?: unknown } | null)?.cullMode ?? 'back');
    return c === 'none' ? 0 : c === 'front' ? 2 : 1;
}

function stateOf(pass: EffectPass): PassConversion['state'] {
    const ds = (pass.depthStencil ?? {}) as { depthTest?: boolean; depthWrite?: boolean };
    return {
        blendMode: blendModeOf(pass.blend),
        depthTest: ds.depthTest ?? true,
        depthWrite: ds.depthWrite ?? true,
        cull: cullOf(pass.rasterizer),
    };
}

// ---------------------------------------------------------------------------
// Programs
// ---------------------------------------------------------------------------

const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/** The names a vertex stage may use and still be the engine's standard transform. */
const STANDARD_VERTEX_TOKENS = new Set([
    'cc_matWorld', 'cc_matView', 'cc_matProj', 'cc_matViewProj', 'a_position', 'a_texCoord', 'a_color', 'a_normal',
]);

/** Whether a vertex stage only places the vertex: nothing in it needs more than the engine's own. Null when it does; else why not. */
function customVertexReason(ref: string, effect: CocosEffect): string | null {
    const [program, entry] = ref.split(':');
    if (!program) return 'the pass names no vertex program';
    const found = effect.programs.get(program);
    // A chunk of the Creator install (`legacy/main-functions/general-vs`): the standard vertex stage of an unlit or lit mesh.
    // A program the Creator install supplies (`general-vs`, `legacy/main-functions/general-vs`): the standard vertex stage of a mesh or a quad.
    if (!found) return /^(?:(?:general|unlit|sprite|standard)-vs|legacy\/main-functions\/(?:general|unlit|standard)-vs)$/.test(program) ? null : `vertex program ${program} is not in the effect`;
    const code = stripComments(found.source);
    // Its own entry only: a helper another stage shares may use more.
    void entry;
    if (/\b#include\s*<legacy\/main-functions\/(general|unlit)-vs>/.test(code) && !/\bvoid\s+main\b/.test(code)) return null;
    const used = new Set<string>([...code.matchAll(/\b((?:cc|a)_[A-Za-z0-9_]+)\b/g)].map((m) => m[1]!));
    const extra = [...used].filter((u) => !STANDARD_VERTEX_TOKENS.has(u) && !u.startsWith('a_'));
    const attrs = [...used].filter((u) => u.startsWith('a_') && !STANDARD_VERTEX_TOKENS.has(u));
    if (extra.length > 0) return `its vertex program reads ${extra.join(', ')}`;
    if (attrs.length > 0) return `its vertex program reads the attributes ${attrs.join(', ')}`;
    if (/\btexture\s*\(|\bsin\s*\(|\bcos\s*\(/.test(code)) return 'its vertex program computes per-vertex displacement';
    return null;
}

/** Cocos names for what the engine's vertex stage hands the fragment. */
const VARYINGS: Record<string, { name: string; glsl: string; mesh?: boolean }> = {
    v_uv: { name: 'v_texCoord', glsl: 'in vec2 v_texCoord;' },
    uv0: { name: 'v_texCoord', glsl: 'in vec2 v_texCoord;' },
    v_color: { name: 'v_color', glsl: 'in vec4 v_color;' },
    color: { name: 'v_color', glsl: 'in vec4 v_color;' },
};

/** The world position a Cocos fragment reads as `v_position`. The engine's vertex stage gives the full position to a mesh that has normals and the position in the plane otherwise. */
const POSITION_VARYING = `#ifdef MESH_NORMALS
in highp vec3 v_worldXYZ;
#define cocos_position v_worldXYZ
#else
in highp vec2 v_worldPos;
#define cocos_position vec3(v_worldPos, 0.0)
#endif`;
const NORMAL_VARYING = `#ifdef MESH_NORMALS
in highp vec3 v_worldNormal;
#define cocos_normal v_worldNormal
#else
#define cocos_normal vec3(0.0, 0.0, 1.0)
#endif`;

const PRELUDE = `// Cocos built-ins the converted fragment calls.
#define CCFragOutput(c) (c)
#define CC_APPLY_FOG(c, p)
#define cc_time u_time
#define CC_HANDLE_RT_SAMPLE_FLIP(uv)
vec3 LinearToSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c)); }
vec3 SRGBToLinear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c)); }
`;

/**
 * A preprocessor expression with each bare macro name asked as `defined(NAME)`: a name that is not defined is 0 in Cocos, and in GLSL ES it is an
 * error. A name compared with a number (`LEVEL == 2`) is left as it is, which is the one thing a bare switch cannot say.
 */
function definedForm(expr: string): string {
    const kept: string[] = [];
    const guarded = expr.replace(/\bdefined\s*(?:\(\s*\w+\s*\)|\s+\w+)/g, (m) => { kept.push(m); return `\u0001${kept.length - 1}\u0001`; });
    const wrapped = guarded.replace(/\b([A-Z][A-Z0-9_]+)\b(?!\s*(?:==|!=|<=|>=|<|>))(?<!(?:==|!=|<=|>=|<|>)\s*[A-Z][A-Z0-9_]*)/g, 'defined($1)');
    return wrapped.replace(/\u0001(\d+)\u0001/g, (_m, i: string) => kept[Number(i)]!);
}

type ParamType = ConvertedShader['params'][number]['type'];

function paramTypeOf(glsl: string, prop: EffectProperty | undefined): ParamType {
    if (glsl === 'float') return 'float';
    if (glsl === 'int' || glsl === 'bool') return 'int';
    if (glsl === 'vec2') return 'vec2';
    if (glsl === 'vec3') return prop?.editorType === 'color' ? 'color' : 'vec3';
    return prop?.editorType === 'color' ? 'color' : 'vec4';
}

const TEXTURE_DEFAULTS: Record<string, string> = { white: 'white', grey: 'grey', gray: 'grey', black: 'black', normal: 'normal', default: 'white' };

const csv = (v: number[]): string => v.map((x) => String(+x.toFixed(6))).join(',');

function numbersOf(value: unknown, n: number): number[] {
    const arr = Array.isArray(value) ? value.map(Number) : typeof value === 'number' ? [value] : [];
    while (arr.length < n) arr.push(0);
    return arr.slice(0, n).map((x) => (Number.isFinite(x) ? x : 0));
}

const ARITY: Record<string, number> = { float: 1, int: 1, vec2: 2, vec3: 3, vec4: 4, color: 4 };

/** Convert one pass. The effect's name is the shader's. */
export function convertPass(effect: CocosEffect, pass: EffectPass, shaderName: string): PassConversion {
    const state = stateOf(pass);
    const vertex = customVertexReason(pass.vert, effect);
    if (vertex) return { shader: null, unsupported: vertex, state };
    const [fragProgram, fragEntry = 'frag'] = pass.frag.split(':');
    const program = effect.programs.get(fragProgram ?? '');
    if (!program) return { shader: null, unsupported: `fragment program ${fragProgram} is not in the effect`, state };

    const approximations: string[] = [];
    const props = new Map(pass.properties.map((p) => [p.name, p]));
    const params: ConvertedShader['params'] = [];
    const declared = new Set<string>();
    let body = program.source;

    // The programs it includes: named by what they give, which the prelude gives.
    const includes = [...body.matchAll(/#include\s*<([^>]+)>/g)].map((m) => m[1]!);
    for (const inc of includes) {
        if (/fog-fs|output|embedded-alpha|alpha-test|common-define|cc-global|cc-local|gamma/.test(inc)) continue;
        return { shader: null, unsupported: `it includes ${inc}, which the engine has no counterpart for`, state };
    }
    if (includes.some((i) => /fog-fs/.test(i))) approximations.push('fog is not applied');

    body = body.replace(/^\s*#include\s*<[^>]+>\s*$/gm, '').replace(/^\s*precision\s+\w+\s+float\s*;\s*$/gm, '').replace(/^\s*#pragma\s+builtin\([^)]*\)\s*$/gm, '');

    // The Constant block's members become parameters; the block goes.
    body = body.replace(/(?:layout\s*\([^)]*\)\s*)?uniform\s+(\w+)\s*\{([\s\S]*?)\}\s*;?/g, (_m, block: string, members: string) => {
        if (block === 'AlphaTestConstants' || block === 'ALPHA_TEST_CONSTANTS') { members = 'float alphaThreshold;'; }
        for (const decl of members.split(';')) {
            const m = /^\s*(?:highp\s+|mediump\s+|lowp\s+)?(float|int|bool|vec2|vec3|vec4)\s+(\w+)\s*$/.exec(decl.replace(/\/\/[^\n]*/g, '').trim());
            if (!m) continue;
            const [, glsl, name] = m as unknown as [string, string, string];
            if (declared.has(name)) continue;
            declared.add(name);
            const prop = props.get(name);
            const type = paramTypeOf(glsl, prop);
            params.push({ name, type, value: numbersOf(prop?.value ?? (name === 'alphaThreshold' ? 0.5 : 0), ARITY[type]!) });
        }
        return '';
    });

    // Samplers: `uniform sampler2D name;` is a texture parameter, bound by the engine.
    body = body.replace(/(?:layout\s*\([^)]*\)\s*)?uniform\s+(?:highp\s+|mediump\s+|lowp\s+)?sampler(\w+)\s+(\w+)\s*;/g, (_m, dim: string, name: string) => {
        if (dim !== '2D') { approximations.push(`${name} is a sampler${dim}, which has no counterpart; it reads as a 2D texture`); }
        if (!declared.has(name)) {
            declared.add(name);
            const def = props.get(name)?.value;
            params.push({ name, type: 'texture', value: TEXTURE_DEFAULTS[String(def)] ?? 'white' });
        }
        return '';
    });

    // Varyings: Cocos's names for what the engine's vertex stage supplies. One it does not supply is the pass's reason not to convert.
    const needed = new Set<string>();
    const renames = new Map<string, string>();
    body = body.replace(/^\s*in\s+(?:highp\s+|mediump\s+|lowp\s+)?(\w+)\s+(\w+)\s*;\s*$/gm, (_m, _type: string, name: string) => {
        const v = VARYINGS[name];
        if (v) { needed.add(v.glsl); renames.set(name, v.name); return ''; }
        if (name === 'v_position' || name === 'v_worldPos') { needed.add(POSITION_VARYING); renames.set(name, 'cocos_position'); return ''; }
        if (name === 'v_normal') { needed.add(NORMAL_VARYING); renames.set(name, 'cocos_normal'); return ''; }
        needed.add(`/* the vertex stage does not supply ${name} */`);
        return '';
    });
    const missing = [...needed].filter((n) => n.startsWith('/*'));
    if (missing.length > 0) return { shader: null, unsupported: `its fragment reads ${missing.map((m) => /supply (\w+)/.exec(m)![1]).join(', ')}, which the engine's vertex stage does not supply`, state };
    for (const [from, to] of renames) if (from !== to) body = body.replace(new RegExp(`\\b${from}\\b`, 'g'), to);
    const usesPosition = needed.has(POSITION_VARYING);
    if (usesPosition) approximations.push('v_position is the world position of the draw: the engine gives the full position to meshes with normals, and the plane position to sprites');

    // GLSL 1.00 spellings of the 3.00 functions, which Cocos's own compiler accepts.
    body = body.replace(/\btexture2D\s*\(/g, 'texture(').replace(/\btextureCube\s*\(/g, 'texture(').replace(/\btexture2DLodEXT\s*\(/g, 'textureLod(');

    // An atlas whose alpha is kept apart (ETC1) is sampled by a helper; here a texture holds its own alpha, so it is a plain sample. Spelt out, not
    // a macro: the engine's twin tool finds a batch texture by the form `texture(u_textures[N], …)`.
    body = body.replace(/\bCCSampleWithAlphaSeparated\s*\(/g, 'texture(');

    // The sprite's own texture: the engine binds it as the first of the batch's textures.
    let usesSpriteTexture = false;
    if (/\bcc_spriteTexture\b/.test(body)) {
        usesSpriteTexture = true;
        body = body.replace(/\bcc_spriteTexture\b/g, 'u_textures[0]');
    }

    // Cocos's scene values (`cc_ambientSky`, `cc_cameraPos`): the engine has no counterpart at the fragment, so each is a parameter of the material
    // that starts at a value that changes nothing, which the project can set where it had a scene setting.
    const sceneValues: Record<string, number[]> = {
        cc_ambientSky: [1, 1, 1, 1], cc_ambientGround: [1, 1, 1, 1], cc_cameraPos: [0, 0, 0, 1], cc_nearFar: [0.1, 1000, 0, 0],
        cc_screenSize: [1, 1, 1, 1], cc_exposure: [1, 1, 0, 0], cc_mainLitColor: [1, 1, 1, 1], cc_mainLitDir: [0, 0, -1, 0],
    };
    for (const [name, value] of Object.entries(sceneValues)) {
        if (!new RegExp(`\\b${name}\\b`).test(body) || declared.has(name)) continue;
        declared.add(name);
        params.push({ name, type: 'vec4', value });
        approximations.push(`${name} is a parameter of the material, not the scene's`);
    }

    // Alpha test: a parameter and a discard, behind the switch the effect uses.
    if (/\bALPHA_TEST\s*\(/.test(body)) {
        if (!declared.has('alphaThreshold')) { declared.add('alphaThreshold'); params.push({ name: 'alphaThreshold', type: 'float', value: [0.5] }); }
        body = `#define ALPHA_TEST(c) if ((c).a < alphaThreshold) discard;\n${body}`;
    }

    // The entry: `vec4 frag()` is the fragment's colour.
    const entry = new RegExp(`\\bvec4\\s+${fragEntry}\\s*\\(\\s*\\)`);
    if (!entry.test(body)) return { shader: null, unsupported: `the fragment entry ${fragEntry}() is not there`, state };
    body = body.replace(entry, 'vec4 cocos_frag()');

    // Cocos reads a macro that is not defined as 0 in `#if`; GLSL ES refuses an undefined name there. A switch is defined when it is on.
    body = body.replace(/^([ \t]*#[ \t]*(?:el)?if)([ \t]+.*)$/gm, (_m, directive: string, expr: string) => `${directive}${definedForm(expr)}`);

    // Macros: what the code branches on is a switch a material turns on.
    const found = macrosIn(body);
    const switches = found.switches.filter((s) => !/^(MESH_NORMALS|GL_ES|CC_[A-Z_]+_ENABLED)$/.test(s) && !found.compared.includes(s));
    if (found.compared.length > 0) approximations.push(`${found.compared.join(', ')} is compared to a number; the engine's switches are on or off`);

    const lines: string[] = [
        `#pragma shader "${shaderName}"`,
        '#pragma version 300 es',
        usesPosition ? '#pragma domain Lit' : '#pragma domain Unlit',
    ];
    for (const s of switches) lines.push(`#pragma switch ${s} default(${pass.macros[s] ? 'on' : 'off'})`);
    for (const p of params) {
        lines.push(p.type === 'texture'
            ? `#pragma param ${p.name} texture default(${p.value})`
            : `#pragma param ${p.name} ${p.type} default(${csv(p.value as number[])})`);
    }
    lines.push('', '#pragma fragment', 'precision mediump float;', '', ...[...needed].filter((n) => !n.startsWith('/*')).map((n) => n), '',
        ...(usesSpriteTexture ? ['uniform sampler2D u_textures[8];'] : []), 'out vec4 fragColor;', '', PRELUDE, body.trim(), '', 'void main() {', '    fragColor = cocos_frag();', '}', '#pragma end', '');
    return { shader: { source: lines.join('\n'), switches, params, approximations }, unsupported: null, state };
}

/**
 * Whether a pass draws an outline: a second draw of the mesh pushed out along its normals and shown from behind. It is a way of drawing the mesh, not
 * the mesh's own surface, so the pass that is the surface is the one a material is converted from.
 */
export function isOutlinePass(pass: EffectPass): boolean {
    return /outline/i.test(pass.vert) || /outline/i.test(pass.frag);
}

export interface EffectConversion {
    /** Each technique's passes, in order. */
    techniques: Array<{ name: string; passes: PassConversion[] }>;
}

/** Convert every pass of an effect. @p stem names the shaders. */
export function convertEffect(effect: CocosEffect, stem: string): EffectConversion {
    return {
        techniques: effect.techniques.map((t) => ({
            name: t.name,
            passes: t.passes.map((p, i) => convertPass(effect, p, `${stem}.${t.name}.${i}`)),
        })),
    };
}
