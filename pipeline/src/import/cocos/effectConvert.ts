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

// ---------------------------------------------------------------------------
// Includes
// ---------------------------------------------------------------------------

export interface EffectOptions {
    /** The text of a chunk by its include name (`common/data/unpack`, a project's `tower_defense_death_dissolve`), or null when there is none. */
    chunk?(name: string): string | null;
}

/** Chunks of Cocos that the prelude gives (a fragment's built-ins, the scene's uniform blocks): they are left out rather than read. */
const PROVIDED = /(?:^|\/)(?:fog-fs|output|output-standard|embedded-alpha|alpha-test|common-define|cc-global|cc-local|cc-environment|cc-forward-light|cc-shadow|gamma|aces)$/;

/** Chunks that make up Cocos's vertex input and its world matrix. The vertex stage is emulated (see below) with the prelude's version of them. */
const VERTEX_STRUCTURE = /(?:^|\/)(?:input|input-standard|decode-base|decode-standard|local-batch|fog-vs|shadow-map-vs|morph|skinning)$/;

const PROVIDED_AND_STRUCTURE = new RegExp(`${PROVIDED.source}|${VERTEX_STRUCTURE.source}`);

/**
 * A program's text with each `#include <name>` that is not the prelude's replaced by the chunk it names: a program of the same effect first, then
 * the project's chunks and the Creator install's, through {@link EffectOptions.chunk}. A chunk is read once for the whole shader, since a second
 * copy would declare its functions twice. What cannot be found is returned, so the pass can say what it lacked.
 */
function expandIncludes(
    source: string, effect: CocosEffect, options: EffectOptions, seen: Set<string>, missing: string[], depth = 0,
    skip: RegExp = PROVIDED,
): string {
    return source.replace(/^[ \t]*#[ \t]*include[ \t]*<([^>]+)>[ \t]*$/gm, (line, name: string) => {
        if (skip.test(name)) return '';
        if (seen.has(name)) return '';
        seen.add(name);
        const text = effect.programs.get(name)?.source ?? options.chunk?.(name) ?? null;
        if (text === null) { missing.push(name); return line; }
        if (depth > 12) { missing.push(`${name} (too deep)`); return line; }
        return expandIncludes(text, effect, options, seen, missing, depth + 1, skip);
    });
}

// ---------------------------------------------------------------------------
// The vertex stage, carried into the fragment
// ---------------------------------------------------------------------------

/**
 * What a vertex program of an effect hands to its fragment is almost always the surface made ready for shading: the world position and normal, the
 * uv scaled and offset by the material's tiling, a second uv, the vertex colour. The engine's vertex stage supplies the first of those and the uv,
 * and the rest are arithmetic on them. So the vertex program is not given a stage of its own: it is run in the fragment, ahead of the fragment's own
 * function, with the attributes it reads standing for what the engine's stage passes down. The result is the same for everything that is a function
 * of the vertex's own values and the material's (a tiling, a world position, a tangent frame), and costs a little more per pixel than per vertex.
 * What it cannot reproduce is where the vertex is drawn: a displacement of the position is not applied, which the pass says.
 */
const VERTEX_PRELUDE = `// The vertex stage of the effect, run per fragment on what the engine's vertex stage hands down.
struct StandardVertInput { highp vec4 position; vec3 normal; vec4 tangent; };
#define CCGetWorldMatrix(m) m = mat4(1.0)
#define CCGetWorldMatrixFull(m, mit) m = mat4(1.0); mit = mat4(1.0)
#define CC_HANDLE_GET_CLIP_FLIP(p) p
#define CCVertInput(In) CCDecode(In)
void CCDecode(out StandardVertInput In) { In.position = vec4(a_position, 1.0); In.normal = a_normal; In.tangent = a_tangent; }
void CCDecode(out vec4 position) { position = vec4(a_position, 1.0); }
`;

const ATTRIBUTE_SOURCES: Record<string, string> = {
    a_position: 'cocos_position', a_normal: 'cocos_normal', a_tangent: 'cocos_tangent', a_texCoord: 'v_texCoord', a_color: 'v_color',
    a_texCoord1: 'v_texCoord', a_uv0: 'v_texCoord',
};

/** The attributes the vertex stage always has: declared whether or not the program says so, since the prelude's decode reads them. */
const STANDARD_ATTRIBUTES: Record<string, string> = { a_position: 'vec3', a_normal: 'vec3', a_texCoord: 'vec2', a_tangent: 'vec4' };

/** The varyings the engine's vertex stage owns. */
const ENGINE_VARYING_NAMES = new Set(['v_color', 'v_texCoord', 'v_worldPos', 'v_worldXYZ', 'v_worldNormal', 'v_worldTangent']);

const TANGENT_VARYING = `#ifdef MESH_TANGENTS
in highp vec4 v_worldTangent;
#define cocos_tangent v_worldTangent
#else
#define cocos_tangent vec4(1.0, 0.0, 0.0, 1.0)
#endif`;

interface Emulated {
    /** The program, as GLSL that declares what it wrote as globals and has the entry `cocos_vert`. */
    source: string;
    /** The attributes it reads, as globals. */
    attributes: string;
    /** The names the vertex program writes for the fragment. */
    outputs: Set<string>;
    /** The assignments that give the attributes it declares their values. */
    attributeSetup: string[];
    approximations: string[];
}

function emulateVertex(program: string, entry: string): Emulated | { error: string } {
    const outputs = new Set<string>();
    const attributes = new Map<string, string>(Object.entries(STANDARD_ATTRIBUTES));
    const approximations: string[] = [];
    let text = program;
    // Declarations: an attribute is a global the setup fills; an output is a global the fragment then reads.
    text = text.replace(/^[ \t]*(?:layout\s*\([^)]*\)\s*)?in\s+(?:(?:highp|mediump|lowp|flat)\s+)*(\w+)\s+(a_\w+)\s*;[ \t]*$/gm, (_m, type: string, name: string) => {
        attributes.set(name, type);
        return '';
    });
    text = text.replace(/^[ \t]*(?:layout\s*\([^)]*\)\s*)?(?:flat\s+)?out\s+(?:(?:highp|mediump|lowp|flat)\s+)*(\w+)\s+(\w+)\s*;[ \t]*$/gm, (_m, type: string, name: string) => {
        outputs.add(name);
        return `${type} ${name};`;
    });
    const unknown = [...attributes.keys()].filter((a) => !(a in ATTRIBUTE_SOURCES) && !/^a_(?:matWorld|instanced|jointAnim|sh_|lightingMap|localShadow|vertexId|joints|weights|texCoord[2-9]|color1|dir|age)/.test(a));
    if (unknown.length > 0) return { error: `its vertex program reads the attributes ${unknown.join(', ')}, which the engine's vertex stage does not carry` };
    if (/\ba_sh_|\bCCGetSH|\bCC_USE_LIGHT_PROBE/.test(text)) return { error: 'its vertex program reads light-probe data, which a material does not get' };
    if ([...attributes.keys()].some((a) => /^a_(?:joints|weights)$/.test(a))) return { error: 'its vertex program skins the mesh, which the converted material does not' };
    if ([...attributes.keys()].some((a) => /^a_(?:matWorld|instanced|dir|age)/.test(a))) return { error: 'its vertex program reads per-instance data, which the engine\'s own instancing does not give a material' };
    const entryRe = new RegExp(`\\bvec4\\s+${entry}\\s*\\(\\s*\\)`);
    if (!entryRe.test(text)) return { error: `the vertex entry ${entry}() is not there` };
    text = text.replace(entryRe, 'vec4 cocos_vert()');
    if (/\bcc_(?:time)\b[^;]*\b(?:position|pos)\b|\b(?:position|pos)\b[^;]*\bcc_time\b/.test(text) || /\bsin\s*\([^;]*\b(?:position|pos)\b/.test(text)) {
        approximations.push('a displacement of the vertex position is not applied');
    }
    const setup: string[] = [];
    const declared: string[] = [];
    for (const [name, type] of attributes) {
        declared.push(`${type} ${name};`);
        const source = ATTRIBUTE_SOURCES[name];
        if (source) setup.push(`    ${name} = ${source}${coerce(type, name)};`);
        if (name === 'a_texCoord1') approximations.push('the second uv is the first until the engine carries one');
    }
    return { source: text, attributes: declared.join('\n'), outputs, attributeSetup: setup, approximations };
}

/** The conversion that makes an engine value of one width fit the type an attribute is declared with. */
function coerce(type: string, name: string): string {
    const width = { float: 1, vec2: 2, vec3: 3, vec4: 4 }[type] ?? 4;
    const from = name === 'a_color' ? 4 : name === 'a_tangent' ? 4 : name === 'a_position' || name === 'a_normal' ? 3 : 2;
    if (width === from) return '';
    if (width < from) return `.${'xyzw'.slice(0, width)}`;
    return '';
}

// ---------------------------------------------------------------------------
// One pass
// ---------------------------------------------------------------------------

/** Convert one pass. The effect's name is the shader's. */
export function convertPass(effect: CocosEffect, pass: EffectPass, shaderName: string, options: EffectOptions = {}): PassConversion {
    const state = stateOf(pass);
    const fail = (unsupported: string): PassConversion => ({ shader: null, unsupported, state });
    const [fragProgram, fragEntry = 'frag'] = pass.frag.split(':');
    const [vertProgram, vertEntry = 'vert'] = pass.vert.split(':');
    const programText = (name: string | undefined): string | null => (name ? effect.programs.get(name)?.source ?? options.chunk?.(name) ?? null : null);
    const fragSource = programText(fragProgram);
    if (fragSource === null) return fail(`fragment program ${fragProgram} is not in the effect`);
    // A vertex stage the Creator install supplies (`general-vs`, `legacy/main-functions/general-vs`) is the standard one: the engine's.
    const vertSource = programText(vertProgram);
    const standardVertex = vertSource === null
        && /^(?:(?:general|unlit|sprite|standard)-vs|legacy\/main-functions\/(?:general|unlit|standard)-vs|builtin\/.*)$/.test(vertProgram ?? '');
    if (vertSource === null && !standardVertex) return fail(`vertex program ${vertProgram} is not in the effect`);

    const approximations: string[] = [];
    const props = new Map(pass.properties.map((p) => [p.name, p]));
    const params: ConvertedShader['params'] = [];
    const declared = new Set<string>();
    const missing: string[] = [];
    const seen = new Set<string>();

    // The vertex program, carried into the fragment.
    let vertex: Emulated | null = null;
    let vertexText = '';
    if (vertSource !== null) {
        const expanded = expandIncludes(vertSource, effect, options, seen, missing, 0, PROVIDED_AND_STRUCTURE);
        const emulated = emulateVertex(expanded, vertEntry);
        if ('error' in emulated) return fail(emulated.error);
        vertex = emulated;
        vertexText = emulated.source;
        approximations.push(...emulated.approximations);
    }
    let body = expandIncludes(fragSource, effect, options, seen, missing);
    if (missing.length > 0) return fail(`it includes ${[...new Set(missing)].join(', ')}, which the engine has no counterpart for`);
    if (/fog-fs|fog-vs/.test(fragSource + (vertSource ?? ''))) approximations.push('fog is not applied');

    const strip = (text: string): string => text.replace(/^[ \t]*#[ \t]*pragma[ \t]+define[ \t]+(?!-meta)/gm, '#define ').replace(/^\s*#include\s*<[^>]+>\s*$/gm, '').replace(/^\s*precision\s+\w+\s+float\s*;\s*$/gm, '').replace(/^\s*#pragma\s+(?:builtin|define-meta|format)\([^)]*\)\s*$/gm, '').replace(/^\s*#pragma\s+define-meta[^\n]*$/gm, '');
    body = strip(body);
    vertexText = strip(vertexText);

    // The Constant blocks' members become parameters, the vertex program's as well as the fragment's; the blocks go.
    const blocks = (text: string): string => text.replace(/(?:layout\s*\([^)]*\)\s*)?uniform\s+(\w+)\s*\{([\s\S]*?)\}\s*;?/g, (_m, block: string, members: string) => {
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
    body = blocks(body);
    vertexText = blocks(vertexText);

    // Samplers: `uniform sampler2D name;` is a texture parameter, bound by the engine.
    const samplers = (text: string): string => text.replace(/(?:layout\s*\([^)]*\)\s*)?uniform\s+(?:highp\s+|mediump\s+|lowp\s+)?sampler(\w+)\s+(\w+)\s*;/g, (_m, dim: string, name: string) => {
        if (dim !== '2D') { approximations.push(`${name} is a sampler${dim}, which has no counterpart; it reads as a 2D texture`); }
        if (!declared.has(name)) {
            declared.add(name);
            const def = props.get(name)?.value;
            params.push({ name, type: 'texture', value: TEXTURE_DEFAULTS[String(def)] ?? 'white' });
        }
        return '';
    });
    body = samplers(body);
    vertexText = samplers(vertexText);

    // Varyings: what the vertex program wrote is a global of the emulation; the rest are the engine's, under Cocos's names. A name that is neither is
    // the pass's reason not to convert.
    const needed = new Set<string>();
    const renames = new Map<string, string>();
    const produced = vertex?.outputs ?? new Set<string>();
    body = body.replace(/^\s*in\s+(?:highp\s+|mediump\s+|lowp\s+)?(\w+)\s+(\w+)\s*;\s*$/gm, (_m, _type: string, name: string) => {
        if (produced.has(name)) return '';
        const v = VARYINGS[name];
        if (v) { needed.add(v.glsl); renames.set(name, v.name); return ''; }
        if (name === 'v_position' || name === 'v_worldPos') { needed.add(POSITION_VARYING); renames.set(name, 'cocos_position'); return ''; }
        if (name === 'v_normal') { needed.add(NORMAL_VARYING); renames.set(name, 'cocos_normal'); return ''; }
        if (name === 'v_tangent') { needed.add(TANGENT_VARYING); renames.set(name, 'cocos_tangent.xyz'); return ''; }
        needed.add(`/* the vertex stage does not supply ${name} */`);
        return '';
    });
    const unsupplied = [...needed].filter((n) => n.startsWith('/*'));
    if (unsupplied.length > 0) return fail(`its fragment reads ${unsupplied.map((m) => /supply (\w+)/.exec(m)![1]).join(', ')}, which the engine's vertex stage does not supply`);
    for (const [from, to] of renames) if (from !== to) body = body.replace(new RegExp(`\\b${from}\\b`, 'g'), to);
    // A vertex output named like one of the engine's varyings (`v_color`) is the emulation's own value, not the engine's: it goes by another name.
    for (const name of produced) {
        if (!ENGINE_VARYING_NAMES.has(name)) continue;
        const own = `cocos_${name}`;
        const re = new RegExp(`\\b${name}\\b`, 'g');
        body = body.replace(re, own);
        vertexText = vertexText.replace(re, own);
    }
    if (vertex) {
        // The emulation reads the engine's values through these, so it needs them declared even where the fragment itself does not.
        needed.add(VARYINGS.v_uv!.glsl);
        needed.add(VARYINGS.v_color!.glsl);
        needed.add(POSITION_VARYING);
        needed.add(NORMAL_VARYING);
        needed.add(TANGENT_VARYING);
    }
    const usesPosition = needed.has(POSITION_VARYING);
    if (usesPosition) approximations.push('v_position is the world position of the draw: the engine gives the full position to meshes with normals, and the plane position to sprites');

    // GLSL 1.00 spellings of the 3.00 functions, which Cocos's own compiler accepts.
    const modern = (text: string): string => text.replace(/\btexture2D\s*\(/g, 'texture(').replace(/\btextureCube\s*\(/g, 'texture(').replace(/\btexture2DLodEXT\s*\(/g, 'textureLod(');
    body = modern(body);
    vertexText = modern(vertexText);

    // Fog and shadow transfers are statements with the arguments of whichever overload the effect uses, and GLSL ES has no variadic macros, so they are
    // taken out as statements.
    const noStatements = (text: string): string => text.replace(/\b(?:CC_APPLY_FOG|CC_TRANSFER_FOG|CC_TRANSFER_SHADOW|CC_TRANSFER_SH)\s*\([^;]*\)\s*;/g, '');
    body = noStatements(body);
    vertexText = noStatements(vertexText);

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
    const everything = `${vertexText}\n${body}`;
    for (const [name, value] of Object.entries(sceneValues)) {
        if (!new RegExp(`\\b${name}\\b`).test(everything) || declared.has(name)) continue;
        declared.add(name);
        params.push({ name, type: 'vec4', value });
        approximations.push(`${name} is a parameter of the material, not the scene's`);
    }
    // The camera's matrices have no value at the fragment that means the same: the emulation's matrices are the identity.
    const matrices = ['cc_matView', 'cc_matProj', 'cc_matViewProj', 'cc_matWorld', 'cc_matWorldIT', 'cc_matViewInv'].filter((m) => new RegExp(`\\b${m}\\b`).test(everything));
    const matrixDefs = matrices.map((m) => `#define ${m} mat4(1.0)`).join('\n');

    // Alpha test: a parameter and a discard, behind the switch the effect uses.
    let alphaTest = '';
    if (/\bALPHA_TEST\s*\(/.test(body)) {
        if (!declared.has('alphaThreshold')) { declared.add('alphaThreshold'); params.push({ name: 'alphaThreshold', type: 'float', value: [0.5] }); }
        alphaTest = '#define ALPHA_TEST(c) if ((c).a < alphaThreshold) discard;';
    }

    // The entry: `vec4 frag()` is the fragment's colour.
    const entry = new RegExp(`\\bvec4\\s+${fragEntry}\\s*\\(\\s*\\)`);
    if (!entry.test(body)) return fail(`the fragment entry ${fragEntry}() is not there`);
    body = body.replace(entry, 'vec4 cocos_frag()');

    // Cocos reads a macro that is not defined as 0 in `#if`; GLSL ES refuses an undefined name there. A switch is defined when it is on.
    const definedFormed = (text: string): string => text.replace(/^([ \t]*#[ \t]*(?:el)?if)([ \t]+.*)$/gm, (_m, directive: string, expr: string) => `${directive}${definedForm(expr)}`);
    body = definedFormed(body);
    vertexText = definedFormed(vertexText);

    // Macros: what the code branches on is a switch a material turns on.
    const found = macrosIn(`${vertexText}\n${body}`);
    const switches = found.switches.filter((s) => !/^(MESH_NORMALS|MESH_TANGENTS|GL_ES|CC_[A-Z_]+_ENABLED)$/.test(s) && !found.compared.includes(s));
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
    const main = ['void main() {'];
    if (vertex) main.push(...vertex.attributeSetup, '    cocos_vert();');
    main.push('    fragColor = cocos_frag();', '}');
    lines.push('', '#pragma fragment', 'precision mediump float;', '', ...[...needed].filter((n) => !n.startsWith('/*')), '',
        ...(usesSpriteTexture ? ['uniform sampler2D u_textures[8];'] : []), 'out vec4 fragColor;', '', PRELUDE,
        ...(matrixDefs ? [matrixDefs, ''] : []), ...(alphaTest ? [alphaTest, ''] : []),
        ...(vertex ? [vertex.attributes, VERTEX_PRELUDE, vertexText.trim(), ''] : []), body.trim(), '', ...main, '#pragma end', '');
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
export function convertEffect(effect: CocosEffect, stem: string, options: EffectOptions = {}): EffectConversion {
    return {
        techniques: effect.techniques.map((t) => ({
            name: t.name,
            passes: t.passes.map((p, i) => convertPass(effect, p, `${stem}.${t.name}.${i}`, options)),
        })),
    };
}
